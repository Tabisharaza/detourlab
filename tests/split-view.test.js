import test from 'node:test';
import assert from 'node:assert/strict';
import { application, minimalScenario, deferredFile, scenarioText } from './helpers/application.js';
import { NetworkMap } from '../src/map.js';
import { createCanvasEnvironment } from './helpers/canvas.js';

async function loaded() {
  const app = application();
  await app.importExperiment(minimalScenario()); app.latestWorker().respond();
  return app;
}

test('split is opt-in and lazy; repeated mode changes preserve completed inputs, results and worker count', async () => {
  const app = await loaded();
  assert.equal(app.maps.length, 1);
  assert.equal(app.element('baseline-pane').hidden, true);
  const before = JSON.stringify(app.state.experiment), results = app.state.allResults, count = app.workers.length;
  for (let i = 0; i < 3; i++) {
    await app.element('view-split').click();
    assert.equal(app.state.view, 'split'); assert.equal(app.maps.length, 2);
    assert.equal(app.element('baseline-pane').hidden, false);
    assert.equal(app.element('view-split').getAttribute('aria-pressed'), 'true');
    await app.element('view-compare').click();
    assert.equal(app.state.view, 'compare'); assert.equal(app.element('baseline-pane').hidden, true);
    assert.equal(app.element('view-split').getAttribute('aria-pressed'), 'false');
  }
  assert.equal(JSON.stringify(app.state.experiment), before); assert.equal(app.state.allResults, results);
  assert.equal(app.workers.length, count);
});

test('baseline pane reads the same replay, selection, zoom and replacement objects without mutating shared state', async () => {
  const app = await loaded(); await app.element('view-split').click();
  const baseline = app.maps[1];
  assert.equal(baseline.state.view, 'baseline'); assert.equal(baseline.state.scenario, app.state.scenario);
  await app.change('timeline', 17, 'input'); await app.element('zoom-in').click();
  assert.equal(baseline.state.time, app.state.time); assert.equal(baseline.state.zoom, app.state.zoom);
  assert.equal(baseline.state.baseline, app.state.baseline);
  await app.element('edit-roads').click();
  assert.equal(app.state.editing, true); assert.equal(baseline.state.editing, false);
  const before = JSON.stringify(app.state.experiment); baseline.handlers.onRoad('bc');
  assert.equal(JSON.stringify(app.state.experiment), before);
  baseline.handlers.onVehicle('van-1'); assert.equal(app.state.selectedVehicle, 'van-1');
  assert.equal(app.element('vehicle-select').value, 'van-1');
  assert.throws(() => { baseline.state.time = 9; }, /read-only/);
  await app.change('variant-select', 'clear-roads');
  assert.equal(baseline.state.scenario, app.state.scenario);
  assert.equal(baseline.state.disrupted, app.state.disrupted);
  assert.match(app.element('variant-pane-label').textContent, /Clear/);
});

test('pending, canceled, restarted and imported runs clear both panes and reject stale worker/file results', async () => {
  const app = await loaded(); await app.element('view-split').click(); const baseline = app.maps[1];
  await app.element('run-experiment').click(); const stale = app.latestWorker();
  assert.equal(baseline.state.baseline, null); assert.equal(baseline.state.disrupted, null);
  await app.element('cancel-run').click(); stale.respond();
  assert.equal(baseline.state.baseline, null);
  await app.element('run-experiment').click(); app.latestWorker().respond();
  assert.ok(baseline.state.baseline); assert.equal(baseline.state.baseline, app.state.baseline);
  const pending = deferredFile(), importing = app.importFile(pending.file);
  await app.change('variant-select', 'clear-roads');
  pending.resolve(new TextEncoder().encode(scenarioText('stale')).buffer); await importing;
  assert.notEqual(baseline.state.scenario.id, 'stale');
  await app.importExperiment(minimalScenario('replacement')); assert.equal(baseline.state.scenario.id, 'replacement');
  assert.equal(baseline.state.baseline, null); app.latestWorker().respond(); assert.ok(baseline.state.baseline);
});

test('literal long variant labels and split state survive tiny-lesson return without altering experiment', async () => {
  const app = await loaded(); await app.element('view-split').click();
  const label = '<img src=x onerror=bad()> & a long variant';
  await app.change('variant-name', label); await app.element('rename-variant').click();
  assert.equal(app.element('variant-pane-label').textContent, `Selected variant: ${label}`);
  assert.equal(app.element('variant-pane-label').title, `Selected variant: ${label}`);
  app.latestWorker().respond(); const before = JSON.stringify(app.state.experiment);
  await app.element('try-example-button').click(); await app.element('lesson-start').click();
  assert.equal(app.state.lessonActive, true);
  await app.element('return-experiment').click();
  assert.equal(app.state.lessonActive, false); assert.equal(app.state.view, 'split');
  assert.equal(JSON.stringify(app.state.experiment), before);
});

test('actual two renderers share time and camera while keeping hit geometry independent and skipping paused/hidden paints', async t => {
  const env = createCanvasEnvironment({ width: 420, height: 360 }), restore = env.install(); t.after(restore);
  const app = application({ now: () => 0, mapClass: class extends NetworkMap {
    constructor(_element, state, handlers) { super(env.createCanvas(), state, handlers); }
  } });
  await app.importExperiment(minimalScenario()); app.latestWorker().respond();
  let tick = 0; const frame = () => app.stepAnimationFrame(++tick * 16);
  frame(); await app.element('view-split').click();
  const [primary, baseline] = app.maps;
  assert.deepEqual(primary.vehiclePoints, []); assert.deepEqual(primary.edgePoints, []);
  frame(); assert.notEqual(primary.canvas, baseline.canvas);
  assert.equal(primary.scale, baseline.scale); assert.equal(primary.offsetX, baseline.offsetX);
  await app.change('timeline', 15, 'input'); frame();
  assert.equal(primary.state.time, baseline.state.time);
  assert.notDeepEqual(primary.vehiclePoints, baseline.vehiclePoints, 'disrupted route and baseline diverge at the same instant');
  env.reset(); frame(); frame(); assert.equal(primary.canvas.context.count('clearRect'), 0); assert.equal(baseline.canvas.context.count('clearRect'), 0);
  env.resize(primary.canvas, 440, 380); assert.deepEqual(primary.vehiclePoints, []); assert.deepEqual(primary.edgePoints, []);
  frame(); await app.element('view-disruption').click(); env.reset();
  await app.change('timeline', 16, 'input'); frame();
  assert.equal(baseline.canvas.context.count('clearRect'), 0, 'hidden secondary is never rendered');
  await app.element('view-split').click(); frame(); await app.element('run-experiment').click(); frame();
  assert.deepEqual(primary.vehiclePoints, []); assert.deepEqual(baseline.vehiclePoints, []);
});
