import { ENGINE_LIMITS } from './engine.js';
import { EXPERIMENT_LIMITS } from './experiment.js';
import { LIMITS } from './scenario.js';
import { copyCompletedResults } from './report-results.js';

export const REPLAY_EVENT_PAGE_SIZE = 20;
const FILTERS = ['all', 'deliveries', 'routing', 'closures'];
const indexes = new WeakMap();

function fail(message) { throw new Error(`Completed replay events require ${message}.`); }
function finiteTime(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }

function plainRecord(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('plain ledger records');
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => !keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) fail('plain ledger records without accessors');
}

function boundedArray(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) fail('bounded ledger arrays');
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) fail('plain ledger arrays without accessors');
  }
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) fail('dense ledger arrays');
  return value;
}

function checkVehicle(vehicle, expectedJobs, edges, nodes) {
  boundedArray(vehicle.segments, ENGINE_LIMITS.segments);
  boundedArray(vehicle.reroutes, ENGINE_LIMITS.segments + LIMITS.jobs);
  let previousEnd = 0;
  for (const segment of vehicle.segments) {
    plainRecord(segment, ['edgeId', 'from', 'to', 'startS', 'endS', 'distanceM']);
    const edge = edges.get(segment.edgeId);
    if (!edge || edge.from !== segment.from || edge.to !== segment.to || edge.distanceM !== segment.distanceM) fail('matching segment edge identities');
    if (!finiteTime(segment.startS) || !finiteTime(segment.endS) || segment.startS < previousEnd || segment.endS !== segment.startS + edge.travelTimeS) fail('ordered finite segment times');
    previousEnd = segment.endS;
  }
  let previousCompletion = 0;
  for (let index = 0; index < vehicle.jobs.length; index += 1) {
    const job = vehicle.jobs[index];
    if (job.id !== expectedJobs[index]?.id) fail('the supplied vehicle job order');
    if (job.arrivalS === null) continue;
    if (job.arrivalS < previousCompletion) fail('ordered delivery times');
    previousCompletion = job.completedS;
  }
  let previousDecision = 0;
  const jobs = new Set(expectedJobs.map(job => job.id));
  for (const decision of vehicle.reroutes) {
    plainRecord(decision, ['atS', 'nodeId', 'jobId', 'closedEdgeIds', 'reason']);
    if (!finiteTime(decision.atS) || decision.atS < previousDecision) fail('ordered finite reroute times');
    if (!nodes.has(decision.nodeId) || !jobs.has(decision.jobId) || !['closure-blocked-route', 'no-route'].includes(decision.reason)) fail('matching reroute identities and reasons');
    boundedArray(decision.closedEdgeIds, LIMITS.edges);
    if (!decision.closedEdgeIds.length || decision.closedEdgeIds.some(id => !edges.has(id)) || new Set(decision.closedEdgeIds).size !== decision.closedEdgeIds.length) fail('matching closed-edge references');
    previousDecision = decision.atS;
  }
}

function selectedData(index, filter) {
  if (!FILTERS.includes(filter)) throw new Error('Choose a supported replay event filter.');
  const data = indexes.get(index);
  if (!data) throw new Error('Create an index from completed replay results first.');
  return { ...data, order: data.orders[filter] };
}

function sourceAt(data, encoded) {
  const streamId = encoded % data.streams.length;
  const sourceIndex = Math.floor(encoded / data.streams.length);
  const stream = data.streams[streamId];
  return { stream, sourceIndex, item: stream.items[sourceIndex] };
}

function timeAt(data, encoded) {
  const stream = data.streams[encoded % data.streams.length];
  return stream.items[Math.floor(encoded / data.streams.length)][stream.timeKey];
}

function edgeSummary(ids) { return `${ids.slice(0, 3).join(', ')}${ids.length > 3 ? ` (+${ids.length - 3} more)` : ''}`; }

function eventAt(data, encoded) {
  const { stream, sourceIndex, item } = sourceAt(data, encoded);
  const originalIndex = stream.kind === 'closure-start' ? item.position : sourceIndex;
  const event = {
    id: `${stream.run}:${stream.kind}:${originalIndex}`,
    atS: item[stream.timeKey], kind: stream.kind, category: stream.category,
    run: stream.run, sourceIndex: originalIndex,
  };
  if (stream.kind === 'closure-start') {
    return { ...event, closureId: item.id, label: `Closure starts: ${item.id}`,
      detail: `Global variant schedule: ${item.edgeIds.length} directed edge${item.edgeIds.length === 1 ? '' : 's'} (${edgeSummary(item.edgeIds)}). This does not establish an effect on the selected vehicle.` };
  }
  if (stream.kind === 'segment-entry' || stream.kind === 'segment-exit') {
    const entering = stream.kind === 'segment-entry';
    return { ...event, edgeId: item.edgeId, nodeId: entering ? item.from : item.to,
      label: `${entering ? 'Enter' : 'Exit'} edge ${item.edgeId}`,
      detail: `${data.edges.get(item.edgeId).roadName} · ${item.from} → ${item.to}. Recorded segment ${sourceIndex + 1}.` };
  }
  if (stream.kind === 'reroute') {
    return { ...event, nodeId: item.nodeId, jobId: item.jobId, reason: item.reason,
      label: item.reason === 'no-route' ? 'No-route decision' : 'Reroute decision',
      detail: `At ${item.nodeId} for ${item.jobId}. Closed planned edges: ${edgeSummary(item.closedEdgeIds)}.` };
  }
  return { ...event, jobId: item.id, nodeId: item.nodeId, status: item.status,
    label: `${stream.kind === 'job-arrival' ? 'Arrive at' : 'Complete'} job ${item.id}`,
    detail: `${item.nodeId} · Arrival status: ${item.status === 'on-time' ? 'on time' : 'late'}. ${stream.kind === 'job-completion' ? 'Service completed.' : 'Deadline applies to arrival.'}` };
}

/**
 * Index internal completed Worker ledgers for one vehicle and selected variant.
 * No routing, simulation, rounding, inferred vehicle effects or input mutation.
 * Caller owns invalidation when experiment/result/vehicle/variant changes. This
 * is not an arbitrary-result importer and does not authenticate a ledger.
 *
 * Merge 11 ordered streams rather than sorting/materializing every event. Only
 * the at-most-8,000 closure schedule is sorted (by time, then input position).
 * Private Uint32 indexes use eight bytes per event, plus the bounded input
 * references. Pages allocate at most 20 display records; navigation is binary.
 * Equal-time display order: closure, exit, arrival, completion, reroute, entry;
 * then baseline before variant, then original source index. It is not a causal
 * ordering. Null unreachable timings have no synthetic event.
 */
export function createReplayEvents(experiment, completedResults, variantId, vehicleId) {
  const checked = copyCompletedResults(experiment, completedResults);
  const selected = experiment.variants.find(variant => variant.id === variantId);
  const selectedResult = completedResults.variants.find(variant => variant.id === variantId);
  if (!selected || !selectedResult) throw new Error('Choose a variant from the completed experiment.');
  if (!experiment.baseScenario.vehicles.some(vehicle => vehicle.id === vehicleId)) throw new Error('Choose a vehicle from the completed experiment.');
  const baseline = completedResults.baseline.vehicles.find(vehicle => vehicle.id === vehicleId);
  const variant = selectedResult.result.vehicles.find(vehicle => vehicle.id === vehicleId);
  const checkedBaseline = checked.baseline.vehicles.find(vehicle => vehicle.id === vehicleId);
  const checkedVariant = checked.variants.find(item => item.id === variantId).result.vehicles.find(vehicle => vehicle.id === vehicleId);
  const edges = new Map(experiment.baseScenario.edges.map(edge => [edge.id, edge]));
  const nodes = new Set(experiment.baseScenario.nodes.map(node => node.id));
  const jobs = experiment.baseScenario.jobs.filter(job => job.vehicleId === vehicleId);
  checkVehicle(baseline, jobs, edges, nodes);
  checkVehicle(variant, jobs, edges, nodes);
  if (baseline.segments.length + variant.segments.length > EXPERIMENT_LIMITS.totalResultSegments) fail('bounded total result segments');
  boundedArray(selected.closures, EXPERIMENT_LIMITS.totalClosures);
  const closures = selected.closures.map((closure, position) => ({ ...closure, position }))
    .sort((a, b) => a.atS - b.atS || a.position - b.position);
  const streams = [{ items: closures, timeKey: 'atS', kind: 'closure-start', category: 'closures', run: 'schedule' }];
  const runs = [
    { run: 'baseline', vehicle: baseline, jobs: checkedBaseline.jobs },
    { run: 'variant', vehicle: variant, jobs: checkedVariant.jobs },
  ];
  for (const [kind, collection, timeKey, category] of [
    ['segment-exit', 'segments', 'endS', 'routing'],
    ['job-arrival', 'jobs', 'arrivalS', 'deliveries'],
    ['job-completion', 'jobs', 'completedS', 'deliveries'],
    ['reroute', 'reroutes', 'atS', 'routing'],
    ['segment-entry', 'segments', 'startS', 'routing'],
  ]) for (const run of runs) streams.push({ items: collection === 'jobs' ? run.jobs : run.vehicle[collection], timeKey, kind, category, run: run.run });

  const counts = { all: 0, deliveries: 0, routing: 0, closures: closures.length };
  for (const run of runs) {
    counts.deliveries += run.jobs.filter(job => job.arrivalS !== null).length * 2;
    counts.routing += run.vehicle.segments.length * 2 + run.vehicle.reroutes.length;
  }
  counts.all = counts.deliveries + counts.routing + counts.closures;
  const orders = Object.fromEntries(FILTERS.map(filter => [filter, new Uint32Array(counts[filter])]));
  const positions = new Uint32Array(streams.length);
  const filled = { all: 0, deliveries: 0, routing: 0, closures: 0 };
  const advance = streamId => {
    const stream = streams[streamId];
    while (positions[streamId] < stream.items.length && stream.items[positions[streamId]][stream.timeKey] === null) positions[streamId] += 1;
  };
  streams.forEach((_, streamId) => advance(streamId));
  while (filled.all < counts.all) {
    let best = -1, nextTime = Infinity;
    for (let streamId = 0; streamId < streams.length; streamId += 1) {
      const stream = streams[streamId], item = stream.items[positions[streamId]];
      if (item && item[stream.timeKey] < nextTime) { best = streamId; nextTime = item[stream.timeKey]; }
    }
    if (best < 0) fail('finite event times');
    const encoded = positions[best] * streams.length + best;
    orders.all[filled.all++] = encoded;
    const category = streams[best].category;
    orders[category][filled[category]++] = encoded;
    positions[best] += 1; advance(best);
  }
  const index = Object.freeze({
    variant: Object.freeze({ id: selected.id, name: selected.name }), vehicleId,
    counts: Object.freeze(counts),
    unreachableJobs: Object.freeze({ baseline: checkedBaseline.jobs.filter(job => job.arrivalS === null).length, variant: checkedVariant.jobs.filter(job => job.arrivalS === null).length }),
  });
  indexes.set(index, { streams, orders, edges });
  return index;
}

/** All ties are retained. A filter with no rows has pageCount/from/to = 0. */
export function pageReplayEvents(index, filter = 'all', requestedPage = 0) {
  const data = selectedData(index, filter), matchingEvents = data.order.length;
  const pageCount = Math.ceil(matchingEvents / REPLAY_EVENT_PAGE_SIZE);
  const pageIndex = Math.max(0, Math.min(Math.max(0, pageCount - 1), Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0));
  const start = pageIndex * REPLAY_EVENT_PAGE_SIZE;
  const events = Array.from(data.order.subarray(start, start + REPLAY_EVENT_PAGE_SIZE), encoded => eventAt(data, encoded));
  return { events, filter, totalEvents: index.counts.all, matchingEvents, pageIndex, pageCount, from: events.length ? start + 1 : 0, to: start + events.length };
}

/** Strict time comparison skips the entire current timestamp, never its ties. */
export function adjacentReplayEvent(index, timeS, direction, filter = 'all') {
  if (!finiteTime(timeS)) throw new Error('Choose a finite nonnegative replay time.');
  if (!['previous', 'next'].includes(direction)) throw new Error('Choose previous or next replay event.');
  const data = selectedData(index, filter);
  let low = 0, high = data.order.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2), atS = timeAt(data, data.order[middle]);
    if (atS < timeS || (direction === 'next' && atS === timeS)) low = middle + 1;
    else high = middle;
  }
  const position = direction === 'previous' ? low - 1 : low;
  return position < 0 || position >= data.order.length ? null : eventAt(data, data.order[position]);
}
