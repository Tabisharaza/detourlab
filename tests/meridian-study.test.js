import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonicalExperiment, simulateExperiment } from '../src/experiment.js';
import { createDemoScenario } from '../src/scenario.js';
import { compareJobOutcomes } from '../src/job-gates.js';
import { compareMeridianSeeds, createMeridianExperiment, MERIDIAN_PLAN_IDS, normalizeMeridianPlans, normalizeSeed, normalizeSeeds, SEED_STUDY_LIMITS, serializeSeedStudy } from '../scripts/meridian-study.js';

test('standard seed-42 four-plan authoring reproduces the existing Meridian fixture exactly', () => {
  const fixture = JSON.parse(readFileSync(new URL('../examples/meridian-experiment.json', import.meta.url), 'utf8'));
  assert.deepEqual(createMeridianExperiment(42, MERIDIAN_PLAN_IDS), fixture);
});

test('default plans and numeric seed ordering are explicit, immutable and canonical', () => {
  assert.deepEqual(normalizeMeridianPlans(), ['market-05', 'market-10']);
  const seeds = Object.freeze([4294967295, 0, 42]);
  assert.deepEqual(normalizeSeeds(seeds), [0, 42, 4294967295]);
  assert.deepEqual(seeds, [4294967295, 0, 42]);
  assert.equal(Object.is(normalizeSeed(-0), 0), true);
  assert.deepEqual(normalizeMeridianPlans(Object.freeze(['clear-roads', 'market-10', 'market-05'])), ['market-05', 'market-10', 'clear-roads']);
});

test('seed count, integer, uint32, uniqueness and dense-array bounds reject ambiguous requests', () => {
  for (const seeds of [null, '0,1', [], [0], Array.from({ length: 13 }, (_, i) => i), [0, 0], [0, -0], [0, 0.5], [0, -1], [0, 4294967296], [0, Infinity], [0, NaN], [0, '1'], [0, 1n], [0, null], [0, undefined], Array(2)]) {
    assert.throws(() => normalizeSeeds(seeds), /Seed|seed|unique|entries/);
  }
  assert.deepEqual(normalizeSeeds(Array.from({ length: 12 }, (_, i) => 11 - i)), Array.from({ length: 12 }, (_, i) => i));
});

test('seed and plan validators never invoke accessors or custom iterators', () => {
  for (const [values, normalize] of [[[0, 1], normalizeSeeds], [['market-05', 'market-10'], normalizeMeridianPlans]]) {
    let invoked = false;
    const accessor = [...values]; Object.defineProperty(accessor, '0', { get() { invoked = true; throw Error('must not execute'); } });
    assert.throws(() => normalize(accessor), /plain array/); assert.equal(invoked, false);
    const iterator = [...values]; iterator[Symbol.iterator] = () => { invoked = true; throw Error('must not execute'); };
    assert.throws(() => normalize(iterator), /plain array/); assert.equal(invoked, false);
    const extra = [...values]; extra.custom = true; assert.throws(() => normalize(extra), /plain array/);
    assert.throws(() => normalize(new (class extends Array {})(...values)), /plain array/);
  }
});

test('plan selection accepts only 2–4 distinct known names, not arbitrary schedules or coercions', () => {
  for (const plans of [null, [], ['market-05'], [...MERIDIAN_PLAN_IDS, 'clear-roads'], ['market-05', 'market-05'], ['market-05', 'unknown'], ['market-05', 10], ['market-05', { toString() { throw Error('must not execute'); } }], Array(2)]) {
    assert.throws(() => normalizeMeridianPlans(plans), /plans|plan|entries/);
  }
});

test('seed authoring regenerates costs and demand, keeps topology and assignment order, and isolates plans', () => {
  const a = createMeridianExperiment(0, MERIDIAN_PLAN_IDS), b = createMeridianExperiment(42, MERIDIAN_PLAN_IDS);
  assert.deepEqual(a.baseScenario.nodes, b.baseScenario.nodes);
  assert.deepEqual(a.baseScenario.vehicles, b.baseScenario.vehicles);
  assert.deepEqual(a.baseScenario.edges.map(({ travelTimeS, ...edge }) => edge), b.baseScenario.edges.map(({ travelTimeS, ...edge }) => edge));
  assert.notDeepEqual(a.baseScenario.edges, b.baseScenario.edges);
  assert.notDeepEqual(a.baseScenario.jobs, b.baseScenario.jobs);
  assert.deepEqual(a.baseScenario.jobs.map(job => [job.id, job.vehicleId]), b.baseScenario.jobs.map(job => [job.id, job.vehicleId]));
  assert.deepEqual(a.baseScenario, { ...createDemoScenario(0), closures: [] });
  assert.deepEqual(a.variants, b.variants);
  a.variants[0].closures[0].edgeIds[0] = 'modified';
  assert.equal(a.variants[1].closures[0].edgeIds[0], 'bridge-central-east');
  assert.equal(b.variants[0].closures[0].edgeIds[0], 'bridge-central-east');
  a.baseScenario.jobs[0].nodeId = 'modified';
  assert.notEqual(b.baseScenario.jobs[0].nodeId, 'modified');
});

const seeds = Object.freeze([0, 42, 4294967295]);
const result = compareMeridianSeeds(seeds, undefined, Object.freeze({ extraLateJobs: 120 }));

test('every seed has its own baseline and fingerprint and matches the ordinary experiment engine', () => {
  for (const run of result.runs) {
    const experiment = createMeridianExperiment(run.seed), simulation = simulateExperiment(experiment);
    assert.equal(run.experimentSha256, createHash('sha256').update(canonicalExperiment(experiment)).digest('hex'));
    assert.deepEqual(run.baseline, simulation.baseline.metrics);
    run.variants.forEach((variant, i) => {
      assert.deepEqual(variant.metrics, simulation.variants[i].result.metrics);
      assert.deepEqual(variant.delta, simulation.variants[i].delta);
      assert.deepEqual(variant.jobComparison, compareJobOutcomes(simulation.baseline, simulation.variants[i].result));
    });
  }
  assert.equal(new Set(result.runs.map(run => run.experimentSha256)).size, 3);
  assert.equal(new Set(result.runs.map(run => run.baseline.distanceM)).size, 3);
});

test('all-sample policy fails even when descriptive mean passes; per-plan failures identify the seed', () => {
  assert.deepEqual(result.runs.map(run => run.variants.map(variant => variant.metrics.lateJobs)), [[122, 109], [118, 106], [105, 101]]);
  assert.equal(result.verdict, 'failed');
  assert.equal(result.variants[0].summary.metrics.lateJobs.mean, 115);
  assert.deepEqual(result.variants[0].failedSeeds, [0]);
  assert.equal(result.variants[1].verdict, 'passed'); assert.deepEqual(result.variants[1].failedSeeds, []);
  assert.deepEqual(result.runs[0].variants[0].violations, [{ metric: 'extraLateJobs', actual: 122, limit: 120 }]);
  assert.deepEqual(result.variants[0].summary.metrics.lateJobs, { samples: 3, missingSamples: 0, min: 105, max: 122, mean: 115, minSeeds: [4294967295], maxSeeds: [0] });
  assert.equal(result.variants[1].summary.metrics.lateJobs.mean, 105.333333);
  assert.match(result.limitations.join(' '), /no probability|No probability/);
  assert.match(result.limitations.join(' '), /service durations/);
  assert.match(result.limitations.join(' '), /Jobs are not paired across seeds/);
});

test('no-policy is not acceptance, and unreachable work retains warnings, signed deltas and timing exclusions', () => {
  const study = compareMeridianSeeds([42, 0], ['clear-roads', 'all-bridges-05']);
  assert.equal(study.verdict, 'not-evaluated');
  assert.deepEqual(study.plans, ['all-bridges-05', 'clear-roads']);
  assert.ok(study.variants.every(variant => variant.failedSeeds === null && variant.verdict === 'not-evaluated'));
  assert.equal(study.warnings.length, 2);
  for (const run of study.runs) {
    assert.ok(run.variants.every(variant => variant.verdict === 'not-evaluated' && variant.violations.length === 0));
    const closed = run.variants[0], clear = run.variants[1];
    assert.ok(closed.delta.distanceM < 0); assert.ok(closed.metrics.unreachableJobs > 0);
    assert.equal(closed.jobComparison.uncomparableJobs, closed.metrics.unreachableJobs);
    assert.ok(closed.jobComparison.comparableJobs < 192);
    assert.deepEqual(clear.metrics, run.baseline); assert.equal(clear.jobComparison.maxArrivalSlipS, 0);
  }
  assert.deepEqual(study.variants[1].summary.metrics.lateJobs.minSeeds, [0, 42]);
});

test('all existing policy metrics participate with literal limits and deterministic violation order', () => {
  const policy = { maxArrivalSlipS: 0, newlyLateJobs: 0, unreachableJobs: 0, extraLateJobs: 0, extraDistancePct: 0 };
  const study = compareMeridianSeeds([0, 42], MERIDIAN_PLAN_IDS, policy);
  assert.deepEqual(Object.keys(study.thresholds), ['extraDistancePct', 'extraLateJobs', 'unreachableJobs', 'newlyLateJobs', 'maxArrivalSlipS']);
  for (const run of study.runs) {
    assert.deepEqual(run.variants[0].violations.map(v => v.metric), ['extraDistancePct', 'extraLateJobs', 'newlyLateJobs', 'maxArrivalSlipS']);
    assert.ok(run.variants[2].violations.some(v => v.metric === 'unreachableJobs'));
    assert.equal(run.variants[3].verdict, 'passed');
  }
});

test('same request order changes cannot change study bytes, with output bounded before emission', () => {
  assert.equal(serializeSeedStudy(result), serializeSeedStudy(compareMeridianSeeds([...seeds].reverse(), ['market-10', 'market-05'], { extraLateJobs: 120 })));
  assert.ok(Buffer.byteLength(serializeSeedStudy(result)) < SEED_STUDY_LIMITS.maxReportBytes);
  assert.throws(() => serializeSeedStudy({ payload: 'é'.repeat(SEED_STUDY_LIMITS.maxReportBytes / 2) }), /1 MiB/);
});

test('invalid policy fails before any seed generation and never executes a policy accessor', () => {
  for (const policy of [{ unknown: 1 }, { extraLateJobs: -1 }, { maxArrivalSlipS: Infinity }, { unreachableJobs: '0' }]) assert.throws(() => compareMeridianSeeds([0, 42], undefined, policy), /policy/);
  let invoked = false; const policy = {};
  Object.defineProperty(policy, 'extraLateJobs', { get() { invoked = true; throw Error('must not execute'); } });
  assert.throws(() => compareMeridianSeeds([0, 42], undefined, policy), /accessors/); assert.equal(invoked, false);
});
