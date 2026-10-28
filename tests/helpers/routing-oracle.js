// Test-only reference: enumerate simple paths, never use the engine's routing,
// heap, reverse tree, closure phases, caches, or validators. Exact comparisons
// below are intended for the bounded dyadic corpus, not arbitrary decimal input.
const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function comparePath(a, b) {
  if (a.travelTimeS !== b.travelTimeS) return a.travelTimeS - b.travelTimeS;
  if (a.distanceM !== b.distanceM) return a.distanceM - b.distanceM;
  for (let i = 0; i < Math.min(a.edgeIds.length, b.edgeIds.length); i += 1) {
    const order = compareId(a.edgeIds[i], b.edgeIds[i]);
    if (order) return order;
  }
  return a.edgeIds.length - b.edgeIds.length;
}
export function exhaustivePath(scenario, from, to, closed = new Set()) {
  if (scenario.nodes.length > 6 || scenario.edges.length > 40) throw new Error('Reference oracle bound exceeded.');
  let best = null;
  let visits = 0;
  function visit(current, nodeIds, edgeIds, travelTimeS, distanceM) {
    if (++visits > 100000) throw new Error('Reference path enumeration bound exceeded.');
    if (current === to) {
      const path = { nodeIds, edgeIds, distanceM, travelTimeS };
      if (!best || comparePath(path, best) < 0) best = path;
      return;
    }
    for (const edge of scenario.edges) {
      if (edge.from !== current || closed.has(edge.id) || nodeIds.includes(edge.to)) continue;
      visit(edge.to, [...nodeIds, edge.to], [...edgeIds, edge.id], travelTimeS + edge.travelTimeS, distanceM + edge.distanceM);
    }
  }
  visit(from, [from], [], 0, 0);
  return best;
}

export function exhaustiveSimulation(scenario) {
  const vehicles = [];
  const metrics = { distanceM: 0, lateJobs: 0, unreachableJobs: 0, completedJobs: 0, totalJobs: scenario.jobs.length, totalDelayS: 0, onTimeJobs: 0, totalTravelTimeS: 0 };
  let durationS = scenario.durationS;
  for (const vehicle of [...scenario.vehicles].sort((a, b) => compareId(a.id, b.id))) {
    let node = vehicle.startNode;
    let now = vehicle.startTimeS;
    let steps = 0;
    const result = { id: vehicle.id, segments: [], jobs: [], distanceM: 0, finishS: now };
    for (const job of scenario.jobs.filter(item => item.vehicleId === vehicle.id)) {
      let unreachable = false;
      while (node !== job.nodeId) {
        if (++steps > 1000) throw new Error('Reference simulation step bound exceeded.');
        const closed = new Set(scenario.closures.filter(event => event.atS <= now).flatMap(event => event.edgeIds));
        const path = exhaustivePath(scenario, node, job.nodeId, closed);
        if (!path) { unreachable = true; break; }
        const edge = scenario.edges.find(item => item.id === path.edgeIds[0]);
        result.segments.push({ edgeId: edge.id, from: node, to: edge.to, startS: now, endS: now + edge.travelTimeS, distanceM: edge.distanceM });
        now += edge.travelTimeS;
        node = edge.to;
        result.distanceM += edge.distanceM;
        metrics.totalTravelTimeS += edge.travelTimeS;
      }
      if (unreachable) {
        result.jobs.push({ id: job.id, nodeId: job.nodeId, dueTimeS: job.dueTimeS, arrivalS: null, completedS: null, status: 'unreachable' });
        metrics.unreachableJobs += 1;
      } else {
        const late = now > job.dueTimeS;
        result.jobs.push({ id: job.id, nodeId: job.nodeId, dueTimeS: job.dueTimeS, arrivalS: now, completedS: now + job.serviceTimeS, status: late ? 'late' : 'on-time' });
        metrics.completedJobs += 1;
        metrics[late ? 'lateJobs' : 'onTimeJobs'] += 1;
        metrics.totalDelayS += Math.max(0, now - job.dueTimeS);
        now += job.serviceTimeS;
      }
    }
    result.finishS = now;
    metrics.distanceM += result.distanceM;
    durationS = Math.max(durationS, now);
    vehicles.push(result);
  }
  return { vehicles, metrics, durationS };
}

// Reroute explanations are intentionally outside this independent numeric/ledger
// oracle. They have a separate contract and focused engine tests.
export function comparableResult(result) {
  const { reroutes, affectedVehicles, ...metrics } = result.metrics;
  return { vehicles: result.vehicles.map(({ reroutes, ...vehicle }) => vehicle), metrics, durationS: result.durationS };
}

export function generatedScenario(seed) {
  let state = seed >>> 0;
  const next = (max) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return Math.floor(state / 4294967296 * max); };
  const nodes = Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, x: i, y: 0 }));
  const edges = [];
  for (let from = 0; from < 5; from += 1) for (let to = 0; to < 5; to += 1) {
    if (from === to || next(100) >= 42) continue;
    edges.push({ id: `e${from}-${to}`, from: `n${from}`, to: `n${to}`, distanceM: (1 + next(24)) / 4, travelTimeS: (1 + next(16)) / 4, roadName: 'Synthetic oracle road' });
  }
  const vehicles = [{ id: 'van-z', startNode: 'n0', startTimeS: next(8) / 4 }, { id: 'van-a', startNode: 'n3', startTimeS: next(8) / 4 }];
  const jobs = Array.from({ length: 12 }, (_, i) => ({ id: `job-${i}`, vehicleId: vehicles[i % 2].id, nodeId: `n${next(5)}`, dueTimeS: next(64) / 4, serviceTimeS: next(8) / 4 }));
  const closures = edges.filter(() => next(100) < 45).map((edge, i) => ({ id: `close-${i}`, edgeIds: [edge.id], atS: next(48) / 4 }));
  return { version: 1, id: `oracle-${seed}`, name: 'Bounded synthetic oracle', seed, description: 'Independent exhaustive-path test fixture; no real traffic or personal data.', nodes, edges, vehicles, jobs, closures, durationS: 1 };
}
