import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { application, deferredFile } from './helpers/application.js';
import { createBrowserImpact } from '../src/browser-impact.js';

const fixture = (name = 'minimal-experiment.json') => JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
async function ready(input = fixture(), options = {}) { const app = application(options); await app.importExperiment(input); app.latestWorker().respond(); return app; }
const rows = app => app.element('impact-rows').children;
const rowText = app => app.element('impact-rows').textContent;

// These execute app handlers with DOM and Worker stand-ins, not a native browser.
test('inspection requires completed results and forced stale clicks cannot open it', async () => {
  const app = application();
  assert.equal(app.element('impact-button').disabled, true);
  await app.element('impact-button').emit('click'); assert.notEqual(app.element('impact-dialog').open, true);
  app.latestWorker().respond(); assert.equal(app.element('impact-button').disabled, false);
  await app.element('run-experiment').click(); assert.equal(app.element('impact-button').disabled, true);
  await app.element('cancel-run').click();
  await app.element('impact-button').emit('click'); assert.notEqual(app.element('impact-dialog').open, true);
});

test('opening reuses exact completed objects and does not run simulation or change replay time', async () => {
  let captured;
  const app = await ready(fixture(), { impactBuilder: (...args) => { captured = args; return createBrowserImpact(...args); } });
  await app.change('variant-select', 'close-at-10');
  const workers = app.workers.length, time = app.state.time;
  await app.element('play-button').click();
  app.element('impact-button').focus(); await app.element('impact-button').click();
  assert.equal(captured[0], app.state.experiment); assert.equal(captured[1], app.state.allResults); assert.equal(captured[2], 'close-at-10');
  assert.equal(app.workers.length, workers); assert.equal(app.state.time, time); assert.equal(app.state.playing, false);
  assert.equal(app.document.activeElement, app.element('impact-dialog-title'));
  assert.match(rowText(app), /On time → Late/); assert.match(rowText(app), /20 s → 26 sChange \+6 s/);
  assert.match(rowText(app), /23 s → 29 sChange \+6 s/); assert.match(rowText(app), /0 s → 4 sChange \+4 s/);
  assert.match(app.element('impact-status').textContent, /Showing 1–1; page 1 of 1/);
  assert.match(app.element('impact-metrics').textContent, /1 → 1 completed; 0 → 0 unreachable/);
});

test('tiny clear control has an honest empty changed filter and an all-deliveries escape', async () => {
  const app = await ready(); await app.element('impact-button').click();
  assert.equal(rows(app).length, 0); assert.equal(app.element('impact-table-region').hidden, true);
  assert.match(app.element('impact-summary').textContent, /0 of 1 delivery outcomes changed; 1 unchanged/);
  assert.match(app.element('impact-status').textContent, /No changed outcomes/);
  assert.match(app.element('impact-status').textContent, /0 matching of 1 total deliveries. 1 excluded/);
  app.element('impact-filter').focus(); await app.change('impact-filter', 'all');
  assert.equal(rows(app).length, 1); assert.equal(app.element('impact-table-region').hidden, false);
  assert.equal(app.document.activeElement, app.element('impact-filter')); assert.match(rowText(app), /On time → On time/);
});

test('Meridian exposes seven same-status arrival shifts with bounded counts and original order', async () => {
  const app = await ready(fixture('meridian-experiment.json')); await app.change('variant-select', 'market-05');
  await app.element('impact-button').click();
  assert.equal(rows(app).length, 20);
  assert.match(app.element('impact-summary').textContent, /125 of 192.*67 unchanged.*Status changes: 118.*Same-status arrival changes: 7/);
  assert.match(app.element('impact-status').textContent, /Showing 1–20; page 1 of 7. 125 matching of 192 total deliveries. 67 excluded/);
  const originalOrder = createBrowserImpact(app.state.experiment, app.state.allResults, 'market-05').jobs.filter(job => job.changed).map(job => job.id);
  const collected = [];
  for (let page = 0; page < 7; page += 1) { collected.push(...rows(app).map(row => row.children[0].children[0].textContent)); if (page < 6) await app.element('impact-next').click(); }
  assert.deepEqual(collected, originalOrder); assert.equal(rows(app).length, 5);
  assert.match(app.element('impact-status').textContent, /Showing 121–125/);
  await app.change('impact-filter', 'timing'); assert.equal(rows(app).length, 7);
  assert.match(app.element('impact-status').textContent, /7 matching of 192 total deliveries. 185 excluded/);
  assert.match(rowText(app), /690 s → 741 sChange \+51 s/);
  await app.change('impact-filter', 'status'); assert.match(app.element('impact-status').textContent, /118 matching/);
  await app.change('impact-filter', 'all'); assert.match(app.element('impact-status').textContent, /192 matching.*0 excluded/);
});

test('modal variant selection updates the selected workbench plan without a rerun and resets pagination', async () => {
  const app = await ready(fixture('meridian-experiment.json')); await app.change('variant-select', 'market-05'); await app.element('impact-button').click();
  await app.element('impact-next').click(); const workers = app.workers.length;
  app.element('impact-variant').focus(); await app.change('impact-variant', 'all-bridges-05');
  assert.equal(app.state.selectedVariantId, 'all-bridges-05'); assert.equal(app.element('variant-select').value, 'all-bridges-05');
  assert.equal(app.workers.length, workers); assert.match(app.element('impact-status').textContent, /Showing 1–20/);
  assert.equal(app.document.activeElement, app.element('impact-variant'));
  assert.match(rowText(app), /Unreachable/); assert.match(rowText(app), /Not reachedNot comparable/);
  assert.match(app.element('impact-metrics').textContent, /192 → 135 completed; 0 → 57 unreachable/);
});

test('empty experiment has a distinct no-deliveries state in every filter', async () => {
  const input = fixture(); input.baseScenario.jobs = [];
  const app = await ready(input); await app.element('impact-button').click();
  for (const filter of ['all', 'changed', 'status', 'timing']) {
    await app.change('impact-filter', filter); assert.equal(rows(app).length, 0);
    assert.match(app.element('impact-status').textContent, /This experiment has no deliveries.*0 matching of 0 total/);
    assert.equal(app.element('impact-next').disabled, true); assert.equal(app.element('impact-previous').disabled, true);
  }
});

test('close and reopen reset filters, clear evidence, and return focus to the trigger', async () => {
  const app = await ready(); app.element('impact-button').focus(); await app.element('impact-button').click();
  await app.change('impact-filter', 'all'); await app.element('impact-close').click();
  assert.equal(rows(app).length, 0); assert.equal(app.element('impact-dialog').open, false);
  assert.equal(app.document.activeElement, app.element('impact-button'));
  await app.element('impact-button').click(); assert.equal(app.element('impact-filter').value, 'changed'); assert.equal(rows(app).length, 0);
});

test('Escape clears inspection, queued close events cannot disturb a reopened modal', async () => {
  const app = await ready(fixture(), { deferDialogClose: true });
  app.element('impact-button').focus(); await app.element('impact-button').click();
  await app.change('impact-filter', 'all'); await app.element('impact-dialog').escape();
  assert.equal(rows(app).length, 0); assert.equal(app.document.activeElement, app.element('impact-button'));
  await app.element('impact-button').click(); await app.flushDialogCloseEvents();
  assert.equal(app.element('impact-dialog').open, true); assert.equal(app.document.activeElement, app.element('impact-dialog-title'));
});

test('Tab containment follows visible enabled controls and keeps the table keyboard-scrollable', async () => {
  const app = await ready(); await app.element('impact-button').click();
  await app.element('impact-dialog').emit('keydown', { key: 'Tab' }); assert.equal(app.document.activeElement, app.element('impact-close'));
  await app.element('impact-dialog').emit('keydown', { key: 'Tab', shiftKey: true }); assert.equal(app.document.activeElement, app.element('impact-filter'));
  await app.change('impact-filter', 'all');
  app.element('impact-close').focus(); await app.element('impact-dialog').emit('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(app.document.activeElement, app.element('impact-table-region'));
  await app.element('impact-dialog').emit('keydown', { key: 'Tab' }); assert.equal(app.document.activeElement, app.element('impact-close'));
  assert.equal(app.element('impact-table-region').tabIndex, 0);
});

test('a pagination button losing availability hands focus to the other page action', async () => {
  const app = await ready(fixture('meridian-experiment.json')); await app.change('variant-select', 'market-05'); await app.element('impact-button').click();
  for (let page = 0; page < 6; page += 1) { app.element('impact-next').focus(); await app.element('impact-next').click(); }
  assert.equal(app.element('impact-next').disabled, true); assert.equal(app.document.activeElement, app.element('impact-previous'));
  for (let page = 0; page < 6; page += 1) { app.element('impact-previous').focus(); await app.element('impact-previous').click(); }
  assert.equal(app.element('impact-previous').disabled, true); assert.equal(app.document.activeElement, app.element('impact-next'));
});

test('Space in the inspection modal never changes background replay', async () => {
  const app = await ready(); await app.element('impact-button').click();
  for (const id of ['impact-dialog-title', 'impact-table-region', 'impact-filter']) {
    await app.change('impact-filter', 'all'); app.element(id).focus();
    const event = app.windowEvent('keydown', { code: 'Space' });
    assert.equal(event.defaultPrevented, false); assert.equal(app.state.playing, false);
  }
});

test('edit invalidates rows immediately, rerun does not silently refill an old inspection', async () => {
  const app = await ready(); await app.element('impact-button').click(); await app.change('impact-filter', 'all');
  app.element('impact-filter').focus(); await app.element('duplicate-variant').click();
  assert.equal(rows(app).length, 0); assert.equal(app.element('impact-filter').disabled, true);
  assert.equal(app.document.activeElement, app.element('impact-close')); assert.match(app.element('impact-status').textContent, /Results changed/);
  await app.element('impact-next').emit('click'); assert.equal(rows(app).length, 0);
  app.latestWorker().respond(); assert.equal(rows(app).length, 0); assert.equal(app.element('impact-button').disabled, false);
  await app.element('impact-close').click(); await app.element('impact-button').click();
  assert.equal(app.element('impact-variant').value, app.state.selectedVariantId);
});

test('cancel, queued stale Worker messages and repeated runs cannot resurrect old rows', async () => {
  const app = await ready(); await app.change('variant-select', 'close-at-10'); await app.element('impact-button').click();
  await app.element('run-experiment').click(); const canceled = app.latestWorker();
  await app.element('cancel-run').click(); canceled.respond();
  assert.equal(rows(app).length, 0); assert.equal(app.element('impact-button').disabled, true);
  await app.element('impact-close').click(); assert.equal(app.document.activeElement, app.element('run-experiment'));
  await app.element('run-experiment').click(); const superseded = app.latestWorker();
  await app.element('run-experiment').click(); app.latestWorker().respond(); await app.element('impact-button').click();
  const text = rowText(app); superseded.respond(); canceled.respond(); assert.equal(rowText(app), text); assert.equal(rows(app).length, 1);
});

test('valid delayed import clears open rows, while a failed import preserves current evidence', async () => {
  const app = await ready(); const delayed = deferredFile(), importing = app.importFile(delayed.file);
  await app.element('impact-button').click(); await app.change('impact-filter', 'all');
  delayed.resolve(new TextEncoder().encode(JSON.stringify(fixture('meridian-experiment.json'))).buffer); await importing;
  assert.equal(rows(app).length, 0); assert.equal(app.element('impact-filter').disabled, true);
  await app.element('impact-close').click(); app.latestWorker().respond(); await app.element('impact-button').click();
  const text = rowText(app); await app.importFile(new Blob(['not JSON'])); assert.equal(rowText(app), text);
});

test('reset, tiny lesson start and lesson return invalidate all inspection data', async () => {
  const app = await ready(); await app.element('impact-button').click(); await app.change('impact-filter', 'all');
  await app.element('reset-button').click(); assert.equal(rows(app).length, 0); await app.element('impact-close').click();
  app.latestWorker().respond(); await app.element('impact-button').click();
  await app.element('try-example-button').click(); await app.element('lesson-start').click(); assert.equal(rows(app).length, 0);
  await app.element('impact-close').click(); app.latestWorker().respond(); await app.element('impact-button').click(); await app.change('impact-filter', 'all');
  await app.element('return-experiment').click(); assert.equal(rows(app).length, 0); assert.equal(app.element('impact-filter').disabled, true);
});

test('worker failures, timeouts and construction errors never enable inspection', async () => {
  for (const failure of ['message', 'error', 'timeout', 'construction']) {
    const app = application({ workerConstructionError: () => failure === 'construction' ? 'blocked' : null });
    if (failure === 'message') app.latestWorker().respond({ error: 'Failed run' });
    if (failure === 'error') app.latestWorker().fail();
    if (failure === 'timeout') [...app.timers.values()].find(timer => timer.delay === 30000).callback();
    assert.equal(app.element('impact-button').disabled, true);
    await app.element('impact-button').emit('click'); assert.notEqual(app.element('impact-dialog').open, true);
  }
});

test('repeated trigger dispatch is idempotent and does not reset a reader position', async () => {
  let calls = 0;
  const app = await ready(fixture('meridian-experiment.json'), { impactBuilder: (...args) => { calls += 1; return createBrowserImpact(...args); } });
  await app.change('variant-select', 'market-05'); await app.element('impact-button').click(); await app.element('impact-next').click();
  const status = app.element('impact-status').textContent; app.element('impact-filter').focus();
  await app.element('impact-button').emit('click'); assert.equal(calls, 1); assert.equal(app.element('impact-status').textContent, status);
  assert.equal(app.document.activeElement, app.element('impact-filter'));
});

test('imported labels are rendered as text, not executable HTML', async () => {
  const input = fixture(); input.variants[1].name = '<img src=x onerror=alert(1)> & "plan"';
  const app = await ready(input); await app.change('variant-select', 'close-at-10'); await app.element('impact-button').click();
  assert.equal(app.element('impact-variant').children[1].textContent, input.variants[1].name);
  assert.ok(app.element('impact-table-caption').textContent.includes(input.variants[1].name));
  assert.equal(app.created.filter(node => ['SCRIPT', 'IMG', 'IFRAME'].includes(node.tagName)).length, 0);
  assert.equal(rows(app)[0].children[0].getAttribute('scope'), 'row');
});

test('a projection failure does not leave partial rows or claim results were inspected', async () => {
  const app = await ready(fixture(), { impactBuilder: () => { throw new Error('Missing completed ledger'); } });
  await app.element('impact-button').click(); assert.notEqual(app.element('impact-dialog').open, true); assert.equal(rows(app).length, 0);
  assert.match(app.element('toast').textContent, /Delivery comparison unavailable. Missing completed ledger/);
});

test('an asynchronous result invalidation hands off a focused trigger without stealing newer focus', async () => {
  for (const focused of ['impact-button', 'road-search']) {
    const app = await ready(), pending = deferredFile(), importing = app.importFile(pending.file);
    app.element(focused).focus(); pending.resolve(new TextEncoder().encode(JSON.stringify(fixture())).buffer); await importing;
    assert.equal(app.element('impact-button').disabled, true);
    assert.equal(app.document.activeElement, app.element(focused === 'impact-button' ? 'run-experiment' : focused));
  }
});

test('a rejected imported-limit edit preserves the open valid comparison', async () => {
  const input = fixture(); input.variants = input.variants.slice(0, 2);
  input.variants[1].closures = Array.from({ length: 4001 }, (_, index) => ({ id: `c-${index}`, edgeIds: ['bc'], atS: 10 }));
  const app = await ready(input); await app.change('variant-select', 'close-at-10'); await app.element('impact-button').click();
  const text = rowText(app), results = app.state.allResults, workers = app.workers.length;
  await app.element('duplicate-variant').click();
  assert.match(app.element('toast').textContent, /Change rejected/);
  assert.equal(rowText(app), text); assert.equal(app.state.allResults, results); assert.equal(app.workers.length, workers);
  assert.equal(app.element('impact-filter').disabled, false);
});
