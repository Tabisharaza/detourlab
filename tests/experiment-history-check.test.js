import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { simulateExperiment, validateExperiment, canonicalExperiment } from '../src/experiment.js';
import { runExperimentHistoryCheck, historyFixtureSequence, usage } from '../tools/experiment-history-check/run.js';

const runner = 'tools/experiment-history-check/run.js';
const tiny = JSON.parse(await readFile(new URL('../examples/minimal-experiment.json', import.meta.url), 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');

test('experiment-history harness help discloses native observation, raw captures and verification limits', () => {
  const result = spawnSync(process.execPath, [runner, '--help'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0); assert.equal(result.stdout.trim(), usage); assert.equal(result.stderr, '');
  for (const phrase of ['Fresh local profile', 'Native Workers', 'never replaced', 'native keyboard', 'raw JPEG', '1 MiB', 'Output must not exist', 'Not native-chooser']) assert.ok(result.stdout.includes(phrase));
});

test('experiment-history harness rejects unsafe or incomplete arguments before creating output', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'history-arguments-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'evidence');
  for (const args of [
    [], ['--browser', 'relative', '--out', output], ['--browser', '/does/not/exist'],
    ['--browser', '/does/not/exist', '--out', output, '--out', output],
    ['--browser', '/does/not/exist', '--out', output, '--profile', root],
    ['--browser', '/does/not/exist', '--out', output, '--no-sandbox'],
    ['--browser', '/does/not/exist', '--out', output, '--url', 'https://example.com'],
  ]) {
    const result = spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1); assert.match(result.stderr, /absolute browser executable|Supply --browser and --out/u);
    assert.deepEqual(await readdir(root), [], 'argument errors cannot create evidence, listen or launch a browser');
  }
});

test('experiment-history harness refuses to overwrite any existing evidence directory', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'history-overwrite-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'evidence'); await mkdir(output);
  await assert.rejects(runExperimentHistoryCheck({ executable: '/does/not/exist', output }), { code: 'EEXIST' });
  assert.deepEqual(await readdir(output), []);
});

test('experiment-history missing-browser preflight retains source-identified failure without sockets or profiles', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'history-preflight-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'evidence');
  // This nonexistent executable fails access(X_OK) before listener creation,
  // temporary profile creation or launchChromium. It is not a browser attempt.
  const result = spawnSync(process.execPath, [runner, '--browser', path.join(root, 'absent-browser'), '--out', output], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, TMPDIR: root, TEMP: root, TMP: root },
  });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 1); assert.match(result.stderr, /ENOENT/u);
  const evidence = JSON.parse(await readFile(path.join(output, 'evidence.json'), 'utf8'));
  assert.equal(evidence.status, 'failed'); assert.match(evidence.error, /ENOENT/u);
  assert.deepEqual(evidence.checks, []); assert.deepEqual(evidence.screenshots, []); assert.deepEqual(evidence.fixtures, []);
  assert.equal(evidence.browser, undefined); assert.equal(evidence.cleanupError, undefined);
  assert.ok(evidence.startedAt); assert.ok(evidence.completedAt); assert.equal(evidence.runtime.node, process.version);
  for (const expected of ['src/app.js', 'src/experiment-history.js', runner, 'tools/browser-check/chromium.js', 'tools/replay-events-check/run.js']) assert.ok(evidence.sourceFiles.some(file => file.path === expected));
  assert.deepEqual(evidence.sourceFiles.map(file => file.path), evidence.sourceFiles.map(file => file.path).sort());
  assert.ok(evidence.sourceFiles.every(file => /^[a-f0-9]{64}$/u.test(file.sha256)));
  assert.equal(evidence.sourceSha256, sha256(JSON.stringify(evidence.sourceFiles)));
  for (const file of evidence.sourceFiles) assert.equal(file.sha256, sha256(await readFile(new URL(`../${file.path}`, import.meta.url))));
  assert.ok(evidence.limitations.some(value => value.includes('adversarial stale callbacks')));
  assert.ok(evidence.limitations.some(value => value.includes('No app handler or Worker delivery is replaced')));
  assert.deepEqual(await readdir(root), ['evidence'], 'preflight creates no owned profile or other temporary artifacts');
  assert.deepEqual(await readdir(output), ['evidence.json']);
});

test('history fixture sequence independently predicts fractional road and cutoff outcomes', () => {
  const original = structuredClone(tiny), fixture = historyFixtureSequence(tiny);
  assert.deepEqual(tiny, original, 'fixture construction never mutates the checked-in example');
  assert.deepEqual(Object.keys(fixture), ['base', 'closed', 'cutoff', 'renamed', 'duplicated', 'deleted', 'divergent']);
  for (const experiment of Object.values(fixture)) {
    assert.deepEqual(validateExperiment(experiment), experiment);
    assert.equal(experiment.baseScenario.vehicles.length, 2);
    assert.ok(Buffer.byteLength(JSON.stringify(experiment)) < 10000, 'native fixture stays deliberately bounded');
    assert.deepEqual(experiment.baseScenario, fixture.base.baseScenario, 'input edits never change graph or demand');
    for (const id of ['close-at-10', 'close-at-11']) assert.deepEqual(experiment.variants.find(item => item.id === id), fixture.base.variants.find(item => item.id === id), 'non-target plans remain exactly unchanged');
  }
  const arrival = experiment => simulateExperiment(experiment).variants.find(variant => variant.id === 'clear').result.vehicles[0].jobs[0].arrivalS;
  assert.equal(arrival(fixture.base), 20.25);
  assert.equal(arrival(fixture.closed), 20.25, '60-second closure occurs after road entry');
  assert.equal(arrival(fixture.cutoff), 26.25, 'exact 10.25-second cutoff forces the detour');
  assert.equal(arrival(fixture.divergent), 20.25, '11.25-second divergent cutoff leaves an entered road intact');
  const run = simulateExperiment(fixture.cutoff).variants.find(variant => variant.id === 'clear').result;
  assert.equal(run.vehicles[0].reroutes[0].atS, 10.25);
  assert.equal(run.vehicles[1].jobs[0].arrivalS, 8.5, 'second vehicle independently tests preserved selection');
});

test('history variant expectations preserve identity, names, order and independent nested data', () => {
  const { base, cutoff, renamed, duplicated, deleted } = historyFixtureSequence(tiny);
  assert.equal(renamed.variants[0].name, 'Morning detour');
  assert.equal(cutoff.variants[0].name, 'Clear roads');
  assert.deepEqual(duplicated.variants.map(item => item.id), ['clear', 'close-at-10', 'close-at-11', 'variant-1']);
  assert.deepEqual(duplicated.variants.at(-1), { id: 'variant-1', name: 'Morning detour copy', closures: [{ id: 'road-edit', edgeIds: ['bc'], atS: 10.25 }] });
  assert.equal(canonicalExperiment(deleted), canonicalExperiment(renamed));
  duplicated.variants.at(-1).closures[0].edgeIds.push('bd');
  assert.deepEqual(duplicated.variants[0].closures[0].edgeIds, ['bc'], 'copy does not alias source variant');
  assert.deepEqual(renamed.variants[0].closures[0].edgeIds, ['bc'], 'expected checkpoints do not share mutable data');
  base.baseScenario.vehicles[0].startTimeS = 99;
  assert.equal(cutoff.baseScenario.vehicles[0].startTimeS, 0.25);
  assert.equal(historyFixtureSequence(tiny).base.baseScenario.vehicles[0].startTimeS, 0.25, 'subsequent fixture calls are independent');
});
