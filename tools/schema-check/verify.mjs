import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import Ajv from 'ajv';
import { LIMITS, parseScenario } from '../../src/scenario.js';
import { EXPERIMENT_LIMITS, parseExperiment, experimentFromScenario } from '../../src/experiment.js';

const root = new URL('../../', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
const scenarioSchema = read('schemas/scenario-v1.schema.json');
const experimentSchema = read('schemas/experiment-v1.schema.json');
const ajv = new Ajv({ strict: true, allErrors: false, ownProperties: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
ajv.addSchema(scenarioSchema);
ajv.addSchema(experimentSchema);
const validators = { scenario: ajv.getSchema(scenarioSchema.$id), experiment: ajv.getSchema(experimentSchema.$id) };
const parsers = { scenario: parseScenario, experiment: parseExperiment };
const fresh = kind => kind === 'scenario' ? read('examples/minimal-directed.json') : read('examples/minimal-experiment.json');
const set = (object, path, value) => { const keys = path.split('.'), key = keys.pop(); let target = object; for (const part of keys) target = target[part]; target[key] = value; };
const get = (object, path) => path.split('.').reduce((value, key) => value[key], object);
function verdict(kind, input, expectedSchema, expectedRuntime = expectedSchema) {
  const text = JSON.stringify(input), data = JSON.parse(text), before = JSON.stringify(data);
  const actual = validators[kind](data);
  assert.equal(actual, expectedSchema, JSON.stringify(validators[kind].errors));
  assert.equal(JSON.stringify(data), before, 'schema validation must not mutate data');
  if (expectedRuntime) assert.doesNotThrow(() => parsers[kind](text));
  else assert.throws(() => parsers[kind](text));
}

test('both original Draft-07 schemas compile strictly with local references and validate against the meta-schema', () => {
  for (const schema of [scenarioSchema, experimentSchema]) {
    assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
    assert.equal(ajv.validateSchema(schema), true);
    assert.equal(typeof ajv.getSchema(schema.$id), 'function');
  }
  assert.equal(ajv.opts.coerceTypes, false); assert.equal(ajv.opts.useDefaults, false); assert.equal(ajv.opts.removeAdditional, false);
  assert.equal(ajv.opts.loadSchema, undefined, 'the verifier never fetches remote schemas');
});

test('schema collection and label constants stay aligned with exported runtime limits', () => {
  for (const field of ['nodes', 'edges', 'vehicles', 'jobs']) assert.equal(scenarioSchema.properties[field].maxItems, LIMITS[field]);
  assert.equal(scenarioSchema.definitions.closureList.maxItems, LIMITS.closures);
  assert.equal(scenarioSchema.definitions.closure.properties.edgeIds.maxItems, LIMITS.edges);
  assert.equal(scenarioSchema.definitions.timestamp.maximum, LIMITS.maxTimeS);
  assert.equal(scenarioSchema.definitions.edge.properties.distanceM.maximum, LIMITS.maxDistanceM);
  assert.equal(scenarioSchema.definitions.identifier.maxLength, EXPERIMENT_LIMITS.idLength);
  assert.equal(scenarioSchema.definitions.label.maxLength, EXPERIMENT_LIMITS.nameLength);
  assert.equal(experimentSchema.properties.variants.minItems, EXPERIMENT_LIMITS.minVariants);
  assert.equal(experimentSchema.properties.variants.maxItems, EXPERIMENT_LIMITS.maxVariants);
});

test('safe root identifiers accept punctuation and exact 96-character limit in both formats', () => {
  for (const kind of ['scenario', 'experiment']) for (const value of ['A', '0.A:a-b_c', 'a'.repeat(EXPERIMENT_LIMITS.idLength)]) { const input = fresh(kind); input.id = value; verdict(kind, input, true); }
});

test('experiment variant closure lists reject wrong types and per-variant overflow', () => {
  for (const value of [null, {}, 'closures', Array(LIMITS.closures + 1).fill({ id: 'c', edgeIds: ['ab'], atS: 0 })]) {
    const input = fresh('experiment'); input.variants[0].closures = value; verdict('experiment', input, false);
  }
});

for (const name of readdirSync(new URL('examples/', root)).filter(name => name.endsWith('.json')).sort()) {
  test(`fixture ${name} passes its schema and authoritative runtime without changes`, () => {
    const input = read(`examples/${name}`), kind = input.format ? 'experiment' : 'scenario';
    verdict(kind, input, true);
    if (kind === 'scenario') verdict('experiment', experimentFromScenario(input), true);
  });
}

const scenarioRecords = ['', 'nodes.0', 'edges.0', 'vehicles.0', 'jobs.0', 'closures.0'];
const experimentRecords = ['', 'baseScenario', 'baseScenario.nodes.0', 'baseScenario.edges.0', 'baseScenario.vehicles.0', 'baseScenario.jobs.0', 'variants.0', 'variants.1.closures.0'];
for (const kind of ['scenario', 'experiment']) {
  for (const path of kind === 'scenario' ? scenarioRecords : experimentRecords) {
    test(`${kind} rejects missing, extra and incorrectly typed records at ${path || 'root'}`, () => {
      const sample = fresh(kind), record = path ? get(sample, path) : sample;
      for (const key of Object.keys(record)) {
        const input = fresh(kind), item = path ? get(input, path) : input; delete item[key]; verdict(kind, input, false);
      }
      for (const key of ['extra', '$schema', '__proto__', 'constructor']) {
        const input = fresh(kind), item = path ? get(input, path) : input;
        Object.defineProperty(item, key, { value: 1, enumerable: true, configurable: true }); verdict(kind, input, false);
      }
      for (const value of [null, [], 1, true, 'object']) {
        const input = fresh(kind); if (path) { set(input, path, value); verdict(kind, input, false); } else verdict(kind, value, false);
      }
    });
  }
}

const numbers = [
  ['seed', 0, 4294967295, true], ['durationS', Number.MIN_VALUE, LIMITS.maxTimeS],
  ['nodes.0.x', -1000000, 1000000], ['nodes.0.y', -1000000, 1000000],
  ['edges.0.distanceM', 0.01, LIMITS.maxDistanceM], ['edges.0.travelTimeS', 0.1, 86400],
  ['vehicles.0.startTimeS', 0, LIMITS.maxTimeS], ['jobs.0.dueTimeS', 0, LIMITS.maxTimeS], ['jobs.0.serviceTimeS', 0, 86400],
  ['closures.0.atS', 0, LIMITS.maxTimeS],
];
for (const [path, min, max, integer] of numbers) {
  test(`scenario numeric bounds and types match runtime at ${path}`, () => {
    for (const value of [min, max, ...(integer ? [] : [Math.max(min, 0.125)])]) { const input = fresh('scenario'); set(input, path, value); verdict('scenario', input, true); }
    for (const value of [min - 1, max + 1, '1', null, true, ...(integer ? [0.5] : [])]) { const input = fresh('scenario'); set(input, path, value); verdict('scenario', input, false); }
  });
}
test('experiment closure cutoff has the same numeric boundary and no coercion', () => {
  for (const value of [0, 0.125, LIMITS.maxTimeS]) { const input = fresh('experiment'); input.variants[1].closures[0].atS = value; verdict('experiment', input, true); }
  for (const value of [-1, LIMITS.maxTimeS + 1, '10', null, true]) { const input = fresh('experiment'); input.variants[1].closures[0].atS = value; verdict('experiment', input, false); }
});
test('format and version are exact, including nested scenario version', () => {
  for (const kind of ['scenario', 'experiment']) for (const value of [0, 2, '1', null, true]) { const input = fresh(kind); input.version = value; verdict(kind, input, false); }
  for (const value of ['', 'scenario', 1, null]) { const input = fresh('experiment'); input.format = value; verdict('experiment', input, false); }
  const input = fresh('experiment'); input.baseScenario.version = 2; verdict('experiment', input, false);
});

for (const [kind, path] of [['scenario', 'id'], ['scenario', 'nodes.0.id'], ['scenario', 'edges.0.id'], ['scenario', 'edges.0.from'], ['scenario', 'edges.0.to'], ['scenario', 'vehicles.0.id'], ['scenario', 'vehicles.0.startNode'], ['scenario', 'jobs.0.id'], ['scenario', 'jobs.0.nodeId'], ['scenario', 'jobs.0.vehicleId'], ['scenario', 'closures.0.id'], ['scenario', 'closures.0.edgeIds.0'], ['experiment', 'id'], ['experiment', 'variants.0.id'], ['experiment', 'variants.1.closures.0.id'], ['experiment', 'variants.1.closures.0.edgeIds.0']]) {
  test(`${kind} identifier syntax and reserved values at ${path}`, () => {
    for (const value of ['', ' space', '-leading', 'pipe|id', 'é', '__proto__', 'prototype', 'constructor', 'a'.repeat(97), 1, null]) { const input = fresh(kind); set(input, path, value); verdict(kind, input, false); }
  });
}
const labelPaths = [['scenario', 'name', 120], ['scenario', 'description', 4000], ['scenario', 'edges.0.roadName', 120], ['experiment', 'name', 120], ['experiment', 'variants.0.name', 120]];
for (const [kind, path, max] of labelPaths) {
  test(`${kind} labels preserve valid Unicode and match structural bounds at ${path}`, () => {
    for (const value of ['x', 'a'.repeat(max), '🚚'.repeat(max / 2), 'A\tB\nC\rD', 'É 東京 مرحبا �', '<b>inert data</b>', 'x\u009b\u202e']) { const input = fresh(kind); set(input, path, value); verdict(kind, input, true); }
    for (const value of ['', ' \t\n\r\ufeff\u00a0\u2003', 'a'.repeat(max + 1), 1, null, true, ...Array.from({ length: 32 }, (_, code) => code).filter(code => ![9, 10, 13].includes(code)).map(code => `x${String.fromCharCode(code)}y`)]) { const input = fresh(kind); set(input, path, value); verdict(kind, input, false); }
  });
  test(`${kind} documents Unicode code-point versus UTF-16 runtime-only length at ${path}`, () => {
    const input = fresh(kind); set(input, path, '🚚'.repeat(max / 2 + 1)); verdict(kind, input, true, false);
  });
}

for (const [path, max, minimum] of [['nodes', LIMITS.nodes, 1], ['edges', LIMITS.edges, 0], ['vehicles', LIMITS.vehicles, 1], ['jobs', LIMITS.jobs, 0], ['closures', LIMITS.closures, 0]]) {
  test(`scenario ${path} collection limits reject oversized and wrong types`, () => {
    for (const value of [null, {}, 'array', Array(max + 1).fill(fresh('scenario')[path][0])]) { const input = fresh('scenario'); input[path] = value; verdict('scenario', input, false); }
    if (minimum) { const input = fresh('scenario'); input[path] = []; verdict('scenario', input, false); }
  });
}
test('minimal empty work is valid, but required nodes and vehicles remain present', () => {
  const input = fresh('scenario'); input.edges = []; input.jobs = []; input.closures = []; verdict('scenario', input, true);
  verdict('experiment', experimentFromScenario(input), true);
});
test('exact maximum node, edge, vehicle, job and closure counts remain accepted', () => {
  for (const [field, max] of [['nodes', LIMITS.nodes], ['edges', LIMITS.edges], ['vehicles', LIMITS.vehicles], ['jobs', LIMITS.jobs], ['closures', LIMITS.closures]]) {
    const input = fresh('scenario'), original = input[field];
    input[field] = [...original, ...Array.from({ length: max - original.length }, (_, index) => ({ ...original[0], id: `extra-${index}` }))];
    verdict('scenario', input, true);
  }
});
test('experiment variant counts and empty base closures are enforced', () => {
  for (const count of [EXPERIMENT_LIMITS.minVariants, EXPERIMENT_LIMITS.maxVariants]) { const input = fresh('experiment'); input.variants = Array.from({ length: count }, (_, i) => ({ id: `v${i}`, name: `Variant ${i}`, closures: [] })); verdict('experiment', input, true); }
  for (const count of [0, 1, 7]) { const input = fresh('experiment'); input.variants = Array.from({ length: count }, (_, i) => ({ id: `v${i}`, name: `Variant ${i}`, closures: [] })); verdict('experiment', input, false); }
  const input = fresh('experiment'); input.baseScenario.closures = fresh('scenario').closures; verdict('experiment', input, false);
});
test('closure edge ID arrays reject empty, duplicate, oversized and wrong-type values in both formats', () => {
  for (const kind of ['scenario', 'experiment']) for (const value of [[], ['ab', 'ab'], Array(LIMITS.edges + 1).fill('ab'), null, {}, ['ab', 1]]) { const input = fresh(kind); set(input, kind === 'scenario' ? 'closures.0.edgeIds' : 'variants.1.closures.0.edgeIds', value); verdict(kind, input, false); }
});

for (const [kind, path] of [['scenario', 'edges.0.from'], ['scenario', 'edges.0.to'], ['scenario', 'vehicles.0.startNode'], ['scenario', 'jobs.0.nodeId'], ['scenario', 'jobs.0.vehicleId'], ['scenario', 'closures.0.edgeIds.0'], ['experiment', 'variants.1.closures.0.edgeIds.0']]) {
  test(`${kind} foreign reference at ${path} remains runtime-authoritative`, () => { const input = fresh(kind); set(input, path, 'missing-id'); verdict(kind, input, true, false); });
}
for (const field of ['nodes', 'edges', 'vehicles', 'jobs', 'closures']) {
  test(`duplicate ${field} IDs with different records remain runtime-authoritative`, () => {
    const input = fresh('scenario'), item = structuredClone(input[field][0]);
    if (field === 'nodes') item.x += 1; else if (field === 'edges') item.distanceM += 1; else if (field === 'vehicles') item.startTimeS += 1; else if (field === 'jobs') item.dueTimeS += 1; else item.atS += 1;
    input[field].push(item); verdict('scenario', input, true, false);
  });
}
test('duplicate variant and per-variant closure IDs remain runtime-authoritative', () => {
  const variants = fresh('experiment'); variants.variants[1].id = variants.variants[0].id; verdict('experiment', variants, true, false);
  const events = fresh('experiment'); events.variants[1].closures.push({ ...events.variants[1].closures[0], atS: 11 }); verdict('experiment', events, true, false);
});
test('aggregate closure record budget remains runtime-authoritative', () => {
  const input = fresh('experiment'); input.variants = input.variants.slice(0, 2);
  input.variants.forEach(variant => { variant.closures = Array.from({ length: 4001 }, (_, i) => ({ id: `c${i}`, edgeIds: ['ab'], atS: 0 })); });
  verdict('experiment', input, true, false);
  input.variants.forEach(variant => variant.closures.pop()); verdict('experiment', input, true);
});
test('aggregate closure reference budget remains runtime-authoritative', () => {
  const input = fresh('experiment'); input.baseScenario.edges = Array.from({ length: LIMITS.edges }, (_, i) => ({ ...input.baseScenario.edges[0], id: `e${i}` }));
  input.variants = Array.from({ length: 6 }, (_, i) => ({ id: `v${i}`, name: `Plan ${i}`, closures: [{ id: 'closure', edgeIds: input.baseScenario.edges.map(edge => edge.id), atS: 0 }] }));
  verdict('experiment', input, true);
  input.variants[0].closures.push({ id: 'extra', edgeIds: ['e0'], atS: 1 }); verdict('experiment', input, true, false);
});
test('UTF-8 file size and byte decoding remain outside JSON Schema', () => {
  const input = fresh('scenario'); input.closures = [];
  input.edges = Array.from({ length: LIMITS.edges }, (_, i) => ({ ...input.edges[0], id: `e${i}`, roadName: '🚚'.repeat(60) }));
  assert.ok(Buffer.byteLength(JSON.stringify(input)) > LIMITS.maxBytes); verdict('scenario', input, true, false);
});
