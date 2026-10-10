import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkMap } from '../src/map.js';
import { application, minimalScenario, deferredFile, scenarioText } from './helpers/application.js';
import { createCanvasEnvironment } from './helpers/canvas.js';

// Actual app handlers + actual renderer; synthetic DOM/Worker/Canvas stand-ins.
// This verifies redraw ordering and hit positions, not browser pixels or timing.
async function loaded(t) {
  const env = createCanvasEnvironment(), restore = env.install(); t.after(restore);
  const app = application({ now: () => 0, mapClass: class extends NetworkMap { constructor(_element, state, handlers) { super(env.canvas, state, handlers); } } });
  const scenario = minimalScenario();
  scenario.vehicles.push({ ...scenario.vehicles[0], id: 'van-2', startTimeS: 1 });
  scenario.jobs.push({ ...scenario.jobs[0], id: 'job-2', vehicleId: 'van-2' });
  await app.importExperiment(scenario); app.latestWorker().respond();
  let now = 0;
  const step = () => { now += 1000 / 60; assert.equal(app.stepAnimationFrame(now), 1); };
  const paintThenSettle = () => {
    env.reset(); step(); assert.equal(env.canvas.context.count('clearRect'), 1, 'next frame paints the change');
    for (let i = 0; i < 10; i += 1) step();
    assert.equal(env.canvas.context.count('clearRect'), 1, 'unchanged paused calls do not repaint');
  };
  paintThenSettle();
  return { app, env, step, paintThenSettle };
}

test('paused app idles without paints; scrub, replay, play and pause retain redraw ordering', async t => {
  const { app, env, step, paintThenSettle } = await loaded(t);
  assert.equal(app.pendingAnimationFrames(), 1, 'RAF scheduling is intentionally unchanged');
  await app.change('timeline', 15, 'input'); paintThenSettle();
  const points = structuredClone(app.map.vehiclePoints);
  env.reset(); for (let i = 0; i < 120; i += 1) step();
  assert.equal(env.canvas.context.count('clearRect'), 0); assert.deepEqual(app.map.vehiclePoints, points);
  await app.element('replay-button').click(); paintThenSettle(); assert.equal(app.state.time, 0);
  await app.element('play-button').click(); env.reset(); const start = app.state.time;
  for (let i = 0; i < 8; i += 1) step();
  assert.ok(app.state.time > start); assert.equal(env.canvas.context.count('clearRect'), 8);
  await app.element('play-button').click(); const pausedTime = app.state.time;
  env.reset(); for (let i = 0; i < 10; i += 1) step();
  assert.equal(app.state.time, pausedTime); assert.equal(env.canvas.context.count('clearRect'), 0);
  await app.change('timeline', 1, 'input'); paintThenSettle();
});

test('pending, cleared, canceled and arriving results repaint at unchanged timestamps', async t => {
  const { app, env, paintThenSettle } = await loaded(t);
  const time = app.state.time;
  await app.element('run-experiment').click(); paintThenSettle();
  assert.equal(app.state.time, time); assert.equal(app.state.disrupted, null); assert.deepEqual(app.map.vehiclePoints, []);
  app.latestWorker().respond(); paintThenSettle(); assert.equal(app.map.vehiclePoints.length, 2);
  await app.element('cancel-run').click(); paintThenSettle(); assert.deepEqual(app.map.vehiclePoints, []);
  const old = app.latestWorker(); await app.element('run-experiment').click(); old.respond();
  assert.equal(app.state.disrupted, null); app.latestWorker().respond(); paintThenSettle();
  assert.equal(app.state.time, time); assert.equal(env.canvas.context.count('clearRect'), 1);
});

test('selection, overlay, zoom, variants and closure edits update a paused map', async t => {
  const { app, env, paintThenSettle } = await loaded(t);
  const background = app.map.background;
  await app.change('vehicle-select', 'van-2'); paintThenSettle();
  assert.equal(background.context.operations.length, 0, 'selection does not rebuild geometry');
  await app.element('view-baseline').click(); paintThenSettle();
  assert.equal(background.context.operations.length, 0, 'overlay does not rebuild geometry');
  await app.element('view-compare').click(); paintThenSettle();
  await app.element('zoom-in').click(); paintThenSettle();
  assert.ok(background.context.operations.length > 0, 'zoom rebuilds projected geometry');
  await app.change('variant-select', 'clear-roads'); paintThenSettle(); assert.equal(app.state.scenario.closures.length, 0);
  await app.change('road-select', 'bc'); await app.element('toggle-road').click(); paintThenSettle();
  assert.equal(app.state.disrupted, null); assert.equal(app.map.closureGeometries.size, 1);
  app.latestWorker().respond(); paintThenSettle();
  const hit = app.map.vehiclePoints.find(v => v.id === 'van-1');
  env.canvas.emit('click', { clientX: hit.x, clientY: hit.y }); paintThenSettle();
  assert.equal(app.state.selectedVehicle, 'van-1');
});

test('import and Reset paint new geometry while stale file reads cannot restore an old scene', async t => {
  const { app, paintThenSettle } = await loaded(t);
  const pending = deferredFile(), importing = app.importFile(pending.file);
  await app.element('reset-button').click(); paintThenSettle();
  assert.equal(app.state.scenario.nodes.length, 432); assert.equal(app.state.disrupted, null);
  pending.resolve(new TextEncoder().encode(scenarioText('stale-import')).buffer); await importing;
  assert.equal(app.state.scenario.id, 'meridian-seed-42');
  app.latestWorker().respond(); paintThenSettle();
  await app.importExperiment(minimalScenario('fresh-map')); paintThenSettle();
  assert.equal(app.state.scenario.nodes.length, 4); assert.deepEqual(app.map.vehiclePoints, []);
  app.latestWorker().respond(); paintThenSettle(); assert.equal(app.map.vehiclePoints.length, 1);
});
