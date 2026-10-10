import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { LIMITS, validateScenario } from '../src/scenario.js';
import { simulate } from '../src/engine.js';
import {
  EXPERIMENT_LIMITS, validateExperiment, parseExperiment, experimentFromScenario,
  scenarioForVariant, simulateExperiment, exportExperiment, canonicalExperiment,
} from '../src/experiment.js';

const readJSON = name => JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
const minimalExperimentSha256 = '7a757f1b53531826e98f44a706d3c6d235986682e6517c3c542f116fa8bf7395';
const fixture = () => experimentFromScenario(readJSON('minimal-directed.json'));
const closure = (id = 'closure', edgeIds = ['bc'], atS = 10) => ({ id, edgeIds, atS });
const bytes = text => Buffer.byteLength(text, 'utf8');
const mutate = change => { const input = fixture(); change(input); return input; };
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value;
function largeGraph() {
  const input = fixture();
  input.baseScenario.edges = Array.from({ length: LIMITS.edges }, (_, i) => ({ ...input.baseScenario.edges[0], id: `e${i}`, roadName: 'R' }));
  input.variants.forEach(variant => { variant.closures = []; });
  return input;
}
// All individual collections and strings remain valid; only the aggregate JSON
// byte size varies. Road names provide one-byte precision at the exact boundary.
function byteSized(target) {
  const input = largeGraph();
  input.variants[0].closures = Array.from({ length: LIMITS.closures }, (_, i) => closure(`c${String(i).padStart(4, '0')}${'x'.repeat(91)}`, ['e0'], 0));
  let remaining = target - bytes(JSON.stringify(input));
  assert.ok(remaining >= 0);
  for (const edge of input.baseScenario.edges) {
    const added = Math.min(119, remaining);
    edge.roadName += 'R'.repeat(added); remaining -= added;
  }
  assert.equal(remaining, 0, 'fixture has enough bounded strings to reach target');
  assert.equal(bytes(JSON.stringify(input)), target);
  return input;
}

test('experiment limits are immutable and describe the documented v1 contract', () => {
  assert.deepEqual(EXPERIMENT_LIMITS, { maxBytes: 2097152, minVariants: 2, maxVariants: 6, nameLength: 120, idLength: 96, totalClosures: 8000, totalClosureReferences: 48000, totalResultSegments: 500000 });
  assert.ok(Object.isFrozen(EXPERIMENT_LIMITS));
});

test('legacy import preserves all supplied data and creates an independent clear-road control', () => {
  const original = readJSON('minimal-directed.json');
  const before = structuredClone(original);
  const input = experimentFromScenario(freeze(original));
  assert.deepEqual(original, before);
  assert.equal(input.format, 'detourlab-experiment');
  assert.equal(input.id, original.id); assert.equal(input.name, original.name);
  assert.deepEqual(input.baseScenario, { ...original, closures: [] });
  assert.deepEqual(input.variants, [
    { id: 'supplied', name: 'Supplied scenario', closures: original.closures },
    { id: 'clear-roads', name: 'Clear-road control', closures: [] },
  ]);
  assert.notEqual(input.baseScenario.nodes, original.nodes);
  assert.notEqual(input.variants[0].closures[0].edgeIds, original.closures[0].edgeIds);
  assert.deepEqual(parseExperiment(JSON.stringify(original)), input);
});

test('legacy clear-road imports remain clear and preserve ordered demand and metadata', () => {
  const original = readJSON('minimal-directed.json'); original.closures = [];
  original.jobs.push({ ...original.jobs[0], id: 'second' }); original.jobs.reverse();
  const input = experimentFromScenario(original);
  assert.deepEqual(input.variants.map(variant => variant.closures), [[], []]);
  assert.deepEqual(input.baseScenario.jobs, original.jobs);
  assert.equal(input.baseScenario.description, original.description);
});

test('pretty roundtrip reproduces identities, complete ledgers, and metrics exactly', () => {
  const input = fixture();
  const exported = exportExperiment(input);
  assert.match(exported, /\n  "format"/);
  const imported = parseExperiment(exported);
  assert.deepEqual(imported, input);
  assert.deepEqual(simulateExperiment(imported), simulateExperiment(input));
  assert.equal(exportExperiment(imported), exported);
});

test('minimal experiment preserves the original fixture and changes only variant closures', () => {
  const original = readJSON('minimal-directed.json');
  const input = readJSON('minimal-experiment.json'), before = structuredClone(input);
  assert.deepEqual(validateExperiment(freeze(input)), input);
  assert.equal(input.format, 'detourlab-experiment');
  assert.equal(input.version, 1);
  assert.equal(input.id, 'minimal-cutoff-experiment');
  assert.equal(input.name, 'One second changes the route');
  assert.deepEqual(original.closures, [closure('bc-closure')]);
  // This checks every shared field, including graph order, fleet, demand and metadata.
  assert.deepEqual(input.baseScenario, { ...original, closures: [] });
  assert.deepEqual(input.variants, [
    { id: 'clear', name: 'Clear roads', closures: [] },
    { id: 'close-at-10', name: 'Close at 10 s', closures: [closure('bc-closure', ['bc'], 10)] },
    { id: 'close-at-11', name: 'Close at 11 s', closures: [closure('bc-closure', ['bc'], 11)] },
  ]);
  for (const variant of input.variants) {
    assert.deepEqual(scenarioForVariant(input, variant.id), { ...original, closures: variant.closures });
  }
  assert.deepEqual(parseExperiment(exportExperiment(input)), input);
  simulateExperiment(input);
  assert.deepEqual(input, before);
  assert.deepEqual(readJSON('minimal-directed.json'), original);
  assert.equal(createHash('sha256').update(canonicalExperiment(input)).digest('hex'), minimalExperimentSha256);
});

test('minimal experiment hand-checked ledgers distinguish entry cutoff from arrival and service', () => {
  const clear = {
    vehicles: [{
      id: 'van-1',
      segments: [
        { edgeId: 'ab', from: 'A', to: 'B', startS: 0, endS: 10, distanceM: 100 },
        { edgeId: 'bc', from: 'B', to: 'C', startS: 10, endS: 20, distanceM: 100 },
      ],
      jobs: [{ id: 'job-1', nodeId: 'C', dueTimeS: 22, arrivalS: 20, completedS: 23, status: 'on-time' }],
      distanceM: 200, finishS: 23, reroutes: [],
    }],
    metrics: { distanceM: 200, lateJobs: 0, unreachableJobs: 0, completedJobs: 1, totalJobs: 1, totalDelayS: 0, onTimeJobs: 1, reroutes: 0, affectedVehicles: 0, totalTravelTimeS: 20 },
    durationS: 60,
  };
  const detour = {
    vehicles: [{
      id: 'van-1',
      segments: [
        { edgeId: 'ab', from: 'A', to: 'B', startS: 0, endS: 10, distanceM: 100 },
        { edgeId: 'bd', from: 'B', to: 'D', startS: 10, endS: 18, distanceM: 80 },
        { edgeId: 'dc', from: 'D', to: 'C', startS: 18, endS: 26, distanceM: 80 },
      ],
      jobs: [{ id: 'job-1', nodeId: 'C', dueTimeS: 22, arrivalS: 26, completedS: 29, status: 'late' }],
      distanceM: 260, finishS: 29,
      reroutes: [{ atS: 10, nodeId: 'B', jobId: 'job-1', closedEdgeIds: ['bc'], reason: 'closure-blocked-route' }],
    }],
    metrics: { distanceM: 260, lateJobs: 1, unreachableJobs: 0, completedJobs: 1, totalJobs: 1, totalDelayS: 4, onTimeJobs: 0, reroutes: 1, affectedVehicles: 1, totalTravelTimeS: 26 },
    durationS: 60,
  };
  const zeroDelta = { distanceM: 0, extraDistancePct: 0, extraLateJobs: 0, unreachableJobs: 0 };
  const input = readJSON('minimal-experiment.json');
  const expected = {
    baseline: clear,
    variants: [
      { id: 'clear', name: 'Clear roads', result: clear, delta: zeroDelta },
      { id: 'close-at-10', name: 'Close at 10 s', result: detour, delta: { distanceM: 60, extraDistancePct: 30, extraLateJobs: 1, unreachableJobs: 0 } },
      { id: 'close-at-11', name: 'Close at 11 s', result: clear, delta: zeroDelta },
    ],
  };
  assert.deepEqual(simulateExperiment(input), expected);
  assert.deepEqual(simulateExperiment(parseExperiment(exportExperiment(input))), expected);
});

test('minimal experiment documented CLI reproduces its fingerprint and every result metric', () => {
  const run = () => spawnSync(process.execPath, ['scripts/run-experiment.js', 'examples/minimal-experiment.json', '--json'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
  const first = run(), second = run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  const simulation = simulateExperiment(readJSON('minimal-experiment.json'));
  assert.deepEqual(JSON.parse(first.stdout), {
    engineVersion: '0.1.0', experimentId: 'minimal-cutoff-experiment', experimentSha256: minimalExperimentSha256,
    seed: 1, baseline: simulation.baseline.metrics,
    variants: simulation.variants.map(variant => ({ id: variant.id, name: variant.name, metrics: variant.result.metrics, delta: variant.delta, passed: true, violations: [] })),
    thresholds: {}, passed: true, violations: [], warnings: [],
  });
  const walkthrough = readFileSync(new URL('../docs/EXPERIMENTS.md', import.meta.url), 'utf8');
  assert.ok(walkthrough.includes('node scripts/run-experiment.js examples/minimal-experiment.json --json'));
  assert.ok(walkthrough.includes(minimalExperimentSha256));
});

test('included multi-variant example preserves its stable IDs and matches direct engine runs', () => {
  const input = validateExperiment(readJSON('meridian-experiment.json'));
  assert.deepEqual(input.variants.map(variant => variant.id), ['market-05', 'market-10', 'all-bridges-05', 'clear-roads']);
  const actual = simulateExperiment(input);
  assert.deepEqual(actual.baseline, simulate(input.baseScenario));
  input.variants.forEach((variant, index) => {
    assert.deepEqual(actual.variants[index].result, simulate({ ...input.baseScenario, closures: variant.closures }));
    assert.equal(actual.variants[index].id, variant.id);
    assert.equal(actual.variants[index].name, variant.name);
  });
  assert.deepEqual(simulateExperiment(parseExperiment(exportExperiment(input))), actual);
  assert.equal(actual.baseline.metrics.distanceM, 311800);
  assert.equal(actual.variants[0].result.metrics.distanceM, 377080);
  assert.equal(actual.variants[0].result.metrics.lateJobs, 118);
});

test('every variant uses the identical baseline inputs and direct engine closure semantics', () => {
  const input = fixture();
  input.variants.push({ id: 'late', name: 'Close after entry', closures: [closure('closure', ['bc'], 10.001)] });
  const actual = simulateExperiment(input);
  assert.deepEqual(actual.baseline, simulate(input.baseScenario));
  assert.deepEqual(actual.variants[0].delta, { distanceM: 60, extraDistancePct: 30, extraLateJobs: 1, unreachableJobs: 0 });
  assert.deepEqual(actual.variants[1].delta, { distanceM: 0, extraDistancePct: 0, extraLateJobs: 0, unreachableJobs: 0 });
  assert.deepEqual(actual.variants[2].result, actual.baseline);
  for (const variant of input.variants) {
    const scenario = scenarioForVariant(input, variant.id);
    assert.deepEqual({ ...scenario, closures: [] }, input.baseScenario);
    assert.deepEqual(scenario.closures, variant.closures);
    assert.deepEqual(actual.variants.find(item => item.id === variant.id).result, simulate(scenario));
  }
});

test('distance reductions remain signed when closures cause skipped jobs', () => {
  const input = fixture(); input.variants[0].closures = [closure('disconnect', ['ab'], 0)];
  const result = simulateExperiment(input);
  assert.deepEqual(result.variants[0].delta, { distanceM: -200, extraDistancePct: -100, extraLateJobs: 0, unreachableJobs: 1 });
  assert.equal(result.variants[0].result.metrics.completedJobs, 0);
  assert.equal(result.variants[0].result.vehicles[0].jobs[0].status, 'unreachable');
});

test('unreachable delta is the absolute variant count even when baseline is disconnected', () => {
  const input = fixture(); input.baseScenario.edges = []; input.variants[0].closures = [];
  const result = simulateExperiment(input);
  assert.equal(result.baseline.metrics.unreachableJobs, 1);
  assert.deepEqual(result.variants[0].delta, { distanceM: 0, extraDistancePct: 0, extraLateJobs: 0, unreachableJobs: 1 });
  assert.deepEqual(result.variants[0].result, result.baseline);
});

test('zero-distance baselines and fractional distances have finite six-decimal deltas', () => {
  const zero = fixture(); zero.baseScenario.jobs[0].nodeId = 'A';
  assert.deepEqual(simulateExperiment(zero).variants[0].delta, { distanceM: 0, extraDistancePct: 0, extraLateJobs: 0, unreachableJobs: 0 });
  const input = fixture(); input.baseScenario.edges.find(edge => edge.id === 'bd').distanceM = 80.123456789;
  const result = simulateExperiment(input).variants[0];
  assert.equal(result.delta.distanceM, 60.123457);
  assert.equal(result.delta.extraDistancePct, 30.061728);
});

test('all public operations leave frozen input unchanged', () => {
  const input = fixture(), before = structuredClone(input); freeze(input);
  validateExperiment(input); scenarioForVariant(input, 'supplied'); simulateExperiment(input);
  exportExperiment(input); canonicalExperiment(input);
  assert.deepEqual(input, before);
});

test('validation breaks shared references between variants and caller-owned records', () => {
  const input = fixture(); input.variants[1].closures = input.variants[0].closures;
  const clean = validateExperiment(input);
  clean.variants[0].closures[0].atS = 90; clean.variants[0].closures[0].edgeIds.push('dc');
  assert.equal(clean.variants[1].closures[0].atS, 10);
  assert.deepEqual(clean.variants[1].closures[0].edgeIds, ['bc']);
  assert.deepEqual(input.variants[0].closures[0], closure('bc-closure'));
});

test('extracted scenarios are independent from the experiment and one another', () => {
  const input = fixture(), first = scenarioForVariant(input, 'supplied'), second = scenarioForVariant(input, 'supplied');
  first.nodes[0].x = 99; first.jobs[0].dueTimeS = 999; first.closures[0].edgeIds.push('dc');
  assert.deepEqual(second, { ...input.baseScenario, closures: input.variants[0].closures });
  assert.deepEqual(input, fixture());
  assert.throws(() => scenarioForVariant(input, 'missing'), /Unknown experiment variant/);
});

test('baseline and control result objects do not alias, including nested ledger arrays', () => {
  const input = fixture(); input.variants.push({ id: 'control-2', name: 'Second control', closures: [] });
  const result = simulateExperiment(input), expected = structuredClone(result.baseline);
  result.variants[1].result.metrics.distanceM = 999;
  result.variants[1].result.vehicles[0].segments[0].edgeId = 'edited';
  result.variants[1].result.vehicles[0].jobs[0].arrivalS = 999;
  assert.deepEqual(result.baseline, expected); assert.deepEqual(result.variants[2].result, expected);
  assert.deepEqual(simulateExperiment(input).baseline, expected);
});

test('baseline executes exactly once and empty controls reuse it without rerouting', () => {
  // Instrument the real checked-in module, as the app state tests do, without
  // exposing a production injection hook or relying on experimental Node mocks.
  const source = readFileSync(new URL('../src/experiment.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const calls = [];
  const instrumented = new Function('LIMITS', 'validateScenario', 'simulate', `${source}\nreturn simulateExperiment;`)(LIMITS, validateScenario, scenario => { calls.push(structuredClone(scenario)); return simulate(scenario); });
  const input = fixture();
  input.variants.push({ id: 'other', name: 'Another closure', closures: [closure('different', ['ab'], 0)] }, { id: 'control-2', name: 'Another control', closures: [] });
  assert.deepEqual(instrumented(input), simulateExperiment(input));
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], input.baseScenario);
  assert.deepEqual(calls[1].closures, input.variants[0].closures);
  assert.deepEqual(calls[2].closures, input.variants[2].closures);
});

test('canonical JSON sorts object keys recursively but preserves semantic array order', () => {
  const input = fixture();
  assert.equal(canonicalExperiment(reverseKeys(input)), canonicalExperiment(input));
  assert.deepEqual(JSON.parse(canonicalExperiment(input)), input);
  assert.equal(canonicalExperiment(parseExperiment(JSON.stringify(input, null, 7))), canonicalExperiment(input));
  const reordered = structuredClone(input); reordered.variants.reverse();
  assert.notEqual(canonicalExperiment(reordered), canonicalExperiment(input));
  const changed = structuredClone(input); changed.variants[0].closures[0].atS += 1;
  assert.notEqual(canonicalExperiment(changed), canonicalExperiment(input));
});

test('all validation entry points reject malformed or unsupported versions and fields', () => {
  for (const input of [null, [], 1, '', {}, { ...fixture(), format: 'scenario' }, { ...fixture(), version: 2 }, { ...fixture(), extra: true }]) {
    assert.throws(() => validateExperiment(input));
    assert.throws(() => exportExperiment(input));
    assert.throws(() => canonicalExperiment(input));
    assert.throws(() => simulateExperiment(input));
  }
  assert.throws(() => parseExperiment('{'), /not valid JSON/);
  assert.throws(() => parseExperiment(fixture()), /JSON text/);
  assert.throws(() => parseExperiment(JSON.stringify({ ...fixture(), format: null })), /format/);
  assert.throws(() => parseExperiment(JSON.stringify({ version: 2 })), /required/);
  for (const key of Object.keys(fixture())) assert.throws(() => validateExperiment(mutate(input => { delete input[key]; })), /required/);
  assert.throws(() => validateExperiment(mutate(input => { input.baseScenario.closures = [closure()]; })), /must be empty/);
});

for (const [name, select] of [['experiment', input => input], ['variant', input => input.variants[0]], ['closure', input => input.variants[0].closures[0]]]) {
  test(`${name} IDs enforce safe syntax, nonempty values, and 96-character bound`, () => {
    for (const value of ['', ' ', 'bad id', '../path', '__proto__', 'constructor', 'prototype', '💥', 'a'.repeat(97), 1, null]) {
      assert.throws(() => validateExperiment(mutate(input => { select(input).id = value; })), /id/);
    }
    assert.doesNotThrow(() => validateExperiment(mutate(input => { select(input).id = 'a'.repeat(96); })));
    assert.doesNotThrow(() => validateExperiment(mutate(input => { select(input).id = 'A-_.:09'; })));
  });
}

for (const [name, select] of [['experiment', input => input], ['variant', input => input.variants[0]]]) {
  test(`${name} names enforce nonempty text, control characters, and 120-character bound`, () => {
    for (const value of ['', ' \t\n', 'a'.repeat(121), 'bad\u0000name', 123, null]) assert.throws(() => validateExperiment(mutate(input => { select(input).name = value; })), /name/);
    assert.doesNotThrow(() => validateExperiment(mutate(input => { select(input).name = 'é'.repeat(120); })));
  });
}

test('duplicate variant IDs and within-variant closure IDs fail, but cross-variant closure IDs are independent', () => {
  assert.throws(() => validateExperiment(mutate(input => { input.variants[1].id = input.variants[0].id; })), /duplicate id/);
  assert.throws(() => validateExperiment(mutate(input => { input.variants[0].closures.push(structuredClone(input.variants[0].closures[0])); })), /duplicate id/);
  assert.doesNotThrow(() => validateExperiment(mutate(input => { input.variants[1].closures = structuredClone(input.variants[0].closures); })));
});

test('closure references reject unknown, duplicate, unsafe, empty, and non-string IDs', () => {
  for (const edgeIds of [['missing'], ['bc', 'bc'], ['__proto__'], [], [null], [123]]) assert.throws(() => validateExperiment(mutate(input => { input.variants[0].closures[0].edgeIds = edgeIds; })));
});

test('closure cutoffs enforce finite numbers from zero through the documented maximum', () => {
  for (const atS of [-1, LIMITS.maxTimeS + 1, NaN, Infinity, -Infinity, '10', null]) assert.throws(() => validateExperiment(mutate(input => { input.variants[0].closures[0].atS = atS; })), /atS/);
  for (const atS of [0, 0.125, LIMITS.maxTimeS]) assert.doesNotThrow(() => validateExperiment(mutate(input => { input.variants[0].closures[0].atS = atS; })));
});

test('variant count accepts exactly two through six and rejects either outer boundary', () => {
  for (const count of [0, 1, 7]) assert.throws(() => validateExperiment(mutate(input => { input.variants = Array.from({ length: count }, (_, i) => ({ id: `v${i}`, name: 'V', closures: [] })); })), /2–6/);
  for (const count of [2, 6]) assert.equal(validateExperiment(mutate(input => { input.variants = Array.from({ length: count }, (_, i) => ({ id: `v${i}`, name: 'V', closures: [] })); })).variants.length, count);
});

test('shared scenario collection bounds and reference validation still apply inside experiments', () => {
  for (const collection of ['nodes', 'edges', 'vehicles', 'jobs']) {
    assert.throws(() => validateExperiment(mutate(input => { input.baseScenario[collection] = Array(LIMITS[collection] + 1).fill(input.baseScenario[collection][0]); })), new RegExp(`scenario.${collection}`));
  }
  for (const collection of ['nodes', 'vehicles']) assert.throws(() => validateExperiment(mutate(input => { input.baseScenario[collection] = []; })), new RegExp(`scenario.${collection}`));
  for (const edit of [input => { input.baseScenario.edges[0].from = 'missing'; }, input => { input.baseScenario.jobs[0].vehicleId = 'missing'; }, input => { input.baseScenario.vehicles[0].startNode = 'missing'; }]) assert.throws(() => validateExperiment(mutate(edit)), /unknown id/);
});

test('closure record and reference collections fail before iterating over oversized arrays', () => {
  assert.throws(() => validateExperiment(mutate(input => { input.variants[0].closures = Array(LIMITS.closures + 1).fill(closure()); })), /closures must be an array/);
  assert.throws(() => validateExperiment(mutate(input => { input.variants[0].closures[0].edgeIds = Array(LIMITS.edges + 1).fill('bc'); })), /edgeIds must be an array/);
});

test('aggregate closure count accepts 8000 across variants and rejects 8001', () => {
  const input = fixture();
  input.variants[0].closures = Array.from({ length: 4000 }, (_, i) => closure(`c${i}`));
  input.variants[1].closures = Array.from({ length: 4000 }, (_, i) => closure(`c${i}`));
  assert.equal(validateExperiment(input).variants[1].closures.length, 4000);
  input.variants[1].closures.push(closure('last'));
  assert.throws(() => validateExperiment(input), /aggregate limit of 8000 closure records/);
});

test('aggregate edge references accept exactly 48000 and reject the next reference', () => {
  const input = largeGraph(), refs = input.baseScenario.edges.map(edge => edge.id);
  input.variants[0].closures = Array.from({ length: 6 }, (_, i) => closure(`c${i}`, [...refs]));
  assert.equal(validateExperiment(input).variants[0].closures[0].edgeIds.length, LIMITS.edges);
  input.variants[1].closures = [closure('over-limit', ['e0'])];
  assert.throws(() => validateExperiment(input), /aggregate limit of 48000 closure edge references/);
});

const recordSelections = [
  ['experiment', input => input], ['variant', input => input.variants[0]],
  ['closure', input => input.variants[0].closures[0]], ['shared scenario', input => input.baseScenario],
  ['shared node', input => input.baseScenario.nodes[0]], ['shared edge', input => input.baseScenario.edges[0]],
  ['shared job', input => input.baseScenario.jobs[0]], ['shared vehicle', input => input.baseScenario.vehicles[0]],
];
for (const [name, select] of recordSelections) {
  test(`${name} records reject unknown fields, symbols, and custom prototypes`, () => {
    for (const property of ['extra', '__proto__', 'prototype', 'constructor', Symbol('hidden')]) {
      assert.throws(() => validateExperiment(mutate(input => { Object.defineProperty(select(input), property, { value: true }); })), /unsupported property/);
    }
    assert.throws(() => validateExperiment(mutate(input => { Object.setPrototypeOf(select(input), { inherited: true }); })), /plain object/);
  });
  test(`${name} records never invoke getters and accept null-prototype data records`, () => {
    let called = 0;
    const input = fixture(), selected = select(input), key = Object.keys(selected)[0];
    Object.defineProperty(selected, key, { get() { called += 1; throw new Error('getter was invoked'); } });
    assert.throws(() => validateExperiment(input), /accessor/); assert.equal(called, 0);
    assert.doesNotThrow(() => validateExperiment(mutate(value => { Object.setPrototypeOf(select(value), null); })));
  });
}

for (const [name, select] of [['variants', input => input.variants], ['closures', input => input.variants[0].closures], ['closure references', input => input.variants[0].closures[0].edgeIds]]) {
  test(`${name} arrays reject sparse entries, accessors, extra properties, and subclasses`, () => {
    assert.throws(() => validateExperiment(mutate(input => { delete select(input)[0]; })), /missing/);
    let called = 0;
    assert.throws(() => validateExperiment(mutate(input => { Object.defineProperty(select(input), '0', { get() { called += 1; return null; } }); })), /accessor/);
    assert.equal(called, 0);
    for (const key of ['extra', '01', '__proto__', Symbol('extra')]) assert.throws(() => validateExperiment(mutate(input => { Object.defineProperty(select(input), key, { value: null }); })), /unsupported array property/);
    assert.throws(() => validateExperiment(mutate(input => { Object.setPrototypeOf(select(input), Object.create(Array.prototype)); })), /plain array/);
  });
}

test('JSON prototype-pollution keys are rejected without changing global prototypes', () => {
  const json = JSON.stringify(fixture()).replace('"format":', '"__proto__":{"polluted":true},"format":');
  assert.throws(() => parseExperiment(json), /unsupported property __proto__/);
  assert.equal({}.polluted, undefined);
});

test('import byte guard checks UTF-8 bytes before JSON parsing, including multibyte text', () => {
  for (const text of [' '.repeat(EXPERIMENT_LIMITS.maxBytes + 1), 'é'.repeat(EXPERIMENT_LIMITS.maxBytes / 2 + 1)]) assert.throws(() => parseExperiment(text), /2 MiB/);
  assert.throws(() => parseExperiment(' '.repeat(EXPERIMENT_LIMITS.maxBytes)), /not valid JSON/);
  const json = JSON.stringify(fixture());
  const padded = json + ' '.repeat(EXPERIMENT_LIMITS.maxBytes - bytes(json));
  assert.deepEqual(parseExperiment(padded), fixture());
  assert.throws(() => parseExperiment(`${padded} `), /2 MiB/);
});

test('valid exact-byte-bound experiments export compactly and can be reimported', () => {
  const input = byteSized(EXPERIMENT_LIMITS.maxBytes);
  const clean = validateExperiment(input);
  const output = exportExperiment(clean);
  assert.equal(bytes(output), EXPERIMENT_LIMITS.maxBytes);
  assert.equal(output, JSON.stringify(clean));
  assert.deepEqual(parseExperiment(output), clean);
});

test('oversized in-memory aggregate data is rejected consistently by validation and export', () => {
  const input = byteSized(EXPERIMENT_LIMITS.maxBytes + 1);
  // The shared scenario is itself valid; the containing experiment is too large.
  assert.doesNotThrow(() => validateScenario(input.baseScenario));
  for (const operation of [validateExperiment, exportExperiment, canonicalExperiment, simulateExperiment]) assert.throws(() => operation(input), /2 MiB/);
});

test('aggregate ledger budget counts baseline and controls before cloning an oversized result', () => {
  const source = readFileSync(new URL('../src/experiment.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  let simulated = 0, cloned = 0;
  const baseline = { vehicles: [{ segments: Array(250000).fill(null) }], metrics: { distanceM: 0, lateJobs: 0, unreachableJobs: 0 } };
  const instrumented = new Function('LIMITS', 'validateScenario', 'simulate', 'structuredClone', `${source}\nreturn simulateExperiment;`)(LIMITS, validateScenario, () => { simulated += 1; return baseline; }, value => { cloned += 1; return structuredClone(value); });
  const input = fixture(); input.variants[0].closures = [];
  assert.throws(() => instrumented(input), /aggregate result limit of 500000 route segments/);
  assert.equal(simulated, 1, 'baseline runs once');
  assert.equal(cloned, 1, 'the second control must be rejected before allocating its clone');
});

test('aggregate ledger budget includes disrupted variants and aborts without later work or partial success', () => {
  const source = readFileSync(new URL('../src/experiment.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const counts = [200000, 200000, 100001]; let simulated = 0;
  const instrumented = new Function('LIMITS', 'validateScenario', 'simulate', `${source}\nreturn simulateExperiment;`)(LIMITS, validateScenario, () => ({ vehicles: [{ segments: Array(counts[simulated++]).fill(null) }], metrics: { distanceM: 0, lateJobs: 0, unreachableJobs: 0 } }));
  const input = fixture(); input.variants[1].closures = [closure()];
  input.variants.push({ id: 'never-run', name: 'Must not run', closures: [closure()] });
  let result;
  assert.throws(() => { result = instrumented(input); }, /aggregate result limit/);
  assert.equal(result, undefined); assert.equal(simulated, 3);
});

test('aggregate ledger budget accepts exactly 500000 segments', () => {
  const source = readFileSync(new URL('../src/experiment.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const counts = [200000, 200000, 100000]; let simulated = 0;
  const instrumented = new Function('LIMITS', 'validateScenario', 'simulate', `${source}\nreturn simulateExperiment;`)(LIMITS, validateScenario, () => ({ vehicles: [{ segments: Array(counts[simulated++]).fill(null) }], metrics: { distanceM: 0, lateJobs: 0, unreachableJobs: 0 } }));
  const input = fixture(); input.variants[1].closures = [closure()];
  const result = instrumented(input);
  assert.equal(simulated, 3); assert.equal(result.variants.length, 2);
  assert.equal(result.baseline.vehicles[0].segments.length + result.variants.reduce((sum, variant) => sum + variant.result.vehicles[0].segments.length, 0), EXPERIMENT_LIMITS.totalResultSegments);
});

test('shared graph, fleet, and demand accept their exact valid collection maxima', () => {
  const input = largeGraph(), scenario = input.baseScenario;
  scenario.nodes = Array.from({ length: LIMITS.nodes }, (_, i) => ({ id: `n${i}`, x: i, y: 0 }));
  for (const edge of scenario.edges) { edge.from = 'n0'; edge.to = 'n1'; }
  scenario.vehicles = Array.from({ length: LIMITS.vehicles }, (_, i) => ({ id: `v${i}`, startNode: 'n0', startTimeS: 0 }));
  scenario.jobs = Array.from({ length: LIMITS.jobs }, (_, i) => ({ id: `j${i}`, nodeId: 'n1', vehicleId: `v${i % LIMITS.vehicles}`, dueTimeS: 0, serviceTimeS: 0 }));
  const validated = validateExperiment(input);
  for (const key of ['nodes', 'edges', 'vehicles', 'jobs']) assert.equal(validated.baseScenario[key].length, LIMITS[key]);
  scenario.edges = []; scenario.jobs = [];
  assert.doesNotThrow(() => validateExperiment(input));
});

test('every variant and closure field is required and collection values must be arrays', () => {
  for (const select of [input => input.variants[0], input => input.variants[0].closures[0]]) {
    for (const key of Object.keys(select(fixture()))) assert.throws(() => validateExperiment(mutate(input => { delete select(input)[key]; })), /required/);
  }
  for (const value of [null, {}, 'not-an-array']) {
    for (const change of [input => { input.variants = value; }, input => { input.variants[0].closures = value; }, input => { input.variants[0].closures[0].edgeIds = value; }]) assert.throws(() => validateExperiment(mutate(change)), /must be an array/);
  }
});
