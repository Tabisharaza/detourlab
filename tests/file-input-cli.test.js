import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInput } from '../scripts/read-input.js';
import { FILE_INPUT_MAX_BYTES, INPUT_ERROR_MAX_LENGTH } from '../src/file-input.js';
import { minimalScenario } from './helpers/application.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const runners = ['run-scenario.js', 'run-experiment.js'];
const run = (runner, file) => spawnSync(process.execPath, [`scripts/${runner}`, file, '--json'], {
  cwd: root, encoding: 'utf8', timeout: 3000,
});
async function fixture(t, bytes) {
  const directory = await mkdtemp(path.join(tmpdir(), 'detourlab-file-input-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'input.json');
  await writeFile(file, bytes);
  return file;
}
function rejected(result, diagnostic) {
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, diagnostic);
  assert.ok(result.stderr.length <= 'DetourLab: '.length + INPUT_ERROR_MAX_LENGTH + 1);
}

for (const runner of runners) {
  test(`${runner} rejects malformed UTF-8 inside valid labels without rewriting its input`, async t => {
    const scenario = minimalScenario('encoding-input'); scenario.name = 'BYTE_MARKER';
    const [before, after] = JSON.stringify(scenario).split('BYTE_MARKER');
    for (const sequence of [[0xff], [0xe2, 0x82], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80]]) {
      const bytes = Buffer.concat([Buffer.from(before), Buffer.from(sequence), Buffer.from(after)]);
      const file = await fixture(t, bytes);
      rejected(run(runner, file), /not valid UTF-8.*Save it as UTF-8 JSON/u);
      assert.deepEqual(await readFile(file), bytes);
    }
  });

  test(`${runner} preserves valid Unicode/U+FFFD and accepts BOM with unchanged deterministic output`, async t => {
    const scenario = minimalScenario('valid-utf8'); scenario.name = 'É 東京 🚚 � inside\ufeffBOM';
    const bytes = Buffer.from(JSON.stringify(scenario));
    const plain = await fixture(t, bytes), bomBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]);
    const bom = await fixture(t, bomBytes), a = run(runner, plain), b = run(runner, bom);
    assert.equal(a.status, 0, a.stderr); assert.equal(b.status, 0, b.stderr);
    assert.equal(a.stdout, b.stdout); assert.equal(a.stderr, ''); assert.equal(b.stderr, '');
    assert.deepEqual(await readFile(plain), bytes); assert.deepEqual(await readFile(bom), bomBytes);
    assert.match(await readInput(plain), /�/u);
  });

  test(`${runner} checks actual bytes including BOM at and above the 2 MiB boundary`, async t => {
    const text = JSON.stringify(minimalScenario('byte-bound'));
    const exact = Buffer.from('\ufeff' + text + ' '.repeat(FILE_INPUT_MAX_BYTES - 3 - Buffer.byteLength(text)));
    assert.equal(exact.length, FILE_INPUT_MAX_BYTES);
    const file = await fixture(t, exact), result = run(runner, file);
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, '');
    assert.deepEqual(await readFile(file), exact);
    for (const bytes of [Buffer.concat([exact, Buffer.from(' ')]), Buffer.from('é'.repeat(FILE_INPUT_MAX_BYTES / 2 + 1))]) {
      rejected(run(runner, await fixture(t, bytes)), /2 MiB/u);
    }
  });

  test(`${runner} rejects missing files, directories and readable devices without metrics`, async t => {
    const file = await fixture(t, '{}');
    rejected(run(runner, file + '.missing'), /ENOENT/u);
    rejected(run(runner, path.dirname(file)), /regular file|EISDIR/u);
    for (const device of ['/dev/null', '/dev/zero']) {
      if (existsSync(device)) rejected(run(runner, device), /regular file/u);
    }
  });

  test(`${runner} rejects an unwritten FIFO without blocking`, { skip: process.platform === 'win32' }, async t => {
    const directory = path.dirname(await fixture(t, '{}')), pipe = path.join(directory, 'input.fifo');
    const made = spawnSync('mkfifo', [pipe], { encoding: 'utf8' });
    if (made.error?.code === 'ENOENT') { t.skip('mkfifo is not installed'); return; }
    assert.equal(made.status, 0, made.stderr);
    rejected(run(runner, pipe), /regular file/u);
  });

  test(`${runner} bounds huge diagnostic keys and escapes terminal controls and bidi separators`, async t => {
    for (const key of ['x'.repeat(FILE_INPUT_MAX_BYTES - 6), '🚧'.repeat(2000), '\x1b[31m\x9b\r\n\u2028\u202e\u2066']) {
      const file = await fixture(t, JSON.stringify({ [key]: 0 })), result = run(runner, file);
      rejected(result, /contains unsupported property/u);
      assert.doesNotMatch(result.stderr.slice(0, -1), /[\x00-\x1f\x7f-\x9f\u2028-\u202e\u2066-\u206f]/u);
      if (key.startsWith('\x1b')) assert.match(result.stderr, /\\u001b\[31m/u);
    }
  });
}

test('bounded reader checks actual bytes even when file size changes after stat and handles partial reads', async t => {
  const file = await fixture(t, Buffer.alloc(FILE_INPUT_MAX_BYTES + 500, 0x20));
  const probe = await open(file), prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const originalStat = prototype.stat, originalRead = prototype.read;
  let actualRead = 0, maximumRequested = 0, handle;
  t.mock.method(prototype, 'stat', async function (...args) {
    handle = this;
    const info = await originalStat.apply(this, args); info.size = 1; return info;
  });
  t.mock.method(prototype, 'read', async function (buffer, offset, length, position) {
    maximumRequested = Math.max(maximumRequested, length);
    const result = await originalRead.call(this, buffer, offset, Math.min(length, 65536), position);
    actualRead += result.bytesRead; return result;
  });
  await assert.rejects(readInput(file), /2 MiB/u);
  assert.equal(actualRead, FILE_INPUT_MAX_BYTES + 1);
  assert.equal(maximumRequested, FILE_INPUT_MAX_BYTES + 1);
  assert.equal(handle.fd, -1, 'reader closes the file after rejecting actual bytes');
});

test('bounded reader rejects advertised oversize before reading and closes on read or encoding errors', async t => {
  const file = await fixture(t, Buffer.alloc(FILE_INPUT_MAX_BYTES + 1));
  const probe = await open(file), prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const originalStat = prototype.stat;
  let handle, reads = 0;
  t.mock.method(prototype, 'stat', async function (...args) { handle = this; return originalStat.apply(this, args); });
  const readMock = t.mock.method(prototype, 'read', async function () { reads += 1; throw new Error('Synthetic file read failure'); });
  await assert.rejects(readInput(file), /2 MiB/u);
  assert.equal(reads, 0); assert.equal(handle.fd, -1);
  await writeFile(file, '{}');
  await assert.rejects(readInput(file), /Synthetic file read failure/u);
  assert.equal(reads, 1); assert.equal(handle.fd, -1);
  readMock.mock.restore();
  await writeFile(file, Buffer.from([0xff]));
  await assert.rejects(readInput(file), /UTF-8/u);
  assert.equal(handle.fd, -1);
});
