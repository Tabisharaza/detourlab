import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { parseBrowserCheckArguments, finishBrowserEvidence } from '../tools/browser-check/run.js';

async function temporary(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'detourlab-browser-evidence-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('optional browser CLI requires an explicit executable and new-output argument', () => {
  assert.deepEqual(parseBrowserCheckArguments(['--browser', '/browser/chrome', '--out', 'evidence']), { executable: '/browser/chrome', output: path.resolve('evidence') });
  assert.equal(parseBrowserCheckArguments(['--help']), null);
  for (const args of [[], ['--browser', 'chrome', '--out', 'evidence'], ['--browser', '/browser/chrome'],
    ['--browser', '/browser/chrome', '--out'], ['--browser', '/browser/chrome', '--out', 'evidence', '--remote-debugging-port', '9222'],
    ['--browser', '/browser/chrome', '--browser', '/other', '--out', 'evidence'], ['--browser', '/browser/chrome', '--out', 'a', '--out', 'b']]) {
    assert.throws(() => parseBrowserCheckArguments(args));
  }
});

test('successful cleanup precedes a complete passed evidence write', async t => {
  const directory = await temporary(t), calls = [], evidence = { status: 'passed', checks: [1] };
  await finishBrowserEvidence(directory, evidence, [async () => calls.push('browser'), async () => calls.push('server')]);
  assert.deepEqual(calls, ['browser', 'server']);
  const saved = JSON.parse(await readFile(path.join(directory, 'evidence.json')));
  assert.equal(saved.status, 'passed'); assert.deepEqual(saved.checks, [1]); assert.ok(saved.completedAt);
});

test('cleanup failure cannot leave passed evidence and does not skip later cleanup', async t => {
  const directory = await temporary(t), calls = [];
  await assert.rejects(finishBrowserEvidence(directory, { status: 'passed' }, [
    async () => { throw new Error('synthetic close failure'); }, async () => calls.push('server'), async () => calls.push('profile'),
  ]), /synthetic close failure/u);
  assert.deepEqual(calls, ['server', 'profile']);
  const saved = JSON.parse(await readFile(path.join(directory, 'evidence.json')));
  assert.equal(saved.status, 'failed'); assert.match(saved.cleanupError, /synthetic close failure/u);
});

test('previous test failures retain their evidence even when cleanup succeeds', async t => {
  const directory = await temporary(t);
  await finishBrowserEvidence(directory, { status: 'failed', error: 'ledger mismatch', checks: [1] }, []);
  assert.equal(JSON.parse(await readFile(path.join(directory, 'evidence.json'))).status, 'failed');
});

test('evidence writing refuses to replace existing evidence', async t => {
  const directory = await temporary(t), file = path.join(directory, 'evidence.json');
  await writeFile(file, 'original bytes');
  await assert.rejects(finishBrowserEvidence(directory, { status: 'passed' }, []), { code: 'EEXIST' });
  assert.equal(await readFile(file, 'utf8'), 'original bytes');
});
