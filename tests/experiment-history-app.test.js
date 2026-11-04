import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { application, deferredFile } from './helpers/application.js';
import { createTutorialExperiment } from '../src/tutorial.js';
import { exportReplayBookmark } from '../src/replay-bookmark.js';

// Checked-in handlers with DOM/Worker stand-ins. This is not native keyboard,
// layout, assistive-technology, Worker or file-chooser evidence.
async function ready() {
  const app = application();
  await app.importExperiment(createTutorialExperiment()); app.latestWorker().respond();
  return app;
}
const click = (app, id) => app.element(id).click();
async function rename(app, name) { await app.change('variant-name', name, 'input'); await click(app, 'rename-variant'); }
const counts = (app, undo, redo) => assert.match(app.element('history-status').textContent, new RegExp(`${undo} undo · ${redo} redo\\.`));
const current = app => app.state.experiment.variants.find(variant => variant.id === app.state.selectedVariantId);
const eventInput = app => app.element('event-list').children[0].children[2].children[1];
const eventRemove = app => app.element('event-list').children[0].children[2].children[2];
const replayFile = () => new Blob([exportReplayBookmark(createTutorialExperiment(), { variantId: 'close-at-10', vehicleId: 'van-1', timeS: 20.5, view: 'split', zoom: 1.2 })]);
const openReplay = (app, file = replayFile()) => app.element('replay-input').emit('change', { target: { files: [file], value: 'file' } });

test('history starts empty with native controls, accessible action labels and session limits', async () => {
  const app = await ready(); counts(app, 0, 0);
  for (const id of ['undo-edit', 'redo-edit']) {
    assert.equal(app.element(id).tagName, 'BUTTON'); assert.equal(app.element(id).disabled, true);
    assert.equal(app.element(id).getAttribute('type'), 'button');
    assert.equal(app.element(id).getAttribute('aria-describedby'), 'history-help');
  }
  assert.equal(app.element('history-status').getAttribute('role'), 'status');
  assert.equal(app.element('history-status').getAttribute('aria-live'), 'polite');
  assert.equal(app.element('history-status').getAttribute('aria-atomic'), 'true');
  const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(markup, /up to 20 steps within 16 MiB/); assert.match(markup, /Reload clears history/);
  await rename(app, 'Independent plan'); counts(app, 1, 0);
  assert.equal(app.element('undo-edit').getAttribute('aria-label'), 'Undo: Rename variant');
  await click(app, 'undo-edit'); counts(app, 0, 1);
  assert.equal(app.element('redo-edit').getAttribute('aria-label'), 'Redo: Rename variant');
});

test('rename, duplicate and removal restore exact inputs and valid pre-edit selection in order', async () => {
  const app = await ready(); await app.change('variant-select', 'close-at-10');
  const before = structuredClone(app.state.experiment);
  await rename(app, 'Named plan'); const named = structuredClone(app.state.experiment);
  await click(app, 'duplicate-variant'); const copyId = app.state.selectedVariantId, duplicated = structuredClone(app.state.experiment);
  assert.notEqual(copyId, 'close-at-10'); assert.equal(current(app).name, 'Named plan copy');
  await click(app, 'delete-variant'); const removed = structuredClone(app.state.experiment);
  assert.equal(app.state.selectedVariantId, 'clear'); counts(app, 3, 0);
  await click(app, 'undo-edit'); assert.deepEqual(app.state.experiment, duplicated); assert.equal(app.state.selectedVariantId, copyId);
  await click(app, 'undo-edit'); assert.deepEqual(app.state.experiment, named); assert.equal(app.state.selectedVariantId, 'close-at-10');
  await click(app, 'undo-edit'); assert.deepEqual(app.state.experiment, before); assert.equal(app.state.selectedVariantId, 'close-at-10'); counts(app, 0, 3);
  await click(app, 'redo-edit'); assert.deepEqual(app.state.experiment, named);
  await click(app, 'redo-edit'); assert.deepEqual(app.state.experiment, duplicated); assert.equal(app.state.selectedVariantId, copyId);
  await click(app, 'redo-edit'); assert.deepEqual(app.state.experiment, removed); assert.equal(app.state.selectedVariantId, 'clear'); counts(app, 3, 0);
});

test('road toggle, event time, removal and preset each restore independent closure schedules', async () => {
  const app = await ready(); await app.change('variant-select', 'close-at-10');
  const original = structuredClone(app.state.experiment);
  const input = eventInput(app); input.value = '10.25'; await input.emit('change');
  assert.equal(current(app).closures[0].atS, 10.25); counts(app, 1, 0);
  assert.equal(app.element('undo-edit').getAttribute('aria-label'), 'Undo: Change closure time');
  await eventRemove(app).click(); assert.deepEqual(current(app).closures, []);
  await app.change('road-select', 'bc'); await app.change('road-direction', 'forward'); await click(app, 'toggle-road');
  assert.deepEqual(current(app).closures[0].edgeIds, ['bc']); counts(app, 3, 0);
  await app.element('preset-list').children.find(button => button.dataset.preset === 'clear').click();
  assert.deepEqual(current(app).closures, []); counts(app, 4, 0);
  for (let step = 0; step < 4; step += 1) await click(app, 'undo-edit');
  assert.deepEqual(app.state.experiment, original); counts(app, 0, 4);
  for (let step = 0; step < 4; step += 1) await click(app, 'redo-edit');
  assert.deepEqual(current(app).closures, []); counts(app, 4, 0);
  assert.deepEqual(app.state.experiment.variants.filter(variant => variant.id !== 'close-at-10'), original.variants.filter(variant => variant.id !== 'close-at-10'));
});

test('selection, scrubbing, view, zoom, playback, picker inputs and reruns do not create edits', async () => {
  const app = await ready(); const before = structuredClone(app.state.experiment);
  await app.change('variant-select', 'close-at-11'); await app.change('timeline', 12.5, 'input');
  for (const id of ['view-split', 'zoom-in', 'edit-roads', 'play-button', 'replay-button']) await click(app, id);
  await app.change('road-search', 'Street', 'input'); await app.change('road-direction', 'forward');
  await app.change('closure-time', 17, 'input'); await app.change('speed', 5); await app.change('vehicle-select', 'van-1');
  await click(app, 'run-experiment'); app.latestWorker().respond(); counts(app, 0, 0);
  assert.deepEqual(app.state.experiment, before);
  await rename(app, 'Selected for edit'); await click(app, 'undo-edit');
  assert.equal(app.state.selectedVariantId, 'close-at-11');
});

test('invalid and no-op edits preserve results and redo without starting another Worker', async () => {
  const app = await ready(); await app.change('variant-select', 'close-at-10');
  await rename(app, 'A change'); await click(app, 'undo-edit'); app.latestWorker().respond();
  const results = app.state.allResults, original = app.state.experiment, count = app.posted.length;
  for (const name of ['Close at 10 s', '  Close at 10 s  ', '', ' ', 'a'.repeat(121)]) await rename(app, name);
  const input = eventInput(app);
  for (const value of ['10', '10.0', '', '-1', 'NaN', 'Infinity', '604801']) { input.value = value; await input.emit('change'); }
  await app.change('road-select', 'bc'); await app.change('road-direction', 'reverse'); await click(app, 'toggle-road');
  counts(app, 0, 1); assert.equal(app.state.experiment, original); assert.equal(app.state.allResults, results); assert.equal(app.posted.length, count);
  await click(app, 'redo-edit'); assert.equal(current(app).name, 'A change');
});

test('a repeated clear preset is a no-op, and a successful divergent edit discards redo', async () => {
  const app = await ready(); await rename(app, 'Old future'); await click(app, 'undo-edit');
  const count = app.posted.length;
  await app.element('preset-list').children.find(button => button.dataset.preset === 'clear').click();
  counts(app, 0, 1); assert.equal(app.posted.length, count);
  await rename(app, 'New future'); counts(app, 1, 0); assert.equal(app.element('redo-edit').disabled, true);
  await click(app, 'redo-edit'); assert.equal(current(app).name, 'New future');
});

test('variant selection preserves redo and is captured for the next successful edit', async () => {
  const app = await ready(); await rename(app, 'Changed clear'); await click(app, 'undo-edit');
  await app.change('variant-select', 'close-at-11'); counts(app, 0, 1);
  await click(app, 'redo-edit'); assert.equal(app.state.selectedVariantId, 'clear');
  await click(app, 'undo-edit'); assert.equal(app.state.selectedVariantId, 'close-at-11');
  await rename(app, 'Changed selected'); await click(app, 'undo-edit');
  assert.equal(app.state.selectedVariantId, 'close-at-11'); counts(app, 0, 1);
});

test('undo/redo pauses, preserves view and picker, replaces pending Worker exactly once and rejects late work', async () => {
  const app = await ready(); await app.change('variant-select', 'close-at-10');
  await click(app, 'view-split'); await click(app, 'zoom-in'); await app.change('timeline', 12.5, 'input');
  await app.change('road-search', 'Second', 'input'); await app.change('road-direction', 'forward');
  await rename(app, 'Pending edit'); const old = app.latestWorker(); await click(app, 'play-button');
  const count = app.posted.length; await click(app, 'undo-edit');
  assert.equal(old.terminated, true); assert.equal(app.posted.length, count + 1); assert.equal(app.state.playing, false);
  assert.equal(app.state.view, 'split'); assert.equal(app.state.zoom, 1.2); assert.equal(app.state.time, 12.5);
  assert.equal(app.element('road-search').value, 'Second'); assert.equal(app.element('road-select').value, 'bc'); assert.equal(app.element('road-direction').value, 'forward');
  assert.equal(app.state.allResults, null); assert.equal(app.state.baseline, null); assert.equal(app.state.disrupted, null);
  old.respond(); old.fail(); assert.equal(app.state.allResults, null); assert.equal(app.state.pending, true);
  const undoWorker = app.latestWorker(); await click(app, 'redo-edit');
  assert.equal(undoWorker.terminated, true); assert.equal(app.posted.length, count + 2);
  undoWorker.respond(); assert.equal(app.state.allResults, null); app.latestWorker().respond();
  assert.equal(current(app).name, 'Pending edit'); assert.equal(app.state.time, 12.5); assert.equal(app.state.playing, false);
});

test('history recomputes from inputs rather than trusting previously displayed result objects', async () => {
  const app = await ready(); const firstResults = app.state.allResults;
  firstResults.baseline.metrics.distanceM = 999999;
  await rename(app, 'Another name'); app.latestWorker().respond(); app.state.allResults.variants[0].result.metrics.lateJobs = 777;
  await click(app, 'undo-edit'); assert.equal(app.state.allResults, null);
  assert.deepEqual(Object.keys(app.latestWorker().request).sort(), ['experiment', 'id']);
  assert.deepEqual(Object.keys(app.latestExperiment()).sort(), ['baseScenario', 'format', 'id', 'name', 'variants', 'version']);
  app.latestWorker().respond(); assert.notEqual(app.state.allResults, firstResults);
  assert.equal(app.state.allResults.baseline.metrics.distanceM, 200); assert.equal(app.state.allResults.variants[0].result.metrics.lateJobs, 0);
});

for (const direction of ['undo', 'redo']) for (const kind of ['import', 'bookmark']) {
  test(`${direction} supersedes a pending ${kind} file read`, async () => {
    const app = await ready(); await rename(app, 'Edit retained');
    if (direction === 'redo') await click(app, 'undo-edit');
    const held = deferredFile(), pending = kind === 'import' ? app.importFile(held.file) : openReplay(app, held.file);
    await click(app, `${direction}-edit`); const expected = app.state.experiment, count = app.posted.length;
    held.resolve(kind === 'import' ? new TextEncoder().encode(JSON.stringify(createTutorialExperiment())).buffer : await replayFile().arrayBuffer()); await pending;
    assert.equal(app.state.experiment, expected); assert.equal(app.posted.length, count); app.latestWorker().respond();
    assert.notEqual(app.state.time, 20.5); assert.notEqual(app.state.view, 'split');
  });
}

test('editing and undo after a bookmark load cannot resurrect its stale saved perspective', async () => {
  const app = await ready(); await openReplay(app); const bookmarkWorker = app.latestWorker(); counts(app, 0, 0);
  await rename(app, 'Edit while loading'); const editedWorker = app.latestWorker();
  await click(app, 'undo-edit'); bookmarkWorker.respond(); editedWorker.respond();
  assert.equal(app.state.allResults, null); app.latestWorker().respond();
  assert.equal(current(app).name, 'Close at 10 s'); assert.equal(app.state.time, 0); assert.equal(app.state.view, 'disruption');
  assert.equal(app.state.playing, false); assert.doesNotMatch(app.element('replay-status').textContent, /loaded and recomputed/);
});

test('history invalidates a pending closure study and rejects its late completion', async () => {
  const app = await ready(); await rename(app, 'Study source'); app.latestWorker().respond();
  await app.change('variant-select', 'close-at-10'); await click(app, 'cutoff-button'); await app.change('cutoff-times', '10,11', 'input'); await click(app, 'cutoff-run');
  const study = app.latestWorker(); await click(app, 'undo-edit');
  assert.equal(study.terminated, true); assert.equal(app.element('cutoff-fields').disabled, true);
  assert.equal(app.element('cutoff-export').disabled, true); assert.equal(app.element('cutoff-rows').children.length, 0);
  study.respond(); assert.equal(app.element('cutoff-rows').children.length, 0); assert.equal(app.state.allResults, null);
  app.latestWorker().respond(); assert.equal(app.element('cutoff-results').hidden, true);
});

test('failed or canceled imports preserve history; successful import, replay open and Reset start fresh', async () => {
  const app = await ready(); await rename(app, 'Before boundaries'); await click(app, 'undo-edit');
  await app.importFile(new Blob(['not json'])); counts(app, 0, 1);
  await openReplay(app, new Blob(['not a bookmark'])); counts(app, 0, 1);
  await app.element('import-input').emit('change', { target: { files: [], value: '' } }); counts(app, 0, 1);
  await app.element('replay-input').emit('change', { target: { files: [], value: '' } }); counts(app, 0, 1);
  await app.importExperiment(createTutorialExperiment()); counts(app, 0, 0);
  await rename(app, 'Before bookmark'); await openReplay(app); counts(app, 0, 0);
  await rename(app, 'Before reset'); await click(app, 'reset-button'); counts(app, 0, 0);
  assert.equal(app.state.experiment.id, 'meridian-seed-42');
});

test('guided lesson edits, navigation and lesson resets leave both parent stacks untouched', async () => {
  const app = await ready(); await app.change('variant-select', 'close-at-11'); await rename(app, 'Parent A'); await rename(app, 'Parent B'); await click(app, 'undo-edit');
  const parent = structuredClone(app.state.experiment), selected = app.state.selectedVariantId;
  await click(app, 'try-example-button'); await click(app, 'lesson-start');
  for (const id of ['undo-edit', 'redo-edit']) assert.equal(app.element(id).disabled, true);
  assert.match(app.element('history-status').textContent, /History paused.*lesson/);
  await rename(app, 'Lesson change'); await click(app, 'duplicate-variant'); await click(app, 'undo-edit');
  assert.equal(current(app).name, 'Lesson change copy');
  await click(app, 'reset-button'); await click(app, 'lesson-close-at-10');
  const input = eventInput(app); input.value = '12'; await input.emit('change');
  await click(app, 'return-experiment'); assert.deepEqual(app.state.experiment, parent); assert.equal(app.state.selectedVariantId, selected); counts(app, 1, 1);
  await click(app, 'redo-edit'); assert.equal(current(app).name, 'Parent B');
  await click(app, 'undo-edit'); assert.equal(current(app).name, 'Parent A'); await click(app, 'undo-edit'); assert.equal(current(app).name, 'Close at 11 s');
});

test('lesson cancellation does not clear history or interrupt its pending Worker', async () => {
  const app = await ready(); await rename(app, 'Keep my work'); await rename(app, 'Keep my redo'); await click(app, 'undo-edit'); const worker = app.latestWorker();
  await click(app, 'try-example-button'); await click(app, 'lesson-cancel'); counts(app, 1, 1);
  assert.equal(app.latestWorker(), worker); assert.equal(worker.terminated, false);
});

test('focused boundary buttons hand off to the available action and never steal newer input focus', async () => {
  const app = await ready(); await rename(app, 'One'); await rename(app, 'Two');
  app.element('undo-edit').focus(); await click(app, 'undo-edit'); assert.equal(app.document.activeElement, app.element('undo-edit'));
  await click(app, 'undo-edit'); assert.equal(app.document.activeElement, app.element('redo-edit'));
  await click(app, 'redo-edit'); assert.equal(app.document.activeElement, app.element('redo-edit'));
  await click(app, 'redo-edit'); assert.equal(app.document.activeElement, app.element('undo-edit'));
  app.element('variant-name').focus(); await rename(app, 'Three'); assert.equal(app.document.activeElement, app.element('variant-name'));
  app.latestWorker().respond(); assert.equal(app.document.activeElement, app.element('variant-name'));
  app.element('undo-edit').focus(); await app.importExperiment(createTutorialExperiment()); assert.equal(app.document.activeElement, app.element('variant-select'));
});

test('in-place event edits and undo preserve native input identity and newer focus through completion', async () => {
  const app = await ready(); await app.change('variant-select', 'close-at-10'); const input = eventInput(app);
  input.focus(); input.value = '14.5'; await input.emit('change'); assert.equal(eventInput(app), input); assert.equal(app.document.activeElement, input);
  await click(app, 'undo-edit'); assert.equal(eventInput(app), input); assert.equal(app.document.activeElement, input); assert.equal(input.value, '10');
  app.element('road-search').focus(); app.latestWorker().respond(); assert.equal(app.document.activeElement, app.element('road-search'));
});

test('native text undo shortcuts are not intercepted by history', async () => {
  const app = await ready(); await rename(app, 'Keep experiment name'); app.element('variant-name').focus(); const count = app.posted.length;
  for (const properties of [{ ctrlKey: true }, { metaKey: true }, { ctrlKey: true, shiftKey: true }]) {
    const event = app.windowEvent('keydown', { key: 'z', code: 'KeyZ', ...properties }); assert.equal(event.defaultPrevented, false);
  }
  assert.equal(app.posted.length, count); assert.equal(current(app).name, 'Keep experiment name'); counts(app, 1, 0);
});

test('bounded history retains only the most recent 20 edits and describes the reachable boundary', async () => {
  const app = await ready();
  for (let index = 1; index <= 23; index += 1) await rename(app, `Name ${index}`);
  counts(app, 20, 0);
  for (let index = 0; index < 20; index += 1) await click(app, 'undo-edit');
  assert.equal(current(app).name, 'Name 3'); counts(app, 0, 20); assert.equal(app.element('undo-edit').disabled, true);
  const count = app.posted.length; await click(app, 'undo-edit'); assert.equal(app.posted.length, count);
  for (let index = 0; index < 20; index += 1) await click(app, 'redo-edit');
  assert.equal(current(app).name, 'Name 23'); counts(app, 20, 0);
});

test('undo preserves replay time while pending and clamps only after the new run horizon is known', async () => {
  const app = await ready(); await app.change('variant-select', 'close-at-10');
  const input = eventInput(app); input.value = '600'; await input.emit('change'); app.latestWorker().respond();
  await app.change('timeline', '550.5', 'input'); await click(app, 'undo-edit'); assert.equal(app.state.time, 550.5);
  app.latestWorker().respond(); assert.equal(app.state.time, Number(app.element('timeline').max)); assert.equal(app.state.time, 60);
});

test('Worker failure after an edit keeps input history usable for a fresh undo computation', async () => {
  const app = await ready(); await rename(app, 'Failed computation'); app.latestWorker().fail(); counts(app, 1, 0);
  assert.equal(app.state.allResults, null); await click(app, 'undo-edit'); assert.equal(app.state.pending, true);
  app.latestWorker().respond(); assert.equal(current(app).name, 'Clear roads'); counts(app, 0, 1);
});
