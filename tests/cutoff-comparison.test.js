import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonicalExperiment, simulateExperiment, validateExperiment } from '../src/experiment.js';
import { createCutoffExperiment, normalizeCutoffTimes } from '../scripts/cutoff-experiment.js';
import { compareCutoffs } from '../scripts/cutoff-comparison.js';
const input = () => JSON.parse(readFileSync(new URL('../examples/minimal-experiment.json', import.meta.url), 'utf8'));
const build = (source = input(), times = [10, 11]) => createCutoffExperiment(source, 'close-at-10', 'bc-closure', times);
const report = (source = input(), times = [10, 11], policy = {}) => compareCutoffs(source, 'close-at-10', 'bc-closure', times, policy);
const sha = value => createHash('sha256').update(canonicalExperiment(value)).digest('hex');

test('cutoff builder preserves base and other closure records, replaces only selected time, and isolates copies', () => {
  const source = input();
  source.variants[1].closures.push({ id: 'other', edgeIds: ['ab'], atS: 100 });
  const before = structuredClone(source), times = [11, 10];
  const generated = build(source, times);
  assert.deepEqual(generated.baseScenario, source.baseScenario);
  assert.equal(generated.variants.length, 2);
  assert.deepEqual(generated.variants.map(v => v.closures), [10, 11].map(atS => [{ ...source.variants[1].closures[0], atS }, source.variants[1].closures[1]]));
  assert.deepEqual(source, before); assert.deepEqual(times, [11, 10]);
  generated.variants[0].closures[0].edgeIds.push('ad');
  generated.baseScenario.nodes[0].x = 123;
  assert.deepEqual(source, before);
  assert.deepEqual(generated.variants[1].closures[0].edgeIds, ['bc']);
});

test('cutoff IDs are deterministic and avoid source and baseline IDs', () => {
  const source = input();
  source.id = 'cutoff-comparison'; source.baseScenario.id = 'cutoff-1'; source.variants[0].id = 'cutoff-2';
  const generated = build(source);
  const reserved = new Set(['baseline', source.id, source.baseScenario.id, ...source.variants.map(v => v.id)]);
  for (const id of [generated.id, ...generated.variants.map(v => v.id)]) { assert.ok(!reserved.has(id)); reserved.add(id); }
  assert.deepEqual(generated, build(source, [11, 10]));
  assert.deepEqual(generated, validateExperiment(generated));
});

test('cutoff builder accepts 2 and 6 samples including after playback horizon and max time', () => {
  for (const times of [[0, 604800], [0, 0.25, 10, 11, 100, 604800]]) {
    const generated = build(input(), times); assert.equal(generated.variants.length, times.length);
    assert.deepEqual(generated.variants.map(v => v.closures[0].atS), times);
  }
  assert.deepEqual(normalizeCutoffTimes([-0, 1]), [0, 1]);
});

for (const times of [null, {}, '10,11', [], [10], [0, 1, 2, 3, 4, 5, 6], [10, 10], [-0, 0], [-1, 1], [0, Infinity], [0, NaN], [0, 604801], [0, '1'], [0, null], [0, undefined], Array(2)]) {
  test(`cutoff times reject ${JSON.stringify(times)}`, () => assert.throws(() => build(input(), times), /times|cutoffs|Sample|Cutoff/));
}

test('cutoff times never execute array accessors or inherited iteration', () => {
  let ran = false;
  const times = [10, 11]; Object.defineProperty(times, '0', { get() { ran = true; return 10; } });
  assert.throws(() => normalizeCutoffTimes(times), /plain array/); assert.equal(ran, false);
  const custom = [10, 11]; custom.extra = 1; assert.throws(() => normalizeCutoffTimes(custom), /plain array/);
  assert.throws(() => normalizeCutoffTimes(new (class extends Array {})(10, 11)), /unique sample/);
});

for (const [variantId, closureId] of [['missing', 'bc-closure'], ['clear', 'bc-closure'], ['close-at-10', 'missing'], [null, 'bc-closure'], ['close-at-10', {}]]) {
  test(`cutoff selection rejects ${JSON.stringify([variantId, closureId])}`, () => assert.throws(() => createCutoffExperiment(input(), variantId, closureId, [10, 11]), /ID/));
}

test('replicated closure count fails aggregate bound before simulation/export', () => {
  const source = input();
  source.variants[1].closures = Array.from({ length: 1400 }, (_, i) => ({ id: i ? `event-${i}` : 'bc-closure', edgeIds: ['bc'], atS: 10 }));
  validateExperiment(source);
  assert.throws(() => build(source, [0, 1, 2, 3, 4, 5]), /aggregate closure-record/);
});

test('replicated closure references fail aggregate bound', () => {
  const source = input();
  source.baseScenario.edges = Array.from({ length: 1000 }, (_, i) => ({ ...source.baseScenario.edges[0], id: `e-${i}` }));
  for (const variant of source.variants) variant.closures = [];
  source.variants[1].closures = Array.from({ length: 9 }, (_, i) => ({ id: i ? `event-${i}` : 'bc-closure', edgeIds: source.baseScenario.edges.map(e => e.id), atS: 10 }));
  validateExperiment(source);
  assert.throws(() => build(source, [0, 1, 2, 3, 4, 5]), /aggregate closure-reference/);
});

test('sampled report proves the tiny boundary and distinguishes no-policy from acceptance', () => {
  const source = input(), before = structuredClone(source);
  const result = report(source);
  assert.equal(result.format, 'detourlab-cutoff-comparison'); assert.equal(result.version, 1);
  assert.equal(result.verdict, 'not-evaluated'); assert.equal(result.passingSampleTimesS, null);
  assert.equal(result.source.experimentSha256, sha(source)); assert.equal(result.experimentSha256, sha(build(source)));
  assert.deepEqual(result.candidates.map(c => [c.cutoffS, c.metrics.distanceM, c.metrics.lateJobs, c.metrics.completedJobs, c.verdict]), [[10, 260, 1, 1, 'not-evaluated'], [11, 200, 0, 1, 'not-evaluated']]);
  assert.deepEqual(source, before); assert.deepEqual(result, report(source, [11, 10]));
  assert.match(result.limitations.join(' '), /no optimal cutoff/);
});

test('every sampled policy is evaluated against clear roads and all-candidate verdict fails if any fails', () => {
  const result = report(input(), [10, 11], { extraDistancePct: 0, extraLateJobs: 0, unreachableJobs: 0, newlyLateJobs: 0, maxArrivalSlipS: 0 });
  assert.equal(result.verdict, 'failed'); assert.deepEqual(result.passingSampleTimesS, [11]);
  assert.deepEqual(result.candidates[0].violations.map(v => v.metric), ['extraDistancePct', 'extraLateJobs', 'newlyLateJobs', 'maxArrivalSlipS']);
  assert.equal(result.candidates[0].jobComparison.maxArrivalSlipS, 6);
  assert.equal(result.candidates[1].verdict, 'passed');
  assert.equal(report(input(), [10, 11], { extraLateJobs: 1 }).verdict, 'passed');
});

test('overlapping closure remains dominant and lost work is never presented as improvement', () => {
  const source = input(); source.variants[1].closures.push({ id: 'dominant', edgeIds: ['bc', 'dc'], atS: 0 });
  const result = report(source, [10, 11], { unreachableJobs: 0, maxArrivalSlipS: 100 });
  assert.equal(result.verdict, 'failed'); assert.deepEqual(result.passingSampleTimesS, []);
  assert.equal(result.warnings.length, 2);
  for (const candidate of result.candidates) {
    assert.equal(candidate.metrics.unreachableJobs, 1); assert.equal(candidate.metrics.completedJobs, 0);
    assert.equal(candidate.jobComparison.maxArrivalSlipS, null);
    assert.ok(candidate.violations.some(v => v.reason === 'no-comparable-jobs'));
  }
  assert.match(result.limitations.join(' '), /overlapping earlier closures can dominate/);
});

test('comparison preserves existing runner metrics and deltas exactly', () => {
  const generated = build(); const simulation = simulateExperiment(generated); const result = report();
  assert.deepEqual(result.baseline, simulation.baseline.metrics);
  result.candidates.forEach((candidate, i) => { assert.deepEqual(candidate.metrics, simulation.variants[i].result.metrics); assert.deepEqual(candidate.delta, simulation.variants[i].delta); });
});

for (const policy of [{ unknown: 1 }, { maxArrivalSlipS: Infinity }, { extraLateJobs: -1 }, { extraLateJobs: '0' }]) {
  test(`cutoff comparison rejects invalid policy ${JSON.stringify(policy)}`, () => assert.throws(() => report(input(), [10, 11], policy), /policy/));
}

test('generated bytes are bounded even when closure and reference totals fit', () => {
  const source = input();
  source.baseScenario.edges = Array.from({ length: 1000 }, (_, i) => ({ ...source.baseScenario.edges[0], id: `e${String(i).padStart(4, '0')}${'x'.repeat(91)}` }));
  for (const variant of source.variants) variant.closures = [];
  source.variants[1].closures = Array.from({ length: 5 }, (_, i) => ({ id: i ? `event-${i}` : 'bc-closure', edgeIds: source.baseScenario.edges.map(e => e.id), atS: 10 }));
  validateExperiment(source);
  assert.throws(() => build(source, [0, 1, 2, 3, 4, 5]), /2 MiB/);
});

test('fully frozen input, sample times and policy remain usable and unchanged', () => {
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const source = freeze(input()), times = freeze([11, 10]), policy = freeze({ extraLateJobs: 0 });
  assert.deepEqual(report(source, times, policy).passingSampleTimesS, [11]);
});
