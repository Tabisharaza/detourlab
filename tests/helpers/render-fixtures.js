import { createDemoScenario, validateScenario } from '../../src/scenario.js';
import { simulate } from '../../src/engine.js';

// Original synthetic fixtures for deterministic renderer operation counts.
// They are not road datasets or browser-performance benchmarks.
export function renderFixtures() {
  const nodes = [], edges = [], vehicles = [], jobs = [];
  const id = (x, y) => `grid-${x}-${y}`;
  const addPair = (from, to) => {
    for (const [a, b] of [[from, to], [to, from]]) edges.push({ id: `${a}-to-${b}`, from: a, to: b, distanceM: 100, travelTimeS: 10, roadName: 'Synthetic grid street' });
  };
  for (let y = 0; y < 40; y += 1) for (let x = 0; x < 40; x += 1) {
    nodes.push({ id: id(x, y), x, y });
    if (x < 39) addPair(id(x, y), id(x + 1, y));
    if (y < 39) addPair(id(x, y), id(x, y + 1));
  }
  for (let v = 0; v < 48; v += 1) {
    const vehicleId = `grid-van-${v}`;
    vehicles.push({ id: vehicleId, startNode: id(v % 40, Math.floor(v / 40)), startTimeS: v });
    for (let j = 0; j < 8; j += 1) jobs.push({ id: `grid-job-${v}-${j}`, vehicleId, nodeId: id((v * 7 + j * 11) % 40, (v * 13 + j * 3) % 40), dueTimeS: 1000 + j * 800, serviceTimeS: 15 });
  }
  return [createDemoScenario(42), validateScenario({ version: 1, id: 'render-grid-40x40', name: 'Synthetic 40 by 40 render fixture', seed: 42, description: 'Bounded deterministic rendering fixture; fictional geometry and deliveries.', nodes, edges, vehicles, jobs, closures: [{ id: 'grid-closure', edgeIds: [edges[0].id], atS: 300 }], durationS: 7200 })];
}

export function renderState(scenario) {
  return { scenario, baseline: simulate(scenario, { closures: [] }), disrupted: simulate(scenario), time: 360, selectedVehicle: scenario.vehicles[0].id, view: 'compare', zoom: 1, playing: false };
}
