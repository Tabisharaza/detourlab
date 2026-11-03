import test from 'node:test';
import assert from 'node:assert/strict';
import { application, deferredFile } from './helpers/application.js';
import { createTutorialExperiment } from '../src/tutorial.js';
import { createReplayEvents, pageReplayEvents } from '../src/replay-events.js';
import { exportReplayBookmark, parseReplayBookmark } from '../src/replay-bookmark.js';

// Checked-in handler tests use DOM/Worker stand-ins, not native-browser evidence.
function fixture() {
  const input = createTutorialExperiment();
  input.baseScenario.vehicles[0].startTimeS = 0.25;
  input.baseScenario.nodes.push({ id: 'E', x: 3, y: 1 });
  input.baseScenario.vehicles.push({ id: 'van-2', startNode: 'D', startTimeS: 0.5 });
  input.baseScenario.jobs[0].serviceTimeS = 3.125;
  for (let i = 2; i <= 12; i += 1) input.baseScenario.jobs.push({ id: `job-${i}`, nodeId: 'C', vehicleId: 'van-1', dueTimeS: 40, serviceTimeS: 0.125 });
  input.baseScenario.jobs.push({ id: 'unreachable', nodeId: 'E', vehicleId: 'van-1', dueTimeS: 40, serviceTimeS: 1 });
  input.baseScenario.jobs.push({ id: 'other-vehicle', nodeId: 'C', vehicleId: 'van-2', dueTimeS: 40, serviceTimeS: 1 });
  input.variants[1].closures[0].atS = 10.25;
  return input;
}
async function ready(input = fixture(), options = {}) {
  const app = application(options); await app.importExperiment(input); app.latestWorker().respond();
  await app.change('variant-select', 'close-at-10'); return app;
}
const rows = app => app.element('replay-events-list').children.map(row => row.children[0]);
const openBookmark = (app, file) => app.element('replay-input').emit('change', { target: { files: [file], value: '' } });
const bookmark = (input = fixture(), changes = {}) => new Blob([exportReplayBookmark(input, { variantId: 'close-at-10', vehicleId: 'van-1', timeS: 20.5, view: 'split', zoom: 1.2, ...changes })]);
const eventRow = (app, kind, run, atS) => rows(app).find(button => button.dataset.kind === kind && button.dataset.run === run && (atS === undefined || Number(button.dataset.time) === atS));

async function allRows(app) {
  const result = [];
  do {
    result.push(...rows(app).map(button => ({ id: button.dataset.eventId, atS: Number(button.dataset.time), kind: button.dataset.kind, category: button.dataset.category, run: button.dataset.run })));
    assert.ok(rows(app).length <= 20);
    if (app.element('replay-events-page-next').disabled) break;
    await app.element('replay-events-page-next').click();
  } while (true);
  return result;
}

test('completed-ledger UI has labeled baseline, variant and global schedule with bounded complete pages', async () => {
  let captured;
  const app = await ready(fixture(), { replayEventsBuilder: (...args) => { captured = args; return createReplayEvents(...args); } });
  assert.equal(captured[0], app.state.experiment); assert.equal(captured[1], app.state.allResults);
  assert.equal(captured[2], 'close-at-10'); assert.equal(captured[3], 'van-1');
  const workers = app.workers.length, results = structuredClone(app.state.allResults);
  assert.equal(rows(app).length, 20);
  assert.match(app.element('replay-events-list').textContent, /Clear-road baseline/);
  assert.match(app.element('replay-events-list').textContent, /Variant · Close at 10 s/);
  assert.match(app.element('replay-events-list').textContent, /Variant schedule · Close at 10 s/);
  assert.match(app.element('replay-events-summary').textContent, /Unreachable deliveries: 1 baseline, 1 variant/);
  const observed = await allRows(app), index = createReplayEvents(...captured), expected = [];
  for (let pageIndex = 0; ; pageIndex += 1) {
    const page = pageReplayEvents(index, 'all', pageIndex);
    expected.push(...page.events.map(({ id, atS, kind, category, run }) => ({ id, atS, kind, category, run })));
    if (pageIndex + 1 >= page.pageCount) break;
  }
  assert.deepEqual(observed, expected); assert.ok(observed.length > 40);
  assert.equal(app.workers.length, workers); assert.deepEqual(app.state.allResults, results);
  assert.match(app.element('replay-events-status').textContent, /matching of .* total timed events/);
});

test('row jump pauses exact fractional time shared across both maps without changing results or running a Worker', async () => {
  const input = fixture(); input.baseScenario.jobs = input.baseScenario.jobs.slice(0, 1);
  const app = await ready(input); await app.element('view-split').click(); await app.change('replay-events-filter', 'deliveries');
  const workers = app.workers.length, results = app.state.allResults, experiment = app.state.experiment;
  await app.element('play-button').click(); assert.equal(app.state.playing, true);
  const arrival = eventRow(app, 'job-arrival', 'variant', 26.25); assert.ok(arrival);
  await arrival.click();
  assert.equal(app.state.time, 26.25); assert.equal(app.maps[1].state.time, 26.25);
  assert.equal(app.state.playing, false); assert.equal(app.workers.length, workers);
  assert.equal(app.state.allResults, results); assert.equal(app.state.experiment, experiment);
  assert.match(app.element('replay-events-announcement').textContent, /Paused at 26.25 s/);
  assert.match(app.element('replay-events-time').textContent, /26.25 s/);
  await eventRow(app, 'job-completion', 'variant', 29.375).click();
  assert.equal(app.state.time, 29.375); assert.equal(app.maps[1].state.time, 29.375);
});

test('strict temporal navigation skips ties while tied event rows remain separately accessible', async () => {
  const app = await ready(); await app.change('replay-events-filter', 'routing');
  await app.change('timeline', 9, 'input'); await app.element('replay-events-next').click();
  assert.equal(app.state.time, 10.25);
  const tied = rows(app).filter(button => Number(button.dataset.time) === 10.25); assert.ok(tied.length >= 5);
  for (const button of tied) { await button.click(); assert.equal(app.state.time, 10.25); }
  await app.element('replay-events-next').click(); assert.equal(app.state.time, 18.25);
  await app.element('replay-events-previous').click(); assert.equal(app.state.time, 10.25);
  await app.change('replay-events-filter', 'closures');
  assert.equal(app.element('replay-events-previous').disabled, true); assert.equal(app.element('replay-events-next').disabled, true);
  assert.equal(rows(app).length, 1);
});

test('filters reset pagination, count all events and never project again or rerun', async () => {
  let builds = 0;
  const app = await ready(fixture(), { replayEventsBuilder: (...args) => { builds += 1; return createReplayEvents(...args); } });
  const before = builds, workers = app.workers.length;
  await app.element('replay-events-page-next').click(); assert.match(app.element('replay-events-status').textContent, /Showing 21–40/);
  for (const filter of ['deliveries', 'routing', 'closures', 'all']) {
    await app.change('replay-events-filter', filter);
    assert.match(app.element('replay-events-status').textContent, /Showing 1–/);
    assert.ok(rows(app).every(button => filter === 'all' || button.dataset.category === filter));
  }
  assert.equal(builds, before); assert.equal(app.workers.length, workers);
});

test('animation and ordinary timeline navigation leave the index and page DOM intact', async () => {
  let builds = 0;
  const app = await ready(fixture(), { now: () => 0, replayEventsBuilder: (...args) => { builds += 1; return createReplayEvents(...args); } });
  const before = builds, originalRows = rows(app), status = app.element('replay-events-status').textContent;
  await app.element('play-button').click();
  for (let time = 16; time <= 160; time += 16) app.stepAnimationFrame(time);
  assert.equal(builds, before); assert.deepEqual(rows(app), originalRows);
  assert.equal(app.element('replay-events-status').textContent, status);
  await app.change('timeline', 11.125, 'input'); assert.equal(builds, before); assert.deepEqual(rows(app), originalRows);
});

test('no selected vehicle after bookmark restoration clears and disables event navigation', async () => {
  const app = await ready(); await openBookmark(app, bookmark(fixture(), { vehicleId: null })); app.latestWorker().respond();
  assert.equal(rows(app).length, 0); assert.equal(app.element('replay-events-filter').disabled, true);
  assert.match(app.element('replay-events-status').textContent, /No vehicle selected/);
  await app.element('replay-events-next').emit('click'); assert.equal(app.state.time, 20.5);
  await app.change('vehicle-select', 'van-1'); assert.ok(rows(app).length); assert.equal(app.element('replay-events-filter').disabled, false);
});

test('empty vehicle and empty filter distinguish no events from excluded events', async () => {
  const input = createTutorialExperiment(); input.baseScenario.jobs = [];
  const app = await ready(input); await app.change('variant-select', 'clear');
  assert.equal(rows(app).length, 0); assert.match(app.element('replay-events-status').textContent, /No timed events.*0 matching of 0 total/);
  await app.change('variant-select', 'close-at-10');
  assert.equal(rows(app).length, 1); assert.equal(rows(app)[0].dataset.run, 'schedule');
  await app.change('replay-events-filter', 'deliveries');
  assert.equal(rows(app).length, 0); assert.match(app.element('replay-events-status').textContent, /No events match.*0 matching of 1 total/);
  assert.equal(app.element('replay-events-next').disabled, true);
  await app.change('replay-events-filter', 'all'); assert.equal(rows(app).length, 1);
});

test('unreachable timings never create an arrival or completion at zero', async () => {
  const app = await ready(); await app.change('replay-events-filter', 'deliveries');
  const events = await allRows(app);
  assert.equal(events.length, 48); assert.ok(events.every(event => event.atS > 0));
  assert.match(app.element('replay-events-summary').textContent, /null arrival and service times have no events/);
});

test('old rows are inert after a vehicle or variant change, including a return to the same IDs', async () => {
  const app = await ready(); const old = rows(app)[0];
  await app.change('vehicle-select', 'van-2'); assert.match(app.element('replay-events-summary').textContent, /van-2/);
  await app.change('timeline', 7.5, 'input'); await old.emit('click'); assert.equal(app.state.time, 7.5);
  await app.change('vehicle-select', 'van-1'); await old.emit('click'); assert.equal(app.state.time, 7.5);
  const priorVariant = rows(app)[0]; await app.change('variant-select', 'clear');
  assert.match(app.element('replay-events-summary').textContent, /Clear roads/);
  await priorVariant.emit('click'); assert.equal(app.state.time, 7.5);
  assert.equal(rows(app).some(button => button.dataset.run === 'schedule'), false);
});

test('rows removed by filter/page changes cannot activate later and focused rows move to the filter', async () => {
  const app = await ready(); const old = rows(app)[0]; old.focus();
  await app.change('replay-events-filter', 'deliveries'); assert.equal(app.document.activeElement, app.element('replay-events-filter'));
  await app.change('timeline', 7, 'input'); await old.emit('click'); assert.equal(app.state.time, 7);
  const firstPage = rows(app)[0]; firstPage.focus(); await app.element('replay-events-page-next').click();
  assert.equal(app.document.activeElement, app.element('replay-events-filter'));
  await firstPage.emit('click'); assert.equal(app.state.time, 7);
});

test('page and time navigation losing availability hand focus to the surviving control', async () => {
  const app = await ready();
  while (!app.element('replay-events-page-next').disabled) { app.element('replay-events-page-next').focus(); await app.element('replay-events-page-next').click(); }
  assert.equal(app.document.activeElement, app.element('replay-events-page-previous'));
  await app.change('replay-events-filter', 'closures'); await app.change('timeline', 0, 'input');
  app.element('replay-events-next').focus(); await app.element('replay-events-next').click();
  assert.equal(app.document.activeElement, app.element('replay-events-filter'));
});

test('rerun, cancel and stale Worker completion clear rows and keep stale buttons inert', async () => {
  const app = await ready(), old = rows(app)[0]; old.focus();
  await app.element('run-experiment').click(); const canceled = app.latestWorker();
  assert.equal(rows(app).length, 0); assert.equal(app.element('replay-events-filter').disabled, true);
  assert.equal(app.document.activeElement, app.element('vehicle-select'));
  await old.emit('click'); assert.equal(app.state.time, 0);
  await app.element('cancel-run').click(); canceled.respond();
  assert.equal(rows(app).length, 0); assert.match(app.element('replay-events-status').textContent, /No completed results/);
  await app.change('timeline', 7, 'input'); await old.emit('click'); assert.equal(app.state.time, 7);
  await app.element('run-experiment').click(); app.latestWorker().respond();
  assert.ok(rows(app).length); await old.emit('click'); assert.equal(app.state.time, 7);
});

test('import clears obsolete event rows without stealing newer focus; invalid import preserves them', async () => {
  const app = await ready(), old = rows(app)[0], held = deferredFile(), importing = app.importFile(held.file);
  app.element('road-search').focus(); held.resolve(await new Blob([JSON.stringify(createTutorialExperiment())]).arrayBuffer()); await importing;
  assert.equal(rows(app).length, 0); assert.equal(app.document.activeElement, app.element('road-search'));
  await old.emit('click'); assert.equal(app.state.time, 0); app.latestWorker().respond();
  const current = rows(app); await app.importFile(new Blob(['invalid JSON'])); assert.deepEqual(rows(app), current);
});

test('an exact event jump supersedes a delayed bookmark read and preserves the current workspace', async () => {
  const app = await ready(), held = deferredFile(), original = app.state.experiment;
  const opening = openBookmark(app, held.file); await app.change('replay-events-filter', 'closures'); await rows(app)[0].click();
  held.resolve(await bookmark().arrayBuffer()); await opening;
  assert.equal(app.state.experiment, original); assert.equal(app.state.time, 10.25);
  assert.match(app.element('replay-status').textContent, /opening canceled/);
});

test('stale event buttons cannot alter or cancel a pending bookmark restoration', async () => {
  const app = await ready(), old = rows(app)[0]; await openBookmark(app, bookmark());
  assert.equal(rows(app).length, 0); await old.emit('click');
  assert.equal(app.state.time, 0); app.latestWorker().respond(); assert.equal(app.state.time, 20.5);
  assert.match(app.element('replay-status').textContent, /paused at 20.5/);
});

test('late scheduled closures extend only playback horizon and survive bookmark save/reopen', async t => {
  const input = createTutorialExperiment(); input.variants[1].closures[0].atS = 100.375;
  const app = await ready(input), result = structuredClone(app.state.allResults);
  assert.equal(Number(app.element('timeline').max), 100.375);
  assert.equal(app.state.disrupted.durationS, 60);
  await app.change('replay-events-filter', 'closures'); await rows(app)[0].click(); assert.equal(app.state.time, 100.375);
  let saved;
  t.mock.method(URL, 'createObjectURL', blob => { saved = blob; return 'blob:replay'; });
  await app.element('save-replay').click(); const parsed = parseReplayBookmark(await saved.text());
  assert.equal(parsed.perspective.timeS, 100.375); assert.deepEqual(app.state.allResults, result);
  await openBookmark(app, saved); app.latestWorker().respond();
  assert.equal(app.state.time, 100.375); assert.doesNotMatch(app.element('replay-status').textContent, /clamped/);
});

test('a late closure in another variant keeps one stable horizon when plans change', async () => {
  const input = createTutorialExperiment(); input.variants[2].closures[0].atS = 120.625;
  const app = await ready(input), workers = app.workers.length;
  assert.equal(app.state.selectedVariantId, 'close-at-10');
  assert.equal(Number(app.element('timeline').max), 120.625);
  await app.change('variant-select', 'close-at-11'); await app.change('replay-events-filter', 'closures');
  await rows(app)[0].click(); assert.equal(app.state.time, 120.625);
  await app.change('variant-select', 'clear');
  assert.equal(app.state.time, 120.625); assert.equal(Number(app.element('timeline').max), 120.625);
  assert.equal(app.state.disrupted.durationS, 60); assert.equal(app.workers.length, workers);
  assert.equal(rows(app).length, 0); assert.match(app.element('replay-events-status').textContent, /No events match/);
});

test('imported event labels stay text and projection errors fail closed without disrupting replay', async () => {
  const input = createTutorialExperiment(); input.variants[1].name = '<img src=x onerror=alert(1)> & plan';
  const app = await ready(input);
  assert.ok(app.element('replay-events-summary').textContent.includes(input.variants[1].name));
  assert.ok(app.element('replay-events-list').textContent.includes(input.variants[1].name));
  assert.equal(app.created.some(element => ['SCRIPT', 'IMG', 'IFRAME'].includes(element.tagName)), false);
  const failed = await ready(input, { replayEventsBuilder: () => { throw new Error('Synthetic incomplete ledger'); } });
  assert.equal(rows(failed).length, 0); assert.equal(failed.element('replay-events-filter').disabled, true);
  assert.match(failed.element('replay-events-status').textContent, /Event navigation unavailable.*Synthetic incomplete ledger/);
  assert.ok(failed.state.allResults);
});
