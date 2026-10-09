import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { createDemoScenario, createPresets, DEMO_PRESETS, LIMITS, parseScenario, validateScenario } from '../src/scenario.js';
import { ENGINE_LIMITS, shortestPath, simulate } from '../src/engine.js';

const edge = (id, from, to, travelTimeS, distanceM = travelTimeS * 10) => ({ id, from, to, travelTimeS, distanceM, roadName: `${id} Road` });
const job = (id, nodeId, dueTimeS = 100, serviceTimeS = 0, vehicleId = 'van-1') => ({ id, nodeId, vehicleId, dueTimeS, serviceTimeS });
function fixture() {
  return {
    version: 1, id: 'test', name: 'Test district', seed: 42, description: 'A tiny directed test network.',
    nodes: ['A', 'B', 'C', 'D'].map((id, i) => ({ id, x: i, y: 0 })),
    edges: [edge('ab', 'A', 'B', 10), edge('bc', 'B', 'C', 10), edge('ad', 'A', 'D', 20), edge('bd', 'B', 'D', 8), edge('dc', 'D', 'C', 8)],
    vehicles: [{ id: 'van-1', startNode: 'A', startTimeS: 0 }],
    jobs: [job('job-1', 'C', 22, 3)], closures: [], durationS: 100,
  };
}
const closure = (edgeIds, atS, id = 'closure') => ({ id, edgeIds, atS });
const clone = value => structuredClone(value);

// Shortest paths are real directed graph calculations.
test('minimum travel-time path reports actual geometry and totals', () => {
  assert.deepEqual(shortestPath(fixture(), 'A', 'C'), { nodeIds: ['A', 'B', 'C'], edgeIds: ['ab', 'bc'], distanceM: 200, travelTimeS: 20 });
});
test('directed edges do not silently permit reverse travel', () => {
  assert.equal(shortestPath(fixture(), 'C', 'A'), null);
});
test('same-node path has zero cost and no edges', () => {
  assert.deepEqual(shortestPath(fixture(), 'A', 'A'), { nodeIds: ['A'], edgeIds: [], distanceM: 0, travelTimeS: 0 });
});
test('closed edge is excluded and an alternate directed route is found', () => {
  assert.deepEqual(shortestPath(fixture(), 'A', 'C', ['bc']).edgeIds, ['ab', 'bd', 'dc']);
  assert.equal(shortestPath(fixture(), 'A', 'C', new Set(['bc', 'dc'])), null);
});
test('travel time is primary objective; physical distance is secondary', () => {
  const s = fixture();
  s.edges = [edge('direct', 'A', 'C', 15, 10000), edge('ab', 'A', 'B', 10, 10), edge('bc', 'B', 'C', 10, 10)];
  assert.deepEqual(shortestPath(s, 'A', 'C').edgeIds, ['direct']);
  s.edges[0].travelTimeS = 20;
  assert.deepEqual(shortestPath(s, 'A', 'C').edgeIds, ['ab', 'bc']);
});
test('equal-cost alternatives use stable lexical edge IDs, regardless of input order', () => {
  const s = fixture();
  s.edges = [edge('z-route', 'A', 'B', 10), edge('b-end', 'B', 'C', 10), edge('a-route', 'A', 'D', 10), edge('d-end', 'D', 'C', 10)];
  assert.deepEqual(shortestPath(s, 'A', 'C').edgeIds, ['a-route', 'd-end']);
  s.edges.reverse(); s.nodes.reverse();
  assert.deepEqual(shortestPath(s, 'A', 'C').edgeIds, ['a-route', 'd-end']);
});
test('positive self-loop is never selected', () => {
  const s = fixture(); s.edges.unshift(edge('aa', 'A', 'A', 0.1));
  assert.deepEqual(shortestPath(s, 'A', 'C').edgeIds, ['ab', 'bc']);
});
test('shortestPath rejects unknown sources and closure references', () => {
  assert.throws(() => shortestPath(fixture(), 'missing', 'A'), /source and destination/);
  assert.throws(() => shortestPath(fixture(), 'A', 'C', ['missing']), /does not exist/);
  assert.throws(() => shortestPath(fixture(), 'A', 'C', 'ab'), /iterable/);
});
test('unbounded closure ID iterables fail within the deterministic import bound', () => {
  function* forever() { while (true) yield 'ab'; }
  assert.throws(() => shortestPath(fixture(), 'A', 'C', forever()), /8000-entry/);
});

// Simulation boundary semantics and honest unreachable accounting.
test('baseline metrics derive from segments and arrival deadlines', () => {
  const result = simulate(fixture());
  assert.equal(result.metrics.distanceM, 200);
  assert.equal(result.metrics.completedJobs, 1);
  assert.equal(result.metrics.lateJobs, 0);
  assert.equal(result.metrics.totalDelayS, 0);
  assert.equal(result.vehicles[0].finishS, 23);
  assert.equal(result.vehicles[0].jobs[0].arrivalS, 20);
  assert.equal(result.vehicles[0].jobs[0].completedS, 23);
  assert.equal(result.durationS, 100);
});
test('closure at exact edge-entry cutoff prevents traversal and causes modeled delay', () => {
  const s = fixture(); s.closures = [closure(['bc'], 10)];
  const result = simulate(s);
  assert.deepEqual(result.vehicles[0].segments.map(s => s.edgeId), ['ab', 'bd', 'dc']);
  assert.equal(result.vehicles[0].jobs[0].arrivalS, 26);
  assert.equal(result.metrics.lateJobs, 1);
  assert.equal(result.metrics.totalDelayS, 4);
  assert.deepEqual(result.vehicles[0].reroutes, [{ atS: 10, nodeId: 'B', jobId: 'job-1', closedEdgeIds: ['bc'], reason: 'closure-blocked-route' }]);
});
test('vehicle already on a newly closed edge finishes its traversal', () => {
  const s = fixture(); s.closures = [closure(['ab'], 5), closure(['bc'], 15, 'later')];
  const result = simulate(s);
  assert.deepEqual(result.vehicles[0].segments.map(s => s.edgeId), ['ab', 'bc']);
  assert.equal(result.vehicles[0].jobs[0].arrivalS, 20);
  assert.equal(result.vehicles[0].reroutes.length, 0);
});
test('closure at time zero is applied before the first segment', () => {
  const s = fixture(); s.closures = [closure(['ab'], 0)];
  const result = simulate(s);
  assert.deepEqual(result.vehicles[0].segments.map(s => s.edgeId), ['ad', 'dc']);
  assert.equal(result.vehicles[0].reroutes[0].atS, 0);
});
test('cutoff passed during service applies before the next job', () => {
  const s = fixture(); s.jobs = [job('stop-1', 'B', 10, 10), job('stop-2', 'C', 40)]; s.closures = [closure(['bc'], 15)];
  const result = simulate(s);
  assert.deepEqual(result.vehicles[0].segments.map(s => [s.edgeId, s.startS]), [['ab', 0], ['bd', 20], ['dc', 28]]);
});
test('closures do not disturb a planned route that uses other roads', () => {
  const s = fixture(); s.closures = [closure(['dc'], 5)];
  const result = simulate(s);
  assert.equal(result.metrics.reroutes, 0);
  assert.equal(result.metrics.distanceM, 200);
});
test('unreachable job is skipped at current node; subsequent reachable job is still attempted', () => {
  const s = fixture(); s.edges = [edge('ab', 'A', 'B', 10), edge('bc', 'B', 'C', 10)];
  s.jobs = [job('east', 'C'), job('local', 'B')]; s.closures = [closure(['bc'], 0)];
  const result = simulate(s);
  assert.deepEqual(result.vehicles[0].jobs.map(j => j.status), ['unreachable', 'on-time']);
  assert.equal(result.vehicles[0].jobs[0].arrivalS, null);
  assert.equal(result.vehicles[0].jobs[0].completedS, null);
  assert.equal(result.vehicles[0].jobs[1].arrivalS, 10);
  assert.equal(result.metrics.unreachableJobs, 1);
  assert.equal(result.metrics.completedJobs, 1);
  assert.equal(result.metrics.lateJobs, 0);
  assert.equal(result.metrics.totalDelayS, 0);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(result)));
});
test('unreachable mid-trip job preserves traveled distance and current node', () => {
  const s = fixture(); s.edges = [edge('ab', 'A', 'B', 10), edge('bc', 'B', 'C', 10), edge('bd', 'B', 'D', 8)];
  s.jobs = [job('east', 'C'), job('local', 'D')]; s.closures = [closure(['bc'], 10)];
  const result = simulate(s);
  assert.deepEqual(result.vehicles[0].segments.map(s => s.edgeId), ['ab', 'bd']);
  assert.equal(result.vehicles[0].jobs[1].arrivalS, 18);
  assert.equal(result.metrics.distanceM, 180);
  assert.equal(result.vehicles[0].reroutes[0].reason, 'no-route');
});
test('unreachable in the original graph is explicit without inventing a closure reroute', () => {
  const s = fixture(); s.jobs = [job('job-1', 'A')]; s.vehicles[0].startNode = 'C';
  const result = simulate(s);
  assert.equal(result.metrics.unreachableJobs, 1);
  assert.equal(result.metrics.reroutes, 0);
  assert.equal(result.vehicles[0].finishS, 0);
});
test('arrival exactly at due time is on-time, even if service finishes later', () => {
  const s = fixture(); s.jobs = [job('job-1', 'C', 20, 30)];
  const result = simulate(s);
  assert.equal(result.vehicles[0].jobs[0].status, 'on-time');
  assert.equal(result.vehicles[0].finishS, 50);
});
test('IEEE-754 sum noise does not let a vehicle enter at a closed cutoff', () => {
  const s = fixture(); s.edges = [edge('ab', 'A', 'B', 0.1), edge('bd', 'B', 'D', 0.7), edge('dc', 'D', 'C', 1)];
  s.closures = [closure(['dc'], 0.8)];
  assert.equal(simulate(s).metrics.unreachableJobs, 1);
});
test('simulation horizon extends to completion instead of discarding work', () => {
  const s = fixture(); s.durationS = 1;
  assert.equal(simulate(s).durationS, 23);
});
test('vehicle start time is respected, including a cutoff before departure', () => {
  const s = fixture(); s.vehicles[0].startTimeS = 50; s.closures = [closure(['ab'], 20)];
  assert.equal(simulate(s).vehicles[0].segments[0].startS, 50);
  assert.equal(simulate(s).vehicles[0].segments[0].edgeId, 'ad');
});
test('zero jobs is a valid completed scenario', () => {
  const s = fixture(); s.jobs = [];
  const result = simulate(s);
  assert.equal(result.metrics.totalJobs, 0);
  assert.equal(result.metrics.distanceM, 0);
  assert.equal(result.vehicles[0].finishS, 0);
});
test('multiple closure records use earliest cutoff and are order independent', () => {
  const s = fixture(); s.closures = [closure(['bc'], 30), closure(['bc'], 10, 'earlier')];
  const one = simulate(s); s.closures.reverse();
  assert.deepEqual(simulate(s), one);
  assert.equal(one.vehicles[0].jobs[0].arrivalS, 26);
});
test('fixed job order is retained for each vehicle, with no hidden assignment optimization', () => {
  const s = fixture(); s.jobs = [job('second-by-name', 'B'), job('first-by-name', 'C')];
  assert.deepEqual(simulate(s).vehicles[0].jobs.map(j => j.id), ['second-by-name', 'first-by-name']);
});
test('simulation and closure overrides do not mutate input', () => {
  const s = fixture(); s.closures = [closure(['bc'], 10)]; const original = clone(s);
  simulate(s, { closures: [] }); simulate(s); shortestPath(s, 'A', 'C');
  assert.deepEqual(s, original);
});
test('deterministic simulation is independent of graph and vehicle input ordering', () => {
  const s = fixture(); s.vehicles.push({ id: 'van-2', startNode: 'B', startTimeS: 5 }); s.jobs.push(job('other', 'D', 100, 0, 'van-2'));
  const expected = simulate(s); s.edges.reverse(); s.nodes.reverse(); s.vehicles.reverse();
  assert.deepEqual(simulate(s), expected);
});

// Bounded schema validation treats import content as data, never executable markup.
test('validation returns independent clean objects with no input references', () => {
  const s = fixture(); const clean = validateScenario(s);
  assert.deepEqual(clean, s); clean.nodes[0].x = 900; clean.jobs[0].id = 'changed';
  assert.equal(s.nodes[0].x, 0); assert.equal(s.jobs[0].id, 'job-1');
});
test('version, unsigned seed, and strict keys are enforced', () => {
  for (const value of [0, 2, '1']) { const s = fixture(); s.version = value; assert.throws(() => validateScenario(s), /version/); }
  for (const seed of [-1, 0.5, 4294967296, NaN]) { const s = fixture(); s.seed = seed; assert.throws(() => validateScenario(s), /seed/); }
  const s = fixture(); s.unrecognized = 'data'; assert.throws(() => validateScenario(s), /unsupported/);
});
test('finite bounds prevent NaN, Infinity, zero, negative, and adversarial subnormal edge weights', () => {
  for (const key of ['distanceM', 'travelTimeS']) {
    for (const value of [NaN, Infinity, -1, 0, Number.MIN_VALUE, '10', null, 1000001]) {
      const s = fixture(); s.edges[0][key] = value; assert.throws(() => validateScenario(s), new RegExp(key));
    }
  }
  const s = fixture(); s.nodes[0].x = Infinity; assert.throws(() => validateScenario(s), /nodes\[0\].x/);
});
test('all duplicate entity IDs are rejected', () => {
  for (const name of ['nodes', 'edges', 'vehicles', 'jobs', 'closures']) {
    const s = fixture(); if (name === 'closures') s.closures = [closure(['ab'], 3)];
    s[name].push(clone(s[name][0])); assert.throws(() => validateScenario(s), /duplicate/);
  }
});
test('all foreign-key references are checked', () => {
  const cases = [s => s.edges[0].from = 'nope', s => s.edges[0].to = 'nope', s => s.vehicles[0].startNode = 'nope', s => s.jobs[0].nodeId = 'nope', s => s.jobs[0].vehicleId = 'nope', s => s.closures.push(closure(['nope'], 0))];
  for (const mutate of cases) { const s = fixture(); mutate(s); assert.throws(() => validateScenario(s), /unknown id/); }
});
test('closure ID lists reject duplicates and empty events', () => {
  for (const edges of [[], ['bc', 'bc']]) { const s = fixture(); s.closures = [closure(edges, 0)]; assert.throws(() => validateScenario(s), /edgeIds/); }
});
test('missing, inherited, and accessor properties are rejected without running getters', () => {
  const missing = fixture(); delete missing.seed; assert.throws(() => validateScenario(missing), /seed is required/);
  const inherited = Object.create(fixture()); assert.throws(() => validateScenario(inherited), /inherited/);
  const accessor = fixture(); let getterRan = false;
  Object.defineProperty(accessor.nodes[0], 'x', { enumerable: true, get() { getterRan = true; return 1; } });
  assert.throws(() => validateScenario(accessor), /accessor/); assert.equal(getterRan, false);
});
test('prototype pollution keys and unsafe identifiers are refused', () => {
  const json = JSON.stringify(fixture()).replace('"version":1', '"version":1,"__proto__":{"polluted":true}');
  assert.throws(() => parseScenario(json), /unsupported property __proto__/);
  for (const id of ['__proto__', 'constructor', 'prototype', '<script>', 'a b']) { const s = fixture(); s.id = id; assert.throws(() => validateScenario(s), /safe identifier/); }
  assert.equal({}.polluted, undefined);
});
test('null-prototype data records are copied safely', () => {
  const s = fixture(); s.nodes[0] = Object.assign(Object.create(null), s.nodes[0]);
  assert.equal(Object.getPrototypeOf(validateScenario(s).nodes[0]), Object.prototype);
});
test('sparse arrays and accessor array entries are rejected', () => {
  const sparse = fixture(); delete sparse.nodes[1]; assert.throws(() => validateScenario(sparse), /missing/);
  const accessor = fixture(); Object.defineProperty(accessor.nodes, '0', { get() { throw new Error('must not run'); } });
  assert.throws(() => validateScenario(accessor), /must not be an accessor/);
});
test('display text is preserved as inert data; identifiers remain restricted', () => {
  const s = fixture(); s.name = '<img src=x onerror=alert(1)>'; s.description = 'Text with <tags>, quotes, and & symbols';
  const clean = validateScenario(s); assert.equal(clean.name, s.name); assert.equal(clean.description, s.description);
});
test('text length and control-character bounds are applied', () => {
  for (const name of ['a'.repeat(121), 'bad\u0000text', '   ']) { const s = fixture(); s.name = name; assert.throws(() => validateScenario(s), /name/); }
});
test('declared collection limits are enforced before inspecting oversized arrays', () => {
  for (const name of ['nodes', 'edges', 'vehicles', 'jobs', 'closures']) {
    const s = fixture(); s[name] = new Array(LIMITS[name] + 1); assert.throws(() => validateScenario(s), new RegExp(name));
  }
});
test('2 MiB import bound includes UTF-8 multibyte characters and whitespace', () => {
  assert.throws(() => parseScenario(' '.repeat(LIMITS.maxBytes + 1)), /2 MiB/);
  assert.throws(() => parseScenario('é'.repeat(LIMITS.maxBytes / 2 + 1)), /2 MiB/);
  assert.throws(() => parseScenario('{ broken'), /valid JSON/);
  assert.throws(() => parseScenario({}), /JSON text/);
});
test('malicious deeply nested unsupported JSON is rejected without recursive traversal', () => {
  const json = JSON.stringify(fixture()).replace('"version":1', `"version":1,"extra":${'['.repeat(2000)}0${']'.repeat(2000)}`);
  assert.throws(() => parseScenario(json), /unsupported property extra/);
});
test('override closures pass the same validation as imported closures', () => {
  assert.throws(() => simulate(fixture(), { closures: [closure(['missing'], 1)] }), /unknown id/);
});

// Seeded model fixtures and repeatability across browser-compatible module boundaries.
test('demo network is stable, synthetic, and within limits with west-bank depots', () => {
  const s = createDemoScenario(42);
  assert.equal(s.nodes.length, 432); assert.equal(s.edges.length, 1614); assert.equal(s.vehicles.length, 24); assert.equal(s.jobs.length, 192);
  assert.deepEqual(s, createDemoScenario(42)); assert.notDeepEqual(s, createDemoScenario(43));
  const nodes = new Map(s.nodes.map(n => [n.id, n]));
  assert.ok(s.vehicles.every(v => nodes.get(v.startNode).x < 11.5));
  assert.equal(s.edges.filter(e => Math.abs(nodes.get(e.from).x - nodes.get(e.to).x) === 1 && Math.min(nodes.get(e.from).x, nodes.get(e.to).x) === 11).length, 6);
});
test('demo baseline and disrupted runs share jobs, with reproducible real metric deltas', () => {
  const s = createDemoScenario(42); const baseline = simulate(s, { closures: [] }); const disrupted = simulate(s);
  assert.equal(baseline.metrics.distanceM, 311800); assert.equal(baseline.metrics.lateJobs, 0);
  assert.equal(disrupted.metrics.distanceM, 377080); assert.equal(disrupted.metrics.lateJobs, 118); assert.equal(disrupted.metrics.totalDelayS, 20139);
  assert.deepEqual(disrupted, simulate(s));
  assert.deepEqual(baseline.vehicles.map(v => v.jobs.map(j => j.id)), disrupted.vehicles.map(v => v.jobs.map(j => j.id)));
  assert.equal(disrupted.metrics.completedJobs, 192); assert.equal(disrupted.metrics.unreachableJobs, 0);
  assert.equal(disrupted.metrics.distanceM, disrupted.vehicles.reduce((sum, v) => sum + v.segments.reduce((n, s) => n + s.distanceM, 0), 0));
});
test('all bridges closed at departure yields explicit unreachable east-bank jobs', () => {
  const s = createDemoScenario(); const preset = createPresets(s).find(p => p.id === 'all-bridges');
  const result = simulate(s, { closures: [closure(preset.edgeIds, 0)] });
  assert.equal(result.metrics.unreachableJobs, 120); assert.equal(result.metrics.completedJobs, 72);
  assert.equal(result.metrics.totalJobs, result.metrics.completedJobs + result.metrics.unreachableJobs);
});
test('presets only contain scenario edges and include a clear-road control', () => {
  const presets = createPresets(createDemoScenario());
  assert.deepEqual(presets, DEMO_PRESETS); assert.equal(presets[0].edgeIds.length, 2); assert.equal(presets[1].edgeIds.length, 6); assert.equal(presets[2].edgeIds.length, 0);
  assert.ok(createPresets(fixture()).every(p => p.edgeIds.length === 0));
});
test('demo seeds are checked, including valid 0 and maximum uint32', () => {
  for (const seed of [-1, 0.1, 4294967296, NaN]) assert.throws(() => createDemoScenario(seed), /seed/);
  assert.equal(createDemoScenario(0).seed, 0); assert.equal(createDemoScenario(4294967295).seed, 4294967295);
});
test('scenario JSON roundtrip preserves exact routing outputs', () => {
  const s = createDemoScenario(7); const imported = parseScenario(JSON.stringify(s));
  assert.deepEqual(imported, s); assert.deepEqual(simulate(imported), simulate(s));
});
test('checked-in example scenarios remain valid and deterministic', () => {
  for (const name of ['meridian-default.json', 'meridian-all-bridges.json', 'minimal-directed.json']) {
    const s = parseScenario(readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
    assert.deepEqual(simulate(s), simulate(s));
  }
});
test('engine runs unchanged in an isolated module worker', async () => {
  const moduleUrl = new URL('../src/engine.js', import.meta.url).href;
  const source = `import { parentPort, workerData } from 'node:worker_threads'; import { simulate } from ${JSON.stringify(moduleUrl)}; parentPort.postMessage(simulate(workerData));`;
  const result = await new Promise((resolve, reject) => {
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`), { workerData: fixture() });
    worker.once('message', resolve); worker.once('error', reject);
  });
  assert.deepEqual(result, simulate(fixture()));
});
test('operation budgets are explicit and immutable', () => {
  assert.equal(ENGINE_LIMITS.routingEdgeVisits, 20000000);
  assert.equal(ENGINE_LIMITS.segments, 250000);
  assert.equal(Object.isFrozen(ENGINE_LIMITS), true);
});

test('array subclass and altered prototype cannot override validation iteration', () => {
  const s = fixture(); let ran = false;
  Object.setPrototypeOf(s.nodes, { map() { ran = true; throw new Error('must not execute'); } });
  assert.throws(() => validateScenario(s), /plain array/); assert.equal(ran, false);
});
test('randomized shortest paths match an independent Bellman-Ford time oracle', () => {
  let state = 12345;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  for (let trial = 0; trial < 40; trial += 1) {
    const s = fixture(); s.nodes = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, x: i, y: 0 })); s.edges = [];
    s.vehicles[0].startNode = 'n0'; s.jobs = [job('job', 'n7')];
    for (let from = 0; from < 8; from += 1) for (let to = 0; to < 8; to += 1) {
      if (from !== to && random() < 0.27) s.edges.push(edge(`e${from}-${to}`, `n${from}`, `n${to}`, 1 + Math.floor(random() * 12)));
    }
    const closed = new Set(s.edges.filter(() => random() < 0.15).map(e => e.id));
    const costs = new Map(s.nodes.map(n => [n.id, n.id === 'n0' ? 0 : Infinity]));
    for (let iteration = 0; iteration < s.nodes.length - 1; iteration += 1) {
      for (const e of s.edges) if (!closed.has(e.id)) costs.set(e.to, Math.min(costs.get(e.to), costs.get(e.from) + e.travelTimeS));
    }
    const path = shortestPath(s, 'n0', 'n7', closed);
    assert.equal(path?.travelTimeS ?? Infinity, costs.get('n7'));
    if (path) {
      assert.equal(path.nodeIds[0], 'n0'); assert.equal(path.nodeIds.at(-1), 'n7');
      assert.equal(new Set(path.nodeIds).size, path.nodeIds.length);
      assert.ok(path.edgeIds.every(id => !closed.has(id)));
    }
  }
});
test('all emitted segments obey the active-closure entry rule across multiple seeded fixtures', () => {
  for (const seed of [0, 1, 7, 99]) {
    const s = createDemoScenario(seed);
    s.closures.push(closure(['bridge-north-east', 'bridge-north-west'], 650, 'second-closure'));
    const result = simulate(s);
    const earliest = new Map();
    for (const c of s.closures) for (const id of c.edgeIds) earliest.set(id, Math.min(earliest.get(id) ?? Infinity, c.atS));
    for (const vehicle of result.vehicles) for (const segment of vehicle.segments) {
      assert.ok(segment.startS < (earliest.get(segment.edgeId) ?? Infinity));
      assert.ok(segment.endS > segment.startS);
    }
    assert.equal(result.metrics.totalJobs, result.metrics.completedJobs + result.metrics.unreachableJobs);
    assert.equal(result.metrics.completedJobs, result.metrics.onTimeJobs + result.metrics.lateJobs);
  }
});
test('pathological valid workload terminates with a budget error rather than partial metrics', () => {
  const s = fixture();
  s.nodes = Array.from({ length: 600 }, (_, i) => ({ id: `n${i}`, x: i, y: 0 }));
  s.edges = [];
  for (let i = 0; i < 599; i += 1) {
    s.edges.push(edge(`out-${i}`, `n${i}`, `n${i + 1}`, 0.1, 0.01));
    s.edges.push(edge(`back-${i}`, `n${i + 1}`, `n${i}`, 0.1, 0.01));
  }
  s.vehicles[0].startNode = 'n0';
  s.jobs = Array.from({ length: 450 }, (_, i) => job(`job-${i}`, i % 2 === 0 ? 'n599' : 'n0'));
  assert.throws(() => simulate(s), /segments work limit/);
});
