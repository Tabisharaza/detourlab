import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { removeOwnedBrowserDirectory, finishBrowserEvidence } from '../tools/browser-check/run.js';

test('owned browser directory cleanup passes exact path and bounded Node retry options', async () => {
  const calls = [];
  await removeOwnedBrowserDirectory('/synthetic/owned/profile-parent', async (...args) => { calls.push(args); });
  assert.deepEqual(calls, [['/synthetic/owned/profile-parent', { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }]]);
});

test('owned directory cleanup propagates permanent removal failure unchanged', async () => {
  const failure = Object.assign(new Error('still not empty'), { code: 'ENOTEMPTY' });
  await assert.rejects(removeOwnedBrowserDirectory('/synthetic/owned', async () => { throw failure; }), error => error === failure);
});

test('permanent profile cleanup failure retains failed evidence and continues later cleanups', async t => {
  const output = await mkdtemp(path.join(tmpdir(), 'browser-cleanup-test-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const failure = Object.assign(new Error('profile remained busy after bounded retries'), { code: 'ENOTEMPTY' });
  const evidence = { status: 'passed', checks: [{ name: 'synthetic prior check', status: 'passed' }] };
  let laterCleanup = false;
  await assert.rejects(finishBrowserEvidence(output, evidence, [
    () => removeOwnedBrowserDirectory('/synthetic/owned', async () => { throw failure; }),
    async () => { laterCleanup = true; },
  ]), error => error === failure);
  assert.equal(laterCleanup, true);
  const saved = JSON.parse(await readFile(path.join(output, 'evidence.json'), 'utf8'));
  assert.equal(saved.status, 'failed');
  assert.match(saved.cleanupError, /profile remained busy/);
  assert.ok(saved.completedAt);
  assert.deepEqual(saved.checks, evidence.checks);
});

test('owned directory cleanup removes a real nested temporary profile', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'browser-cleanup-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const owned = path.join(root, 'owned');
  await mkdir(path.join(owned, 'profile', 'Default'), { recursive: true });
  await writeFile(path.join(owned, 'profile', 'Default', 'test'), 'synthetic');
  await removeOwnedBrowserDirectory(owned);
  await assert.rejects(access(owned), { code: 'ENOENT' });
  await access(root);
});
