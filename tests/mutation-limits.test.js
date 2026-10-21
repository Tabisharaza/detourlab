import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS } from '../src/scenario.js';
import { EXPERIMENT_LIMITS, experimentFromScenario, validateExperiment } from '../src/experiment.js';
import { INPUT_ERROR_MAX_LENGTH } from '../src/file-input.js';
import { application, minimalScenario } from './helpers/application.js';

// Execute the checked-in UI handlers with DOM/Worker stand-ins. These are not
// native browser tests. Every starting experiment passes the real validator.
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const eventInput = (app, index = 0) => app.element('event-list').children[index].children[2].children[1];
const closure = (id, edgeIds = ['ab']) => ({ id, edgeIds, atS: 0 });

function withClosureCount(count) {
  const input = experimentFromScenario(minimalScenario('mutation-count-boundary'));
  input.variants[0].closures = Array.from({ length: count }, (_, i) => closure(`c${i}`));
  return input;
}

function withParallelEdges(longIds = false) {
  const input = experimentFromScenario(minimalScenario('mutation-byte-boundary'));
  const template = input.baseScenario.edges[0];
  input.baseScenario.edges = Array.from({ length: LIMITS.edges }, (_, i) => ({
    ...template, id: longIds ? `e${i}`.padEnd(96, 'x') : `e${i}`, roadName: 'R',
  }));
  input.variants[0].closures = [closure('cutoff', [input.baseScenario.edges[0].id])];
  return input;
}

function withReferenceCount() {
  const input = withParallelEdges(), ids = input.baseScenario.edges.map(edge => edge.id);
  input.variants[0].closures = [
    ...Array.from({ length: 3 }, (_, i) => closure(`c${i}`, [...ids])),
    closure('extra', [ids[0]]),
  ];
  assert.equal(input.variants[0].closures.reduce((sum, item) => sum + item.edgeIds.length, 0), 24001);
  return input;
}

function atByteLimit() {
  const input = withParallelEdges(true);
  let remaining = EXPERIMENT_LIMITS.maxBytes - bytes(input);
  assert.ok(remaining > 0);
  for (const edge of input.baseScenario.edges) {
    const added = Math.min(119, remaining);
    edge.roadName += 'R'.repeat(added); remaining -= added;
  }
  assert.equal(remaining, 0);
  assert.equal(bytes(input), EXPERIMENT_LIMITS.maxBytes);
  return input;
}

async function loaded(input) {
  validateExperiment(input);
  const app = application();
  await app.importExperiment(input);
  assert.deepEqual(app.state.experiment, input);
  app.latestWorker().respond();
  return app;
}

function unchanged(app, focus) {
  focus.focus();
  assert.strictEqual(app.document.activeElement, focus);
  const state = structuredClone(app.state), results = app.state.allResults;
  const worker = app.latestWorker(), requests = app.posted.length;
  const display = ['distance-value', 'late-value', 'unreachable-value', 'comparison-status', 'status-line']
    .map(id => [id, app.element(id).textContent]);
  return () => {
    assert.deepEqual(app.state, state, 'failed mutations preserve all experiment and replay state');
    assert.strictEqual(app.state.allResults, results, 'completed results are not replaced or cleared');
    assert.strictEqual(app.latestWorker(), worker);
    assert.equal(app.posted.length, requests, 'a rejected edit starts no replacement worker');
    assert.strictEqual(app.document.activeElement, focus, 'rejection must not move focus');
    for (const [id, text] of display) assert.equal(app.element(id).textContent, text);
  };
}

function rejection(app, pattern) {
  const toast = app.element('toast');
  assert.equal(toast.hidden, false);
  assert.ok(toast.classList.contains('error'));
  assert.match(toast.textContent, /^Change rejected\. /u);
  assert.match(toast.textContent, pattern);
  assert.ok(toast.textContent.length <= 'Change rejected. '.length + INPUT_ERROR_MAX_LENGTH);
  assert.doesNotMatch(toast.textContent, /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u206f]/u);
}

for (const [name, fixture, error] of [
  ['aggregate closure count', () => withClosureCount(4001), /aggregate limit of 8000 closure records/u],
  ['aggregate edge references', withReferenceCount, /aggregate limit of 48000 closure edge references/u],
  ['UTF-8 byte budget', atByteLimit, /2 MiB/u],
]) {
  test(`duplicate rejects ${name} visibly without losing input, results or focus`, async () => {
    const app = await loaded(fixture()), button = app.element('duplicate-variant');
    assert.equal(button.disabled, false, 'two variants do not hit the six-variant UI ceiling');
    const preserved = unchanged(app, button);
    await assert.doesNotReject(async () => button.click());
    preserved(); rejection(app, error);
    assert.equal(app.state.experiment.variants.length, 2);
  });
}

test('duplicate still accepts exactly 8000 aggregate closure records and runs the new independent variant', async () => {
  const app = await loaded(withClosureCount(4000)), source = app.state.experiment.variants[0];
  const requests = app.posted.length;
  await app.element('duplicate-variant').click();
  assert.equal(app.state.experiment.variants.length, 3);
  assert.equal(app.state.experiment.variants.reduce((sum, variant) => sum + variant.closures.length, 0), 8000);
  const duplicate = app.state.experiment.variants.at(-1);
  assert.notEqual(duplicate.id, source.id);
  assert.deepEqual(duplicate.closures, source.closures);
  assert.notStrictEqual(duplicate.closures, app.state.experiment.variants[0].closures);
  assert.notStrictEqual(duplicate.closures[0].edgeIds, app.state.experiment.variants[0].closures[0].edgeIds);
  assert.equal(app.state.selectedVariantId, duplicate.id);
  assert.equal(app.posted.length, requests + 1);
  assert.equal(app.state.pending, true);
  app.latestWorker().respond();
  assert.equal(app.state.pending, false);
  assert.equal(app.state.allResults.variants.length, 3);
});

test('adding a road closure at the imported record limit reports rejection without changing the current run', async () => {
  const app = await loaded(withClosureCount(LIMITS.closures));
  await app.change('road-select', 'bc'); await app.change('road-direction', 'forward');
  const button = app.element('toggle-road'), preserved = unchanged(app, button);
  await assert.doesNotReject(async () => button.click());
  preserved(); rejection(app, /closures must be an array with 0–8000 entries/u);
});

test('a rejected cutoff edit restores the focused control to the saved value at the byte limit', async () => {
  const app = await loaded(atByteLimit()), input = eventInput(app);
  const preserved = unchanged(app, input);
  input.value = '604800';
  await assert.doesNotReject(async () => input.emit('change'));
  preserved(); rejection(app, /2 MiB/u);
  assert.equal(input.value, '0', 'the editor must not display a cutoff the experiment rejected');
  // A same-width edit fits: failure must not lock the control or poison retries.
  input.value = '1'; await input.emit('change');
  assert.equal(app.state.experiment.variants[0].closures[0].atS, 1);
  assert.equal(app.state.pending, true);
});

test('rename shares the bounded mutation error boundary for an imported byte-limit experiment', async () => {
  const app = await loaded(atByteLimit());
  await app.change('variant-name', 'A longer name than Supplied scenario');
  const button = app.element('rename-variant'), preserved = unchanged(app, button);
  await assert.doesNotReject(async () => button.click());
  preserved(); rejection(app, /2 MiB/u);
});
