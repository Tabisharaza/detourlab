import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareVariants, renderVariantComparisonJson, VARIANT_COMPARISON_MAX_BYTES } from '../scripts/variant-comparison.js';
import { createJobImpactReport } from '../scripts/job-impact.js';

const load = file => JSON.parse(readFileSync(new URL(`../examples/${file}.json`, import.meta.url), 'utf8'));
const tiny = () => load('minimal-experiment');

test('tiny closure compares two named plans with the right direction and all timing fields', () => {
  const input = tiny();
  const original = structuredClone(input);
  const report = compareVariants(input, 'close-at-10', 'close-at-11');
  assert.equal(report.reference.id, 'close-at-10');
  assert.equal(report.candidate.id, 'close-at-11');
  assert.deepEqual(report.delta, { distanceM: -60, lateJobs: -1, unreachableJobs: 0, completedJobs: 0 });
  assert.deepEqual(report.summary.arrivals, { earlier: 1, unchanged: 0, later: 0, notComparable: 0 });
  assert.equal(report.summary.transitions.late['on-time'], 1);
  assert.deepEqual(report.jobs, [{
    id: 'job-1', vehicleId: 'van-1', nodeId: 'C', dueTimeS: 22,
    changed: true, statusChanged: true, arrivalDeltaS: -6, completedDeltaS: -6,
    reference: { status: 'late', arrivalS: 26, completedS: 29, latenessS: 4 },
    candidate: { status: 'on-time', arrivalS: 20, completedS: 23, latenessS: 0 },
    latenessDeltaS: -4,
  }]);
  assert.deepEqual(input, original);
});

test('swapping sides reverses signs and transitions without changing experiment identity', () => {
  const forward = compareVariants(tiny(), 'close-at-10', 'close-at-11');
  const reverse = compareVariants(tiny(), 'close-at-11', 'close-at-10');
  assert.equal(reverse.experimentSha256, forward.experimentSha256);
  assert.deepEqual(reverse.reference, forward.candidate);
  assert.deepEqual(reverse.candidate, forward.reference);
  assert.equal(reverse.delta.distanceM, 60);
  assert.equal(reverse.delta.lateJobs, 1);
  assert.equal(reverse.summary.transitions['on-time'].late, 1);
  assert.deepEqual(reverse.summary.arrivals, { earlier: 0, unchanged: 0, later: 1, notComparable: 0 });
  assert.deepEqual([reverse.jobs[0].arrivalDeltaS, reverse.jobs[0].completedDeltaS, reverse.jobs[0].latenessDeltaS], [6, 6, 4]);
});

test('distinct plans may have unchanged outcomes; an empty run does not invent comparisons', () => {
  const input = tiny();
  const unchanged = compareVariants(input, 'clear', 'close-at-11');
  assert.deepEqual(unchanged.summary.arrivals, { earlier: 0, unchanged: 1, later: 0, notComparable: 0 });
  assert.equal(unchanged.jobs[0].changed, false);
  assert.equal(unchanged.jobs[0].arrivalDeltaS, 0);
  input.baseScenario.jobs = [];
  const empty = compareVariants(input, 'clear', 'close-at-11');
  assert.equal(empty.summary.totalJobs, 0);
  assert.deepEqual(empty.summary.arrivals, { earlier: 0, unchanged: 0, later: 0, notComparable: 0 });
  assert.equal(Object.values(empty.summary.transitions).flatMap(Object.values).every(count => count === 0), true);
  assert.deepEqual(empty.jobs, []);
});

test('missing arrival on either or both sides never becomes zero or an unchanged comparable arrival', () => {
  const input = tiny();
  const disconnect = id => ({ id, name: id, closures: [{ id: 'closed', atS: 0, edgeIds: ['bc', 'bd'] }] });
  input.variants.push(disconnect('disconnected-a'), disconnect('disconnected-b'));
  for (const [from, to, before, after, delta] of [
    ['clear', 'disconnected-a', 'on-time', 'unreachable', 1],
    ['disconnected-a', 'clear', 'unreachable', 'on-time', -1],
    ['disconnected-a', 'disconnected-b', 'unreachable', 'unreachable', 0],
  ]) {
    const report = compareVariants(input, from, to);
    assert.deepEqual(report.summary.arrivals, { earlier: 0, unchanged: 0, later: 0, notComparable: 1 });
    assert.equal(report.delta.unreachableJobs, delta);
    assert.equal(report.delta.completedJobs, -delta || 0);
    assert.equal(report.summary.transitions[before][after], 1);
    assert.deepEqual([report.jobs[0].arrivalDeltaS, report.jobs[0].completedDeltaS, report.jobs[0].latenessDeltaS], [null, null, null]);
    assert.equal(report.jobs[0].changed, before !== after);
  }
});

test('Meridian matches both ordinary reports in input order and exposes mixed individual outcomes', () => {
  const input = load('meridian-experiment');
  const reference = createJobImpactReport(input, 'market-05');
  const candidate = createJobImpactReport(input, 'market-10');
  const comparison = compareVariants(input, 'market-05', 'market-10');
  assert.deepEqual(comparison.delta, { distanceM: -480, lateJobs: -12, unreachableJobs: 0, completedJobs: 0 });
  assert.deepEqual(comparison.summary.arrivals, { earlier: 46, unchanged: 81, later: 65, notComparable: 0 });
  assert.equal(comparison.summary.changedJobs, 111);
  assert.equal(comparison.summary.transitions.late['on-time'], 12);
  assert.equal(comparison.experimentSha256, reference.experimentSha256);
  assert.deepEqual(comparison.reference.metrics, reference.variantMetrics);
  assert.deepEqual(comparison.candidate.metrics, candidate.variantMetrics);
  assert.deepEqual(comparison.jobs.map(job => job.id), input.baseScenario.jobs.map(job => job.id));
  const outcome = ({ delayS, ...rest }) => ({ ...rest, latenessS: delayS });
  for (const [index, job] of comparison.jobs.entries()) {
    assert.deepEqual(job.reference, outcome(reference.jobs[index].variant));
    assert.deepEqual(job.candidate, outcome(candidate.jobs[index].variant));
    assert.equal(job.arrivalDeltaS, job.candidate.arrivalS - job.reference.arrivalS);
  }
});

test('each side keeps the engine status for a fractional on-time boundary', () => {
  const input = tiny();
  input.baseScenario.edges[0].travelTimeS = 0.1;
  input.baseScenario.edges[1].travelTimeS = 0.2;
  input.baseScenario.jobs[0].dueTimeS = 0.3;
  const report = compareVariants(input, 'close-at-10', 'close-at-11');
  assert.ok(report.jobs[0].reference.arrivalS > 0.3);
  assert.equal(report.jobs[0].reference.status, 'on-time');
  assert.equal(report.jobs[0].reference.latenessS, 0);
  assert.equal(report.jobs[0].candidate.latenessS, 0);
});

test('nonfinite and unsafe selector values are rejected without coercion', () => {
  const input = tiny();
  assert.throws(() => compareVariants(input, 'clear', { toString() { assert.fail('coercion'); } }), /safe variant ID/);
  assert.throws(() => compareVariants(input, NaN, 'clear'), /safe variant ID/);
  assert.throws(() => compareVariants(input, 'missing', 'clear'), /Unknown reference variant/);
  assert.throws(() => compareVariants(input, 'clear', 'clear'), /distinct/);
});

test('JSON limit counts UTF-8 bytes and the final newline, not characters', () => {
  const overhead = Buffer.byteLength(renderVariantComparisonJson({ text: '' }));
  const exact = { text: 'é'.repeat((VARIANT_COMPARISON_MAX_BYTES - overhead) / 2) + 'a'.repeat((VARIANT_COMPARISON_MAX_BYTES - overhead) % 2) };
  assert.equal(Buffer.byteLength(renderVariantComparisonJson(exact)), VARIANT_COMPARISON_MAX_BYTES);
  assert.throws(() => renderVariantComparisonJson({ text: exact.text + 'a' }), /4 MiB/);
});
