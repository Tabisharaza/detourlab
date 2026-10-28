import test from 'node:test';
import assert from 'node:assert/strict';
import { shortestPath, simulate } from '../src/engine.js';
import { exhaustivePath, exhaustiveSimulation, comparableResult, generatedScenario } from './helpers/routing-oracle.js';

const seeds = Array.from({ length: 96 }, (_, i) => i);
for (const seed of seeds) {
  test(`independent exhaustive routing and delivery ledger: seed ${seed}`, () => {
    const scenario = generatedScenario(seed);
    const original = structuredClone(scenario);
    const expected = exhaustiveSimulation(scenario);
    assert.deepEqual(comparableResult(simulate(scenario)), expected);
    const closed = new Set(scenario.closures.filter(event => event.atS <= 3).flatMap(event => event.edgeIds));
    for (const blocked of [new Set(), closed]) for (const source of scenario.nodes) for (const target of scenario.nodes) {
      assert.deepEqual(shortestPath(scenario, source.id, target.id, blocked), exhaustivePath(scenario, source.id, target.id, blocked), `${source.id} -> ${target.id}; closed=${[...blocked].join(',')}`);
    }
    const reordered = { ...scenario, nodes: [...scenario.nodes].reverse(), edges: [...scenario.edges].reverse(), vehicles: [...scenario.vehicles].reverse(), closures: [...scenario.closures].reverse() };
    assert.deepEqual(comparableResult(simulate(reordered)), expected);
    assert.deepEqual(scenario, original);
  });
}

const edge = (id, from, to, time, distance = time) => ({ id, from, to, travelTimeS: time, distanceM: distance, roadName: 'Oracle road' });
const job = (id, nodeId, dueTimeS = 100, serviceTimeS = 0) => ({ id, nodeId, vehicleId: 'van', dueTimeS, serviceTimeS });
function fixture(edges, jobs, closures = []) {
  return { version: 1, id: 'oracle-curated', name: 'Curated oracle', seed: 0, description: 'Original hand-checkable synthetic case.', nodes: ['A', 'B', 'C', 'D'].map((id, x) => ({ id, x, y: 0 })), edges, vehicles: [{ id: 'van', startNode: 'A', startTimeS: 0 }], jobs, closures, durationS: 1 };
}
function check(scenario) {
  const expected = exhaustiveSimulation(scenario);
  assert.deepEqual(comparableResult(simulate(scenario)), expected);
  return expected.vehicles[0];
}

test('reference chooses time, then distance, then ordinal edge ID including parallel edges', () => {
  const scenario = fixture([edge('fast-long', 'A', 'C', 1, 100), edge('slow-short', 'A', 'C', 2, 1), edge('z', 'A', 'B', 0.5, 2), edge('A', 'A', 'B', 0.5, 2), edge('end', 'B', 'C', 0.5, 2)], [job('delivery', 'C')]);
  const path = exhaustivePath(scenario, 'A', 'C');
  assert.deepEqual(path, { nodeIds: ['A', 'B', 'C'], edgeIds: ['A', 'end'], distanceM: 4, travelTimeS: 1 });
  assert.deepEqual(shortestPath(scenario, 'A', 'C'), path);
  assert.deepEqual(check(scenario).segments.map(item => item.edgeId), ['A', 'end']);
});

test('reference dynamic route may revisit a node after a permanent closure', () => {
  const scenario = fixture([edge('ab', 'A', 'B', 1), edge('bc', 'B', 'C', 1), edge('ba', 'B', 'A', 1), edge('ad', 'A', 'D', 5), edge('dc', 'D', 'C', 1)], [job('delivery', 'C', 7)], [{ id: 'cut', edgeIds: ['bc'], atS: 1 }]);
  const result = check(scenario);
  assert.deepEqual(result.segments.map(item => item.edgeId), ['ab', 'ba', 'ad', 'dc']);
  assert.equal(result.jobs[0].arrivalS, 8);
  assert.equal(result.jobs[0].status, 'late');
});

test('reference respects service-boundary closure, earliest duplicate cutoff, and input job order', () => {
  const scenario = fixture([edge('ab', 'A', 'B', 1), edge('bc', 'B', 'C', 1), edge('bd', 'B', 'D', 2), edge('dc', 'D', 'C', 1)], [job('z-first', 'B', 1, 2), job('a-second', 'C', 6)], [{ id: 'later', edgeIds: ['bc'], atS: 9 }, { id: 'cut', edgeIds: ['bc'], atS: 3 }]);
  const result = check(scenario);
  assert.deepEqual(result.jobs.map(item => [item.id, item.arrivalS, item.completedS, item.status]), [['z-first', 1, 3, 'on-time'], ['a-second', 6, 6, 'on-time']]);
  assert.deepEqual(result.segments.map(item => [item.edgeId, item.startS]), [['ab', 0], ['bd', 3], ['dc', 5]]);
});

test('reference finishes an already entered edge then skips unreachable service and continues from actual location', () => {
  const scenario = fixture([edge('ab', 'A', 'B', 2), edge('bc', 'B', 'C', 1), edge('bd', 'B', 'D', 1)], [job('unreachable', 'C', 0, 100), job('local', 'B', 2, 1), job('next', 'D', 4)], [{ id: 'cut', edgeIds: ['ab', 'bc'], atS: 1 }]);
  const result = check(scenario);
  assert.deepEqual(result.jobs.map(item => [item.arrivalS, item.completedS, item.status]), [[null, null, 'unreachable'], [2, 3, 'on-time'], [4, 4, 'on-time']]);
  assert.deepEqual(result.segments.map(item => [item.edgeId, item.startS, item.endS]), [['ab', 0, 2], ['bd', 3, 4]]);
  assert.equal(result.finishS, 4);
});

test('reference handles time-zero closures, same-node jobs and empty or disconnected directed graphs', () => {
  for (const edges of [[], [edge('ba', 'B', 'A', 1)], [edge('ab', 'A', 'B', 1)]]) {
    const scenario = fixture(edges, [job('same', 'A', 0, 0.25), job('away', 'B')], edges.some(item => item.id === 'ab') ? [{ id: 'cut', edgeIds: ['ab'], atS: 0 }] : []);
    const result = check(scenario);
    assert.deepEqual(result.segments, []);
    assert.deepEqual(result.jobs.map(item => item.status), ['on-time', 'unreachable']);
    assert.equal(result.finishS, 0.25);
  }
});

test('dyadic corpus actually covers reachable, late, unreachable, service and closure cases', () => {
  const coverage = { onTime: 0, late: 0, unreachable: 0, moving: 0, service: 0, closure: 0, rerouting: 0 };
  for (const seed of seeds) {
    const scenario = generatedScenario(seed);
    const result = simulate(scenario);
    coverage.onTime += result.metrics.onTimeJobs;
    coverage.late += result.metrics.lateJobs;
    coverage.unreachable += result.metrics.unreachableJobs;
    coverage.moving += result.vehicles.flatMap(vehicle => vehicle.segments).length;
    coverage.service += scenario.jobs.filter(item => item.serviceTimeS > 0).length;
    coverage.closure += scenario.closures.length;
    coverage.rerouting += result.metrics.reroutes;
  }
  for (const [kind, count] of Object.entries(coverage)) assert.ok(count > 0, `corpus must exercise ${kind}`);
});

test('reference compares late-starting vehicle before early-starting vehicle without sharing closure state', () => {
  const scenario = fixture([edge('ab', 'A', 'B', 1), edge('bc', 'B', 'C', 1), edge('ad', 'A', 'D', 3), edge('dc', 'D', 'C', 1)], [], [{ id: 'cut', edgeIds: ['ab'], atS: 2 }]);
  scenario.vehicles = [{ id: 'z-early', startNode: 'A', startTimeS: 0 }, { id: 'a-late', startNode: 'A', startTimeS: 3 }];
  scenario.jobs = scenario.vehicles.map(vehicle => ({ ...job(`job-${vehicle.id}`, 'C'), vehicleId: vehicle.id }));
  const expected = exhaustiveSimulation(scenario);
  assert.deepEqual(comparableResult(simulate(scenario)), expected);
  assert.deepEqual(expected.vehicles.map(vehicle => [vehicle.id, vehicle.jobs[0].arrivalS, vehicle.segments.map(item => item.edgeId)]), [['a-late', 7, ['ad', 'dc']], ['z-early', 2, ['ab', 'bc']]]);
});

test('reference resolves equal-cost shared-prefix route ties by the next differing edge ID', () => {
  const scenario = fixture([edge('prefix', 'A', 'B', 1), edge('z', 'B', 'C', 2), edge('A', 'B', 'D', 1), edge('end', 'D', 'C', 1)], [job('delivery', 'C')]);
  const expected = { nodeIds: ['A', 'B', 'D', 'C'], edgeIds: ['prefix', 'A', 'end'], distanceM: 3, travelTimeS: 3 };
  for (const edges of [scenario.edges, [...scenario.edges].reverse()]) {
    assert.deepEqual(exhaustivePath({ ...scenario, edges }, 'A', 'C'), expected);
    assert.deepEqual(shortestPath({ ...scenario, edges }, 'A', 'C'), expected);
  }
  check(scenario);
});
