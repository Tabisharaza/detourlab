import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { LIMITS } from '../src/scenario.js';
import { canonicalExperiment, simulateExperiment, validateExperiment } from '../src/experiment.js';
import { createJobImpactReport, projectJobOutcomes, IMPACT_LIMITS } from '../scripts/job-impact.js';

const readJSON = name => JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
const fixture = () => readJSON('minimal-experiment.json');
const bytes = value => Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
const statuses = ['on-time', 'late', 'unreachable'];
const transitions = (...entries) => {
  const matrix = Object.fromEntries(statuses.map(from => [from, Object.fromEntries(statuses.map(to => [to, 0]))]));
  for (const [from, to, count] of entries) matrix[from][to] = count;
  return matrix;
};
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value;

// Run the checked-in implementation with a smaller byte budget or a runner spy,
// without adding a production injection API or relying on experimental mocks.
function instrument({ maxBytes = IMPACT_LIMITS.maxBytes, runner = simulateExperiment } = {}) {
  const source = readFileSync(new URL('../scripts/job-impact.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export \{.*\};\n/gm, '').replace(/^export /gm, '')
    .replace('maxBytes: 4 * 1024 * 1024', `maxBytes: ${maxBytes}`);
  return new Function('createHash', 'canonicalExperiment', 'simulateExperiment', 'validateExperiment', 'projectJobOutcomes', `${source}\nreturn createJobImpactReport;`)(createHash, canonicalExperiment, runner, validateExperiment, projectJobOutcomes);
}

test('impact report has a frozen, bounded format limit', () => {
  assert.deepEqual(IMPACT_LIMITS, { maxBytes: 4194304 });
  assert.ok(Object.isFrozen(IMPACT_LIMITS));
});

test('10-second cutoff has an independently hand-checked complete report', () => {
  assert.deepEqual(createJobImpactReport(fixture(), 'close-at-10'), {
    format: 'detourlab-job-impact', version: 1, engineVersion: '0.1.0',
    experimentId: 'minimal-cutoff-experiment',
    experimentSha256: '7a757f1b53531826e98f44a706d3c6d235986682e6517c3c542f116fa8bf7395',
    variant: { id: 'close-at-10', name: 'Close at 10 s' },
    baselineMetrics: { distanceM: 200, lateJobs: 0, unreachableJobs: 0, completedJobs: 1, totalJobs: 1, totalDelayS: 0, onTimeJobs: 1, reroutes: 0, affectedVehicles: 0, totalTravelTimeS: 20 },
    variantMetrics: { distanceM: 260, lateJobs: 1, unreachableJobs: 0, completedJobs: 1, totalJobs: 1, totalDelayS: 4, onTimeJobs: 0, reroutes: 1, affectedVehicles: 1, totalTravelTimeS: 26 },
    delta: { distanceM: 60, extraDistancePct: 30, extraLateJobs: 1, unreachableJobs: 0 },
    summary: { totalJobs: 1, changedJobs: 1, unchangedJobs: 0, statusChangedJobs: 1, arrivalChangedJobs: 1, transitions: transitions(['on-time', 'late', 1]) },
    jobs: [{
      id: 'job-1', vehicleId: 'van-1', nodeId: 'C', dueTimeS: 22,
      baseline: { status: 'on-time', arrivalS: 20, completedS: 23, delayS: 0 },
      variant: { status: 'late', arrivalS: 26, completedS: 29, delayS: 4 },
      changed: true, statusChanged: true, arrivalDeltaS: 6, completedDeltaS: 6, delayDeltaS: 4,
    }],
  });
});

test('11-second cutoff finishes an already-entered edge without changing the outcome', () => {
  const report = createJobImpactReport(fixture(), 'close-at-11');
  assert.deepEqual(report.baselineMetrics, report.variantMetrics);
  assert.deepEqual(report.delta, { distanceM: 0, extraDistancePct: 0, extraLateJobs: 0, unreachableJobs: 0 });
  assert.deepEqual(report.summary, { totalJobs: 1, changedJobs: 0, unchangedJobs: 1, statusChangedJobs: 0, arrivalChangedJobs: 0, transitions: transitions(['on-time', 'on-time', 1]) });
  assert.deepEqual(report.jobs, [{
    id: 'job-1', vehicleId: 'van-1', nodeId: 'C', dueTimeS: 22,
    baseline: { status: 'on-time', arrivalS: 20, completedS: 23, delayS: 0 },
    variant: { status: 'on-time', arrivalS: 20, completedS: 23, delayS: 0 },
    changed: false, statusChanged: false, arrivalDeltaS: 0, completedDeltaS: 0, delayDeltaS: 0,
  }]);
});

test('report rows follow original interleaved job order, not vehicle or job-ID sorting', () => {
  const input = fixture(), original = input.baseScenario.jobs[0];
  input.baseScenario.vehicles = ['z-van', 'a-van', 'm-van'].map((id, i) => ({ id, startNode: 'A', startTimeS: i }));
  input.baseScenario.jobs = [
    { ...original, id: 'z-job', vehicleId: 'z-van' },
    { ...original, id: 'y-job', vehicleId: 'a-van' },
    { ...original, id: 'a-job', vehicleId: 'z-van' },
    { ...original, id: 'b-job', vehicleId: 'm-van' },
    { ...original, id: 'm-job', vehicleId: 'a-van' },
  ];
  const report = createJobImpactReport(input, 'clear');
  assert.deepEqual(report.jobs.map(job => [job.id, job.vehicleId, job.baseline.arrivalS]), [
    ['z-job', 'z-van', 20], ['y-job', 'a-van', 21], ['a-job', 'z-van', 23], ['b-job', 'm-van', 22], ['m-job', 'a-van', 24],
  ]);
  assert.equal(report.summary.unchangedJobs, 5);
  assert.deepEqual(report.summary.transitions, transitions(['on-time', 'on-time', 3], ['late', 'late', 2]));
});

test('empty work returns a full zero matrix and no invented jobs', () => {
  const input = fixture(); input.baseScenario.jobs = [];
  const report = createJobImpactReport(input, 'close-at-10');
  assert.deepEqual(report.jobs, []);
  assert.deepEqual(report.summary, { totalJobs: 0, changedJobs: 0, unchangedJobs: 0, statusChangedJobs: 0, arrivalChangedJobs: 0, transitions: transitions() });
  assert.equal(report.baselineMetrics.totalJobs, 0);
  assert.equal(report.variantMetrics.completedJobs, 0);
  assert.equal(report.delta.extraDistancePct, 0);
});

test('unreachable outcomes stay null after partial travel and skipped work continues from the real node', () => {
  const input = fixture();
  input.variants[1].closures[0].edgeIds = ['bc', 'bd'];
  input.baseScenario.jobs.push(
    { id: 'second', vehicleId: 'van-1', nodeId: 'B', dueTimeS: 5, serviceTimeS: 2 },
    { id: 'third', vehicleId: 'van-1', nodeId: 'B', dueTimeS: 50, serviceTimeS: 0 },
    { id: 'fourth', vehicleId: 'van-1', nodeId: 'A', dueTimeS: 50, serviceTimeS: 0 },
  );
  const report = createJobImpactReport(input, 'close-at-10');
  const unreachable = { status: 'unreachable', arrivalS: null, completedS: null, delayS: null };
  assert.deepEqual(report.jobs.map(job => [job.baseline, job.variant]), [
    [{ status: 'on-time', arrivalS: 20, completedS: 23, delayS: 0 }, unreachable],
    [unreachable, { status: 'late', arrivalS: 10, completedS: 12, delayS: 5 }],
    [unreachable, { status: 'on-time', arrivalS: 12, completedS: 12, delayS: 0 }],
    [unreachable, unreachable],
  ]);
  for (const job of report.jobs) {
    assert.equal(job.arrivalDeltaS, null);
    assert.equal(job.completedDeltaS, null);
    assert.equal(job.delayDeltaS, null);
  }
  assert.equal(report.jobs[3].changed, false);
  assert.equal(report.baselineMetrics.distanceM, 200);
  assert.equal(report.variantMetrics.distanceM, 100, 'partial travel remains in aggregate metrics');
  assert.deepEqual(report.delta, { distanceM: -100, extraDistancePct: -50, extraLateJobs: 1, unreachableJobs: 2 });
  assert.deepEqual(report.summary, {
    totalJobs: 4, changedJobs: 3, unchangedJobs: 1, statusChangedJobs: 3, arrivalChangedJobs: 3,
    transitions: transitions(['on-time', 'unreachable', 1], ['unreachable', 'late', 1], ['unreachable', 'on-time', 1], ['unreachable', 'unreachable', 1]),
  });
});

test('immediately unreachable and already-disconnected jobs never receive numeric timing deltas', () => {
  const input = fixture();
  input.baseScenario.jobs[0].dueTimeS = 19;
  input.variants[1].closures[0] = { id: 'block-start', edgeIds: ['ab'], atS: 0 };
  const blocked = createJobImpactReport(input, 'close-at-10');
  assert.deepEqual(blocked.jobs[0].baseline, { status: 'late', arrivalS: 20, completedS: 23, delayS: 1 });
  assert.deepEqual(blocked.jobs[0].variant, { status: 'unreachable', arrivalS: null, completedS: null, delayS: null });
  assert.equal(blocked.jobs[0].arrivalDeltaS, null);
  assert.equal(blocked.jobs[0].delayDeltaS, null);
  assert.equal(blocked.variantMetrics.distanceM, 0);
  assert.deepEqual(blocked.summary.transitions, transitions(['late', 'unreachable', 1]));
  input.baseScenario.edges = [];
  input.variants.forEach(variant => { variant.closures = []; });
  const disconnected = createJobImpactReport(input, 'clear');
  assert.equal(disconnected.jobs[0].changed, false);
  assert.equal(disconnected.summary.arrivalChangedJobs, 0);
  assert.equal(disconnected.delta.unreachableJobs, 1, 'experiment delta retains its absolute unreachable count');
  assert.deepEqual(disconnected.summary.transitions, transitions(['unreachable', 'unreachable', 1]));
});

test('already-late baseline remains a changed job when lateness count is unchanged', () => {
  const input = fixture(); input.baseScenario.jobs[0].dueTimeS = 19;
  const report = createJobImpactReport(input, 'close-at-10');
  assert.equal(report.delta.extraLateJobs, 0);
  assert.deepEqual(report.summary, { totalJobs: 1, changedJobs: 1, unchangedJobs: 0, statusChangedJobs: 0, arrivalChangedJobs: 1, transitions: transitions(['late', 'late', 1]) });
  assert.equal(report.jobs[0].baseline.delayS, 1);
  assert.equal(report.jobs[0].variant.delayS, 7);
  assert.equal(report.jobs[0].delayDeltaS, 6);
});

test('later jobs can arrive earlier after skipped work, with signed deltas and lost service still visible', () => {
  const input = fixture();
  input.baseScenario.edges.push({ id: 'cb', from: 'C', to: 'B', distanceM: 120, travelTimeS: 12, roadName: 'Return Street' });
  input.variants[1].closures[0].edgeIds = ['bc', 'bd'];
  input.baseScenario.jobs.push({ id: 'second', vehicleId: 'van-1', nodeId: 'B', dueTimeS: 25, serviceTimeS: 2 });
  const report = createJobImpactReport(input, 'close-at-10'), second = report.jobs[1];
  assert.deepEqual(second.baseline, { status: 'late', arrivalS: 35, completedS: 37, delayS: 10 });
  assert.deepEqual(second.variant, { status: 'on-time', arrivalS: 10, completedS: 12, delayS: 0 });
  assert.equal(second.arrivalDeltaS, -25);
  assert.equal(second.completedDeltaS, -25);
  assert.equal(second.delayDeltaS, -10);
  assert.equal(second.changed, true);
  assert.equal(second.statusChanged, true);
  assert.equal(report.jobs[0].variant.status, 'unreachable');
  assert.equal(report.baselineMetrics.completedJobs, 2);
  assert.equal(report.variantMetrics.completedJobs, 1);
  assert.deepEqual(report.summary.transitions, transitions(['on-time', 'unreachable', 1], ['late', 'on-time', 1]));
});

test('on-time to on-time arrival changes are included without inventing lateness', () => {
  const input = fixture(); input.baseScenario.jobs[0].dueTimeS = 30;
  const report = createJobImpactReport(input, 'close-at-10');
  assert.equal(report.jobs[0].changed, true);
  assert.equal(report.jobs[0].statusChanged, false);
  assert.equal(report.jobs[0].arrivalDeltaS, 6);
  assert.equal(report.jobs[0].delayDeltaS, 0);
  assert.equal(report.summary.changedJobs, 1);
  assert.deepEqual(report.summary.transitions, transitions(['on-time', 'on-time', 1]));
});

test('changed routes with identical job outcomes remain unchanged in this report', () => {
  const input = fixture();
  input.baseScenario.edges.filter(edge => ['bd', 'dc'].includes(edge.id)).forEach(edge => { edge.travelTimeS = 5; });
  const report = createJobImpactReport(input, 'close-at-10');
  assert.equal(report.delta.distanceM, 60);
  assert.equal(report.variantMetrics.reroutes, 1);
  assert.equal(report.jobs[0].changed, false);
  assert.equal(report.summary.changedJobs, 0);
});

test('job numbers retain full precision and delay honors engine deadline tolerance', () => {
  const input = fixture();
  const times = { ab: 0.1, bc: 0.2, bd: 0.123456789, dc: 0.234567891 };
  input.baseScenario.edges.forEach(edge => { edge.travelTimeS = times[edge.id]; });
  input.baseScenario.jobs[0].dueTimeS = 0.3;
  input.baseScenario.jobs[0].serviceTimeS = 0.123456789;
  input.variants[1].closures[0].atS = 0.1;
  const report = createJobImpactReport(input, 'close-at-10'), job = report.jobs[0];
  const baselineArrival = 0.1 + 0.2, variantArrival = 0.1 + 0.123456789 + 0.234567891;
  assert.ok(baselineArrival > 0.3, 'fixture exercises representational deadline noise');
  assert.deepEqual(job.baseline, { status: 'on-time', arrivalS: baselineArrival, completedS: baselineArrival + 0.123456789, delayS: 0 });
  assert.deepEqual(job.variant, { status: 'late', arrivalS: variantArrival, completedS: variantArrival + 0.123456789, delayS: variantArrival - 0.3 });
  assert.equal(job.arrivalDeltaS, variantArrival - baselineArrival);
  assert.equal(job.completedDeltaS, (variantArrival + 0.123456789) - (baselineArrival + 0.123456789));
  assert.equal(job.delayDeltaS, variantArrival - 0.3);
  assert.notEqual(job.arrivalDeltaS, Number(job.arrivalDeltaS.toFixed(6)));
  assert.equal(report.variantMetrics.totalDelayS, job.variant.delayS);
  input.baseScenario.jobs[0].dueTimeS = 0.3 - 1e-8;
  const late = createJobImpactReport(input, 'clear').jobs[0].baseline;
  assert.equal(late.status, 'late');
  assert.equal(late.delayS, baselineArrival - (0.3 - 1e-8));
});

test('Meridian report exposes changed arrivals beyond the additional late-job count', () => {
  const input = readJSON('meridian-experiment.json');
  const report = createJobImpactReport(input, 'market-05');
  assert.equal(report.summary.changedJobs, 125);
  assert.equal(report.summary.arrivalChangedJobs, 125);
  assert.equal(report.summary.statusChangedJobs, 118);
  assert.equal(report.delta.extraLateJobs, 118);
  const job = report.jobs.find(item => item.id === 'job-01-4');
  assert.equal(job.vehicleId, 'van-01');
  assert.equal(job.dueTimeS, 749);
  assert.deepEqual(job.baseline, { status: 'on-time', arrivalS: 690, completedS: 710, delayS: 0 });
  assert.deepEqual(job.variant, { status: 'on-time', arrivalS: 741, completedS: 761, delayS: 0 });
  assert.equal(job.changed, true);
  assert.equal(job.statusChanged, false);
  assert.equal(job.arrivalDeltaS, 51);
  assert.equal(report.summary.totalJobs, input.baseScenario.jobs.length);
  assert.equal(report.summary.changedJobs + report.summary.unchangedJobs, report.summary.totalJobs);
  assert.equal(Object.values(report.summary.transitions).flatMap(Object.values).reduce((sum, n) => sum + n, 0), report.summary.totalJobs);
});

test('frozen inputs are unchanged and report objects never alias each other or caller data', () => {
  const input = fixture(), before = structuredClone(input);
  freeze(input);
  const first = createJobImpactReport(input, 'clear'), expected = structuredClone(first);
  const second = createJobImpactReport(input, 'clear');
  assert.deepEqual(input, before);
  assert.notEqual(first.baselineMetrics, first.variantMetrics);
  assert.notEqual(first.jobs[0].baseline, first.jobs[0].variant);
  assert.notEqual(first.summary.transitions['on-time'], first.summary.transitions.late);
  first.variant.name = 'Edited';
  first.variantMetrics.distanceM = 900;
  first.jobs[0].variant.arrivalS = 900;
  first.summary.transitions['on-time'].late = 900;
  first.delta.distanceM = 900;
  assert.deepEqual(first.baselineMetrics, expected.baselineMetrics);
  assert.deepEqual(first.jobs[0].baseline, expected.jobs[0].baseline);
  assert.equal(first.summary.transitions.late.late, 0);
  assert.deepEqual(second, expected);
  assert.deepEqual(createJobImpactReport(input, 'clear'), expected);
  assert.deepEqual(input, before);
});

test('reports and hashes are deterministic across object keys and whitespace, with array order significant', () => {
  const input = fixture(), report = createJobImpactReport(input, 'close-at-10');
  assert.deepEqual(createJobImpactReport(reverseKeys(input), 'close-at-10'), report);
  assert.deepEqual(createJobImpactReport(JSON.parse(JSON.stringify(input, null, 7)), 'close-at-10'), report);
  assert.equal(JSON.stringify(createJobImpactReport(input, 'close-at-10')), JSON.stringify(report));
  assert.equal(report.experimentSha256, createHash('sha256').update(canonicalExperiment(input)).digest('hex'));
  assert.equal(createJobImpactReport(input, 'clear').experimentSha256, report.experimentSha256, 'variant selection does not rewrite the experiment');
  input.variants.reverse();
  assert.notEqual(createJobImpactReport(input, 'close-at-10').experimentSha256, report.experimentSha256);
  const changed = fixture(); changed.variants[1].closures[0].atS += 1;
  assert.notEqual(createJobImpactReport(changed, 'close-at-10').experimentSha256, report.experimentSha256);
});

test('unknown variants are rejected before simulation and variant selectors are never coerced', () => {
  let calls = 0;
  const run = instrument({ runner() { calls += 1; throw new Error('must not run'); } });
  for (const id of ['', 'missing', 'Close at 10 s', '__proto__']) assert.throws(() => run(fixture(), id), /Unknown experiment variant/);
  let coerced = false;
  const hostile = { [Symbol.toPrimitive]() { coerced = true; throw new Error('coerced'); } };
  for (const id of [undefined, null, 1, hostile, new String('clear')]) assert.throws(() => run(fixture(), id), /variant ID must be a string/);
  assert.equal(coerced, false);
  assert.equal(calls, 0);
});

test('validation rejects malformed input and getters before simulation, without getter side effects', () => {
  for (const input of [null, [], {}, { ...fixture(), version: 2 }, { ...fixture(), unsupported: true }]) assert.throws(() => createJobImpactReport(input, 'clear'));
  const selections = [
    input => [input, 'id'], input => [input, 'baseScenario'],
    input => [input.baseScenario, 'jobs'], input => [input.baseScenario.jobs, '0'],
    input => [input.baseScenario.jobs[0], 'dueTimeS'], input => [input.variants, '0'],
    input => [input.variants[1], 'closures'], input => [input.variants[1].closures[0], 'atS'],
  ];
  let called = 0;
  for (const select of selections) {
    const input = fixture(), [target, key] = select(input);
    Object.defineProperty(target, key, { get() { called += 1; throw new Error('getter ran'); } });
    assert.throws(() => createJobImpactReport(input, 'clear'), /accessor/);
  }
  assert.equal(called, 0);
  const invalidUnselected = fixture(); invalidUnselected.variants[2].closures[0].edgeIds = ['missing'];
  assert.throws(() => createJobImpactReport(invalidUnselected, 'clear'), /unknown id/);
  const oversized = fixture();
  oversized.baseScenario.jobs = Array.from({ length: LIMITS.jobs + 1 }, (_, i) => ({ ...oversized.baseScenario.jobs[0], id: `j${i}` }));
  assert.throws(() => createJobImpactReport(oversized, 'clear'), /0–2000/);
});

test('selected report delegates the whole experiment once and preserves all runner failures', () => {
  const input = fixture(); let calls = 0;
  const run = instrument({ runner(actual) {
    calls += 1;
    assert.deepEqual(actual, input);
    assert.notEqual(actual, input);
    return simulateExperiment(actual);
  } });
  assert.deepEqual(run(input, 'clear'), createJobImpactReport(input, 'clear'));
  assert.equal(calls, 1);
  for (const message of ['Simulation exceeds the routingEdgeVisits work limit.', 'Simulation exceeds the pathEdgeVisits work limit.', 'Simulation exceeds the segments work limit.', 'Experiment exceeds the aggregate result limit of 500000 route segments.']) {
    const error = new Error(message);
    const failing = instrument({ runner(actual) { assert.equal(actual.variants.length, 3); throw error; } });
    let report;
    assert.throws(() => { report = failing(input, 'clear'); }, thrown => thrown === error);
    assert.equal(report, undefined, 'no partial result is returned');
  }
});

test('serialization bound measures pretty UTF-8 report plus final newline at the exact inclusive boundary', () => {
  const input = fixture(); input.variants[1].name = 'é🌉'.repeat(20);
  const report = createJobImpactReport(input, 'close-at-10');
  const size = bytes(report), pretty = `${JSON.stringify(report, null, 2)}\n`;
  assert.ok(size > pretty.length, 'multibyte variant label distinguishes bytes from JS string length');
  assert.ok(size > Buffer.byteLength(JSON.stringify(report), 'utf8'), 'bound includes pretty-print overhead');
  assert.deepEqual(instrument({ maxBytes: size })(input, 'close-at-10'), report);
  assert.throws(() => instrument({ maxBytes: size - 1 })(input, 'close-at-10'), /Job impact report exceeds the 4 MiB limit/);
  assert.throws(() => instrument({ maxBytes: pretty.length })(input, 'close-at-10'), /Job impact report exceeds/);
});

test('maximum valid job count and long identifiers fit the complete report budget', () => {
  const input = fixture(), scenario = input.baseScenario;
  const nodeId = 'n'.repeat(96);
  scenario.nodes = [{ id: nodeId, x: 0, y: 0 }];
  scenario.edges = [];
  scenario.vehicles = Array.from({ length: LIMITS.vehicles }, (_, i) => ({ id: `v${String(i).padStart(2, '0')}${'x'.repeat(93)}`, startNode: nodeId, startTimeS: 604800 }));
  scenario.jobs = Array.from({ length: LIMITS.jobs }, (_, i) => ({
    id: `j${String(i).padStart(4, '0')}${'x'.repeat(91)}`,
    vehicleId: scenario.vehicles[i % LIMITS.vehicles].id, nodeId, dueTimeS: 604800, serviceTimeS: 86400,
  }));
  input.variants.forEach(variant => { variant.closures = []; });
  const report = createJobImpactReport(input, 'clear');
  assert.equal(report.jobs.length, LIMITS.jobs);
  assert.equal(report.summary.totalJobs, LIMITS.jobs);
  assert.equal(report.summary.unchangedJobs, LIMITS.jobs);
  assert.equal(report.baselineMetrics.completedJobs, LIMITS.jobs);
  assert.deepEqual(report.jobs.map(job => job.id), scenario.jobs.map(job => job.id));
  assert.deepEqual(report.summary.transitions, transitions(['on-time', 'on-time', 100], ['late', 'late', 1900]));
  assert.ok(bytes(report) <= IMPACT_LIMITS.maxBytes);
  assert.deepEqual(JSON.parse(JSON.stringify(report, null, 2)), report);
});
