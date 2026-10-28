import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { simulateExperiment } from '../src/experiment.js';
import { createCutoffExperiment, normalizeCutoffTimes } from '../src/cutoff-experiment.js';
import * as cliBuilder from '../scripts/cutoff-experiment.js';
import { summarizeCutoffResults } from '../src/cutoff-comparison.js';
import { compareCutoffs } from '../scripts/cutoff-comparison.js';

const fixture = (name = 'minimal-experiment.json') => JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
const build = (source = fixture(), times = [10, 11]) => createCutoffExperiment(source, 'close-at-10', 'bc-closure', times);
const summarize = (experiment = build(), policy = {}) => summarizeCutoffResults(experiment, 'bc-closure', simulateExperiment(experiment), policy);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

test('browser and CLI import the identical bounded cutoff builder', () => {
  assert.equal(createCutoffExperiment, cliBuilder.createCutoffExperiment);
  assert.equal(normalizeCutoffTimes, cliBuilder.normalizeCutoffTimes);
});

test('shared completed-study projection matches the CLI including five-gate and no-policy results', () => {
  for (const [name, variantId, closureId, times] of [
    ['minimal-experiment.json', 'close-at-10', 'bc-closure', [10, 11]],
    ['meridian-experiment.json', 'market-05', 'market-bridge-closure', [0, 300, 600]],
  ]) {
    const source = fixture(name);
    for (const policy of [{}, { extraDistancePct: 0, extraLateJobs: 0, unreachableJobs: 0, newlyLateJobs: 0, maxArrivalSlipS: 0 }]) {
      const experiment = createCutoffExperiment(source, variantId, closureId, times);
      const projected = summarizeCutoffResults(experiment, closureId, simulateExperiment(experiment), policy);
      const { format, version, engineVersion, source: identity, experimentSha256, ...cli } = compareCutoffs(source, variantId, closureId, times, policy);
      assert.deepEqual(projected, cli);
      assert.equal(format, 'detourlab-cutoff-comparison'); assert.equal(version, 1); assert.equal(engineVersion, '0.1.0');
      assert.equal(identity.closureId, closureId); assert.match(experimentSha256, /^[0-9a-f]{64}$/u);
    }
  }
});

test('no thresholds means not-evaluated, never an empty passing set or an implicit success', () => {
  const report = summarize();
  assert.equal(report.verdict, 'not-evaluated'); assert.equal(report.passingSampleTimesS, null);
  assert.deepEqual(report.thresholds, {});
  for (const candidate of report.candidates) {
    assert.equal(candidate.verdict, 'not-evaluated'); assert.deepEqual(candidate.violations, []);
    assert.equal(Object.hasOwn(candidate, 'jobComparison'), false);
  }
});

test('aggregate distance policy retains signed percentage and equality semantics', () => {
  assert.deepEqual(summarize(build(), { extraDistancePct: 0 }).passingSampleTimesS, [11]);
  const equal = summarize(build(), { extraDistancePct: 30 });
  assert.equal(equal.verdict, 'passed'); assert.deepEqual(equal.passingSampleTimesS, [10, 11]);
  assert.equal(equal.candidates[0].delta.extraDistancePct, 30);
});

test('aggregate lateness policy retains net difference semantics', () => {
  const failed = summarize(build(), { extraLateJobs: 0 });
  assert.deepEqual(failed.candidates[0].violations, [{ metric: 'extraLateJobs', actual: 1, limit: 0 }]);
  assert.equal(summarize(build(), { extraLateJobs: 1 }).verdict, 'passed');
  assert.equal(Object.hasOwn(failed.candidates[0], 'jobComparison'), false);
});

test('unreachable policy uses absolute lost work and keeps skipped-work warnings', () => {
  const source = fixture(); source.variants[1].closures.push({ id: 'dominant', edgeIds: ['bc', 'dc'], atS: 0 });
  const generated = build(source), failed = summarize(generated, { unreachableJobs: 0 });
  assert.equal(failed.verdict, 'failed'); assert.deepEqual(failed.passingSampleTimesS, []);
  assert.equal(failed.warnings.length, 2);
  for (const candidate of failed.candidates) {
    assert.deepEqual(candidate.violations, [{ metric: 'unreachableJobs', actual: 1, limit: 0 }]);
    assert.equal(candidate.metrics.completedJobs, 0); assert.equal(candidate.metrics.totalJobs, 1);
  }
  assert.equal(summarize(generated, { unreachableJobs: 1 }).verdict, 'passed');
  assert.match(failed.warnings[0].message, /lower distance or lateness does not establish equal-service improvement/);
});

test('newly-late policy reuses per-job transition counts', () => {
  const report = summarize(build(), { newlyLateJobs: 0 });
  assert.deepEqual(report.candidates[0].violations, [{ metric: 'newlyLateJobs', actual: 1, limit: 0 }]);
  assert.equal(report.candidates[0].jobComparison.newlyLateJobs, 1);
  assert.equal(report.candidates[1].jobComparison.newlyLateJobs, 0);
  assert.equal(summarize(build(), { newlyLateJobs: 1 }).verdict, 'passed');
});

test('arrival-slip policy preserves literal timing and permits equality', () => {
  const report = summarize(build(), { maxArrivalSlipS: 5.999999999 });
  assert.deepEqual(report.passingSampleTimesS, [11]);
  assert.deepEqual(report.candidates[0].violations, [{ metric: 'maxArrivalSlipS', actual: 6, limit: 5.999999999 }]);
  assert.equal(summarize(build(), { maxArrivalSlipS: 6 }).verdict, 'passed');
});

test('requested arrival-slip fails closed when empty demand supplies no comparable evidence', () => {
  const source = fixture(); source.baseScenario.jobs = [];
  const generated = build(source), report = summarize(generated, { maxArrivalSlipS: 100 });
  assert.equal(report.verdict, 'failed'); assert.deepEqual(report.passingSampleTimesS, []);
  for (const candidate of report.candidates) {
    assert.equal(candidate.jobComparison.maxArrivalSlipS, null);
    assert.deepEqual(candidate.violations, [{ metric: 'maxArrivalSlipS', actual: null, limit: 100, reason: 'no-comparable-jobs' }]);
  }
  assert.equal(summarize(generated).verdict, 'not-evaluated');
});

test('projection consumes supplied completed evidence instead of rerunning and independently copies output', () => {
  const generated = build(), completed = simulateExperiment(generated);
  // A finite internal metric not recomputed from routes by the report boundary.
  completed.baseline.metrics.totalTravelTimeS = 12345.6789;
  const before = structuredClone({ generated, completed });
  const report = summarizeCutoffResults(generated, 'bc-closure', completed);
  assert.equal(report.baseline.totalTravelTimeS, 12345.6789);
  report.baseline.totalTravelTimeS = 0; report.candidates[0].delta.extraLateJobs = 999;
  report.candidates[1].metrics.distanceM = 0;
  assert.deepEqual({ generated, completed }, before);
  assert.deepEqual(summarizeCutoffResults(freeze(generated), 'bc-closure', freeze(completed), freeze({ extraLateJobs: 0 })).passingSampleTimesS, [11]);
});

test('projection never reads or copies route segments already budgeted by the Worker', () => {
  const generated = build(), completed = simulateExperiment(generated);
  const expected = summarizeCutoffResults(generated, 'bc-closure', completed);
  for (const run of [completed.baseline, ...completed.variants.map(variant => variant.result)]) {
    for (const vehicle of run.vehicles) { vehicle.segments = null; vehicle.reroutes = null; }
  }
  assert.deepEqual(summarizeCutoffResults(generated, 'bc-closure', completed), expected);
});

test('transport IDs never leak into candidate evidence or change repeated projection', () => {
  const generated = build(), completed = simulateExperiment(generated);
  const expected = summarizeCutoffResults(generated, 'bc-closure', completed);
  assert.deepEqual(summarizeCutoffResults(generated, 'bc-closure', { id: 9182, ...completed }), expected);
  assert.deepEqual(summarizeCutoffResults(generated, 'bc-closure', completed), expected);
});

test('incomplete, stale and incoherent completed ledgers reject the entire study', () => {
  const generated = build(), completed = simulateExperiment(generated);
  for (const change of [
    value => { value.variants.pop(); },
    value => { value.variants.reverse(); },
    value => { value.variants[0].id = 'old-study'; },
    value => { value.variants[0].name = 'old-label'; },
    value => { value.baseline.vehicles[0].jobs.pop(); },
    value => { value.variants[0].result.metrics.distanceM += 1; },
    value => { value.variants[1].result.vehicles[0].jobs[0].completedS += 1; },
    value => { value.variants[0].delta.extraLateJobs = -10; },
    value => { value.variants[0].result.metrics.completedJobs = 0; },
  ]) {
    const invalid = structuredClone(completed); change(invalid);
    assert.throws(() => summarizeCutoffResults(generated, 'bc-closure', invalid), /Completed results/);
  }
});

test('selected closure must exist in every candidate and retained schedules cannot diverge', () => {
  for (const change of [
    value => { value.variants[0].closures = []; },
    value => { value.variants[0].closures[0].edgeIds = ['ab']; },
    value => { value.variants[0].closures.push({ id: 'extra', edgeIds: ['ab'], atS: 20 }); },
  ]) {
    const generated = build(); change(generated);
    assert.throws(() => summarize(generated), /selected closure|preserve all other/);
  }
  assert.throws(() => summarizeCutoffResults(build(), null, {}), /closure ID/);
});

test('projection rejects repeated or out-of-order sampled times instead of labeling an ambiguous comparison', () => {
  const duplicate = build(); duplicate.variants[1].closures[0].atS = 10;
  assert.throws(() => summarize(duplicate), /unique/);
  const reversed = build(); reversed.variants.reverse();
  assert.throws(() => summarize(reversed), /increasing closure start time/);
});

test('projection rejects malformed policies before reading completed data', () => {
  for (const policy of [{ typo: 0 }, { extraLateJobs: -1 }, { extraDistancePct: Infinity }, { newlyLateJobs: '0' }, null]) {
    assert.throws(() => summarizeCutoffResults(build(), 'bc-closure', {}, policy), /Report policy/);
  }
  let called = false;
  const policy = { get maxArrivalSlipS() { called = true; return 0; } };
  assert.throws(() => summarizeCutoffResults(build(), 'bc-closure', {}, policy), /data properties/);
  assert.equal(called, false);
});

test('completed-result accessors are rejected rather than executed during study projection', () => {
  const generated = build(), completed = simulateExperiment(generated);
  let called = false;
  Object.defineProperty(completed.baseline.metrics, 'distanceM', { get() { called = true; return 0; } });
  assert.throws(() => summarizeCutoffResults(generated, 'bc-closure', completed), /accessors/);
  assert.equal(called, false);
});

test('client cutoff helpers contain no Node import, separate simulation call or unbounded result truncation', () => {
  for (const file of ['cutoff-experiment.js', 'cutoff-comparison.js']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /^import .*from ['"]node:|\bsimulate(?:Experiment)?\s*\(|\.slice\(/mu);
  }
  const report = summarize(build(fixture(), [0, 1, 2, 10, 11, 604800]));
  assert.equal(report.candidates.length, 6);
  assert.deepEqual(report.candidates.map(candidate => candidate.cutoffS), [0, 1, 2, 10, 11, 604800]);
});
