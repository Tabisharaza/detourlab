import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { application, deferredFile, minimalScenario, scenarioText } from './helpers/application.js';
import { createTutorialExperiment } from '../src/tutorial.js';
import { experimentFromScenario, validateExperiment } from '../src/experiment.js';

// Real app handlers and worker results, with controlled DOM/Worker stand-ins.
// Native focus trapping, layout, keyboard activation and file-picker behavior
// still need browser QA; these tests do not claim to exercise a real browser.
const copy = value => structuredClone(value);
const canonical = () => validateExperiment(createTutorialExperiment());
const steps = ['clear', 'close-at-10', 'close-at-11'];
async function start(app = application()) {
  await app.element('try-example-button').click();
  await app.element('lesson-start').click();
  return app;
}
function workspace(app) {
  const { selectedVariantId, time, speed, view, zoom, selectedVehicle, editing } = app.state;
  return { selectedVariantId, time, speed, view, zoom, selectedVehicle, editing,
    closureTime: app.element('closure-time').value, roadDirection: app.element('road-direction').value,
    roadId: app.element('road-select').value, variantName: app.element('variant-name').value };
}

test('lesson is optional; Cancel, native Escape and close preserve the current experiment and results', async () => {
  const app = application(); app.latestWorker().respond();
  assert.equal(app.element('lesson-dialog').open, undefined); assert.equal(app.element('lesson-panel').hidden, true);
  const experiment = app.state.experiment, results = app.state.allResults, before = workspace(app), requests = app.posted.length;
  await app.element('lesson-start').emit('click'); // A closed dialog cannot confirm.
  assert.equal(app.posted.length, requests);
  for (const dismiss of [() => app.element('lesson-cancel').click(), () => app.element('lesson-dialog').escape(), () => app.element('lesson-dialog').close()]) {
    await app.element('play-button').click();
    app.element('try-example-button').focus(); await app.element('try-example-button').click();
    assert.equal(app.state.playing, false); assert.equal(app.element('lesson-dialog').open, true);
    assert.equal(app.document.activeElement, app.element('lesson-cancel'));
    await dismiss();
    assert.equal(app.element('lesson-dialog').open, false); assert.equal(app.state.lessonActive, false);
    assert.equal(app.document.activeElement, app.element('try-example-button'));
    assert.strictEqual(app.state.experiment, experiment); assert.strictEqual(app.state.allResults, results);
    assert.deepEqual(workspace(app), before); assert.equal(app.posted.length, requests);
  }
});

test('opening and dismissing confirmation keeps a pending worker alive and accepts its result', async () => {
  const app = application(), worker = app.latestWorker();
  await app.element('try-example-button').click(); await app.element('lesson-dialog').escape();
  assert.equal(worker.terminated, false); assert.equal(app.state.pending, true);
  const outcome = worker.respond(); assert.deepEqual(app.state.allResults, outcome);
  assert.equal(app.state.lessonActive, false);
});

test('guide entry closes the guide and cancel returns focus to a visible main entry', async () => {
  const app = application();
  await app.element('assumptions-button').click(); assert.equal(app.element('guide-dialog').open, true);
  await app.element('guide-example-button').click();
  assert.equal(app.element('guide-dialog').open, false); assert.equal(app.element('lesson-dialog').open, true);
  await app.element('lesson-cancel').click();
  assert.equal(app.document.activeElement, app.element('try-example-button'));
  await app.element('quick-example-button').click(); assert.equal(app.element('lesson-dialog').open, true);
  await app.element('lesson-dialog').escape(); assert.equal(app.document.activeElement, app.element('quick-example-button'));
});

test('confirmed lesson starts canonical clear roads at time zero, 1× and Compare, with safe import controls', async () => {
  const app = await start();
  assert.deepEqual(app.state.experiment, canonical()); assert.equal(app.state.lessonActive, true);
  assert.equal(app.state.lessonModified, false); assert.equal(app.state.selectedVariantId, 'clear');
  assert.equal(app.state.time, 0); assert.equal(app.state.speed, 1); assert.equal(app.element('speed').value, '1');
  assert.equal(app.state.view, 'compare'); assert.equal(app.element('view-compare').getAttribute('aria-pressed'), 'true');
  assert.equal(app.state.zoom, 1); assert.equal(app.state.editing, false); assert.equal(app.state.playing, false);
  assert.equal(app.element('lesson-dialog').open, false); assert.equal(app.element('lesson-panel').hidden, false);
  assert.equal(app.document.activeElement, app.element('lesson-clear'));
  assert.equal(app.element('reset-button').textContent, '↺ Reset lesson');
  assert.equal(app.element('import-button').disabled, true); assert.equal(app.element('lesson-import-help').hidden, false);
  assert.equal(app.element('import-button').getAttribute('aria-describedby'), 'lesson-import-help');
  assert.match(app.element('lesson-import-help').textContent || readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /Return to your experiment before importing/u);
  assert.equal(app.element('closure-time').value, '10'); assert.equal(app.element('closure-time').step, '1');
  for (const id of steps) assert.equal(app.element('lesson-' + id).getAttribute('aria-pressed'), String(id === 'clear'));
});

test('dialog dismissal falls back to the main entry when its responsive trigger becomes hidden', async () => {
  const app = application();
  await app.element('quick-example-button').click();
  app.element('quick-example-button').style.display = 'none';
  await app.element('lesson-dialog').escape();
  assert.equal(app.document.activeElement, app.element('try-example-button'));
  assert.equal(app.state.lessonActive, false);
});

test('lesson steps select the actual plan and cutoff; metrics, computed paths and arrivals use engine results', async () => {
  const app = await start(); app.latestWorker().respond(); const requests = app.posted.length;
  for (const [id, time, distance, late, path, arrival, finish] of [
    ['clear', 0, '200 m', 0, 'A → B → C', '00:20', '00:23'],
    ['close-at-10', 10, '260 m', 1, 'A → B → D → C', '00:26', '00:29'],
    ['close-at-11', 11, '200 m', 0, 'A → B → C', '00:20', '00:23'],
  ]) {
    await app.element('play-button').click(); await app.element('lesson-' + id).click();
    assert.equal(app.state.selectedVariantId, id); assert.equal(app.state.time, time); assert.equal(app.state.playing, false);
    assert.equal(app.element('timeline').value, String(time)); assert.equal(app.state.view, 'compare');
    assert.equal(app.element('distance-value').textContent, distance.replace(' ', ''));
    assert.equal(app.element('late-value').textContent, `${late}/ 1`);
    assert.equal(app.element('route-baseline-distance').textContent, '200 m');
    assert.equal(app.element('route-scenario-distance').textContent, distance);
    assert.equal(app.element('route-path').textContent, `Computed path: ${path}`);
    assert.equal(app.element('route-path').hidden, false);
    assert.equal(app.element('route-scenario-time').textContent, `${finish} elapsed`);
    assert.match(app.element('job-list').textContent, new RegExp(`Arrived ${arrival} · due 00:22`, 'u'));
    assert.match(app.element('lesson-story').textContent, /3 (?:more )?seconds|3 s of service/u);
    assert.equal(app.element('job-list').children[0].children[0].children[1].textContent, late ? '+4 s' : 'ON TIME');
    for (const other of steps) assert.equal(app.element('lesson-' + other).getAttribute('aria-pressed'), String(other === id));
  }
  assert.match(app.element('lesson-story').textContent, /already on B → C/u);
  assert.match(app.element('comparison-status').textContent, /200 m, 0 late, 0 unreachable/u);
  assert.equal(app.posted.length, requests, 'steps reuse the same computed ledgers');
});

test('return restores independent prior work, selected plan and all workspace controls while staying paused', async () => {
  const app = application(), scenario = minimalScenario('my-experiment');
  scenario.durationS = 900; scenario.vehicles.push({ id: 'van-2', startNode: 'A', startTimeS: 1 });
  scenario.jobs.push({ ...scenario.jobs[0], id: 'job-2', vehicleId: 'van-2' });
  await app.importExperiment(experimentFromScenario(scenario)); app.latestWorker().respond();
  await app.change('variant-select', 'clear-roads'); await app.change('vehicle-select', 'van-2');
  await app.change('timeline', 257, 'input'); await app.change('speed', 120);
  await app.element('view-baseline').click(); await app.element('zoom-in').click(); await app.element('zoom-in').click();
  await app.element('edit-roads').click(); await app.change('closure-time', 720);
  await app.change('road-select', 'bc'); await app.change('road-direction', 'reverse'); await app.change('variant-name', 'An unfinished name');
  const experiment = copy(app.state.experiment), before = workspace(app), priorReference = app.state.experiment;
  await app.element('play-button').click(); await start(app);
  priorReference.variants[0].name = 'Mutating an abandoned object cannot change the backup';
  await app.change('variant-name', 'My lesson edits'); await app.element('rename-variant').click();
  const lessonReference = app.state.experiment;
  await app.element('return-experiment').click();
  assert.equal(app.state.lessonActive, false); assert.equal(app.state.lessonModified, false);
  assert.deepEqual(app.state.experiment, experiment); assert.deepEqual(workspace(app), before);
  assert.equal(app.element('timeline').value, '257'); assert.equal(app.element('speed').value, '120');
  assert.equal(app.element('view-baseline').getAttribute('aria-pressed'), 'true');
  assert.equal(app.element('edit-roads').getAttribute('aria-pressed'), 'true');
  assert.equal(app.state.playing, false); assert.equal(app.state.allResults, null); assert.equal(app.state.pending, true);
  assert.equal(app.element('import-button').disabled, false); assert.equal(app.element('lesson-import-help').hidden, true);
  assert.equal(app.element('reset-button').textContent, '↺ Reset experiment'); assert.equal(app.element('lesson-panel').hidden, true);
  assert.equal(app.element('closure-time').step, '60');
  lessonReference.variants[0].name = 'More abandoned edits'; assert.deepEqual(app.state.experiment, experiment);
  app.latestWorker().respond(); assert.deepEqual(workspace(app), before); assert.equal(app.state.playing, false);
  assert.match(app.element('toast').textContent, /Playback is paused/u);
  const restored = app.state.experiment; await app.element('return-experiment').emit('click'); assert.strictEqual(app.state.experiment, restored);
});

test('repeated start/confirm and Reset lesson never replace the one original backup', async () => {
  const app = application(), original = copy(app.state.experiment);
  await start(app); await app.change('variant-name', 'Changed lesson'); await app.element('rename-variant').click();
  const edited = copy(app.state.experiment), requests = app.posted.length;
  await app.element('try-example-button').emit('click'); await app.element('lesson-start').emit('click');
  assert.deepEqual(app.state.experiment, edited); assert.equal(app.posted.length, requests);
  app.element('lesson-dialog').showModal(); await app.element('lesson-start').emit('click');
  assert.deepEqual(app.state.experiment, edited); await app.element('lesson-dialog').close();
  await app.element('reset-button').click();
  assert.deepEqual(app.state.experiment, canonical()); assert.equal(app.state.lessonModified, false);
  assert.equal(app.state.selectedVariantId, 'clear'); assert.equal(app.state.time, 0); assert.equal(app.state.speed, 1);
  for (const id of steps) assert.equal(app.element('lesson-' + id).disabled, false);
  await app.element('return-experiment').click(); assert.deepEqual(app.state.experiment, original);
  await app.change('variant-name', 'Second original'); await app.element('rename-variant').click();
  const second = copy(app.state.experiment); await start(app); await app.element('return-experiment').click();
  assert.deepEqual(app.state.experiment, second, 'a later independent lesson gets a fresh backup');
});

test('all experiment edits invalidate the fixed lesson narrative; controls still work and Reset restores it', async () => {
  const app = await start();
  const actions = [
    async () => { await app.change('variant-name', 'Renamed'); await app.element('rename-variant').click(); },
    () => app.element('duplicate-variant').click(),
    () => app.element('delete-variant').click(),
    async () => { await app.change('road-select', 'bc'); await app.element('toggle-road').click(); },
    async () => { await app.element('lesson-close-at-10').click(); const input = app.element('event-list').children[0].children[2].children[1]; input.value = '9'; await input.emit('change'); },
    async () => { await app.element('lesson-close-at-11').click(); await app.element('event-list').children[0].children[2].children[2].click(); },
    () => app.element('preset-list').children[0].click(),
  ];
  for (const edit of actions) {
    await edit(); assert.equal(app.state.lessonModified, true);
    assert.equal(app.element('lesson-story').textContent, 'Your edits changed the example; reset lesson to repeat.');
    const selected = app.state.selectedVariantId;
    for (const id of steps) { assert.equal(app.element('lesson-' + id).disabled, true); await app.element('lesson-' + id).emit('click'); assert.equal(app.state.selectedVariantId, selected); }
    await app.element('reset-button').click(); assert.equal(app.state.lessonModified, false);
    assert.deepEqual(app.state.experiment, canonical());
  }
  await app.change('timeline', 15, 'input'); await app.change('speed', 30); await app.element('zoom-in').click();
  await app.element('view-baseline').click(); await app.element('edit-roads').click(); await app.change('closure-time', 17);
  assert.equal(app.state.lessonModified, false, 'navigation and a future closure time do not edit the experiment');
});

test('a missing canonical variant disables its step and the guarded handler cannot select it', async () => {
  const app = await start(); app.state.experiment.variants = app.state.experiment.variants.filter(variant => variant.id !== 'close-at-10');
  await app.change('variant-select', 'clear'); assert.equal(app.element('lesson-close-at-10').disabled, true);
  await app.element('lesson-close-at-10').emit('click'); assert.equal(app.state.selectedVariantId, 'clear');
});

test('new and synthetic imports cannot open the chooser or read a file during the lesson', async () => {
  const app = await start(), requests = app.posted.length; let chooserCalls = 0, fileReads = 0;
  app.element('import-input').addEventListener('click', () => { chooserCalls += 1; });
  await app.element('import-button').click(); await app.element('import-button').emit('click');
  await app.importFile({ size: 100, arrayBuffer: async () => { fileReads += 1; return new TextEncoder().encode(scenarioText('unwanted')).buffer; } });
  assert.equal(chooserCalls, 0); assert.equal(fileReads, 0); assert.equal(app.posted.length, requests);
  assert.deepEqual(app.state.experiment, canonical());
  await app.element('return-experiment').click(); await app.element('import-button').click(); assert.equal(chooserCalls, 1);
});

test('pending imports cannot overwrite either the active lesson or the returned original', async () => {
  for (const returnFirst of [false, true]) {
    const app = application(), original = copy(app.state.experiment), pending = deferredFile();
    const importing = app.importFile(pending.file); await start(app);
    if (returnFirst) await app.element('return-experiment').click();
    const worker = app.latestWorker(), toast = app.element('toast').textContent;
    pending.resolve(new TextEncoder().encode(scenarioText('stale-file')).buffer); await importing;
    assert.deepEqual(app.state.experiment, returnFirst ? original : canonical());
    assert.strictEqual(app.latestWorker(), worker); assert.equal(app.element('toast').textContent, toast);
  }
  const app = application(), pending = deferredFile(), importing = app.importFile(pending.file);
  await start(app); await app.element('return-experiment').click(); const toast = app.element('toast').textContent;
  pending.reject(new Error('stale failure')); await importing; assert.equal(app.element('toast').textContent, toast);
});

test('superseded worker completions and errors cannot overwrite lesson, Reset lesson or returned work', async () => {
  const app = application(), original = copy(app.state.experiment), originalWorker = app.latestWorker();
  await start(app); const firstLessonWorker = app.latestWorker();
  originalWorker.respond(undefined, firstLessonWorker.request.id); originalWorker.fail('old failure');
  assert.equal(app.state.allResults, null); assert.equal(app.state.pending, true); assert.deepEqual(app.state.experiment, canonical());
  await app.element('reset-button').click(); const resetWorker = app.latestWorker();
  firstLessonWorker.respond(undefined, resetWorker.request.id); firstLessonWorker.fail('old lesson failure');
  assert.equal(app.state.allResults, null); assert.equal(app.state.pending, true);
  await app.element('return-experiment').click(); const returnWorker = app.latestWorker();
  const toast = app.element('toast').textContent;
  for (const worker of [originalWorker, firstLessonWorker, resetWorker]) { worker.respond(undefined, returnWorker.request.id); worker.fail('old result after return'); }
  assert.deepEqual(app.state.experiment, original); assert.equal(app.state.allResults, null); assert.equal(app.state.pending, true);
  const outcome = returnWorker.respond(); assert.deepEqual(app.state.allResults, outcome);
  resetWorker.respond(); assert.deepEqual(app.state.allResults, outcome); assert.equal(app.element('toast').textContent, toast);
});

test('worker failure during lesson leaves the original safely returnable', async () => {
  const app = application(), original = copy(app.state.experiment); await start(app);
  app.latestWorker().fail('synthetic failure'); assert.equal(app.state.pending, false);
  assert.equal(app.state.lessonActive, true); await app.element('return-experiment').click();
  assert.deepEqual(app.state.experiment, original); app.latestWorker().respond(); assert.ok(app.state.allResults);
});

test('closure range step is set before value on lesson entry and return', async () => {
  const app = application(), range = app.element('closure-time'); await app.change('closure-time', 720);
  let value = range.value; const writes = [];
  Object.defineProperty(range, 'value', { get: () => value, set(next) { writes.push({ value: String(next), step: range.step }); value = String(next); }, configurable: true });
  await start(app); assert.ok(writes.some(write => write.value === '10' && write.step === '1'));
  assert.ok(!writes.some(write => write.value === '10' && write.step !== '1'));
  await app.element('return-experiment').click(); assert.deepEqual(writes.at(-1), { value: '720', step: '60' });
});

test('Space never toggles the underlying replay in either native dialog or on keyboard controls', async () => {
  const app = application();
  await app.element('try-example-button').click(); app.element('lesson-dialog').focus();
  let event = app.windowEvent('keydown', { code: 'Space' }); assert.equal(event.defaultPrevented, false); assert.equal(app.state.playing, false);
  await app.element('lesson-cancel').click(); await app.element('guide-button').click(); app.element('guide-dialog').focus();
  event = app.windowEvent('keydown', { code: 'Space' }); assert.equal(event.defaultPrevented, false); assert.equal(app.state.playing, false);
  await app.element('guide-dialog').close(); await start(app);
  for (const id of ['lesson-clear', 'lesson-close-at-10', 'lesson-close-at-11', 'return-experiment', 'timeline', 'speed']) {
    app.element(id).focus(); event = app.windowEvent('keydown', { code: 'Space' });
    assert.equal(event.defaultPrevented, false); assert.equal(app.state.playing, false);
  }
  app.document.activeElement = app.document.createElement('main');
  event = app.windowEvent('keydown', { code: 'Space' }); assert.equal(event.defaultPrevented, true); assert.equal(app.state.playing, true);
});

test('distance units retain small positive values, zero and the 999/1000 m boundary; large values stay in km', async () => {
  const app = await start(), outcome = app.latestWorker().respond();
  for (const [distance, text] of [[0, '0 m'], [0.25, '0.25 m'], [0.1 + 0.2, '0.3 m'], [123.45678912345678, '123.457 m'], [1e-9, '1e-9 m'], [999, '999 m'], [1000, '1.0 km'], [23456, '23.5 km']]) {
    await app.element('run-experiment').click(); const result = copy(outcome);
    result.baseline.metrics.distanceM = distance; result.baseline.vehicles[0].distanceM = distance;
    result.variants[0].result.metrics.distanceM = distance; result.variants[0].result.vehicles[0].distanceM = distance;
    app.latestWorker().respond(result);
    assert.equal(app.element('distance-value').textContent, text.replace(' ', ''));
    assert.equal(app.element('route-baseline-distance').textContent, text); assert.equal(app.element('route-scenario-distance').textContent, text);
    assert.equal(app.element('variant-results').children[0].children[1].children[0].textContent, text);
  }
});

test('lateness displays exact sub-minute seconds without changing the minute convention for longer delays', async () => {
  const app = await start(), outcome = app.latestWorker().respond();
  for (const [seconds, text] of [[0, 'ON TIME'], [1e-9, '+1e-9 s'], [0.25, '+0.25 s'], [4, '+4 s'], [59, '+59 s'], [60, '+1 min'], [61, '+2 min']]) {
    await app.element('run-experiment').click(); const result = copy(outcome), job = result.variants[0].result.vehicles[0].jobs[0];
    job.dueTimeS = 0; job.arrivalS = seconds; job.status = seconds ? 'late' : 'on-time';
    app.latestWorker().respond(result);
    assert.equal(app.element('job-list').children[0].children[0].children[1].textContent, text);
  }
});
