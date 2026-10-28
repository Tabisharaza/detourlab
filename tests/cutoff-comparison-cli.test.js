import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExperiment } from '../src/experiment.js';
import { createCutoffExperiment } from '../scripts/cutoff-experiment.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const example = 'examples/minimal-experiment.json';
const selection = ['--variant', 'close-at-10', '--closure', 'bc-closure', '--times', '10,11'];
const run = (...args) => spawnSync(process.execPath, ['scripts/compare-cutoffs.js', ...args], { cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
const source = () => JSON.parse(readFileSync(path.join(root, example), 'utf8'));
function file(t, data) {
  const dir = mkdtempSync(path.join(tmpdir(), 'detourlab-cutoffs-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'input.json'); writeFileSync(target, typeof data === 'object' && !Buffer.isBuffer(data) ? JSON.stringify(data) : data); return target;
}
function success(result, status = 0) { assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, status, result.stderr); assert.equal(result.stderr, ''); return result.stdout; }
function failure(result, pattern) { assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 2); assert.equal(result.stdout, ''); assert.match(result.stderr, pattern); assert.ok(result.stderr.length <= 525); }

test('cutoff CLI prints deterministic sorted JSON and preserves the source bytes', () => {
  const before = readFileSync(path.join(root, example));
  const text = success(run(example, ...selection, '--json'));
  assert.equal(text, success(run('--times', '11,10', '--closure', 'bc-closure', '--json', example, '--variant', 'close-at-10')));
  const report = JSON.parse(text); assert.deepEqual(report.candidates.map(c => c.cutoffS), [10, 11]); assert.equal(report.verdict, 'not-evaluated'); assert.equal(report.passingSampleTimesS, null);
  assert.deepEqual(readFileSync(path.join(root, example)), before);
});

test('cutoff CLI emits complete failure report and sampled passing times, not an optimizer claim', () => {
  const report = JSON.parse(success(run(example, ...selection, '--max-extra-late', '0', '--max-unreachable', '0', '--json'), 1));
  assert.equal(report.verdict, 'failed'); assert.deepEqual(report.passingSampleTimesS, [11]);
  assert.equal(report.candidates.length, 2); assert.equal(report.candidates[0].violations[0].actual, 1);
  const text = success(run(example, ...selection, '--max-extra-late', '0'), 1);
  assert.match(text, /10 s \[cutoff-1\]: 260 m; 1 late; 0 unreachable; 1\/1 completed/);
  assert.match(text, /11 s \[cutoff-2\]: 200 m; 0 late; 0 unreachable; 1\/1 completed/);
  assert.match(text, /Passing sampled times \(s\): 11/); assert.match(text, /no optimal cutoff, continuous passing interval, monotonicity or operational safety/);
  assert.equal(JSON.parse(success(run(example, ...selection, '--max-extra-late', '1', '--json'))).verdict, 'passed');
});

test('cutoff CLI no-policy human output explicitly says not evaluated', () => {
  const text = success(run(example, ...selection)); assert.match(text, /Policy: NOT EVALUATED/); assert.doesNotMatch(text, /Passing sampled times/);
});

test('cutoff export is ordinary experiment JSON and reproduces via the existing runner', t => {
  const text = success(run(example, ...selection, '--export-experiment'));
  const exported = parseExperiment(text); assert.deepEqual(exported, createCutoffExperiment(source(), 'close-at-10', 'bc-closure', [10, 11]));
  const target = file(t, text), before = readdirSync(path.dirname(target));
  const old = spawnSync(process.execPath, ['scripts/run-experiment.js', target, '--json'], { cwd: root, encoding: 'utf8', timeout: 15000 });
  const result = JSON.parse(success(old)); const comparison = JSON.parse(success(run(example, ...selection, '--json')));
  assert.equal(result.experimentSha256, comparison.experimentSha256);
  result.variants.forEach((v, i) => assert.deepEqual(v.metrics, comparison.candidates[i].metrics));
  assert.deepEqual(readdirSync(path.dirname(target)), before);
});

test('legacy scenario input remains supported with explicit supplied variant/event selection', () => {
  const input = 'examples/minimal-directed.json'; const parsed = parseExperiment(readFileSync(path.join(root, input), 'utf8'));
  const closure = parsed.variants[0].closures[0];
  const result = JSON.parse(success(run(input, '--variant', 'supplied', '--closure', closure.id, '--times', '10,11', '--json')));
  assert.equal(result.source.variantId, 'supplied'); assert.equal(result.candidates.length, 2);
});

for (const times of ['', '10', '0,1,2,3,4,5,6', '1,1', '1,1.0', '0,0e0', ',1', '1,', '1,,2', '1,Infinity', 'NaN,2', '-1,2', '0x10,20', '1e999,2', '0,604801', '1,2;3', '0,'.repeat(600)]) {
  test(`cutoff CLI rejects bad samples ${times.slice(0, 45)}`, () => failure(run('missing-file.json', '--variant', 'v', '--closure', 'c', '--times', times), /times|Cutoff|Sample|cutoffs|cutoff/));
}

for (const flag of ['--variant', '--closure', '--times', '--json', '--export-experiment']) {
  test(`cutoff CLI rejects duplicate ${flag} before reading a file`, () => {
    const base = ['missing-file.json', ...selection];
    const pair = flag === '--variant' ? [flag, 'close-at-10'] : flag === '--closure' ? [flag, 'bc-closure'] : flag === '--times' ? [flag, '10,11'] : [flag, flag];
    failure(run(...base, ...pair), /only be supplied once/);
  });
}

for (const args of [[], [example], [example, '--variant', 'close-at-10'], [example, '--closure', 'bc-closure', '--times', '10,11'], [example, ...selection, '--unknown'], [example, ...selection, 'second.json'], [example, ...selection, '--max-extra-late', '--times', '0,1', '2'], [example, ...selection, '--max-extra-late', '1', '--max-extra-late', '2'], [example, ...selection, '--export-experiment', '--json'], [example, ...selection, '--export-experiment', '--max-extra-late', '0']]) {
  test(`cutoff CLI rejects malformed flags ${JSON.stringify(args).slice(-80)}`, () => failure(run(...args), /required|Unknown|Only one|finite|once|combined/));
}

test('cutoff CLI help bypasses input read and documents bounds and safe redirection', () => {
  const text = success(run('missing.json', '--invalid', '--help')); assert.match(text, /2–6 unique/); assert.match(text, /604800/); assert.match(text, /NEW destination, never the input filename/);
});

test('cutoff CLI rejects malformed/oversized/invalid UTF-8 inputs without partial report', t => {
  for (const [data, pattern] of [['{', /valid JSON/], [Buffer.from([0xff]), /UTF-8/], [Buffer.alloc(2 * 1024 * 1024 + 1, 32), /2 MiB/]]) failure(run(file(t, data), ...selection, '--json'), pattern);
});

test('cutoff CLI rejects unknown variant and event without reflecting hostile labels', () => {
  failure(run(example, '--variant', 'missing', '--closure', 'bc-closure', '--times', '10,11'), /variant ID/);
  failure(run(example, '--variant', 'clear', '--closure', 'bc-closure', '--times', '10,11'), /Closure ID/);
  failure(run(example, '--variant', 'close-at-10', '--closure', '\u001b[31mBAD', '--times', '10,11'), /Closure ID/);
});

test('cutoff export does not simulate work that would exceed engine budget; comparison fails without partial output', t => {
  const input = source(); const base = input.baseScenario;
  base.nodes = Array.from({ length: 600 }, (_, i) => ({ id: `n${i}`, x: i, y: 0 })); base.edges = [];
  for (let i = 0; i < 599; i += 1) {
    base.edges.push({ id: `out-${i}`, from: `n${i}`, to: `n${i + 1}`, travelTimeS: 0.25, distanceM: 1, roadName: 'Synthetic budget road' });
    base.edges.push({ id: `back-${i}`, from: `n${i + 1}`, to: `n${i}`, travelTimeS: 0.25, distanceM: 1, roadName: 'Synthetic budget road' });
  }
  base.vehicles[0].startNode = 'n0';
  base.jobs = Array.from({ length: 450 }, (_, i) => ({ id: `job-${i}`, vehicleId: base.vehicles[0].id, nodeId: i % 2 ? 'n0' : 'n599', dueTimeS: 604800, serviceTimeS: 0 }));
  for (const variant of input.variants) variant.closures = [];
  input.variants[1].closures = [{ id: 'bc-closure', edgeIds: ['out-0'], atS: 604800 }];
  const target = file(t, input);
  const exported = success(run(target, '--variant', 'close-at-10', '--closure', 'bc-closure', '--times', '604799,604800', '--export-experiment'));
  assert.equal(parseExperiment(exported).variants.length, 2);
  failure(run(target, '--variant', 'close-at-10', '--closure', 'bc-closure', '--times', '604799,604800', '--json'), /work limit/);
});

test('checked-in cutoff example outputs reproduce byte for byte', () => {
  assert.equal(success(run(example, ...selection, '--export-experiment')), readFileSync(path.join(root, 'docs/examples/cutoff-comparison/tiny-experiment.json'), 'utf8'));
  assert.equal(success(run(example, ...selection, '--max-extra-late', '0', '--max-unreachable', '0', '--json'), 1), readFileSync(path.join(root, 'docs/examples/cutoff-comparison/tiny-comparison.json'), 'utf8'));
});
