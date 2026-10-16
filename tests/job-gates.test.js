import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { simulate } from '../src/engine.js';
import { parseArguments } from '../scripts/cli-arguments.js';
import { compareJobOutcomes, formatJobComparison, formatThresholdViolation, hasJobThresholds, thresholdViolations } from '../scripts/job-gates.js';

const edge = (id, from, to, travelTimeS) => ({ id, from, to, travelTimeS, distanceM: travelTimeS, roadName: `${id} Road` });
const job = (id, vehicleId, nodeId, dueTimeS, serviceTimeS = 0) => ({ id, vehicleId, nodeId, dueTimeS, serviceTimeS });
function maskingFixture() {
  return {
    version: 1, id: 'synthetic-masking', name: 'Synthetic masking fixture', seed: 1, description: 'A hand-checkable synthetic comparison.',
    nodes: ['A', 'B', 'C', 'D', 'E'].map((id, x) => ({ id, x, y: 0 })),
    edges: [edge('ab', 'A', 'B', 10), edge('ac', 'A', 'C', 8), edge('cb', 'C', 'B', 8), edge('de', 'D', 'E', 10), edge('ed', 'E', 'D', 10)],
    vehicles: [{ id: 'one', startNode: 'A', startTimeS: 0 }, { id: 'two', startNode: 'D', startTimeS: 0 }],
    jobs: [job('newly-late', 'one', 'B', 12), job('skipped', 'two', 'E', 200, 100), job('previously-late', 'two', 'D', 50)],
    closures: [{ id: 'close', edgeIds: ['ab', 'de'], atS: 0 }], durationS: 200,
  };
}
const fixture = () => JSON.parse(readFileSync(new URL('../examples/minimal-directed.json', import.meta.url), 'utf8'));
const runPair = scenario => [simulate(scenario, { closures: [] }), simulate(scenario)];
const outcome = (id, status, arrivalS) => ({ id, nodeId: 'A', dueTimeS: 10, status, arrivalS, completedS: arrivalS });
const ledger = jobs => ({ vehicles: [{ id: 'one', jobs }] });
const empty = () => ({ totalJobs: 0, comparableJobs: 0, uncomparableJobs: 0, newlyLateJobs: 0, maxArrivalSlipS: null });
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

test('hand-checked multi-vehicle fixture exposes a newly late job masked by the net late-job count', () => {
  const [baseline, variant] = runPair(maskingFixture());
  assert.deepEqual(baseline.vehicles.flatMap(vehicle => vehicle.jobs.map(item => item.arrivalS)), [10, 10, 120]);
  assert.deepEqual(variant.vehicles.flatMap(vehicle => vehicle.jobs.map(item => item.arrivalS)), [16, null, 0]);
  assert.equal(baseline.metrics.lateJobs, 1);
  assert.equal(variant.metrics.lateJobs, 1);
  assert.equal(baseline.metrics.distanceM, 30);
  assert.equal(variant.metrics.distanceM, 16);
  assert.deepEqual(compareJobOutcomes(baseline, variant), {
    totalJobs: 3, comparableJobs: 2, uncomparableJobs: 1, newlyLateJobs: 1, maxArrivalSlipS: 6,
  });
});

test('job and vehicle identity pairing is independent of ledger ordering', () => {
  const [baseline, variant] = runPair(maskingFixture());
  const expected = compareJobOutcomes(baseline, variant);
  variant.vehicles.reverse();
  for (const vehicle of variant.vehicles) vehicle.jobs.reverse();
  assert.deepEqual(compareJobOutcomes(baseline, variant), expected);
  baseline.vehicles.reverse();
  for (const vehicle of baseline.vehicles) vehicle.jobs.reverse();
  assert.deepEqual(compareJobOutcomes(baseline, variant), expected);
});

test('only baseline on-time to variant late counts as newly late across all nine status transitions', () => {
  const baseline = [], variant = [];
  for (const from of ['on-time', 'late', 'unreachable']) {
    for (const to of ['on-time', 'late', 'unreachable']) {
      const id = `${from}-${to}`;
      baseline.push(outcome(id, from, from === 'unreachable' ? null : from === 'late' ? 20 : 10));
      variant.push(outcome(id, to, to === 'unreachable' ? null : to === 'late' ? 25 : 10));
    }
  }
  assert.deepEqual(compareJobOutcomes(ledger(baseline), ledger(variant)), {
    totalJobs: 9, comparableJobs: 4, uncomparableJobs: 5, newlyLateJobs: 1, maxArrivalSlipS: 15,
  });
});

test('later but still-on-time and already-late arrivals contribute to maximum slip', () => {
  for (const dueTimeS of [40, 19]) {
    const input = fixture(); input.jobs[0].dueTimeS = dueTimeS;
    const [baseline, variant] = runPair(input);
    assert.equal(baseline.vehicles[0].jobs[0].status, variant.vehicles[0].jobs[0].status);
    assert.deepEqual(compareJobOutcomes(baseline, variant), {
      totalJobs: 1, comparableJobs: 1, uncomparableJobs: 0, newlyLateJobs: 0, maxArrivalSlipS: 6,
    });
  }
});

test('maximum slip uses arrival times, not lateness or service-completion times', () => {
  const before = ledger([outcome('a', 'on-time', 5)]), after = ledger([outcome('a', 'on-time', 9)]);
  before.vehicles[0].jobs[0].completedS = 200;
  after.vehicles[0].jobs[0].completedS = 9;
  assert.equal(compareJobOutcomes(before, after).maxArrivalSlipS, 4);
});

test('earlier arrivals never offset a later arrival, and all earlier/equal arrivals yield positive zero', () => {
  const baseline = ledger([outcome('a', 'late', 100), outcome('b', 'late', 100)]);
  const after = ledger([outcome('a', 'on-time', 0), outcome('b', 'late', 105)]);
  assert.equal(compareJobOutcomes(baseline, after).maxArrivalSlipS, 5);
  after.vehicles[0].jobs[1].arrivalS = 99;
  assert.equal(compareJobOutcomes(baseline, after).maxArrivalSlipS, 0);
  assert.ok(!Object.is(compareJobOutcomes(ledger([outcome('a', 'on-time', 0)]), ledger([outcome('a', 'on-time', -0)])).maxArrivalSlipS, -0));
});

test('zero jobs has no comparable arrivals and never invents a numeric maximum', () => {
  const input = fixture(); input.jobs = [];
  const summary = compareJobOutcomes(...runPair(input));
  assert.deepEqual(summary, empty());
  assert.deepEqual(thresholdViolations({}, { newlyLateJobs: 0 }, summary), []);
  assert.deepEqual(thresholdViolations({}, { maxArrivalSlipS: 0 }, summary), [{ metric: 'maxArrivalSlipS', actual: null, limit: 0, reason: 'no-comparable-jobs' }]);
  assert.deepEqual(compareJobOutcomes({ vehicles: [] }, { vehicles: [] }), empty());
});

test('no comparable jobs fails a requested arrival gate at every finite nonnegative limit', () => {
  const summary = compareJobOutcomes(ledger([outcome('a', 'on-time', 1)]), ledger([outcome('a', 'unreachable', null)]));
  assert.deepEqual(summary, { totalJobs: 1, comparableJobs: 0, uncomparableJobs: 1, newlyLateJobs: 0, maxArrivalSlipS: null });
  for (const limit of [0, 1, Number.MAX_VALUE]) {
    assert.deepEqual(thresholdViolations({}, { maxArrivalSlipS: limit }, summary), [{ metric: 'maxArrivalSlipS', actual: null, limit, reason: 'no-comparable-jobs' }]);
  }
  assert.deepEqual(thresholdViolations({}, {}, summary), []);
});

test('baseline-only, variant-only and both-unreachable jobs are each omitted from timing comparisons', () => {
  const before = ledger([outcome('a', 'unreachable', null), outcome('b', 'on-time', 0), outcome('c', 'unreachable', null)]);
  const after = ledger([outcome('a', 'late', 100), outcome('b', 'unreachable', null), outcome('c', 'unreachable', null)]);
  assert.deepEqual(compareJobOutcomes(before, after), { totalJobs: 3, comparableJobs: 0, uncomparableJobs: 3, newlyLateJobs: 0, maxArrivalSlipS: null });
});

test('engine deadline tolerance determines newly-late status and timing differences retain full precision', () => {
  const input = fixture();
  const times = { ab: 0.1, bc: 0.2, bd: 0.123456789, dc: 0.234567891 };
  input.edges.forEach(item => { item.travelTimeS = times[item.id]; });
  input.jobs[0].dueTimeS = 0.3;
  input.closures[0].atS = 0.1;
  const [baseline, variant] = runPair(input), a = baseline.vehicles[0].jobs[0], b = variant.vehicles[0].jobs[0];
  assert.ok(a.arrivalS > a.dueTimeS, 'binary addition is slightly beyond the exact deadline');
  assert.equal(a.status, 'on-time');
  assert.equal(b.status, 'late');
  const summary = compareJobOutcomes(baseline, variant);
  assert.equal(summary.newlyLateJobs, 1);
  assert.equal(summary.maxArrivalSlipS, b.arrivalS - a.arrivalS);
  assert.notEqual(summary.maxArrivalSlipS, Number(summary.maxArrivalSlipS.toFixed(6)));
  assert.deepEqual(thresholdViolations({}, { maxArrivalSlipS: summary.maxArrivalSlipS }, summary), []);
  assert.equal(thresholdViolations({}, { maxArrivalSlipS: summary.maxArrivalSlipS - Number.EPSILON }, summary).length, 1);
  input.closures = [];
  assert.equal(compareJobOutcomes(...runPair(input)).newlyLateJobs, 0);
});

test('exact numeric boundaries pass and strict exceedances fail for both new metrics', () => {
  const summary = { ...empty(), totalJobs: 1, comparableJobs: 1, newlyLateJobs: 1, maxArrivalSlipS: 6 };
  assert.deepEqual(thresholdViolations({}, { newlyLateJobs: 1, maxArrivalSlipS: 6 }, summary), []);
  assert.deepEqual(thresholdViolations({}, { newlyLateJobs: 0.5, maxArrivalSlipS: 6 - Number.EPSILON * 4 }, summary), [
    { metric: 'newlyLateJobs', actual: 1, limit: 0.5 },
    { metric: 'maxArrivalSlipS', actual: 6, limit: 6 - Number.EPSILON * 4 },
  ]);
});

test('old threshold semantics remain signed and retain their existing violation shape', () => {
  const delta = { extraDistancePct: -40, extraLateJobs: -1, unreachableJobs: 2 };
  const thresholds = { extraDistancePct: 0, extraLateJobs: 0, unreachableJobs: 1 };
  assert.deepEqual(thresholdViolations(delta, thresholds), [{ metric: 'unreachableJobs', actual: 2, limit: 1 }]);
  assert.equal(formatThresholdViolation({ metric: 'unreachableJobs', actual: 2, limit: 1 }), 'unreachableJobs 2 > 1');
});

test('all threshold metrics retain deterministic order regardless of new flag ordering', () => {
  const flags = ['--max-extra-distance-pct', '--max-extra-late', '--max-unreachable', '--max-newly-late', '--max-arrival-slip-s'];
  const metrics = ['extraDistancePct', 'extraLateJobs', 'unreachableJobs', 'newlyLateJobs', 'maxArrivalSlipS'];
  const a = parseArguments(flags.flatMap(flag => [flag, '0'])).thresholds;
  const b = parseArguments([...flags].reverse().flatMap(flag => [flag, '0'])).thresholds;
  assert.deepEqual(Object.keys(a), metrics);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const summary = { ...empty(), newlyLateJobs: 1, maxArrivalSlipS: 2 };
  const delta = { extraDistancePct: 1, extraLateJobs: 1, unreachableJobs: 1 };
  assert.deepEqual(thresholdViolations(delta, a, summary).map(item => item.metric), metrics);
  assert.deepEqual(thresholdViolations(delta, a, summary), thresholdViolations(delta, b, summary));
});

test('new flags use the existing finite nonnegative numeric contract and reject duplicates', () => {
  for (const [flag, metric] of [['--max-newly-late', 'newlyLateJobs'], ['--max-arrival-slip-s', 'maxArrivalSlipS']]) {
    for (const value of ['0', '-0', '0.5', '1e2', '1e308']) assert.equal(parseArguments([flag, value]).thresholds[metric], Number(value));
    for (const value of ['', ' ', 'NaN', 'Infinity', '-Infinity', '-1', '1e309', '--json']) assert.throws(() => parseArguments([flag, value]), /finite nonnegative number/);
    assert.throws(() => parseArguments([flag]), /finite nonnegative number/);
    for (const values of [['0', '1'], ['1', '0'], ['0', '0']]) assert.throws(() => parseArguments([flag, values[0], flag, values[1]], { requireFile: true }), /only be supplied once/);
    assert.deepEqual(parseArguments([flag, 'invalid', '--help'], { requireFile: true }), { help: true });
  }
});

test('comparisons are opt-in through own threshold keys and missing comparisons cannot silently pass', () => {
  for (const thresholds of [{}, { extraLateJobs: 0 }, Object.create({ newlyLateJobs: 0, maxArrivalSlipS: 0 })]) assert.equal(hasJobThresholds(thresholds), false);
  for (const thresholds of [{ newlyLateJobs: 0 }, { maxArrivalSlipS: 0 }]) {
    assert.equal(hasJobThresholds(thresholds), true);
    assert.throws(() => thresholdViolations({}, thresholds), /require a job comparison/);
  }
});

test('mismatched job sets, assignments, destinations, deadlines and vehicle sets fail explicitly', () => {
  const [baseline, original] = runPair(maskingFixture());
  const mutations = [
    value => { value.vehicles[0].jobs[0].id = 'different'; },
    value => { value.vehicles[0].jobs.pop(); },
    value => { value.vehicles[0].jobs[0].nodeId = 'different'; },
    value => { value.vehicles[0].jobs[0].dueTimeS += 1; },
    value => { value.vehicles[1].jobs.push(value.vehicles[0].jobs.pop()); },
    value => { value.vehicles[0].id = 'different'; },
    value => { value.vehicles.pop(); },
  ];
  for (const mutate of mutations) {
    const variant = structuredClone(original); mutate(variant);
    assert.throws(() => compareJobOutcomes(baseline, variant), /requires matching/);
  }
});

test('duplicate IDs cannot collapse ledger rows or silently replace assignments', () => {
  const [baseline, original] = runPair(maskingFixture());
  const duplicateJob = structuredClone(original);
  duplicateJob.vehicles[1].jobs.push(structuredClone(duplicateJob.vehicles[0].jobs[0]));
  assert.throws(() => compareJobOutcomes(baseline, duplicateJob), /unique job IDs/);
  const duplicateVehicle = structuredClone(original);
  duplicateVehicle.vehicles.push({ id: duplicateVehicle.vehicles[0].id, jobs: [] });
  assert.throws(() => compareJobOutcomes(baseline, duplicateVehicle), /unique vehicle IDs/);
});

test('inconsistent status and arrival nulls, nonfinite values and negative values fail explicitly', () => {
  const baseline = ledger([outcome('a', 'on-time', 0)]);
  for (const [status, arrivalS] of [['on-time', null], ['late', null], ['late', NaN], ['late', Infinity], ['on-time', -1], ['on-time', '0'], ['unreachable', 0], ['missing', null]]) {
    const variant = ledger([outcome('a', status, arrivalS)]);
    assert.throws(() => compareJobOutcomes(baseline, variant), /engine statuses/);
    assert.throws(() => compareJobOutcomes(variant, baseline), /engine statuses/);
  }
});

test('frozen ledger inputs and thresholds stay unchanged, with independent summary objects', () => {
  const pair = runPair(maskingFixture()), before = structuredClone(pair);
  pair.forEach(freeze);
  const summary = compareJobOutcomes(...pair), expected = structuredClone(summary), again = compareJobOutcomes(...pair);
  const delta = freeze({ extraLateJobs: 0 }), thresholds = freeze({ extraLateJobs: 0, newlyLateJobs: 0, maxArrivalSlipS: 5 });
  const violations = thresholdViolations(delta, thresholds, freeze(summary));
  assert.equal(violations.length, 2);
  violations[0].actual = 100;
  again.newlyLateJobs = 99;
  assert.deepEqual(compareJobOutcomes(...pair), expected);
  assert.deepEqual(pair, before);
  assert.deepEqual(delta, { extraLateJobs: 0 });
  assert.deepEqual(thresholds, { extraLateJobs: 0, newlyLateJobs: 0, maxArrivalSlipS: 5 });
});

test('comparison reads existing job ledgers without inspecting routes or aggregate metrics', () => {
  const pair = runPair(maskingFixture());
  for (const result of pair) {
    Object.defineProperty(result, 'metrics', { get() { throw new Error('metrics read'); } });
    for (const vehicle of result.vehicles) Object.defineProperty(vehicle, 'segments', { get() { throw new Error('routes read'); } });
  }
  assert.equal(compareJobOutcomes(...pair).maxArrivalSlipS, 6);
});

test('human summaries expose omitted timing evidence and render unevaluable gates without null arithmetic', () => {
  const text = formatJobComparison(compareJobOutcomes(...runPair(maskingFixture())));
  assert.match(text, /3 total jobs; 2 comparable; 1 uncomparable/);
  assert.match(text, /on-time -> late/);
  assert.match(text, /maximum arrival slip: 6 s/);
  assert.match(text, /Unreachable jobs are omitted from timing comparisons/);
  assert.match(text, /does not establish overall service improvement/);
  assert.match(formatJobComparison(empty()), /n\/a \(no comparable arrivals\)/);
  const failure = formatThresholdViolation({ metric: 'maxArrivalSlipS', actual: null, limit: 0, reason: 'no-comparable-jobs' });
  assert.match(failure, /unevaluable: no comparable arrivals/);
  assert.doesNotMatch(failure, /null|>/);
});
