/** Scenario schema, bounded import, and original synthetic demonstration fixtures. */

export const LIMITS = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  nodes: 2000,
  edges: 8000,
  vehicles: 100,
  jobs: 2000,
  closures: 8000,
  maxTimeS: 604800,
  maxDistanceM: 1000000,
});

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

/** Check a JSON-like record without trusting inherited properties or running getters. */
function record(value, keys, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`${path} must be a plain object; inherited data is not allowed.`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || DANGEROUS_KEYS.has(key) || !keys.includes(key)) {
      throw new Error(`${path} contains unsupported property ${String(key)}.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !hasOwn(descriptor, 'value')) {
      throw new Error(`${path}.${key} must be a data property, not an accessor.`);
    }
  }
  for (const key of keys) {
    if (!hasOwn(value, key)) throw new Error(`${path}.${key} is required.`);
  }
  return value;
}

function string(value, path, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`${path} must be a nonempty string of at most ${max} characters.`);
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value)) {
    throw new Error(`${path} contains unsupported control characters.`);
  }
  return value;
}

function identifier(value, path) {
  string(value, path, 96);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(value) || DANGEROUS_KEYS.has(value)) {
    throw new Error(`${path} must be a safe identifier using letters, numbers, ., :, _, or -.`);
  }
  return value;
}

function number(value, path, min = 0, max = LIMITS.maxTimeS, positive = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (positive && value <= 0)) {
    throw new Error(`${path} must be a finite number from ${min} to ${max}${positive ? ', greater than zero' : ''}.`);
  }
  return value;
}

function array(value, path, max, nonempty = false) {
  if (!Array.isArray(value) || value.length > max || (nonempty && value.length === 0)) {
    throw new Error(`${path} must be an array with ${nonempty ? '1' : '0'}–${max} entries.`);
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new Error(`${path} must be a plain array; inherited overrides are not allowed.`);
  }
  // Reject sparse arrays and custom/accessor properties before reading their items.
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length) {
      throw new Error(`${path} contains unsupported array property ${String(key)}.`);
    }
    if (!hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) {
      throw new Error(`${path}[${key}] must not be an accessor.`);
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!hasOwn(value, index)) throw new Error(`${path}[${index}] is missing.`);
  }
  return value;
}

function unique(items, path) {
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`${path} contains duplicate id "${item.id}".`);
    ids.add(item.id);
  }
  return ids;
}

function reference(value, ids, path) {
  identifier(value, path);
  if (!ids.has(value)) throw new Error(`${path} references unknown id "${value}".`);
  return value;
}

/**
 * Validate and copy a version-1 scenario into independent, plain JSON objects.
 * Unknown properties, invalid references, accessors, and inherited fields are rejected.
 * Job array order is its assigned vehicle's fixed service sequence.
 * @param {unknown} input
 * @returns {import('./engine.js').Scenario}
 */
export function validateScenario(input) {
  const source = record(input, ['version', 'id', 'name', 'seed', 'description', 'nodes', 'edges', 'vehicles', 'jobs', 'closures', 'durationS'], 'scenario');
  if (source.version !== 1) throw new Error('scenario.version must be 1.');
  const id = identifier(source.id, 'scenario.id');
  const name = string(source.name, 'scenario.name');
  const seed = number(source.seed, 'scenario.seed', 0, 4294967295);
  if (!Number.isInteger(seed)) throw new Error('scenario.seed must be an unsigned 32-bit integer.');
  const description = string(source.description, 'scenario.description', 4000);
  const durationS = number(source.durationS, 'scenario.durationS', 0, LIMITS.maxTimeS, true);
  const nodes = array(source.nodes, 'scenario.nodes', LIMITS.nodes, true).map((item, i) => {
    const path = `scenario.nodes[${i}]`;
    record(item, ['id', 'x', 'y'], path);
    return { id: identifier(item.id, `${path}.id`), x: number(item.x, `${path}.x`, -1000000, 1000000), y: number(item.y, `${path}.y`, -1000000, 1000000) };
  });
  const nodeIds = unique(nodes, 'scenario.nodes');
  const edges = array(source.edges, 'scenario.edges', LIMITS.edges).map((item, i) => {
    const path = `scenario.edges[${i}]`;
    record(item, ['id', 'from', 'to', 'distanceM', 'travelTimeS', 'roadName'], path);
    return {
      id: identifier(item.id, `${path}.id`),
      from: reference(item.from, nodeIds, `${path}.from`),
      to: reference(item.to, nodeIds, `${path}.to`),
      distanceM: number(item.distanceM, `${path}.distanceM`, 0.01, LIMITS.maxDistanceM, true),
      travelTimeS: number(item.travelTimeS, `${path}.travelTimeS`, 0.1, 86400, true),
      roadName: string(item.roadName, `${path}.roadName`),
    };
  });
  const edgeIds = unique(edges, 'scenario.edges');
  const vehicles = array(source.vehicles, 'scenario.vehicles', LIMITS.vehicles, true).map((item, i) => {
    const path = `scenario.vehicles[${i}]`;
    record(item, ['id', 'startNode', 'startTimeS'], path);
    return { id: identifier(item.id, `${path}.id`), startNode: reference(item.startNode, nodeIds, `${path}.startNode`), startTimeS: number(item.startTimeS, `${path}.startTimeS`) };
  });
  const vehicleIds = unique(vehicles, 'scenario.vehicles');
  const jobs = array(source.jobs, 'scenario.jobs', LIMITS.jobs).map((item, i) => {
    const path = `scenario.jobs[${i}]`;
    record(item, ['id', 'nodeId', 'vehicleId', 'dueTimeS', 'serviceTimeS'], path);
    return {
      id: identifier(item.id, `${path}.id`),
      nodeId: reference(item.nodeId, nodeIds, `${path}.nodeId`),
      vehicleId: reference(item.vehicleId, vehicleIds, `${path}.vehicleId`),
      dueTimeS: number(item.dueTimeS, `${path}.dueTimeS`),
      serviceTimeS: number(item.serviceTimeS, `${path}.serviceTimeS`, 0, 86400),
    };
  });
  unique(jobs, 'scenario.jobs');
  const closures = array(source.closures, 'scenario.closures', LIMITS.closures).map((item, i) => {
    const path = `scenario.closures[${i}]`;
    record(item, ['id', 'edgeIds', 'atS'], path);
    const affected = array(item.edgeIds, `${path}.edgeIds`, LIMITS.edges, true).map((edge, j) => reference(edge, edgeIds, `${path}.edgeIds[${j}]`));
    if (new Set(affected).size !== affected.length) throw new Error(`${path}.edgeIds contains duplicate edge ids.`);
    return { id: identifier(item.id, `${path}.id`), edgeIds: affected, atS: number(item.atS, `${path}.atS`) };
  });
  unique(closures, 'scenario.closures');
  const sanitized = { version: 1, id, name, seed, description, nodes, edges, vehicles, jobs, closures, durationS };
  if (new TextEncoder().encode(JSON.stringify(sanitized)).byteLength > LIMITS.maxBytes) {
    throw new Error('Scenario data exceeds the 2 MiB limit.');
  }
  return sanitized;
}

/** Parse a UTF-8 JSON import, checking size before parsing. */
export function parseScenario(text) {
  if (typeof text !== 'string') throw new Error('Scenario import must be JSON text.');
  if (text.length > LIMITS.maxBytes || new TextEncoder().encode(text).byteLength > LIMITS.maxBytes) {
    throw new Error('Scenario import exceeds the 2 MiB limit.');
  }
  let input;
  try { input = JSON.parse(text); } catch { throw new Error('Scenario import is not valid JSON.'); }
  return validateScenario(input);
}

const BRIDGES = [
  { id: 'north', row: 3, name: 'Foundry Bridge' },
  { id: 'central', row: 9, name: 'Market Bridge' },
  { id: 'south', row: 15, name: 'Harbor Bridge' },
];

/** Stable presets refer only to roads included in the supplied scenario. */
export function createPresets(scenario) {
  const ids = new Set(scenario.edges.map(edge => edge.id));
  const central = ['bridge-central-east', 'bridge-central-west'].filter(id => ids.has(id));
  const all = BRIDGES.flatMap(bridge => [`bridge-${bridge.id}-east`, `bridge-${bridge.id}-west`]).filter(id => ids.has(id));
  return [
    { id: 'central', name: 'Market Bridge', description: 'Close the central river crossing in both directions.', edgeIds: central },
    { id: 'all-bridges', name: 'All river crossings', description: 'Close all three bridges; east-bank stops become unreachable.', edgeIds: all },
    { id: 'clear', name: 'Clear roads', description: 'Keep the network open as a control run.', edgeIds: [] },
  ];
}

export const DEMO_PRESETS = Object.freeze(createPresets({ edges: BRIDGES.flatMap(bridge => ['east', 'west'].map(direction => ({ id: `bridge-${bridge.id}-${direction}` }))) }).map(preset => Object.freeze({ ...preset, edgeIds: Object.freeze(preset.edgeIds) })));

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Small fixture-only Dijkstra; sets due times from actual open-network travel. */
function fixtureTravelTime(adjacency, from, to) {
  const distances = new Map([[from, 0]]);
  const pending = new Set([from]);
  while (pending.size) {
    let current = null;
    for (const candidate of pending) {
      if (current === null || distances.get(candidate) < distances.get(current)) current = candidate;
    }
    pending.delete(current);
    if (current === to) return distances.get(current);
    for (const edge of adjacency.get(current)) {
      const distance = distances.get(current) + edge.travelTimeS;
      if (distance < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, distance);
        pending.add(edge.to);
      }
    }
  }
  throw new Error('Internal demo fixture is disconnected.');
}

/**
 * Original synthetic district, not a real road map. All depots are west of the river.
 * Seed controls travel times, stop locations, and deadline slack. No random source
 * outside this seeded generator participates in fixture construction or simulation.
 * @param {number} [seed=42]
 * @returns {import('./engine.js').Scenario}
 */
export function createDemoScenario(seed = 42) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('Demo seed must be an unsigned 32-bit integer.');
  const random = randomGenerator(seed);
  const integer = (min, max) => min + Math.floor(random() * (max - min + 1));
  const node = (x, y) => `node-${x}-${y}`;
  const nodes = [];
  const edges = [];
  const vehicles = [];
  const jobs = [];
  const adjacency = new Map();
  for (let y = 0; y < 18; y += 1) {
    for (let x = 0; x < 24; x += 1) {
      const id = node(x, y);
      nodes.push({ id, x, y });
      adjacency.set(id, []);
    }
  }
  const add = (id, from, to, distanceM, travelTimeS, roadName) => {
    const edge = { id, from, to, distanceM, travelTimeS, roadName };
    edges.push(edge);
    adjacency.get(from).push(edge);
  };
  for (let y = 0; y < 18; y += 1) {
    for (let x = 0; x < 24; x += 1) {
      if (x < 23) {
        const bridge = x === 11 ? BRIDGES.find(item => item.row === y) : null;
        if (x !== 11 || bridge) {
          const distanceM = bridge ? 280 : 140;
          const base = bridge ? (bridge.id === 'central' ? 22 : 32) : (y % 6 === 3 ? 11 : 15);
          const road = bridge ? bridge.name : `${['Ash', 'Willow', 'Mercer', 'Foundry', 'Pine', 'Maple', 'Cedar', 'Briar', 'Union', 'Market', 'Pearl', 'Juniper', 'Grove', 'Quay', 'Elm', 'Harbor', 'Alder', 'Dock'][y]} Street`;
          add(bridge ? `bridge-${bridge.id}-east` : `edge-${x}-${y}-east`, node(x, y), node(x + 1, y), distanceM, base + integer(0, 3), road);
          add(bridge ? `bridge-${bridge.id}-west` : `edge-${x + 1}-${y}-west`, node(x + 1, y), node(x, y), distanceM, base + integer(0, 3), road);
        }
      }
      if (y < 17) {
        const road = `${x + 1}${x === 0 || x === 20 ? 'st' : x === 1 || x === 21 ? 'nd' : x === 2 || x === 22 ? 'rd' : 'th'} Avenue`;
        add(`edge-${x}-${y}-south`, node(x, y), node(x, y + 1), 120, 13 + integer(0, 3), road);
        add(`edge-${x}-${y + 1}-north`, node(x, y + 1), node(x, y), 120, 13 + integer(0, 3), road);
      }
    }
  }
  for (let index = 0; index < 24; index += 1) {
    const id = `van-${String(index + 1).padStart(2, '0')}`;
    const startNode = node(3 + index % 3, 7 + index % 5);
    const startTimeS = index * 5;
    vehicles.push({ id, startNode, startTimeS });
    let previous = startNode;
    let completion = startTimeS;
    for (let stop = 0; stop < 8; stop += 1) {
      // Alternating bank visits expose the bridge closure throughout the workday.
      const west = stop === 0 || stop === 3 || stop === 6;
      const x = west ? integer(6, 10) : integer(stop === 2 || stop === 5 ? 18 : 13, 22);
      const y = integer(5, 13);
      const nodeId = node(x, y);
      const serviceTimeS = integer(18, 32);
      const arrival = completion + fixtureTravelTime(adjacency, previous, nodeId);
      const dueTimeS = arrival + integer(35, 65);
      jobs.push({ id: `job-${String(index + 1).padStart(2, '0')}-${stop + 1}`, nodeId, vehicleId: id, dueTimeS, serviceTimeS });
      completion = arrival + serviceTimeS;
      previous = nodeId;
    }
  }
  return validateScenario({
    version: 1, id: `meridian-seed-${seed}`, name: 'Meridian District', seed,
    description: 'An original synthetic 24 × 18 district. Twenty-four vans serve fixed stop sequences across a river with three bridges. Market Bridge closes at 05:00. Distances and travel times are modeled, not live traffic.',
    nodes, edges, vehicles, jobs,
    closures: [{ id: 'market-bridge-closure', edgeIds: ['bridge-central-east', 'bridge-central-west'], atS: 300 }],
    durationS: 2400,
  });
}
