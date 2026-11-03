import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplayEvents, pageReplayEvents, adjacentReplayEvent, REPLAY_EVENT_PAGE_SIZE } from '../src/replay-events.js';
import { createTutorialExperiment } from '../src/tutorial.js';
import { simulateExperiment, EXPERIMENT_LIMITS } from '../src/experiment.js';
import { ENGINE_LIMITS } from '../src/engine.js';

const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function ready(input = createTutorialExperiment(), variant = 'close-at-10', vehicle = 'van-1') {
  const completed = simulateExperiment(input);
  return { input, completed, index: createReplayEvents(input, completed, variant, vehicle) };
}
function collect(index, filter = 'all') {
  const first = pageReplayEvents(index, filter), events = [];
  for (let page = 0; page < first.pageCount; page += 1) events.push(...pageReplayEvents(index, filter, page).events);
  return events;
}
const brief = event => [event.atS, event.run, event.kind];

test('tiny cutoff at 10 preserves both completed ledgers, every tie and 20/23/26/29 boundaries', () => {
  const { index } = ready();
  assert.equal(REPLAY_EVENT_PAGE_SIZE, 20);
  assert.deepEqual(index.counts, { all: 16, deliveries: 4, routing: 11, closures: 1 });
  const events = collect(index);
  assert.deepEqual(events.map(brief), [
    [0, 'baseline', 'segment-entry'], [0, 'variant', 'segment-entry'],
    [10, 'schedule', 'closure-start'], [10, 'baseline', 'segment-exit'], [10, 'variant', 'segment-exit'],
    [10, 'variant', 'reroute'], [10, 'baseline', 'segment-entry'], [10, 'variant', 'segment-entry'],
    [18, 'variant', 'segment-exit'], [18, 'variant', 'segment-entry'],
    [20, 'baseline', 'segment-exit'], [20, 'baseline', 'job-arrival'], [23, 'baseline', 'job-completion'],
    [26, 'variant', 'segment-exit'], [26, 'variant', 'job-arrival'], [29, 'variant', 'job-completion'],
  ]);
  assert.equal(new Set(events.map(event => event.id)).size, events.length);
  assert.deepEqual(collect(index, 'deliveries').map(event => event.atS), [20, 23, 26, 29]);
  assert.equal(events.find(event => event.kind === 'reroute').reason, 'closure-blocked-route');
});

test('cutoff at 11 remains a global schedule fact even when the vehicle has already entered the edge', () => {
  const { index } = ready(createTutorialExperiment(), 'close-at-11');
  assert.deepEqual(index.counts, { all: 13, deliveries: 4, routing: 8, closures: 1 });
  const events = collect(index), closure = events.find(event => event.kind === 'closure-start');
  assert.equal(closure.atS, 11); assert.equal(closure.run, 'schedule');
  assert.match(closure.detail, /Global variant schedule/);
  assert.match(closure.detail, /does not establish an effect/);
  assert.equal(events.filter(event => event.kind === 'reroute').length, 0);
  assert.deepEqual(collect(index, 'deliveries').map(brief), [[20, 'baseline', 'job-arrival'], [20, 'variant', 'job-arrival'], [23, 'baseline', 'job-completion'], [23, 'variant', 'job-completion']]);
  assert.equal(adjacentReplayEvent(index, 10, 'next').atS, 11);
  assert.equal(adjacentReplayEvent(index, 11, 'previous').atS, 10);
});

test('strict previous/next navigation skips all ties and obeys the selected filter', () => {
  const { index } = ready();
  const times = [...new Set(collect(index).map(event => event.atS))];
  for (const filter of ['all', 'deliveries', 'routing', 'closures']) {
    const events = collect(index, filter);
    for (const time of [...times, 0.125, 10.0001, 25.75, 50]) {
      assert.deepEqual(adjacentReplayEvent(index, time, 'previous', filter), events.findLast(event => event.atS < time) ?? null);
      assert.deepEqual(adjacentReplayEvent(index, time, 'next', filter), events.find(event => event.atS > time) ?? null);
    }
  }
  assert.equal(adjacentReplayEvent(index, 0, 'previous'), null);
  assert.equal(adjacentReplayEvent(index, 29, 'next'), null);
  assert.equal(adjacentReplayEvent(index, 10, 'next', 'closures'), null);
  for (const invalid of [null, undefined, NaN, Infinity, -1, '10']) assert.throws(() => adjacentReplayEvent(index, invalid, 'next'), /finite nonnegative/);
  assert.throws(() => adjacentReplayEvent(index, 10, 'forward'), /previous or next/);
});

test('fractional timestamps and arithmetic are retained exactly without tolerance-based grouping', () => {
  const input = createTutorialExperiment();
  const times = { ab: 0.1, bc: 0.2, bd: 0.123456789, dc: 0.234567891 };
  for (const edge of input.baseScenario.edges) edge.travelTimeS = times[edge.id];
  input.baseScenario.jobs[0].dueTimeS = 0.3; input.baseScenario.jobs[0].serviceTimeS = 0.123456789;
  input.variants[1].closures[0].atS = 0.1;
  const { index, completed } = ready(input), events = collect(index, 'deliveries');
  const baseline = completed.baseline.vehicles[0].jobs[0], variant = completed.variants[1].result.vehicles[0].jobs[0];
  assert.deepEqual(events.filter(event => event.run === 'baseline').map(event => event.atS), [baseline.arrivalS, baseline.completedS]);
  assert.deepEqual(events.filter(event => event.run === 'variant').map(event => event.atS), [variant.arrivalS, variant.completedS]);
  assert.equal(events.find(event => event.run === 'baseline').status, 'on-time');
  assert.ok(baseline.arrivalS > 0.3);
  assert.equal(adjacentReplayEvent(index, 0.3, 'next', 'deliveries').atS, baseline.arrivalS);
  assert.equal(adjacentReplayEvent(index, baseline.arrivalS, 'previous', 'deliveries'), null);
});

test('unreachable null jobs have no invented time-zero event and retain explicit counts', () => {
  const input = createTutorialExperiment(); input.variants[1].closures[0].edgeIds = ['bc', 'bd'];
  const { index } = ready(input), events = collect(index);
  assert.deepEqual(index.unreachableJobs, { baseline: 0, variant: 1 });
  assert.deepEqual(collect(index, 'deliveries').map(brief), [[20, 'baseline', 'job-arrival'], [23, 'baseline', 'job-completion']]);
  assert.ok(events.every(event => Number.isFinite(event.atS)));
  assert.equal(events.filter(event => event.atS === 0 && event.category === 'deliveries').length, 0);
  assert.equal(events.find(event => event.kind === 'reroute').reason, 'no-route');
});

test('zero-service, repeated same-node jobs retain every simultaneous arrival and completion across pages', () => {
  const input = createTutorialExperiment();
  input.baseScenario.jobs = Array.from({ length: 23 }, (_, index) => ({ id: `job-${index}`, nodeId: 'A', vehicleId: 'van-1', dueTimeS: 0, serviceTimeS: 0 }));
  const { index } = ready(input, 'clear'), events = collect(index);
  assert.equal(events.length, 92); assert.equal(new Set(events.map(event => event.id)).size, 92);
  assert.ok(events.every(event => event.atS === 0));
  assert.deepEqual(events.slice(0, 23).map(event => event.jobId), input.baseScenario.jobs.map(job => job.id));
  assert.ok(events.slice(0, 23).every(event => event.run === 'baseline' && event.kind === 'job-arrival'));
  assert.ok(events.slice(23, 46).every(event => event.run === 'variant' && event.kind === 'job-arrival'));
  assert.equal(adjacentReplayEvent(index, 0, 'next'), null);
  assert.equal(adjacentReplayEvent(index, 0, 'previous'), null);
  assert.equal(adjacentReplayEvent(index, 0.1, 'previous').id, events.at(-1).id);
});

test('repeated traversals of one edge retain separate stable identities and source indices', () => {
  const input = createTutorialExperiment();
  input.baseScenario.edges.push({ id: 'ba', from: 'B', to: 'A', distanceM: 80, travelTimeS: 3, roadName: 'Return Street' });
  input.baseScenario.jobs = ['B', 'A', 'B'].map((nodeId, index) => ({ id: `job-${index}`, nodeId, vehicleId: 'van-1', dueTimeS: 100, serviceTimeS: 0 }));
  const { index } = ready(input, 'clear');
  const entries = collect(index, 'routing').filter(event => event.edgeId === 'ab' && event.run === 'variant' && event.kind === 'segment-entry');
  assert.deepEqual(entries.map(event => event.atS), [0, 13]);
  assert.deepEqual(entries.map(event => event.sourceIndex), [0, 2]);
  assert.notEqual(entries[0].id, entries[1].id);
  assert.deepEqual(collect(index), collect(index));
});

test('all filters expose complete counts, clamped 20-row pages and an explicit empty page', () => {
  const input = createTutorialExperiment();
  input.baseScenario.jobs = Array.from({ length: 29 }, (_, index) => ({ ...input.baseScenario.jobs[0], id: `job-${index}` }));
  const { index } = ready(input), all = collect(index);
  for (const filter of ['all', 'deliveries', 'routing', 'closures']) {
    const first = pageReplayEvents(index, filter), expected = filter === 'all' ? all : all.filter(event => event.category === filter);
    assert.equal(first.matchingEvents, expected.length); assert.equal(first.totalEvents, all.length);
    assert.equal(first.matchingEvents, index.counts[filter]);
    assert.deepEqual(collect(index, filter), expected);
    for (let page = 0; page < first.pageCount; page += 1) {
      const result = pageReplayEvents(index, filter, page);
      assert.ok(result.events.length <= 20); assert.equal(result.from, page * 20 + 1); assert.equal(result.to, Math.min(expected.length, (page + 1) * 20));
    }
    assert.equal(pageReplayEvents(index, filter, 1e9).pageIndex, Math.max(0, first.pageCount - 1));
    for (const value of [null, -10, NaN, Infinity, '2']) assert.equal(pageReplayEvents(index, filter, value).pageIndex, 0);
    assert.equal(pageReplayEvents(index, filter, 1.9).pageIndex, Math.min(1, first.pageCount - 1));
  }
  const clear = ready(input, 'clear').index;
  assert.deepEqual(pageReplayEvents(clear, 'closures', 100), { events: [], filter: 'closures', totalEvents: clear.counts.all, matchingEvents: 0, pageIndex: 0, pageCount: 0, from: 0, to: 0 });
  assert.throws(() => pageReplayEvents(index, 'unknown'), /supported replay event filter/);
  assert.throws(() => adjacentReplayEvent(index, 0, 'next', 'unknown'), /supported replay event filter/);
});

test('an empty selected vehicle excludes other vehicles but still sees the global variant schedule', () => {
  const input = createTutorialExperiment(); input.baseScenario.vehicles.push({ id: 'idle', startNode: 'D', startTimeS: 7.5 });
  const { completed, index } = ready(input, 'close-at-10', 'idle');
  assert.deepEqual(index.counts, { all: 1, deliveries: 0, routing: 0, closures: 1 });
  assert.equal(collect(index)[0].kind, 'closure-start');
  const clear = createReplayEvents(input, completed, 'clear', 'idle');
  assert.deepEqual(clear.counts, { all: 0, deliveries: 0, routing: 0, closures: 0 });
  assert.deepEqual(pageReplayEvents(clear), { events: [], filter: 'all', totalEvents: 0, matchingEvents: 0, pageIndex: 0, pageCount: 0, from: 0, to: 0 });
  assert.equal(adjacentReplayEvent(clear, 0, 'next'), null);
  for (const id of [null, '', 'missing']) assert.throws(() => createReplayEvents(input, completed, 'clear', id), /Choose a vehicle/);
});

test('closure input order is unchanged while display order is time then original position', () => {
  const input = createTutorialExperiment();
  input.variants[1].closures = [
    { id: 'late', edgeIds: ['bc'], atS: 29 }, { id: 'tie-z', edgeIds: ['bc'], atS: 11 },
    { id: 'tie-a', edgeIds: ['bd'], atS: 11 }, { id: 'early', edgeIds: ['dc'], atS: 10 },
  ];
  const { index } = ready(input);
  assert.deepEqual(collect(index, 'closures').map(event => event.closureId), ['early', 'tie-z', 'tie-a', 'late']);
  assert.deepEqual(collect(index, 'closures').map(event => event.sourceIndex), [3, 1, 2, 0]);
  assert.deepEqual(input.variants[1].closures.map(closure => closure.id), ['late', 'tie-z', 'tie-a', 'early']);
});

test('safe display records keep labels as text and bounded details do not expand huge edge lists', () => {
  const input = createTutorialExperiment();
  input.baseScenario.edges[0].roadName = '<img src=x onerror=alert(1)> & "road"';
  input.variants[1].name = '<script>variant</script>';
  input.variants[1].closures[0].edgeIds = ['ab', 'bc', 'bd', 'dc'];
  const { index } = ready(input), events = collect(index);
  assert.equal(index.variant.name, input.variants[1].name);
  assert.ok(events.find(event => event.kind === 'segment-entry').detail.startsWith(input.baseScenario.edges[0].roadName));
  assert.match(events.find(event => event.kind === 'closure-start').detail, /ab, bc, bd \(\+1 more\)/);
  for (const event of events) for (const value of Object.values(event)) assert.ok(value === null || ['string', 'number'].includes(typeof value));
});

test('building, paging and seeking preserve frozen source objects and never invoke simulation cloning', () => {
  const { input, completed } = ready();
  const serializedInput = JSON.stringify(input), serializedResults = JSON.stringify(completed);
  const baseline = completed.baseline, variant = completed.variants[1].result;
  const segments = baseline.vehicles[0].segments, decisions = variant.vehicles[0].reroutes;
  freeze(input); freeze(completed);
  const clone = globalThis.structuredClone;
  globalThis.structuredClone = () => { throw new Error('Unexpected simulation or clone'); };
  try {
    const index = createReplayEvents(input, completed, 'close-at-10', 'van-1');
    collect(index); adjacentReplayEvent(index, 10, 'next'); adjacentReplayEvent(index, 29, 'previous', 'deliveries');
    const page = pageReplayEvents(index); page.events[0].label = 'Changed display copy';
    assert.notEqual(pageReplayEvents(index).events[0].label, 'Changed display copy');
  } finally { globalThis.structuredClone = clone; }
  assert.equal(JSON.stringify(input), serializedInput); assert.equal(JSON.stringify(completed), serializedResults);
  assert.equal(completed.baseline, baseline); assert.equal(completed.variants[1].result, variant);
  assert.equal(baseline.vehicles[0].segments, segments); assert.equal(variant.vehicles[0].reroutes, decisions);
});

test('mismatched identities, unsorted ledgers and invalid times fail closed', () => {
  const { input, completed } = ready();
  assert.throws(() => createReplayEvents(input, completed, 'missing', 'van-1'), /Choose a variant/);
  const reject = (mutate, pattern) => { const copy = structuredClone(completed); mutate(copy); assert.throws(() => createReplayEvents(input, copy, 'close-at-10', 'van-1'), pattern); };
  reject(copy => { copy.baseline.vehicles[0].segments[0].startS = null; }, /ordered finite segment/);
  reject(copy => { copy.baseline.vehicles[0].segments[0].edgeId = 'missing'; }, /segment edge identities/);
  reject(copy => { copy.baseline.vehicles[0].segments.reverse(); }, /ordered finite segment/);
  reject(copy => { copy.variants[1].result.vehicles[0].reroutes[0].atS = NaN; }, /ordered finite reroute/);
  reject(copy => { copy.variants[1].result.vehicles[0].reroutes[0].jobId = 'missing'; }, /reroute identities/);
  reject(copy => { copy.baseline.vehicles[0].segments = new Array(ENGINE_LIMITS.segments + 1); }, /bounded ledger arrays/);
  reject(copy => { copy.baseline.vehicles[0].jobs.pop(); }, /matching vehicle, variant and job identities/);
  let getterCalls = 0;
  reject(copy => { Object.defineProperty(copy.baseline.vehicles[0].segments[0], 'startS', { get() { getterCalls += 1; return 0; } }); }, /without accessors/);
  assert.equal(getterCalls, 0);
  assert.throws(() => pageReplayEvents({ counts: { all: 0 } }), /Create an index/);
});

test('the actual 500,000-segment result limit keeps all 1,008,000 events with bounded pages and binary seeking', () => {
  const input = createTutorialExperiment(), scenario = input.baseScenario;
  scenario.nodes = Array.from({ length: 250 }, (_, index) => ({ id: `n${index}`, x: index, y: 0 }));
  scenario.edges = scenario.nodes.map((node, index) => ({ id: `e${index}`, from: node.id, to: `n${(index + 1) % 250}`, distanceM: 1, travelTimeS: 1, roadName: 'Synthetic ring' }));
  scenario.vehicles = [{ id: 'van-1', startNode: 'n0', startTimeS: 0 }];
  scenario.jobs = Array.from({ length: 2000 }, (_, index) => ({ id: `job-${index}`, nodeId: index % 2 ? 'n0' : 'n125', vehicleId: 'van-1', dueTimeS: 604800, serviceTimeS: 0 }));
  input.variants = [{ id: 'clear', name: 'Clear', closures: [] }, { id: 'blocked', name: 'Blocked', closures: [{ id: 'stop', edgeIds: ['e0'], atS: 0 }] }];
  const { index, completed } = ready(input, 'clear');
  assert.equal(completed.baseline.vehicles[0].segments.length, ENGINE_LIMITS.segments);
  assert.equal([completed.baseline, ...completed.variants.map(variant => variant.result)].reduce((sum, result) => sum + result.vehicles[0].segments.length, 0), EXPERIMENT_LIMITS.totalResultSegments);
  assert.deepEqual(index.counts, { all: 1008000, deliveries: 8000, routing: 1000000, closures: 0 });
  const first = pageReplayEvents(index), last = pageReplayEvents(index, 'all', Infinity);
  assert.equal(first.events.length, 20); assert.equal(first.pageCount, 50400);
  assert.equal(last.pageIndex, 0); // Non-finite requests reset to the first page.
  const final = pageReplayEvents(index, 'all', first.pageCount - 1);
  assert.equal(final.events.length, 20); assert.equal(final.to, 1008000); assert.equal(final.events.at(-1).atS, 250000);
  assert.equal(pageReplayEvents(index, 'deliveries', 399).to, 8000);
  assert.equal(adjacentReplayEvent(index, 12345.5, 'previous').atS, 12345);
  assert.equal(adjacentReplayEvent(index, 12345.5, 'next').atS, 12346);
  assert.equal(adjacentReplayEvent(index, 250000, 'next'), null);
});
