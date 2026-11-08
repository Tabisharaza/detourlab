import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { application, deferredFile } from './helpers/application.js';
import { exportReplayBookmark } from '../src/replay-bookmark.js';
import { createBrowserImpact } from '../src/browser-impact.js';

const fixture = (name = 'minimal-experiment.json') => JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
async function ready(input = fixture(), options = {}, variant = 'close-at-10') {
  const app = application(options); await app.importExperiment(input); assert.equal(app.state.experiment.id, input.id); app.latestWorker().respond();
  await app.change('variant-select', variant); await app.element('impact-button').click(); return app;
}
const actions = app => app.element('impact-rows').querySelectorAll('button');
const action = (app, side) => actions(app).find(button => button.dataset.impactReplay === side);
const perspective = app => ({ time: app.state.time, vehicle: app.state.selectedVehicle, view: app.state.view, playing: app.state.playing });

// Handler/DOM stand-ins, not native browser or accessibility certification.
for (const [side, time] of [['baseline', 20], ['variant', 26]]) test(`${side} arrival selects exact shared replay without recomputing or changing input`, async () => {
  const app = await ready(); const input = app.state.experiment, results = app.state.allResults, bytes = JSON.stringify(input), workers = app.posted.length;
  const button = action(app, side); assert.equal(button.dataset.time, String(time)); assert.match(button.getAttribute('aria-label'), /split view/);
  button.focus(); await button.click();
  assert.equal(app.state.time, time); assert.equal(app.state.selectedVehicle, input.baseScenario.jobs[0].vehicleId);
  assert.equal(app.state.view, 'split'); assert.equal(app.state.playing, false); assert.equal(app.element('impact-dialog').open, false);
  assert.equal(app.document.activeElement, app.element('vehicle-select'));
  assert.equal(app.maps.length, 2); assert.equal(app.maps[1].state.time, time); assert.equal(app.maps[1].state.selectedVehicle, app.state.selectedVehicle);
  assert.equal(app.state.experiment, input); assert.equal(JSON.stringify(input), bytes); assert.equal(app.state.allResults, results); assert.equal(app.posted.length, workers);
  assert.match(app.element('replay-events-announcement').textContent, new RegExp(`Paused at ${time} s`));
  assert.match(app.element('replay-events-announcement').textContent, /Both map panes use this exact time/);
  await button.emit('click'); assert.equal(app.state.time, time);
});

test('fractional arrival times are retained, and zero is a real replay target', async () => {
  for (const zero of [false, true]) {
    const input = fixture(); input.baseScenario.vehicles[0].startTimeS = zero ? 0 : .25;
    if (zero) input.baseScenario.jobs[0].nodeId = input.baseScenario.vehicles[0].startNode;
    const app = await ready(input); await app.change('impact-filter', 'all');
    const report = createBrowserImpact(app.state.experiment, app.state.allResults, 'close-at-10');
    const expected = report.jobs[0].baseline.arrivalS; assert.equal(expected, zero ? 0 : 20.25);
    await action(app, 'baseline').click(); assert.equal(app.state.time, expected); assert.equal(app.maps[1].state.time, expected);
  }
});

test('missing arrival has no action while a reached comparison side remains replayable', async () => {
  const input = fixture(); input.variants[1].closures = [{ id: 'block', atS: 0, edgeIds: ['ab'] }];
  const app = await ready(input); assert.match(app.element('impact-rows').textContent, /Not reached/);
  assert.equal(action(app, 'variant'), undefined); assert.ok(action(app, 'baseline'));
  await action(app, 'baseline').click(); assert.equal(app.state.time, 20);
});

for (const [name, change] of [
  ['filter', app => app.change('impact-filter', 'all')],
  ['search', app => app.change('impact-search', 'missing', 'input')],
  ['sort', app => app.change('impact-sort', 'arrival-desc')],
  ['page', app => app.element('impact-next').emit('click')],
  ['variant', app => app.change('impact-variant', 'close-at-11')],
  ['close', app => app.element('impact-close').click()],
  ['reopen', async app => { await app.element('impact-close').click(); await app.element('impact-button').click(); }],
  ['rerun', app => app.element('run-experiment').click()],
  ['new completion', async app => { await app.element('run-experiment').click(); app.latestWorker().respond(); await app.element('impact-close').click(); await app.element('impact-button').click(); }],
  ['reset', app => app.element('reset-button').click()],
  ['edit', async app => { await app.change('variant-name', 'Changed'); await app.element('rename-variant').click(); }],
  ['import', app => app.importExperiment(fixture())],
]) test(`retained row callbacks cannot navigate after ${name}`, async () => {
  const app = await ready(); const stale = action(app, 'variant'); await change(app);
  const before = perspective(app), workers = app.posted.length; await stale.emit('click');
  assert.deepEqual(perspective(app), before); assert.equal(app.posted.length, workers);
});

test('deferred close notification cannot steal replay focus or focus from a reopened dialog', async () => {
  const app = await ready(fixture(), { deferDialogClose: true }); await action(app, 'variant').click();
  await app.flushDialogCloseEvents(); assert.equal(app.document.activeElement, app.element('vehicle-select'));
  await app.element('impact-button').click(); await app.change('impact-filter', 'all'); await action(app, 'baseline').click();
  await app.element('impact-button').click(); await app.flushDialogCloseEvents();
  assert.equal(app.element('impact-dialog').open, true); assert.equal(app.document.activeElement, app.element('impact-dialog-title'));
});

test('rerender moves focus off removed replay buttons to a usable inspector control', async () => {
  const app = await ready(); action(app, 'baseline').focus(); await app.change('impact-search', 'missing', 'input');
  assert.equal(app.document.activeElement, app.element('impact-search'));
});

test('searched and ranked Meridian row selects its own vehicle and arrival', async () => {
  const app = await ready(fixture('meridian-experiment.json'), {}, 'market-05');
  await app.change('impact-filter','all'); await app.change('impact-search','job-01-4','input'); await app.change('impact-sort','arrival-desc');
  const button = action(app,'variant'); assert.equal(button.dataset.jobId,'job-01-4'); await button.click();
  assert.equal(app.state.time,741); assert.equal(app.state.selectedVehicle,'van-01');
});

 test('arrival navigation supersedes a delayed bookmark read without creating undo history', async () => {
  const app = await ready(); const input = app.state.experiment, held = deferredFile();
  const before = app.element('history-status').textContent;
  const opening = app.element('replay-input').emit('change', { target: { files: [held.file], value: 'file' } });
  await action(app,'variant').click();
  const bookmark = exportReplayBookmark(fixture(), {variantId:'close-at-11',vehicleId:'van-1',timeS:4.5,view:'baseline',zoom:1});
  held.resolve(new TextEncoder().encode(bookmark).buffer); await opening;
  assert.equal(app.state.experiment,input); assert.equal(app.state.time,26); assert.equal(app.state.view,'split');
  assert.equal(app.element('history-status').textContent,before); assert.match(app.element('replay-status').textContent,/opening canceled/);
});
