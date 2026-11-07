import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBrowserImpact, pageDeliveryImpact, IMPACT_PAGE_SIZE } from '../src/browser-impact.js';
import { simulateExperiment } from '../src/experiment.js';
import { createJobImpactReport } from '../scripts/job-impact.js';

const fixture = (name = 'minimal-experiment.json') => JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

test('browser inspection uses the exact CLI outcomes, metrics and deltas for every tiny and Meridian variant', () => {
  for (const name of ['minimal-experiment.json', 'meridian-experiment.json']) {
    const input = fixture(name), completed = simulateExperiment(input);
    for (const variant of input.variants) {
      const actual = createBrowserImpact(input, completed, variant.id), expected = createJobImpactReport(input, variant.id);
      for (const key of ['variant', 'baselineMetrics', 'variantMetrics', 'delta', 'summary', 'jobs']) assert.deepEqual(actual[key], expected[key], `${name}: ${variant.id}: ${key}`);
    }
  }
});

test('same-status arrival shifts are separately discoverable, without hiding the other job counts', () => {
  const input = fixture('meridian-experiment.json'), impact = createBrowserImpact(input, simulateExperiment(input), 'market-05');
  assert.equal(impact.summary.changedJobs, 125);
  assert.equal(impact.summary.unchangedJobs, 67);
  assert.equal(impact.summary.statusChangedJobs, 118);
  assert.equal(impact.sameStatusArrivalChanges, 7);
  const page = pageDeliveryImpact(impact, 'timing');
  assert.equal(page.matchingJobs, 7); assert.equal(page.totalJobs, 192);
  assert.equal(page.jobs[0].statusChanged, false);
  assert.ok(page.jobs.every(job => job.arrivalDeltaS > 0 && job.baseline.status === job.variant.status));
});

test('all filters preserve original order and every page remains bounded and traversable', () => {
  assert.equal(IMPACT_PAGE_SIZE, 20);
  const input = fixture('meridian-experiment.json'), impact = createBrowserImpact(input, simulateExperiment(input), 'market-05');
  for (const filter of ['changed', 'status', 'timing', 'all']) {
    const first = pageDeliveryImpact(impact, filter), collected = [];
    for (let index = 0; index < first.pageCount; index += 1) {
      const page = pageDeliveryImpact(impact, filter, index);
      assert.ok(page.jobs.length <= 20); assert.equal(page.from, index * 20 + 1);
      assert.equal(page.to, page.from + page.jobs.length - 1); collected.push(...page.jobs);
    }
    const expected = impact.jobs.filter(job => filter === 'all' || (filter === 'changed' ? job.changed : filter === 'status' ? job.statusChanged : !job.statusChanged && job.arrivalDeltaS !== 0));
    assert.deepEqual(collected, expected); assert.equal(collected.length, first.matchingJobs);
    assert.equal(pageDeliveryImpact(impact, filter, 99999).pageIndex, first.pageCount - 1);
    for (const index of [-10, NaN, Infinity]) assert.equal(pageDeliveryImpact(impact, filter, index).pageIndex, 0);
  }
  assert.throws(() => pageDeliveryImpact(impact, 'unknown'), /supported delivery filter/);
});

test('the maximum input job count does not expand a page or truncate complete evidence', () => {
  const input = fixture(), job = input.baseScenario.jobs[0];
  input.baseScenario.jobs = Array.from({ length: 2000 }, (_, index) => ({ ...job, id: `job-${index}` }));
  const impact = createBrowserImpact(input, simulateExperiment(input), 'close-at-10');
  assert.equal(impact.jobs.length, 2000);
  const first = pageDeliveryImpact(impact, 'all'), last = pageDeliveryImpact(impact, 'all', 99);
  assert.equal(first.pageCount, 100); assert.equal(first.jobs.length, 20); assert.equal(last.jobs.length, 20);
  assert.equal(last.to, 2000); assert.equal(last.jobs.at(-1).id, 'job-1999');
});

test('empty jobs and filters have explicit zero-row pages, not invented unchanged data', () => {
  const input = fixture(), completed = simulateExperiment(input);
  const clear = pageDeliveryImpact(createBrowserImpact(input, completed, 'clear'));
  assert.deepEqual(clear, { jobs: [], filter: 'changed', query: '', sort: 'input', filteredJobs: 0, totalJobs: 1, matchingJobs: 0, pageIndex: 0, pageCount: 0, from: 0, to: 0 });
  input.baseScenario.jobs = [];
  const empty = createBrowserImpact(input, simulateExperiment(input), 'close-at-10');
  for (const filter of ['changed', 'status', 'timing', 'all']) assert.deepEqual(pageDeliveryImpact(empty, filter, 99), { jobs: [], filter, query: '', sort: 'input', filteredJobs: 0, totalJobs: 0, matchingJobs: 0, pageIndex: 0, pageCount: 0, from: 0, to: 0 });
});

test('unreachable timings remain null and are never treated as zero change', () => {
  const input = fixture(); input.variants[1].closures[0].edgeIds = ['bc', 'bd'];
  const impact = createBrowserImpact(input, simulateExperiment(input), 'close-at-10'), job = impact.jobs[0];
  assert.equal(job.variant.status, 'unreachable');
  for (const key of ['arrivalS', 'completedS', 'delayS']) assert.equal(job.variant[key], null);
  for (const key of ['arrivalDeltaS', 'completedDeltaS', 'delayDeltaS']) assert.equal(job[key], null);
  assert.equal(pageDeliveryImpact(impact).matchingJobs, 1);
  assert.equal(impact.summary.arrivalChangedJobs, 1);
});

test('fractional arrival times retain the engine tolerance and unrounded differences', () => {
  const input = fixture();
  const times = { ab: 0.1, bc: 0.2, bd: 0.123456789, dc: 0.234567891 };
  input.baseScenario.edges.forEach(edge => { edge.travelTimeS = times[edge.id]; });
  input.baseScenario.jobs[0].dueTimeS = 0.3; input.baseScenario.jobs[0].serviceTimeS = 0.123456789;
  input.variants[1].closures[0].atS = 0.1;
  const job = createBrowserImpact(input, simulateExperiment(input), 'close-at-10').jobs[0];
  assert.ok(job.baseline.arrivalS > 0.3); assert.equal(job.baseline.status, 'on-time'); assert.equal(job.baseline.delayS, 0);
  assert.equal(job.arrivalDeltaS, 0.1 + 0.123456789 + 0.234567891 - (0.1 + 0.2));
});

test('inspection does not mutate or rerun input, and does not need route segments', () => {
  const input = fixture(), completed = simulateExperiment(input);
  const expected = createBrowserImpact(input, completed, 'close-at-10');
  for (const run of [completed.baseline, ...completed.variants.map(variant => variant.result)]) for (const vehicle of run.vehicles) { vehicle.segments = null; vehicle.reroutes = null; }
  freeze(input); freeze(completed);
  const clone = globalThis.structuredClone; globalThis.structuredClone = () => { throw new Error('Unexpected simulation clone'); };
  try { assert.deepEqual(createBrowserImpact(input, completed, 'close-at-10'), expected); } finally { globalThis.structuredClone = clone; }
});

test('missing variants and mismatched completed ledgers fail closed rather than showing partial evidence', () => {
  const input = fixture(), completed = simulateExperiment(input);
  assert.throws(() => createBrowserImpact(input, completed, 'missing'), /Choose a variant/);
  completed.variants[0].result.vehicles[0].jobs.pop();
  assert.throws(() => createBrowserImpact(input, completed, 'close-at-10'), /matching vehicle, variant and job identities/);
});

const searchImpact = rows => ({ summary: { totalJobs: rows.length }, jobs: rows.map((row, index) => ({
  id: `job-${index}`, vehicleId: 'van-default', nodeId: 'node-default', arrivalDeltaS: 0,
  changed: true, statusChanged: false, baseline: { arrivalS: 10 }, variant: { arrivalS: 11 }, ...row,
})) });

test('literal ID search trims and case-folds across job, vehicle and destination IDs', () => {
  const impact = searchImpact([
    { id: 'Delivery.[A]*' }, { vehicleId: 'VAN-ÉCOLE' }, { nodeId: 'DEPOT-東京' },
    { id: 'delivery-other', nodeId: 'école-annex' },
  ]);
  for (const [query, expected] of [['  DELIVERY.[a]*  ', [0]], ['éCoLe', [1, 3]], ['東京', [2]], ['.*', []], ['   ', [0, 1, 2, 3]]]) {
    const page = pageDeliveryImpact(impact, 'all', 0, { query });
    assert.deepEqual(page.jobs, expected.map(index => impact.jobs[index]));
    assert.equal(page.query, query.trim().toLowerCase());
    assert.equal(page.filteredJobs, 4); assert.equal(page.matchingJobs, expected.length);
  }
});

test('search does not cross ID boundaries or search statuses and rendered time values', () => {
  const impact = searchImpact([{ id: 'alpha', vehicleId: 'beta', nodeId: 'gamma', baseline: { arrivalS: 123, status: 'late' } }]);
  for (const query of ['alpha beta', 'late', '123']) assert.equal(pageDeliveryImpact(impact, 'all', 0, { query }).matchingJobs, 0);
});

test('filters precede search and separately report complete, filtered and matching counts', () => {
  const impact = searchImpact([
    { id: 'needle-1', changed: false, variant: { arrivalS: 10 } },
    { id: 'needle-2', statusChanged: true }, { id: 'needle-3' }, { id: 'other' },
  ]);
  for (const [filter, filtered, matches] of [['all', 4, 3], ['changed', 3, 2], ['status', 1, 1], ['timing', 2, 1]]) {
    const page = pageDeliveryImpact(impact, filter, 0, { query: 'needle' });
    assert.equal(page.totalJobs, 4); assert.equal(page.filteredJobs, filtered); assert.equal(page.matchingJobs, matches);
  }
});

test('arrival ordering keeps nulls last, signed fractional values exact, and equal values in input order', () => {
  const values = [null, -3, 1.000000001, 0, 1.000000001, null, -0.5, -3, 1.000000002];
  const impact = freeze(searchImpact(values.map(arrivalDeltaS => ({ arrivalDeltaS }))));
  const before = JSON.stringify(impact);
  const options = freeze({ query: ' JOB- ', sort: 'arrival-desc' });
  const page = pageDeliveryImpact(impact, 'all', 0, options);
  assert.deepEqual(page.jobs.map(job => job.id), [8, 2, 4, 3, 6, 1, 7, 0, 5].map(index => `job-${index}`));
  assert.deepEqual(page.jobs.map(job => job.arrivalDeltaS), [1.000000002, 1.000000001, 1.000000001, 0, -0.5, -3, -3, null, null]);
  assert.equal(page.sort, 'arrival-desc'); assert.equal(JSON.stringify(impact), before);
  assert.deepEqual(pageDeliveryImpact(impact, 'all').jobs, impact.jobs);
});

test('search and sort are applied to all 2000 rows before pagination, without mutation or truncation', () => {
  const impact = freeze(searchImpact(Array.from({ length: 2000 }, (_, index) => ({
    vehicleId: index % 2 ? 'odd' : 'even', arrivalDeltaS: index % 2 ? null : index,
  }))));
  const options = { query: 'EVEN', sort: 'arrival-desc' };
  const first = pageDeliveryImpact(impact, 'all', 0, options), collected = [];
  assert.equal(first.filteredJobs, 2000); assert.equal(first.matchingJobs, 1000); assert.equal(first.pageCount, 50);
  for (let index = 0; index < first.pageCount; index += 1) {
    const page = pageDeliveryImpact(impact, 'all', index, options);
    assert.equal(page.jobs.length, 20); assert.equal(page.from, index * 20 + 1); assert.equal(page.to, index * 20 + 20);
    collected.push(...page.jobs.map(job => job.id));
  }
  assert.deepEqual(collected, Array.from({ length: 1000 }, (_, index) => `job-${1998 - index * 2}`));
  assert.equal(pageDeliveryImpact(impact, 'all', 999, options).pageIndex, 49);
  assert.equal(pageDeliveryImpact(impact, 'all', 1.9, options).pageIndex, 1);
  for (const pageIndex of [-1, Infinity, NaN]) assert.equal(pageDeliveryImpact(impact, 'all', pageIndex, options).pageIndex, 0);
  assert.equal(impact.jobs[0].id, 'job-0'); assert.equal(impact.jobs.at(-1).id, 'job-1999');
});

test('unmatched search has an explicit zero page even after a later requested page', () => {
  const page = pageDeliveryImpact(searchImpact([{}]), 'all', 99, { query: 'missing', sort: 'arrival-desc' });
  assert.deepEqual(page, { jobs: [], filter: 'all', query: 'missing', sort: 'arrival-desc', filteredJobs: 1,
    totalJobs: 1, matchingJobs: 0, pageIndex: 0, pageCount: 0, from: 0, to: 0 });
});

test('invalid search options fail clearly without coercion or executing input', () => {
  const impact = searchImpact([{}]);
  for (const options of [null, [], '', 0, false]) assert.throws(() => pageDeliveryImpact(impact, 'all', 0, options), /supported delivery search options/);
  for (const query of [null, 0, false, [], {}, { toString() { throw new Error('must not coerce'); } }]) {
    assert.throws(() => pageDeliveryImpact(impact, 'all', 0, { query }), /search text as a string/);
  }
  for (const sort of [null, 0, false, [], {}, 'unknown', 'ARRIVAL-DESC']) {
    assert.throws(() => pageDeliveryImpact(impact, 'all', 0, { sort }), /supported delivery order/);
  }
  assert.deepEqual(pageDeliveryImpact(impact, 'all', 0, { query: undefined, sort: undefined }), pageDeliveryImpact(impact, 'all'));
});
