import { validateScenario } from './scenario.js';

/**
 * Deterministic, dependency-free fixed-sequence logistics simulator.
 *
 * Each route minimizes travel time, then distance, then stable edge/node ID order.
 * Closures take effect at edge entry and remain in force. An edge entered before a
 * cutoff is completed. Routes are recomputed at every edge boundary. There is no
 * waiting for reopening, congestion interaction, reassignment, or VRP optimization.
 * A permanently unreachable job is skipped immediately, with the van staying at
 * its current node/time and trying the next job in its fixed input sequence.
 * Deadlines are arrival deadlines; service time delays subsequent jobs.
 * durationS is a minimum playback horizon, never a truncation of work.
 */

const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
// Only absorb IEEE-754 addition noise at a boundary, not meaningful elapsed time.
const reached = (time, cutoff) => Number.isFinite(cutoff) && (time >= cutoff || cutoff - time <= Number.EPSILON * Math.max(1, Math.abs(time), Math.abs(cutoff)) * 8);

/** Deterministic work limits keep adversarial imports from monopolizing a worker. */
export const ENGINE_LIMITS = Object.freeze({ routingEdgeVisits: 20000000, pathEdgeVisits: 4000000, segments: 250000 });

function spend(budget, kind, amount = 1) {
  if (!budget) return;
  budget[kind] += amount;
  if (budget[kind] > ENGINE_LIMITS[kind]) {
    throw new Error(`Simulation exceeds the ${kind} work limit. Reduce the graph, jobs, or closure events.`);
  }
}

class MinHeap {
  constructor() { this.items = []; }
  less(a, b) {
    return a.time < b.time || (a.time === b.time && (a.distance < b.distance || (a.distance === b.distance && compareId(a.id, b.id) < 0)));
  }
  push(value) {
    const items = this.items;
    let index = items.length;
    items.push(value);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.less(value, items[parent])) break;
      items[index] = items[parent];
      index = parent;
    }
    items[index] = value;
  }
  pop() {
    const items = this.items;
    const first = items[0];
    const last = items.pop();
    if (items.length) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        if (left >= items.length) break;
        const right = left + 1;
        const child = right < items.length && this.less(items[right], items[left]) ? right : left;
        if (!this.less(items[child], last)) break;
        items[index] = items[child];
        index = child;
      }
      items[index] = last;
    }
    return first;
  }
  get size() { return this.items.length; }
}

function graphFor(scenario) {
  const incoming = new Map(scenario.nodes.map(node => [node.id, []]));
  const edges = new Map();
  for (const edge of scenario.edges) {
    incoming.get(edge.to).push(edge);
    edges.set(edge.id, edge);
  }
  for (const list of incoming.values()) list.sort((a, b) => compareId(a.id, b.id));
  return { incoming, edges };
}

/** Reverse Dijkstra supplies optimal next hops for every source to one destination. */
function routeTree(graph, target, isClosed, budget) {
  const costs = new Map([[target, { time: 0, distance: 0 }]]);
  const next = new Map();
  const heap = new MinHeap();
  heap.push({ id: target, time: 0, distance: 0 });
  while (heap.size) {
    const current = heap.pop();
    const known = costs.get(current.id);
    if (known.time !== current.time || known.distance !== current.distance) continue;
    for (const edge of graph.incoming.get(current.id)) {
      spend(budget, 'routingEdgeVisits');
      if (isClosed(edge.id)) continue;
      const time = current.time + edge.travelTimeS;
      const distance = current.distance + edge.distanceM;
      const previous = costs.get(edge.from);
      if (!previous || time < previous.time || (time === previous.time && distance < previous.distance)) {
        costs.set(edge.from, { time, distance });
        next.set(edge.from, edge);
        heap.push({ id: edge.from, time, distance });
      } else if (time === previous.time && distance === previous.distance && compareId(edge.id, next.get(edge.from)?.id ?? '') < 0) {
        next.set(edge.from, edge);
      }
    }
  }
  return { costs, next };
}

function extractPath(tree, from, to, nodeLimit, budget) {
  const cost = tree.costs.get(from);
  if (!cost) return null;
  const nodeIds = [from];
  const edgeIds = [];
  let current = from;
  while (current !== to) {
    spend(budget, 'pathEdgeVisits');
    const edge = tree.next.get(current);
    if (!edge || edgeIds.length >= nodeLimit) throw new Error('Routing invariant failed: expected a finite directed path.');
    edgeIds.push(edge.id);
    current = edge.to;
    nodeIds.push(current);
  }
  return { nodeIds, edgeIds, distanceM: cost.distance, travelTimeS: cost.time };
}

/**
 * @param {import('./engine.js').Scenario} input
 * @param {string} from
 * @param {string} to
 * @param {Iterable<string>} [closedEdgeIds=[]]
 * @returns {import('./engine.js').PathResult|null}
 */
export function shortestPath(input, from, to, closedEdgeIds = []) {
  const scenario = validateScenario(input);
  const graph = graphFor(scenario);
  if (!graph.incoming.has(from) || !graph.incoming.has(to)) throw new Error('Route source and destination must reference scenario nodes.');
  if (typeof closedEdgeIds === 'string' || !closedEdgeIds || typeof closedEdgeIds[Symbol.iterator] !== 'function') throw new Error('Closed edge IDs must be an iterable of edge IDs.');
  const closed = new Set();
  let count = 0;
  for (const id of closedEdgeIds) {
    if (++count > 8000) throw new Error('Closed edge IDs exceed the 8000-entry limit.');
    if (!graph.edges.has(id)) throw new Error(`Closed edge id "${id}" does not exist.`);
    closed.add(id);
  }
  return extractPath(routeTree(graph, to, id => closed.has(id)), from, to, scenario.nodes.length);
}

function closureTimeline(closures) {
  const closedAt = new Map();
  for (const closure of closures) {
    for (const id of closure.edgeIds) closedAt.set(id, Math.min(closedAt.get(id) ?? Infinity, closure.atS));
  }
  const times = [...new Set(closedAt.values())].sort((a, b) => a - b);
  return {
    closedAt,
    phaseAt(time) {
      let low = 0;
      let high = times.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (reached(time, times[middle])) low = middle + 1;
        else high = middle;
      }
      return low;
    },
    timeAt(phase) { return phase === 0 ? -Infinity : times[phase - 1]; },
  };
}

/**
 * Complete all fixed vehicle job sequences; never mutates input or uses wall time.
 * Completed/arrival values are null for unreachable jobs, not Infinity or NaN.
 * @param {import('./engine.js').Scenario} input
 * @param {{closures?: import('./engine.js').Closure[]}} [options]
 * @returns {import('./engine.js').SimulationResult}
 */
export function simulate(input, options = {}) {
  let scenario = validateScenario(input);
  if (options.closures !== undefined) scenario = validateScenario({ ...scenario, closures: options.closures });
  const graph = graphFor(scenario);
  const budget = { routingEdgeVisits: 0, pathEdgeVisits: 0, segments: 0 };
  const timeline = closureTimeline(scenario.closures);
  const cache = new Map();
  const treeFor = (target, phase) => {
    const key = `${phase}|${target}`;
    let tree = cache.get(key);
    if (!tree) {
      const cutoff = timeline.timeAt(phase);
      tree = routeTree(graph, target, id => (timeline.closedAt.get(id) ?? Infinity) <= cutoff, budget);
      // Bounded memory even on an imported scenario with thousands of cutoffs.
      if (cache.size >= 128) cache.delete(cache.keys().next().value);
      cache.set(key, tree);
    } else {
      cache.delete(key);
      cache.set(key, tree);
    }
    return tree;
  };
  const jobsByVehicle = new Map(scenario.vehicles.map(vehicle => [vehicle.id, []]));
  for (const job of scenario.jobs) jobsByVehicle.get(job.vehicleId).push(job);
  const metrics = { distanceM: 0, lateJobs: 0, unreachableJobs: 0, completedJobs: 0, totalJobs: scenario.jobs.length, totalDelayS: 0, onTimeJobs: 0, reroutes: 0, affectedVehicles: 0, totalTravelTimeS: 0 };
  const vehicles = [];
  let durationS = scenario.durationS;
  for (const vehicle of [...scenario.vehicles].sort((a, b) => compareId(a.id, b.id))) {
    const result = { id: vehicle.id, segments: [], jobs: [], distanceM: 0, finishS: vehicle.startTimeS, reroutes: [] };
    let current = vehicle.startNode;
    let time = vehicle.startTimeS;
    for (const job of jobsByVehicle.get(vehicle.id)) {
      let planned = extractPath(treeFor(job.nodeId, 0), current, job.nodeId, scenario.nodes.length, budget)?.edgeIds ?? [];
      let plannedIndex = 0;
      let plannedPhase = 0;
      let unreachable = false;
      while (current !== job.nodeId) {
        const phase = timeline.phaseAt(time);
        const tree = treeFor(job.nodeId, phase);
        const edge = tree.next.get(current);
        let blocked = [];
        if (phase !== plannedPhase) {
          spend(budget, 'pathEdgeVisits', planned.length - plannedIndex);
          blocked = planned.slice(plannedIndex).filter(id => reached(time, timeline.closedAt.get(id) ?? Infinity));
          plannedPhase = phase;
        }
        if (blocked.length) {
          result.reroutes.push({ atS: time, nodeId: current, jobId: job.id, closedEdgeIds: [...new Set(blocked)].sort(compareId), reason: edge ? 'closure-blocked-route' : 'no-route' });
          planned = extractPath(tree, current, job.nodeId, scenario.nodes.length, budget)?.edgeIds ?? [];
          plannedIndex = 0;
        }
        if (!edge) { unreachable = true; break; }
        // The closure decision was made at entry. Finish this segment unchanged.
        const endS = time + edge.travelTimeS;
        spend(budget, 'segments');
        result.segments.push({ edgeId: edge.id, from: edge.from, to: edge.to, startS: time, endS, distanceM: edge.distanceM });
        result.distanceM += edge.distanceM;
        metrics.totalTravelTimeS += edge.travelTimeS;
        time = endS;
        current = edge.to;
        if (planned[plannedIndex] === edge.id) plannedIndex += 1;
        else {
          planned = extractPath(tree, current, job.nodeId, scenario.nodes.length, budget)?.edgeIds ?? [];
          plannedIndex = 0;
        }
      }
      if (unreachable) {
        result.jobs.push({ id: job.id, nodeId: job.nodeId, dueTimeS: job.dueTimeS, arrivalS: null, completedS: null, status: 'unreachable' });
        metrics.unreachableJobs += 1;
        continue;
      }
      const delay = reached(job.dueTimeS, time) ? 0 : time - job.dueTimeS;
      const status = delay > 0 ? 'late' : 'on-time';
      result.jobs.push({ id: job.id, nodeId: job.nodeId, dueTimeS: job.dueTimeS, arrivalS: time, completedS: time + job.serviceTimeS, status });
      metrics.completedJobs += 1;
      metrics.totalDelayS += delay;
      if (status === 'late') metrics.lateJobs += 1;
      else metrics.onTimeJobs += 1;
      time += job.serviceTimeS;
    }
    result.finishS = time;
    metrics.distanceM += result.distanceM;
    metrics.reroutes += result.reroutes.length;
    if (result.reroutes.length) metrics.affectedVehicles += 1;
    durationS = Math.max(durationS, time);
    vehicles.push(result);
  }
  return { vehicles, metrics, durationS };
}
