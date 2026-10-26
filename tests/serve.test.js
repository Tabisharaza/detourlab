import test from 'node:test';
import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { readFile, mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequestHandler } from '../scripts/serve.js';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const regularFile = { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
const directoryEntry = { isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false };
const parentEntry = filename => filename === root || filename === path.join(root, 'src');
const ordinaryLstat = async filename => parentEntry(filename) ? directoryEntry : regularFile;
const missing = code => Object.assign(new Error('Synthetic file read failure'), { code });

// Real Node response/header behavior over an in-memory stream. No listening
// socket or browser is used; these are HTTP-handler tests, not browser QA.
async function request(handler, url = '/', method = 'GET') {
  const socket = new PassThrough(), chunks = [];
  socket.on('data', chunk => chunks.push(chunk));
  const req = new IncomingMessage(socket);
  // HTTP/1.0 keeps the wire body unchunked for exact byte comparison.
  req.url = url; req.method = method; req.httpVersionMajor = 1; req.httpVersionMinor = 0;
  const res = new ServerResponse(req);
  res.assignSocket(socket);
  const finished = once(res, 'finish');
  try {
    await handler(req, res);
    assert.equal(res.writableEnded, true, 'every request must complete its response');
    await finished;
    const bytes = Buffer.concat(chunks);
    return { status: res.statusCode, wire: bytes.toString('utf8'), body: bytes.subarray(bytes.indexOf('\r\n\r\n') + 4) };
  } finally {
    res.detachSocket(socket);
    socket.destroy();
  }
}

async function syntheticTree(t) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'detourlab-preview-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const directory = path.join(temporary, 'site');
  for (const folder of ['src/nested', 'public', 'examples', '.private']) await mkdir(path.join(directory, folder), { recursive: true });
  await mkdir(path.join(temporary, 'outside'));
  for (const [name, bytes] of Object.entries({
    'site/index.html': '<!doctype html><title>Synthetic preview</title>',
    'site/src/app.js': 'export const synthetic = true;\n',
    'site/src/nested/module.js': 'export const nested = true;\n',
    'site/public/icon.svg': '<svg/>',
    'site/examples/input.json': '{"synthetic":true}\n',
    'site/.private/note.txt': 'synthetic hidden content',
    'outside/note.txt': 'synthetic outside content',
  })) await writeFile(path.join(temporary, name), bytes);
  return { temporary, directory, handler: createRequestHandler(directory) };
}

for (const target of ['outside', 'hidden', 'asset']) {
  test(`preview rejects a file symlink targeting ${target} content for GET and HEAD`, async t => {
    const { temporary, directory, handler } = await syntheticTree(t);
    const destination = target === 'outside' ? path.join(temporary, 'outside/note.txt')
      : path.join(directory, target === 'hidden' ? '.private/note.txt' : 'src/app.js');
    await symlink(destination, path.join(directory, 'src/linked.js'), 'file');
    for (const method of ['GET', 'HEAD']) {
      const response = await request(handler, '/src/linked.js', method);
      assert.equal(response.status, 404);
      assert.doesNotMatch(response.wire, /synthetic (outside|hidden)|export const/u);
      if (method === 'HEAD') assert.equal(response.body.length, 0);
    }
    assert.equal((await request(handler, '/src/app.js')).status, 200);
  });
}

for (const level of ['top', 'nested', 'root']) {
  test(`preview rejects a ${level}-level directory symlink without exposing descendants`, async t => {
    const { temporary, directory } = await syntheticTree(t);
    let handler = createRequestHandler(directory), url;
    if (level === 'root') {
      const alias = path.join(temporary, 'alias');
      await symlink(directory, alias, 'dir');
      handler = createRequestHandler(alias); url = '/src/app.js';
    } else {
      const parent = level === 'top' ? 'public' : 'src/nested';
      await rm(path.join(directory, parent), { recursive: true });
      await symlink(path.join(temporary, 'outside'), path.join(directory, parent), 'dir');
      url = `/${parent}/note.txt`;
    }
    for (const method of ['GET', 'HEAD']) assert.equal((await request(handler, url, method)).status, 404);
  });
}

test('ordinary root, nested and encoded assets preserve GET bytes and body-free HEAD', async t => {
  const { directory, handler } = await syntheticTree(t);
  await writeFile(path.join(directory, 'public/space name-λ.txt'), 'synthetic unicode asset');
  for (const [url, filename] of [
    ['/', 'index.html'], ['/index.html', 'index.html'], ['/src/app.js', 'src/app.js'],
    ['/src\\app.js', 'src/app.js'], // Literal backslashes are URL-normalized first.
    ['/src/nested/module.js', 'src/nested/module.js'], ['/public/icon.svg', 'public/icon.svg'],
    ['/examples/input.json', 'examples/input.json'], ['/public/space%20name-%CE%BB.txt', 'public/space name-λ.txt'],
  ]) {
    const response = await request(handler, url);
    assert.equal(response.status, 200, url);
    assert.deepEqual(response.body, await readFile(path.join(directory, filename)));
    const head = await request(handler, url, 'HEAD');
    assert.equal(head.status, 200, url); assert.equal(head.body.length, 0);
  }
});

test('root index links, dangling links and link cycles are generic 404s', async t => {
  const { temporary, directory, handler } = await syntheticTree(t);
  await rm(path.join(directory, 'index.html'));
  await symlink(path.join(temporary, 'outside/note.txt'), path.join(directory, 'index.html'), 'file');
  await symlink('absent.js', path.join(directory, 'src/dangling.js'), 'file');
  await symlink('cycle.js', path.join(directory, 'src/cycle.js'), 'file');
  for (const url of ['/', '/index.html', '/src/dangling.js', '/src/cycle.js']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await request(handler, url, method);
      assert.equal(response.status, 404, url);
      assert.equal(response.body.toString(), method === 'HEAD' ? '' : 'Not found');
      assert.doesNotMatch(response.wire, /synthetic outside|ENOENT|ELOOP/u);
    }
  }
});

test('path inspection failures never read a body, and the same handler can recover', async () => {
  const components = [root, path.join(root, 'src'), path.join(root, 'src/app.js')];
  for (const component of components) {
    for (const failure of [missing('ENOENT'), missing('EACCES'), missing('EIO'),
      { isSymbolicLink: () => true }, { isSymbolicLink: () => false, isFile: () => false, isDirectory: () => false }]) {
      let rejected = true, reads = 0;
      const handler = createRequestHandler(root, {
        lstat: async filename => {
          if (rejected && filename === component) {
            if (failure instanceof Error) throw failure;
            return failure;
          }
          return ordinaryLstat(filename);
        },
        readFile: async () => { reads += 1; return Buffer.from('recovered'); },
      });
      for (const method of ['GET', 'HEAD']) assert.equal((await request(handler, '/src/app.js', method)).status, 404);
      assert.equal(reads, 0);
      rejected = false;
      assert.equal((await request(handler, '/src/app.js')).body.toString(), 'recovered');
      assert.equal(reads, 1);
    }
  }
});

test('every request rechecks a previously valid directory after it becomes a link', async t => {
  const { temporary, directory, handler } = await syntheticTree(t);
  const url = '/src/nested/module.js';
  assert.equal((await request(handler, url)).status, 200);
  await writeFile(path.join(temporary, 'outside/module.js'), 'synthetic replacement');
  await rm(path.join(directory, 'src/nested'), { recursive: true });
  await symlink(path.join(temporary, 'outside'), path.join(directory, 'src/nested'), 'dir');
  for (const method of ['GET', 'HEAD']) assert.equal((await request(handler, url, method)).status, 404);
  await rm(path.join(directory, 'src/nested'));
  await mkdir(path.join(directory, 'src/nested'));
  await writeFile(path.join(directory, 'src/nested/module.js'), 'synthetic restored');
  assert.equal((await request(handler, url)).body.toString(), 'synthetic restored');
});

for (const code of ['ENOENT', 'EACCES', 'EIO']) {
  test(`GET read failure ${code} after successful stat returns 404 and the next request recovers`, async () => {
    let reads = 0;
    const handler = createRequestHandler(root, {
      lstat: ordinaryLstat,
      readFile: async () => { if (++reads === 1) throw missing(code); return Buffer.from('recovered'); },
    });
    const failed = await request(handler, '/src/app.js');
    assert.equal(failed.status, 404);
    assert.match(failed.wire, /^HTTP\/1\.1 404 Not Found\r\n/u);
    assert.match(failed.wire, /Not found/u);
    assert.doesNotMatch(failed.wire, /200 OK|Synthetic|ENOENT|EACCES|EIO/u);
    const recovered = await request(handler, '/src/app.js');
    assert.equal(recovered.status, 200);
    assert.deepEqual(recovered.body, Buffer.from('recovered'));
    assert.equal(reads, 2);
  });
}

test('GET commits no successful headers until the complete file read resolves', async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const bytes = new Promise(resolve => { release = resolve; });
  const handler = createRequestHandler(root, {
    lstat: ordinaryLstat,
    readFile: () => { entered(); return bytes; },
  });
  const socket = new PassThrough(), chunks = [];
  socket.on('data', chunk => chunks.push(chunk));
  const req = new IncomingMessage(socket); req.url = '/src/app.js'; req.method = 'GET';
  const res = new ServerResponse(req); res.assignSocket(socket);
  const running = handler(req, res);
  try {
    await started;
    assert.equal(res.headersSent, false);
    assert.equal(chunks.length, 0);
  } finally {
    release(Buffer.from('complete bytes'));
    await running;
    res.detachSocket(socket); socket.destroy();
  }
});

test('HEAD checks the file but never reads or emits a body', async () => {
  let stats = 0;
  const handler = createRequestHandler(root, {
    lstat: async filename => { if (parentEntry(filename)) return directoryEntry; stats += 1; return regularFile; },
    readFile: async () => assert.fail('HEAD must not read file bytes'),
  });
  const response = await request(handler, '/src/app.js', 'HEAD');
  assert.equal(response.status, 200);
  assert.equal(stats, 1);
  assert.match(response.wire, /Content-Type: text\/javascript; charset=utf-8\r\n/u);
  assert.equal(response.body.length, 0);
});

test('successful GET retains exact file bytes and the existing security headers', async () => {
  const response = await request(createRequestHandler(root), '/public/favicon.svg');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, await readFile(path.join(root, 'public/favicon.svg')));
  for (const header of [
    'Content-Type: image/svg+xml', 'Cache-Control: no-store',
    'X-Content-Type-Options: nosniff', 'Referrer-Policy: no-referrer',
    "Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
  ]) assert.ok(response.wire.includes(header + '\r\n'), header);
});

test('stat failures and non-files remain complete 404 responses without body reads', async () => {
  let reads = 0;
  for (const lstat of [async () => { throw missing('ENOENT'); }, async () => directoryEntry]) {
    const handler = createRequestHandler(root, { lstat, readFile: async () => { reads += 1; return Buffer.from('unexpected'); } });
    assert.equal((await request(handler, '/src/missing.js')).status, 404);
  }
  assert.equal(reads, 0);
});

test('unsupported methods, malformed URLs and blocked paths never access the filesystem', async () => {
  let accesses = 0;
  const handler = createRequestHandler(root, {
    lstat: async () => { accesses += 1; return regularFile; },
    readFile: async () => { accesses += 1; return Buffer.from('unexpected'); },
  });
  const method = await request(handler, '/src/app.js', 'POST');
  assert.equal(method.status, 405);
  assert.match(method.wire, /Allow: GET, HEAD\r\n/u);
  for (const url of ['/%ZZ', '/package.json', '/src/.env', '/%2e%2e/package.json', '/src%2f..%2f..%2foutside.js', '/src/nested%5c..%5c..%5cpackage.json']) {
    assert.equal((await request(handler, url)).status, 404, url);
  }
  assert.equal(accesses, 0);
});

test('direct source and dist entrypoints listen on loopback once; importing does not listen', () => {
  // Intercept before loading the actual CLI, not an evaluated copy of it. This
  // checks the entrypoint guard and port/host wiring without opening a socket.
  const preload = `
    import http from 'node:http';
    let calls = 0;
    http.Server.prototype.listen = function(port, host, callback) {
      calls += 1;
      console.log('LISTEN ' + JSON.stringify({port, host}));
      callback.call(this);
      return this;
    };
    process.on('exit', () => console.log('CALLS ' + calls));
  `;
  const script = new URL('../scripts/serve.js', import.meta.url);
  const run = args => spawnSync(process.execPath, ['--import=data:text/javascript,' + encodeURIComponent(preload), ...args], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, PORT: '43123' },
  });
  for (const args of [[], ['--dist']]) {
    const result = run([fileURLToPath(script), ...args]);
    assert.equal(result.status, 0, result.stderr || String(result.error));
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, 'LISTEN {"port":43123,"host":"127.0.0.1"}\nDetourLab → http://127.0.0.1:43123\nCALLS 1\n');
  }
  const result = run(['--input-type=module', '-e', `await import(${JSON.stringify(script.href)});`]);
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, 'CALLS 0\n');
});
