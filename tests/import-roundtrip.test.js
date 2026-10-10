import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LIMITS } from '../src/scenario.js';
import { decodeFileInput } from '../src/file-input.js';
import {
  canonicalExperiment, exportExperiment, parseExperiment, simulateExperiment,
} from '../src/experiment.js';

// Original synthetic corpus, reproducible without dependencies or Math.random.
// Seed 0x5eedc0de; 48 cases, at most 8 nodes / 15 edges / 3 vehicles / 8 jobs,
// with 2–6 variants and at most 3 closures per variant. Large byte-boundary
// fixtures belong to experiment.test.js and file-input.test.js, not this corpus.
const SEED = 0x5eedc0de;
const CASE_COUNT = 48;
function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function generateCorpus(seed = SEED) {
  const random = randomGenerator(seed);
  const integer = (min, max) => min + Math.floor(random() * (max - min + 1));
  const shuffle = items => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = integer(0, i); [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  const labels = ['Café & Quay', '<b>Detour</b>', '🚚 港湾', 'A\u030A lane', '<img src=x onerror=alert(1)>'];
  return Array.from({ length: CASE_COUNT }, (_, index) => {
    const nodes = ['A', 'B', 'C', 'D', 'U', ...Array.from({ length: integer(0, 3) }, (_, i) => `E${i}`)]
      .map((id, i) => ({ id, x: i * 2 + integer(0, 3) / 4, y: integer(-4, 4) }));
    const startS = integer(0, 12) / 4;
    const firstTime = integer(1, 8) + 0.25;
    const secondTime = integer(1, 4) + 0.5;
    const edge = (id, from, to, travelTimeS) => ({
      id, from, to, travelTimeS, distanceM: integer(10, 200) + 0.25,
      roadName: labels[(index + id.length) % labels.length],
    });
    // A→B→C is the unique fastest first route. B→A is deliberately asymmetric;
    // C→B does not exist. U is isolated. Extra branches cannot beat B→D→C.
    const edges = [
      edge('ab', 'A', 'B', firstTime), edge('ba', 'B', 'A', firstTime + 1.5),
      edge('bc', 'B', 'C', secondTime), edge('bd', 'B', 'D', secondTime + 0.25),
      edge('dc', 'D', 'C', secondTime + 0.5), edge('ca', 'C', 'A', firstTime + 2),
    ];
    for (const node of nodes.filter(item => item.id.startsWith('E'))) {
      edges.push(edge(`d-${node.id}`, 'D', node.id, secondTime + integer(1, 5)));
      edges.push(edge(`${node.id}-c`, node.id, 'C', secondTime + integer(1, 5)));
      if (index % 3 !== 0) edges.push(edge(`${node.id}-d`, node.id, 'D', secondTime + integer(6, 9)));
    }
    const vehicles = Array.from({ length: 1 + index % 3 }, (_, i) => ({
      id: `van-${i}`, startNode: i === 0 ? 'A' : 'C', startTimeS: startS + i / 4,
    }));
    const job = (id, nodeId, vehicleId = 'van-0') => ({
      id, nodeId, vehicleId, dueTimeS: integer(0, 25) + 0.5, serviceTimeS: integer(0, 8) / 4,
    });
    let jobs = [];
    if (index % 8 !== 0) {
      jobs = shuffle([
        job('isolated', 'U'),
        ...Array.from({ length: integer(0, 6) }, (_, i) => job(`job-${i}`,
          nodes[integer(0, nodes.length - 1)].id, vehicles[integer(0, vehicles.length - 1)].id)),
      ]);
      // Vary global demand order, while preserving a known first job for van-0.
      jobs.splice(integer(0, jobs.findIndex(item => item.vehicleId === 'van-0')), 0, job('entry', 'C'));
    }
    const entryS = startS + firstTime;
    const closure = (id, edgeIds, atS) => ({ id, edgeIds, atS });
    const variants = [
      { id: 'clear', name: `Clear ${labels[index % labels.length]}`, closures: [] },
      { id: 'at-entry', name: 'At entry · 閉鎖', closures: [closure('cutoff', ['bc'], entryS)] },
      { id: 'after-entry', name: 'After entry + 0.125 s', closures: [closure('cutoff', ['bc'], entryS + 0.125)] },
      { id: 'before-entry', name: 'Before entry − 0.125 s', closures: [closure('cutoff', ['bc'], entryS - 0.125)] },
      { id: 'disconnect', name: '<em>No exit</em>', closures: [closure('cutoff', ['ab'], startS)] },
      { id: 'overlapping', name: 'Repeated edge, independent events', closures: shuffle([
        closure('early', ['bc'], entryS), closure('later', ['bc'], entryS + 0.5),
        closure('pair', shuffle(['ab', 'ba']), entryS + 10.125),
      ]) },
    ].slice(0, 2 + index % 5);
    return {
      format: 'detourlab-experiment', version: 1, id: `seeded-${index}`,
      name: `Roundtrip ${index} · ${labels[index % labels.length]}`,
      baseScenario: {
        version: 1, id: `graph-${index}`, name: `Graph ${index} · 東京 <svg/onload=alert(1)>`,
        seed: integer(0, 0xffffffff), description: 'Synthetic only: café, e\u0301, 🚚, <script>text</script> & quotes ".',
        nodes: shuffle(nodes), edges: shuffle(edges), vehicles: shuffle(vehicles), jobs,
        closures: [], durationS: integer(1, 15) + 0.5,
      },
      variants: shuffle(variants),
    };
  });
}

const corpus = generateCorpus();
const fingerprint = input => createHash('sha256').update(canonicalExperiment(input)).digest('hex');
const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value;
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function references(value, result = new Set()) {
  if (value && typeof value === 'object' && !result.has(value)) {
    result.add(value); Object.values(value).forEach(item => references(item, result));
  }
  return result;
}
function independent(first, second, message) {
  const original = references(first);
  for (const object of references(second)) assert.ok(!original.has(object), message);
}
const firstJob = result => result.vehicles.find(vehicle => vehicle.id === 'van-0').jobs[0];

function assertLedgerContract(input, simulation) {
  const { baseScenario } = input;
  const results = [simulation.baseline, ...simulation.variants.map(variant => variant.result)];
  results.forEach((result, index) => {
    assert.equal(result.metrics.totalJobs, baseScenario.jobs.length);
    assert.equal(result.metrics.completedJobs + result.metrics.unreachableJobs, baseScenario.jobs.length);
    for (const vehicle of result.vehicles) {
      assert.deepEqual(vehicle.jobs.map(job => job.id),
        baseScenario.jobs.filter(job => job.vehicleId === vehicle.id).map(job => job.id), 'assigned job order survives');
    }
    results.slice(index + 1).forEach(other => independent(result, other, 'result ledgers must not alias'));
  });
  assert.deepEqual(simulation.variants.find(variant => variant.id === 'clear').result, simulation.baseline);
  if (!baseScenario.jobs.length) {
    for (const result of results) {
      assert.equal(result.metrics.distanceM, 0);
      assert.ok(result.vehicles.every(vehicle => !vehicle.jobs.length && !vehicle.segments.length));
    }
    return;
  }
  const start = baseScenario.vehicles.find(vehicle => vehicle.id === 'van-0').startTimeS;
  const travel = id => baseScenario.edges.find(edge => edge.id === id).travelTimeS;
  assert.equal(firstJob(simulation.baseline).id, 'entry');
  assert.equal(firstJob(simulation.baseline).arrivalS, start + travel('ab') + travel('bc'));
  for (const result of results) {
    assert.equal(result.vehicles.find(vehicle => vehicle.id === 'van-0').jobs.find(job => job.id === 'isolated').status, 'unreachable');
  }
  for (const variant of simulation.variants) {
    if (['at-entry', 'before-entry', 'overlapping'].includes(variant.id)) {
      assert.equal(firstJob(variant.result).arrivalS, start + travel('ab') + travel('bd') + travel('dc'), variant.id);
    } else if (variant.id === 'after-entry') {
      assert.deepEqual(firstJob(variant.result), firstJob(simulation.baseline), 'entered edges finish after a cutoff');
    } else if (variant.id === 'disconnect') {
      assert.equal(firstJob(variant.result).status, 'unreachable');
    }
  }
}

test('seed 0x5eedc0de generates exactly 48 bounded, reproducible cases', () => {
  assert.deepEqual(generateCorpus(), corpus);
  assert.equal(corpus.length, 48);
  assert.equal(corpus.filter(input => !input.baseScenario.jobs.length).length, 6);
  assert.deepEqual([2, 3, 4, 5, 6].map(count => corpus.filter(input => input.variants.length === count).length), [10, 10, 10, 9, 9]);
  for (const { baseScenario: scenario, variants } of corpus) {
    for (const [key, limit] of [['nodes', 8], ['edges', 15], ['vehicles', 3], ['jobs', 8]]) assert.ok(scenario[key].length <= limit, key);
    assert.ok(variants.every(variant => variant.closures.length <= 3));
    assert.ok(Buffer.byteLength(JSON.stringify({ scenario, variants })) < 20000, 'generated fixtures stay small');
  }
});

for (const [index, generated] of corpus.entries()) {
  test(`seed 0x5eedc0de case ${index}: UTF-8 import/export preserves semantics, fingerprints, and independent ledgers`, () => {
    const original = freeze(structuredClone(generated));
    const snapshot = JSON.stringify(original);
    const source = JSON.stringify(index % 2 ? reverseKeys(original) : original, null, index % 3);
    const bytes = new TextEncoder().encode(`${index % 4 === 0 ? '\uFEFF' : ''}${source}\n`);
    const beforeBytes = bytes.slice();
    const imported = parseExperiment(decodeFileInput(bytes));
    assert.deepEqual(imported, original, 'all supplied display text, arrays, and metadata survive import');
    const exported = exportExperiment(imported);
    const restored = parseExperiment(decodeFileInput(new TextEncoder().encode(exported)));
    assert.deepEqual(restored, original);
    assert.equal(exportExperiment(restored), exported, 'export is idempotent');
    assert.equal(fingerprint(imported), fingerprint(original));
    assert.equal(fingerprint(restored), fingerprint(reverseKeys(original)), 'object key order is not semantic');
    const reordered = structuredClone(original); reordered.variants.reverse();
    assert.notEqual(fingerprint(reordered), fingerprint(original), 'variant array order remains fingerprinted');
    const expected = simulateExperiment(original);
    const actual = simulateExperiment(restored);
    assert.deepEqual(actual, expected, 'complete ledgers and deltas survive the roundtrip');
    assertLedgerContract(restored, actual);
    independent(original, imported, 'imports must not alias caller data');
    independent(imported, restored, 'separate imports must not alias');
    independent(restored, actual, 'simulation results must not alias inputs');
    independent(expected, actual, 'separate runs must not alias');
    restored.baseScenario.nodes[0].x += 0.5;
    restored.variants.find(variant => variant.id === 'at-entry').closures[0].edgeIds.push('edited');
    actual.variants.find(variant => variant.id === 'clear').result.metrics.distanceM = -1;
    assert.deepEqual(imported, original, 'mutating a later copy leaves the first import untouched');
    assert.equal(exportExperiment(imported), exported);
    assert.deepEqual(actual.baseline, expected.baseline, 'mutating a control leaves its baseline untouched');
    assert.equal(JSON.stringify(original), snapshot, 'public operations never mutate the original state');
    assert.deepEqual(bytes, beforeBytes, 'decoding never edits file bytes');
  });
}

const atEntry = input => input.variants.find(variant => variant.id === 'at-entry').closures[0];
const poison = (value, key) => Object.defineProperty(value, key, { value: { detourlabPolluted: true }, enumerable: true });
const mutations = [
  ['unsupported format', input => { input.format = 'other'; }, /experiment\.format/],
  ['future experiment version', input => { input.version = 2; }, /experiment\.version/],
  ['string experiment version', input => { input.version = '1'; }, /experiment\.version/],
  ['missing experiment version', input => { delete input.version; }, /experiment\.version is required/],
  ['future scenario version', input => { input.baseScenario.version = 2; }, /scenario\.version/],
  ['unknown edge source', input => { input.baseScenario.edges[0].from = 'missing'; }, /edges\[0\]\.from references unknown/],
  ['unknown edge destination', input => { input.baseScenario.edges[0].to = 'missing'; }, /edges\[0\]\.to references unknown/],
  ['unknown vehicle start', input => { input.baseScenario.vehicles[0].startNode = 'missing'; }, /vehicles\[0\]\.startNode references unknown/],
  ['unknown job node', input => { input.baseScenario.jobs[0].nodeId = 'missing'; }, /jobs\[0\]\.nodeId references unknown/],
  ['unknown job vehicle', input => { input.baseScenario.jobs[0].vehicleId = 'missing'; }, /jobs\[0\]\.vehicleId references unknown/],
  ['unknown closure edge', input => { atEntry(input).edgeIds[0] = 'missing'; }, /edgeIds\[0\] references unknown/],
  ['root __proto__ key', input => poison(input, '__proto__'), /unsupported property __proto__/],
  ['scenario constructor key', input => poison(input.baseScenario, 'constructor'), /unsupported property constructor/],
  ['variant prototype key', input => poison(input.variants[0], 'prototype'), /unsupported property prototype/],
  ['closure __proto__ key', input => poison(atEntry(input), '__proto__'), /unsupported property __proto__/],
  ['no nodes', input => { input.baseScenario.nodes = []; }, /scenario\.nodes must be an array/],
  ['no vehicles', input => { input.baseScenario.vehicles = []; }, /scenario\.vehicles must be an array/],
  ['one variant', input => { input.variants.length = 1; }, /experiment\.variants must be an array/],
  ['seven variants', input => { input.variants = Array(7).fill(input.variants[0]); }, /experiment\.variants must be an array/],
  ...['nodes', 'edges', 'vehicles', 'jobs'].map(key => [`too many ${key}`, input => {
    input.baseScenario[key] = Array(LIMITS[key] + 1).fill(input.baseScenario[key][0]);
  }, new RegExp(`scenario\\.${key} must be an array`)]),
  ['too many closure references', input => { atEntry(input).edgeIds = Array(LIMITS.edges + 1).fill('bc'); }, /edgeIds must be an array/],
  ['too many closures', input => { input.variants[0].closures = Array(LIMITS.closures + 1).fill(atEntry(input)); }, /closures must be an array/],
];

test('25 bounded malformed-input mutations reject consistently without changing original state', async t => {
  assert.equal(mutations.length, 25);
  const original = freeze(structuredClone(corpus[1]));
  const snapshot = exportExperiment(original);
  const expected = simulateExperiment(original);
  for (const [name, mutate, error] of mutations) {
    await t.test(name, () => {
      const invalid = structuredClone(original); mutate(invalid); freeze(invalid);
      const serialized = JSON.stringify(invalid);
      assert.ok(Buffer.byteLength(serialized) < LIMITS.maxBytes, `${name}: schema failure must precede byte limit`);
      const operations = [
        ['parse', () => parseExperiment(decodeFileInput(new TextEncoder().encode(serialized)))],
        ['export', () => exportExperiment(invalid)],
        ['canonicalize', () => canonicalExperiment(invalid)],
        ['simulate', () => simulateExperiment(invalid)],
      ];
      for (const [operation, run] of operations) assert.throws(run, error, `${name}: ${operation}`);
      assert.equal(JSON.stringify(invalid), serialized, `${name}: rejected input is not modified`);
      assert.equal(exportExperiment(original), snapshot, `${name}: retained valid state is unchanged`);
      assert.equal(Object.hasOwn(Object.prototype, 'detourlabPolluted'), false, name);
    });
  }
  assert.deepEqual(simulateExperiment(original), expected, 'failed imports leave the retained valid result reproducible');
});

test('three seeded file samples reproduce library metrics and fingerprints through the experiment CLI', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'detourlab-seeded-roundtrip-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // Six-variant, empty-work, and legacy-scenario imports. Only three subprocesses.
  const legacy = structuredClone(corpus[3].baseScenario);
  legacy.closures = [structuredClone(atEntry(corpus[3]))];
  for (const [index, input] of [corpus[14], corpus[40], legacy].entries()) {
    const content = `\uFEFF${JSON.stringify(reverseKeys(input), null, 2)}\n`;
    const bytes = Buffer.from(content);
    const file = path.join(directory, `sample-${index}.json`); writeFileSync(file, bytes);
    const experiment = parseExperiment(decodeFileInput(bytes));
    const simulation = simulateExperiment(experiment);
    const run = spawnSync(process.execPath, ['scripts/run-experiment.js', file, '--json'], {
      cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 15000,
    });
    assert.equal(run.status, 0, `sample ${index}: ${run.error ?? run.stderr}`);
    assert.equal(run.stderr, '');
    const output = JSON.parse(run.stdout);
    assert.equal(output.experimentId, experiment.id);
    assert.equal(output.experimentSha256, fingerprint(experiment));
    assert.deepEqual(output.baseline, simulation.baseline.metrics);
    assert.deepEqual(output.variants.map(({ id, name, metrics, delta }) => ({ id, name, metrics, delta })),
      simulation.variants.map(({ id, name, result, delta }) => ({ id, name, metrics: result.metrics, delta })));
    assert.deepEqual(readFileSync(file), bytes, 'CLI input remains byte-for-byte unchanged');
  }
});
