import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseServeArguments } from '../scripts/serve-options.js';

const script = fileURLToPath(new URL('../scripts/serve.js', import.meta.url));
const base = { host: '127.0.0.1', port: 4173, dist: false, strictPort: true };
const preload = `
  import http from 'node:http';
  let creates = 0, listens = 0;
  const create = http.createServer;
  http.createServer = (...args) => { creates++; return create(...args); };
  http.Server.prototype.listen = function(port, host, callback) {
    listens++;
    console.log('LISTEN ' + JSON.stringify({port, host}));
    if (process.env.TEST_LISTEN_ERROR) queueMicrotask(() => this.emit('error', Object.assign(new Error('Synthetic bind failure'), {code:process.env.TEST_LISTEN_ERROR})));
    else callback.call(this);
    return this;
  };
  process.on('exit', () => console.log('COUNTS ' + JSON.stringify({creates,listens})));
`;
function cli(args = [], env = {}) {
  return spawnSync(process.execPath, ['--import=data:text/javascript,' + encodeURIComponent(preload), script, ...args], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, PORT: '', TEST_LISTEN_ERROR: '', ...env },
  });
}

test('preview defaults and source/dist mode preserve existing start behavior', () => {
  assert.deepEqual(parseServeArguments(), base);
  assert.deepEqual(parseServeArguments([], ''), base);
  assert.deepEqual(parseServeArguments(['--dist'], '43123'), { ...base, port:43123, dist:true });
});

test('managed arguments select exact port and host without changing the input array', () => {
  const args = Object.freeze(['--host', '127.0.0.1', '--port', '45123', '--strictPort']);
  assert.deepEqual(parseServeArguments(args, '43210'), { ...base, port:45123 });
  assert.deepEqual(parseServeArguments(['--strictPort', '--dist', '--port', '65535', '--host', '127.0.0.1']), { ...base, port:65535, dist:true });
  assert.equal(parseServeArguments(['--port', '1']).port, 1);
});

test('explicit port overrides PORT, including an otherwise invalid inherited value', () => {
  assert.equal(parseServeArguments(['--port', '4173'], 'not-a-port').port, 4173);
  assert.equal(parseServeArguments([], '43210').port, 43210);
});

for (const port of ['0', '-1', '65536', '1.5', '1e3', 'Infinity', 'NaN', ' 4173', '4173 ', '', '12x', '000001']) {
  test(`malformed or out-of-range CLI port is rejected: ${JSON.stringify(port)}`, () => {
    assert.throws(() => parseServeArguments(['--port', port]), /port/);
  });
}

test('invalid PORT environment values are rejected before a server is constructed', () => {
  for (const port of ['0', '65536', '1e3', 'nope']) {
    const result = cli([], { PORT: port });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /port must be/);
    assert.equal(result.stdout, 'COUNTS {"creates":0,"listens":0}\n');
  }
});

for (const host of ['0.0.0.0', '::', '::1', 'localhost', '127.0.0.2', 'example.com', '']) {
  test(`preview never expands loopback host selection: ${JSON.stringify(host)}`, () => {
    assert.throws(() => parseServeArguments(['--host', host]), /127\.0\.0\.1/);
  });
}

test('every flag is single-use and flags cannot hide missing values', () => {
  for (const args of [
    ['--dist', '--dist'], ['--strictPort', '--strictPort'], ['--host', '127.0.0.1', '--host', '127.0.0.1'],
    ['--port', '4173', '--port', '4173'], ['--host'], ['--port'], ['--host', '--dist'], ['--port', '--strictPort'],
  ]) assert.throws(() => parseServeArguments(args), /only be supplied once|requires a value/);
});

test('unknown flags, positional values and assignment syntax fail closed', () => {
  for (const args of [['--bogus'], ['4173'], ['--port=4173'], ['--host=127.0.0.1'], ['--strictPort', 'false'], ['--dist', 'public']]) {
    assert.throws(() => parseServeArguments(args), /unknown preview option/);
  }
  for (const args of [null, {}, [4173], ['--host', null]]) assert.throws(() => parseServeArguments(args), /arguments must be strings/);
});

test('actual entrypoint honors managed flags, default start and PORT with no listening socket', () => {
  for (const [args, env, port] of [
    [[], {}, 4173], [[], {PORT:'43123'}, 43123],
    [['--host', '127.0.0.1', '--port', '45123', '--strictPort'], {PORT:'43123'}, 45123],
    [['--dist', '--port', '1'], {}, 1],
  ]) {
    const result = cli(args, env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, `LISTEN {"port":${port},"host":"127.0.0.1"}\nDetourLab → http://127.0.0.1:${port}\nCOUNTS {"creates":1,"listens":1}\n`);
  }
});

test('invalid actual CLI arguments create no HTTP server or listening socket', () => {
  for (const args of [['--host', '0.0.0.0'], ['--port', '0'], ['--bogus'], ['--port', '1', '--port', '2']]) {
    const result = cli(args);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /^DetourLab: /);
    assert.equal(result.stdout, 'COUNTS {"creates":0,"listens":0}\n');
  }
});

test('bind failures exit once with no success URL, fallback port or retry', () => {
  for (const code of ['EADDRINUSE', 'EACCES']) {
    for (const strict of [[], ['--strictPort']]) {
      const result = cli(['--port', '43123', ...strict], {TEST_LISTEN_ERROR:code});
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stderr, `DetourLab: cannot listen on 127.0.0.1:43123 (${code}).\n`);
      assert.equal(result.stdout, 'LISTEN {"port":43123,"host":"127.0.0.1"}\nCOUNTS {"creates":1,"listens":1}\n');
    }
  }
});

test('npm dev selects the existing constrained server without changing npm start', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.start, 'node scripts/serve.js');
  assert.equal(pkg.scripts.dev, pkg.scripts.start);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});
