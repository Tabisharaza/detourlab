import test from 'node:test';
import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequestHandler } from '../scripts/serve.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const regularFile = { isFile: () => true };
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

for (const code of ['ENOENT', 'EACCES', 'EIO']) {
  test(`GET read failure ${code} after successful stat returns 404 and the next request recovers`, async () => {
    let reads = 0;
    const handler = createRequestHandler(root, {
      stat: async () => regularFile,
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
    stat: async () => regularFile,
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
    stat: async () => { stats += 1; return regularFile; },
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
  for (const stat of [async () => { throw missing('ENOENT'); }, async () => ({ isFile: () => false })]) {
    const handler = createRequestHandler(root, { stat, readFile: async () => { reads += 1; return Buffer.from('unexpected'); } });
    assert.equal((await request(handler, '/src/missing.js')).status, 404);
  }
  assert.equal(reads, 0);
});

test('unsupported methods, malformed URLs and blocked paths never access the filesystem', async () => {
  let accesses = 0;
  const handler = createRequestHandler(root, {
    stat: async () => { accesses += 1; return regularFile; },
    readFile: async () => { accesses += 1; return Buffer.from('unexpected'); },
  });
  const method = await request(handler, '/src/app.js', 'POST');
  assert.equal(method.status, 405);
  assert.match(method.wire, /Allow: GET, HEAD\r\n/u);
  for (const url of ['/%ZZ', '/package.json', '/src/.env', '/%2e%2e/package.json', '/src%2f..%2f..%2foutside.js']) {
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
