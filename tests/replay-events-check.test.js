import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { simulateExperiment, validateExperiment } from '../src/experiment.js';
import { runReplayEventsCheck, eventNavigationFixture, lateClosureFixture, expectedLedgerRows, usage } from '../tools/replay-events-check/run.js';

const runner = 'tools/replay-events-check/run.js';
const tiny = JSON.parse(await readFile(new URL('../examples/minimal-experiment.json', import.meta.url), 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');

test('replay-events harness help discloses native observation and verification limits', () => {
  const result = spawnSync(process.execPath, [runner, '--help'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0); assert.equal(result.stdout.trim(), usage); assert.equal(result.stderr, '');
  for (const phrase of ['Fresh local profile', 'Native Workers', 'never replaced', 'Raw JPEG', 'Output must not exist', 'Not native-chooser']) assert.ok(result.stdout.includes(phrase));
});

test('replay-events harness rejects missing, repeated, unknown and relative-browser arguments without output', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'events-arguments-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'evidence');
  for (const args of [
    [], ['--browser', 'relative', '--out', output], ['--browser', '/does/not/exist'],
    ['--browser', '/does/not/exist', '--out', output, '--out', output],
    ['--browser', '/does/not/exist', '--out', output, '--profile', root],
    ['--browser', '/does/not/exist', '--out', output, '--no-sandbox'],
  ]) {
    const result = spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1); assert.match(result.stderr, /absolute browser executable|Supply --browser and --out/);
    assert.deepEqual(await readdir(root), [], 'argument validation cannot create evidence or launch a browser');
  }
});

test('replay-events harness refuses to overwrite existing evidence output', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'events-overwrite-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'evidence'); await mkdir(output);
  await assert.rejects(runReplayEventsCheck({ executable: '/does/not/exist', output }), { code: 'EEXIST' });
  assert.deepEqual(await readdir(output), []);
});

test('replay-events failed launch retains source-identified failure and releases server and owned profile', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'events-failure-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  // A separate process proves there is no leftover listener/handle keeping the
  // harness alive. This deliberately nonexistent path never invokes Chromium.
  const output = path.join(root, 'evidence');
  const result = spawnSync(process.execPath, [runner, '--browser', '/does/not/exist', '--out', output], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, TMPDIR: root, TEMP: root, TMP: root },
  });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 1); assert.match(result.stderr, /ENOENT/);
  const evidence = JSON.parse(await readFile(path.join(output, 'evidence.json'), 'utf8'));
  assert.equal(evidence.status, 'failed'); assert.match(evidence.error, /ENOENT/); assert.deepEqual(evidence.checks, []);
  assert.deepEqual(evidence.screenshots, []); assert.deepEqual(evidence.fixtures, []); assert.equal(evidence.cleanupError, undefined);
  assert.ok(evidence.completedAt); assert.ok(evidence.startedAt); assert.equal(evidence.runtime.node, process.version);
  assert.ok(evidence.sourceFiles.some(file => file.path === 'src/app.js'));
  assert.ok(evidence.sourceFiles.some(file => file.path === runner));
  assert.ok(evidence.sourceFiles.every(file => /^[a-f0-9]{64}$/u.test(file.sha256)));
  assert.equal(evidence.sourceSha256, sha256(JSON.stringify(evidence.sourceFiles)));
  assert.deepEqual(await readdir(root), ['evidence'], 'failed launch removes its owned temporary profile');
  assert.deepEqual(await readdir(output), ['evidence.json']);
});

test('event fixture independently provides fractional ties, paging, second vehicle and null unreachable jobs', () => {
  const original = structuredClone(tiny), fixture = eventNavigationFixture(tiny);
  assert.deepEqual(tiny, original, 'fixture builder does not mutate the checked-in example');
  assert.deepEqual(validateExperiment(fixture), fixture);
  const result = simulateExperiment(fixture);
  const variant = result.variants.find(item => item.id === 'fractional-detour').result;
  const van = variant.vehicles.find(item => item.id === 'van-1');
  assert.equal(van.reroutes[0].atS, 10.25); assert.equal(van.jobs[0].arrivalS, 26.25); assert.equal(van.jobs[0].completedS, 29.375);
  const isolated = van.jobs.find(job => job.id === 'isolated-job');
  assert.equal(isolated.status, 'unreachable'); assert.equal(isolated.arrivalS, null); assert.equal(isolated.completedS, null);
  const expected = expectedLedgerRows(fixture, result, 'van-1', 'fractional-detour');
  assert.equal(expected.length, 64); assert.equal(expected.filter(row => row.time === 10.25).length, 6);
  assert.equal(expected.filter(row => row.category === 'deliveries').length, 52);
  assert.equal(expected.filter(row => row.category === 'routing').length, 11);
  assert.equal(expected.filter(row => row.category === 'closures').length, 1);
  assert.ok(expected.every(row => Number.isFinite(row.time) && row.time > 0));
  const blocked = expectedLedgerRows(fixture, result, 'van-1', 'blocked');
  assert.equal(blocked.some(row => row.run === 'variant' && row.category === 'deliveries'), false);
  const second = expectedLedgerRows(fixture, result, 'van-2', 'fractional-detour');
  assert.ok(second.some(row => row.time === 8.5)); assert.ok(second.every(row => row.time !== 26.25));
});

test('tiny event oracle covers all six tied cutoff events without invented dispatch or finish rows', () => {
  const rows = expectedLedgerRows(tiny, simulateExperiment(tiny), 'van-1', 'close-at-10');
  assert.equal(rows.length, 16); assert.equal(rows.filter(row => row.time === 10).length, 6);
  assert.deepEqual([...new Set(rows.map(row => row.kind))].sort(), ['closure-start', 'job-arrival', 'job-completion', 'reroute', 'segment-entry', 'segment-exit']);
});


test('late schedule fixture keeps a navigable event beyond every completed ledger horizon', () => {
  const original = structuredClone(tiny), fixture = lateClosureFixture(tiny), result = simulateExperiment(fixture);
  assert.deepEqual(tiny, original); assert.deepEqual(validateExperiment(fixture), fixture);
  assert.equal(result.baseline.durationS, 60); assert.ok(result.variants.every(variant => variant.result.durationS === 60));
  const rows = expectedLedgerRows(fixture, result, 'van-1', 'close-at-10');
  assert.equal(rows.length, 17);
  assert.deepEqual(rows.filter(row => row.time > 60), [{ run: 'schedule', kind: 'closure-start', category: 'closures', time: 123.375 }]);
});
