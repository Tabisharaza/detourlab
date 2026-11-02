import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { experimentFromScenario, canonicalExperiment, simulateExperiment } from '../src/experiment.js';
import { parseReplayBookmark, exportReplayBookmark, validateReplayBookmark, REPLAY_BOOKMARK_LIMITS } from '../src/replay-bookmark.js';

function fixture() {
  const experiment = experimentFromScenario(JSON.parse(readFileSync(new URL('../examples/minimal-directed.json', import.meta.url), 'utf8')));
  return { format: 'detourlab-replay-bookmark', version: 1, experiment,
    perspective: { variantId: experiment.variants[0].id, vehicleId: experiment.baseScenario.vehicles[0].id, timeS: 15.25, view: 'split', zoom: 1 } };
}
const reverse = value => Array.isArray(value) ? value.map(reverse) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverse(item)])) : value;

test('portable bookmark roundtrip preserves complete experiment and reproducible results, not caches', () => {
  const input = fixture(), before = structuredClone(input);
  const text = exportReplayBookmark(input.experiment, input.perspective), result = parseReplayBookmark(text);
  assert.deepEqual(result, input); assert.deepEqual(input, before);
  assert.equal(canonicalExperiment(result.experiment), canonicalExperiment(input.experiment));
  assert.deepEqual(simulateExperiment(result.experiment), simulateExperiment(input.experiment));
  assert.deepEqual(Object.keys(result), ['format', 'version', 'experiment', 'perspective']);
  result.experiment.variants[0].name = 'Different';
  assert.equal(input.experiment.variants[0].name, before.experiment.variants[0].name);
});
test('canonical text ignores object key insertion order but retains meaningful array order', () => {
  const input = fixture(), other = reverse(input);
  assert.equal(exportReplayBookmark(input.experiment, input.perspective), exportReplayBookmark(other.experiment, other.perspective));
  other.experiment.variants.reverse();
  assert.notEqual(exportReplayBookmark(input.experiment, input.perspective), exportReplayBookmark(other.experiment, other.perspective));
});
test('all views, null selection, boundary zoom/time and full IDs roundtrip', () => {
  for (const view of ['baseline', 'disruption', 'compare', 'split']) {
    const input = fixture(); input.experiment.variants[0].id = 'v'.repeat(96);
    input.experiment.baseScenario.vehicles[0].id = 'full-vehicle-id';
    for (const job of input.experiment.baseScenario.jobs) job.vehicleId = 'full-vehicle-id';
    Object.assign(input.perspective, { view, variantId: 'v'.repeat(96), vehicleId: 'full-vehicle-id', zoom: .65, timeS: 0 });
    assert.deepEqual(parseReplayBookmark(exportReplayBookmark(input.experiment, input.perspective)), input);
    Object.assign(input.perspective, { vehicleId: null, zoom: 2.5, timeS: REPLAY_BOOKMARK_LIMITS.maxTimeS });
    assert.deepEqual(validateReplayBookmark(input), input);
  }
});
test('rejects missing or unknown envelope and perspective fields, including result caches', () => {
  for (const path of [[], ['perspective']]) {
    const original = path.length ? fixture().perspective : fixture();
    for (const key of Object.keys(original)) {
      const input = fixture(), target = path.length ? input.perspective : input; delete target[key];
      assert.throws(() => validateReplayBookmark(input), /required/);
    }
    for (const key of ['metadata', 'results', '__proto__', 'prototype', 'constructor']) {
      const input = fixture(), target = path.length ? input.perspective : input;
      Object.defineProperty(target, key, { value: {}, enumerable: true });
      assert.throws(() => validateReplayBookmark(input), /unsupported/);
    }
  }
});
test('rejects unsupported versions, formats, views and dangling selection references', () => {
  for (const [key, value] of [['version', 2], ['version', '1'], ['format', 'detourlab-experiment']]) {
    const input = fixture(); input[key] = value; assert.throws(() => validateReplayBookmark(input));
  }
  for (const [key, value] of [['view', 'overlay'], ['variantId', 'missing'], ['variantId', null], ['vehicleId', 'missing'], ['vehicleId', 1]]) {
    const input = fixture(); input.perspective[key] = value; assert.throws(() => validateReplayBookmark(input));
  }
});
test('rejects nonfinite, coercible, negative and out-of-range presentation numbers', () => {
  for (const key of ['timeS', 'zoom']) for (const value of [NaN, Infinity, -Infinity, '1', null, {}, -1, Number.MAX_SAFE_INTEGER + 1]) {
    const input = fixture(); input.perspective[key] = value; assert.throws(() => validateReplayBookmark(input), /finite number/);
  }
  for (const zoom of [.649, 2.501]) { const input = fixture(); input.perspective.zoom = zoom; assert.throws(() => validateReplayBookmark(input)); }
  const input = fixture(); input.perspective.timeS = -0; assert.equal(Object.is(validateReplayBookmark(input).perspective.timeS, -0), false);
});
test('never invokes accessors or toJSON and rejects inherited or symbol data', () => {
  let calls = 0;
  for (const level of ['root', 'perspective', 'experiment']) {
    for (const kind of ['getter', 'prototype', 'symbol', 'toJSON']) {
      const input = fixture(), target = level === 'root' ? input : input[level];
      if (kind === 'getter') Object.defineProperty(target, Object.keys(target)[0], { get() { calls++; throw Error('executed'); } });
      if (kind === 'prototype') Object.setPrototypeOf(target, { inherited: true });
      if (kind === 'symbol') target[Symbol('extra')] = 1;
      if (kind === 'toJSON') target.toJSON = () => { calls++; throw Error('executed'); };
      assert.throws(() => validateReplayBookmark(input));
    }
  }
  assert.equal(calls, 0);
  const input = fixture(); Object.setPrototypeOf(input, null); Object.setPrototypeOf(input.perspective, null);
  assert.equal(validateReplayBookmark(input).perspective.view, 'split');
});
test('nested strict experiment validation rejects hostile metadata and invalid network inputs', () => {
  const input = fixture(); input.experiment.baseScenario.nodes[0].extra = 1;
  assert.throws(() => validateReplayBookmark(input), /unsupported/);
  assert.throws(() => parseReplayBookmark('{"__proto__":{}}'), /unsupported/);
});
test('parser enforces JSON text and UTF-8 byte bounds before parsing', () => {
  for (const value of [null, {}, 1, undefined]) assert.throws(() => parseReplayBookmark(value), /JSON text/);
  for (const value of ['', '{', 'null', '[]']) assert.throws(() => parseReplayBookmark(value));
  assert.throws(() => parseReplayBookmark(' '.repeat(REPLAY_BOOKMARK_LIMITS.maxBytes + 1)), /2 MiB/);
  assert.throws(() => parseReplayBookmark('界'.repeat(Math.floor(REPLAY_BOOKMARK_LIMITS.maxBytes / 3) + 1)), /2 MiB/);
  const input = fixture(); input.experiment.name = '<script>literal & safe</script>';
  assert.equal(parseReplayBookmark(exportReplayBookmark(input.experiment, input.perspective)).experiment.name, input.experiment.name);
});
test('whole-envelope byte limit includes perspective: exact boundary exports and one more byte fails', () => {
  const input = fixture(), scenario = input.experiment.baseScenario;
  scenario.edges = Array.from({ length: 8000 }, (_, i) => ({ ...scenario.edges[0], id: `e${i}`, roadName: 'R' }));
  input.experiment.variants.forEach(variant => { variant.closures = []; });
  input.experiment.variants[0].closures = Array.from({ length: 8000 }, (_, i) => ({ id: `c${String(i).padStart(4, '0')}${'x'.repeat(91)}`, edgeIds: ['e0'], atS: 0 }));
  let remaining = REPLAY_BOOKMARK_LIMITS.maxBytes - Buffer.byteLength(JSON.stringify(input));
  assert.ok(remaining > 0);
  for (const edge of scenario.edges) { const n = Math.min(118, remaining); edge.roadName += 'R'.repeat(n); remaining -= n; }
  assert.equal(remaining, 0);
  const text = exportReplayBookmark(input.experiment, input.perspective);
  assert.equal(Buffer.byteLength(text), REPLAY_BOOKMARK_LIMITS.maxBytes);
  assert.deepEqual(parseReplayBookmark(text), validateReplayBookmark(input));
  scenario.edges[0].roadName += 'R';
  assert.throws(() => exportReplayBookmark(input.experiment, input.perspective), /2 MiB/);
});
