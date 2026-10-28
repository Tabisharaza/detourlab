import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { application, deferredFile } from './helpers/application.js';
import { createCutoffExperiment } from '../src/cutoff-experiment.js';
import { parseExperiment, simulateExperiment } from '../src/experiment.js';

const fixture = () => JSON.parse(readFileSync(new URL('../examples/minimal-experiment.json', import.meta.url), 'utf8'));
const rows = app => app.element('cutoff-rows').children;
const text = app => app.element('cutoff-rows').textContent;
const anchors = app => app.created.filter(element => element.tagName === 'A');
const policyMetrics = ['extraDistancePct', 'extraLateJobs', 'unreachableJobs', 'newlyLateJobs', 'maxArrivalSlipS'];
async function ready(input = fixture(), options = {}) {
  const app = application(options); await app.importExperiment(input); app.latestWorker().respond();
  await app.change('variant-select', input.variants.find(variant => variant.closures.length)?.id ?? input.variants[0].id);
  return app;
}
async function opened(input = fixture(), options = {}) {
  const app = await ready(input, options); app.element('cutoff-button').focus(); await app.element('cutoff-button').click(); return app;
}
async function start(app, times = '10, 11', policy = {}) {
  await app.change('cutoff-times', times, 'input');
  if (Object.keys(policy).length) app.element('cutoff-policy').open = true;
  for (const [metric, value] of Object.entries(policy)) await app.change(`cutoff-${metric}`, value, 'input');
  await app.element('cutoff-run').click(); return app.latestWorker();
}
async function complete(app, times = '10, 11', policy = {}) { const worker = await start(app, times, policy); worker.respond(); return worker; }
function assertNoEvidence(app) {
  assert.equal(rows(app).length, 0); assert.equal(app.element('cutoff-results').hidden, true); assert.equal(app.element('cutoff-export').disabled, true);
}

// DOM/Worker stand-ins execute checked-in handlers, not a native browser,
// assistive technology, a real file picker or an upload/download flow.
test('study launch is gated while the workspace runs and when no variant has a closure', async () => {
  const app = application(); assert.equal(app.element('cutoff-button').disabled, true);
  await app.element('cutoff-button').emit('click'); assert.notEqual(app.element('cutoff-dialog').open, true);
  app.latestWorker().respond(); assert.equal(app.element('cutoff-button').disabled, false);
  await app.element('run-experiment').click(); assert.equal(app.element('cutoff-button').disabled, true);
  await app.element('cutoff-button').emit('click'); assert.notEqual(app.element('cutoff-dialog').open, true);
  const empty = fixture(); empty.variants.forEach(variant => { variant.closures = []; });
  await app.importExperiment(empty); app.latestWorker().respond();
  assert.equal(app.element('cutoff-button').disabled, true);
  await app.element('cutoff-button').emit('click'); assert.notEqual(app.element('cutoff-dialog').open, true);
});

test('opening is a temporary editor: no simulation, preselected source, empty samples and heading focus', async () => {
  const app = await ready(), count = app.workers.length;
  await app.element('cutoff-button').click();
  assert.equal(app.workers.length, count); assert.equal(app.element('cutoff-variant').value, 'close-at-10');
  assert.equal(app.element('cutoff-closure').value, 'bc-closure'); assert.equal(app.element('cutoff-times').value, '');
  assert.equal(app.document.activeElement, app.element('cutoff-dialog-title'));
  assert.match(app.element('cutoff-source-detail').textContent, /currently starts at 10 s.*1 directed edges.*0 other closure events/);
  assert.match(app.element('cutoff-source-detail').textContent, /clear roads, not this original schedule/);
  assertNoEvidence(app); assert.equal(anchors(app).length, 0);
});

test('tiny study sorts chosen times and displays hand-checkable outcomes without implying acceptance', async () => {
  const app = await opened(), before = app.workers.length; const worker = await complete(app, '11, 10');
  assert.equal(app.workers.length, before + 1); assert.equal(worker.terminated, true);
  assert.deepEqual(rows(app).map(row => row.children[0].textContent), ['10 s', '11 s']);
  assert.match(rows(app)[0].textContent, /260 m\+30%.*1\+1 vs clear roads.*1\/1 completed0 unreachable.*Not evaluated/);
  assert.match(rows(app)[1].textContent, /200 m0%.*00 vs clear roads.*1\/1 completed0 unreachable.*Not evaluated/);
  assert.match(app.element('cutoff-baseline').textContent, /200 m.*0 late.*1\/1 completed.*0 unreachable/);
  assert.match(app.element('cutoff-policy-summary').textContent, /Not evaluated does not mean passed/);
  assert.match(app.element('cutoff-status').textContent, /2 sampled times completed.*Acceptance not evaluated.*Workspace unchanged/);
  assert.equal(rows(app)[0].children[0].getAttribute('scope'), 'row');
  assert.equal(app.element('cutoff-results').getAttribute('aria-busy'), 'false'); assert.equal(anchors(app).length, 0);
});

test('two and six samples accept zero, fractional, scientific and maximum bounded time', async () => {
  const app = await opened();
  for (const times of ['0,604800', '604800, 11, 10, 2.5, 1e0, +0']) {
    await complete(app, times);
    assert.deepEqual(rows(app).map(row => row.children[0].textContent), times.startsWith('0,') ? ['0 s', '604800 s'] : ['0 s', '1 s', '2.5 s', '10 s', '11 s', '604800 s']);
  }
});

test('invalid counts, syntax, duplicate values and time bounds prevent Worker creation and focus the invalid input', async () => {
  const app = await opened(), before = app.workers.length;
  for (const times of ['', '10', '0,1,2,3,4,5,6', '10,10.0', '0,-0', '-1,11', '10,604801', '10,Infinity', 'NaN,11', '10,1e999', '0x10,11', '10,,11', '10;11', '10,11,', '1'.repeat(201) + ',2']) {
    await start(app, times); assert.equal(app.workers.length, before, times);
    assertNoEvidence(app); assert.equal(app.element('cutoff-times').getAttribute('aria-invalid'), 'true', times);
    assert.equal(app.document.activeElement, app.element('cutoff-times')); assert.match(app.element('cutoff-status').textContent, /Study not run/);
  }
  await app.change('cutoff-times', '10, 11', 'input'); assert.equal(app.element('cutoff-times').getAttribute('aria-invalid'), 'false');
});

test('five explicit policy limits are displayed and applied with whole-study pass/fail counts', async () => {
  const app = await opened(); await complete(app, '10,11', Object.fromEntries(policyMetrics.map(metric => [metric, '0'])));
  assert.match(app.element('cutoff-status').textContent, /1 passed the supplied limits; 1 failed/);
  assert.match(rows(app)[0].textContent, /Failed supplied limits.*extra distance \(%\): 30 > 0.*extra late deliveries: 1 > 0.*newly late deliveries: 1 > 0.*arrival slip \(seconds\): 6 > 0/);
  assert.match(rows(app)[1].textContent, /Passed supplied limits/);
  assert.match(app.element('cutoff-policy-summary').textContent, /unreachable deliveries ≤ 0/);
  await complete(app, '10,11', { extraDistancePct: 30, extraLateJobs: 1, unreachableJobs: 0, newlyLateJobs: 1, maxArrivalSlipS: 6 });
  assert.match(app.element('cutoff-status').textContent, /2 passed the supplied limits; 0 failed/);
});

test('empty limits are not zero limits and unlisted gates remain not evaluated', async () => {
  const app = await opened(); await complete(app, '10,11', { maxArrivalSlipS: 6 });
  assert.match(app.element('cutoff-policy-summary').textContent, /arrival slip \(seconds\) ≤ 6.*Unlisted limits are not evaluated/);
  assert.doesNotMatch(app.element('cutoff-policy-summary').textContent, /extra late deliveries ≤/);
  await app.change('cutoff-maxArrivalSlipS', '', 'input'); await app.element('cutoff-run').click(); app.latestWorker().respond();
  assert.match(app.element('cutoff-status').textContent, /Acceptance not evaluated/); assert.doesNotMatch(text(app), /Passed supplied limits/);
});

test('invalid numeric policy values and native badInput prevent a run and identify the field', async () => {
  const app = await opened(); await app.change('cutoff-times', '10,11', 'input'); const count = app.workers.length;
  for (const [metric, value] of [['extraDistancePct', '-1'], ['extraLateJobs', 'NaN'], ['unreachableJobs', 'Infinity'], ['newlyLateJobs', 'one'], ['maxArrivalSlipS', '1e999']]) {
    app.element('cutoff-policy').open = true; await app.change(`cutoff-${metric}`, value, 'input'); await app.element('cutoff-run').click();
    assert.equal(app.workers.length, count); assert.equal(app.document.activeElement, app.element(`cutoff-${metric}`));
    assert.equal(app.element(`cutoff-${metric}`).getAttribute('aria-invalid'), 'true'); assertNoEvidence(app);
    await app.change(`cutoff-${metric}`, '', 'input');
  }
  app.element('cutoff-maxArrivalSlipS').validity = { badInput: true }; await app.element('cutoff-run').click();
  assert.equal(app.workers.length, count); assert.equal(app.element('cutoff-maxArrivalSlipS').getAttribute('aria-invalid'), 'true');
});

test('an invalid policy hidden by a collapsed disclosure is revealed before receiving focus', async () => {
  const app = await opened(); await app.change('cutoff-times', '10,11', 'input');
  await app.change('cutoff-extraDistancePct', '-1', 'input'); app.element('cutoff-policy').open = false;
  await app.element('cutoff-run').click();
  assert.equal(app.element('cutoff-policy').open, true);
  assert.equal(app.document.activeElement, app.element('cutoff-extraDistancePct'));
  assertNoEvidence(app);
});

test('unreachable samples expose lost service and fail a requested timing gate with no comparable arrivals', async () => {
  const input = fixture(); input.variants[1].closures.push({ id: 'dominant', edgeIds: ['bc', 'dc'], atS: 0 });
  const app = await opened(input); await complete(app, '10,11', { unreachableJobs: 0, maxArrivalSlipS: 100 });
  for (const row of rows(app)) {
    assert.match(row.textContent, /0\/1 completed1 unreachable/);
    assert.match(row.textContent, /unreachable deliveries: 1 > 0.*no comparable arrivals; requested limit cannot pass.*0 comparable arrivals; 1 not comparable/);
  }
  assert.match(app.element('cutoff-warning').textContent, /Skipped work can reduce distance or lateness.*not equal-service improvements/);
});

test('empty demand distinguishes no comparable evidence from successful requested arrival-slip evaluation', async () => {
  const input = fixture(); input.baseScenario.jobs = [];
  const app = await opened(input); await complete(app, '10,11', { maxArrivalSlipS: 0 });
  assert.match(app.element('cutoff-status').textContent, /0 passed the supplied limits; 2 failed/);
  assert.match(text(app), /0\/0 completed0 unreachable.*no comparable arrivals/);
});

test('source and closure selection is local to the study and retains every nonselected schedule', async () => {
  const input = fixture(); input.variants[2].closures.push({ id: 'other', edgeIds: ['ab'], atS: 100 });
  const app = await opened(input), selected = app.state.selectedVariantId;
  await app.change('cutoff-variant', 'clear');
  assert.equal(app.element('cutoff-closure').disabled, true); assert.equal(app.element('cutoff-run').disabled, true);
  assert.match(app.element('cutoff-source-detail').textContent, /no closure to vary/);
  await app.change('cutoff-variant', 'close-at-11'); await app.change('cutoff-closure', 'other');
  const worker = await start(app, '99,100');
  assert.equal(app.state.selectedVariantId, selected);
  assert.deepEqual(worker.request.experiment, createCutoffExperiment(app.state.experiment, 'close-at-11', 'other', [99,100]));
  assert.equal(worker.request.experiment.variants[0].closures[0].atS, 11);
});

test('successful study and dismissal preserve source objects, unsaved fields, selection and replay settings', async () => {
  const app = await ready();
  await app.change('variant-name', 'Unsaved label'); await app.change('road-search', 'B', 'input');
  await app.change('road-direction', 'forward'); await app.change('timeline', 12, 'input'); await app.change('speed', 120);
  await app.element('zoom-in').click(); await app.element('view-baseline').click(); await app.element('edit-roads').click();
  const source = app.state.experiment, results = app.state.allResults, scenario = app.state.scenario;
  const before = { selectedVariantId: app.state.selectedVariantId, selectedVehicle: app.state.selectedVehicle, time: app.state.time, speed: app.state.speed, zoom: app.state.zoom, view: app.state.view, editing: app.state.editing };
  const fields = Object.fromEntries(['variant-name', 'road-search', 'road-select', 'road-direction', 'closure-time'].map(id => [id, app.element(id).value]));
  await app.element('play-button').click(); await app.element('cutoff-button').click();
  assert.equal(app.state.playing, false);
  await complete(app); await app.element('cutoff-close').click();
  assert.equal(app.state.experiment, source); assert.equal(app.state.allResults, results); assert.equal(app.state.scenario, scenario);
  assert.deepEqual(Object.fromEntries(Object.keys(before).map(key => [key, app.state[key]])), before);
  assert.deepEqual(Object.fromEntries(Object.keys(fields).map(id => [id, app.element(id).value])), fields);
  assert.equal(anchors(app).length, 0);
});

test('study uses saved source names and schedules while preserving unsaved editor text verbatim', async () => {
  const input = fixture(); input.variants[1].closures.push({ id: 'other', edgeIds: ['ab'], atS: 100 });
  const app = await ready(input), source = app.state.experiment;
  const savedName = source.variants.find(variant => variant.id === 'close-at-10').name;
  app.element('variant-name').value = 'Unsaved source name';
  const unsavedClosure = app.element('event-list').children[1].children[2].children[1];
  unsavedClosure.value = '999'; // No committed change event.
  await app.element('cutoff-button').click();
  assert.equal(app.element('cutoff-variant').children[1].textContent, savedName);
  const worker = await complete(app);
  assert.deepEqual(worker.request.experiment, createCutoffExperiment(source, 'close-at-10', 'bc-closure', [10,11]));
  assert.equal(worker.request.experiment.variants[0].closures[1].atS, 100);
  assert.ok(app.element('cutoff-caption').textContent.includes(savedName));
  assert.doesNotMatch(app.element('cutoff-caption').textContent, /Unsaved source name/);
  await app.element('cutoff-close').click();
  assert.equal(app.element('variant-name').value, 'Unsaved source name'); assert.equal(unsavedClosure.value, '999');
  assert.equal(app.state.experiment, source);
});

test('every study input invalidates finished evidence without touching workspace results', async () => {
  const app = await opened(), results = app.state.allResults;
  for (const id of ['cutoff-times', ...policyMetrics.map(metric => `cutoff-${metric}`)]) {
    await complete(app); await app.change(id, id === 'cutoff-times' ? '10,12' : '0', 'input');
    assertNoEvidence(app); assert.equal(app.state.allResults, results); assert.match(app.element('cutoff-status').textContent, /Inputs changed/);
  }
});

test('changing either source selector cancels pending work and queued results cannot reappear', async () => {
  const input = fixture(); input.variants[1].closures.push({ id: 'other', edgeIds: ['ab'], atS: 100 });
  const app = await opened(input), first = await start(app);
  await app.change('cutoff-closure', 'other'); first.respond(); assert.equal(first.terminated, true); assertNoEvidence(app);
  const second = await start(app, '99,100'); await app.change('cutoff-variant', 'close-at-11'); second.respond();
  assert.equal(second.terminated, true); assertNoEvidence(app); assert.match(app.element('cutoff-status').textContent, /Source changed/);
});

test('Cancel preserves inputs, clears work and focus, and ignores old success or errors', async () => {
  const app = await opened(), worker = await start(app);
  app.element('cutoff-cancel').focus(); await app.element('cutoff-cancel').click();
  assert.equal(worker.terminated, true); assert.equal(app.element('cutoff-times').value, '10, 11');
  assert.equal(app.document.activeElement, app.element('cutoff-run')); assert.equal(app.element('cutoff-cancel').hidden, true);
  const status = app.element('cutoff-status').textContent; worker.respond(); worker.fail('old failure');
  assert.equal(app.element('cutoff-status').textContent, status); assertNoEvidence(app);
  await complete(app); assert.equal(rows(app).length, 2);
});

test('queued terminal Cancel dispatch cannot erase a finished study or disturb reader focus', async () => {
  const app = await opened(); await complete(app); app.element('cutoff-export').focus();
  const shown = text(app), status = app.element('cutoff-status').textContent;
  await app.element('cutoff-cancel').emit('click');
  assert.equal(text(app), shown); assert.equal(app.element('cutoff-status').textContent, status);
  assert.equal(app.element('cutoff-export').disabled, false); assert.equal(app.document.activeElement, app.element('cutoff-export'));
});

test('editing pending inputs and repeated Run replace old Workers without stale success or failure', async () => {
  const app = await opened(), first = await start(app);
  await app.change('cutoff-times', '11,12', 'input'); assert.equal(first.terminated, true); first.respond(); assertNoEvidence(app);
  await app.element('cutoff-run').click(); const second = app.latestWorker();
  await app.element('cutoff-run').click(); const third = app.latestWorker(); assert.notEqual(third, second); assert.equal(second.terminated, true);
  third.respond(); const current = text(app); second.respond(); first.respond({ error: 'stale failure' });
  assert.equal(text(app), current); assert.deepEqual(rows(app).map(row => row.children[0].textContent), ['11 s', '12 s']);
});

test('foreign response IDs are ignored until the current Worker response arrives', async () => {
  const app = await opened(), worker = await start(app);
  worker.respond(undefined, worker.request.id + 1); assertNoEvidence(app); assert.equal(worker.terminated, false);
  worker.respond(); assert.equal(rows(app).length, 2); assert.equal(worker.terminated, true);
});

test('Close and Escape terminate work, discard studies and restore launch focus', async () => {
  for (const method of ['close', 'escape']) {
    const app = await opened(), worker = await start(app);
    if (method === 'close') await app.element('cutoff-close').click(); else await app.element('cutoff-dialog').escape();
    assert.equal(app.element('cutoff-dialog').open, false); assert.equal(worker.terminated, true); assertNoEvidence(app);
    assert.equal(app.document.activeElement, app.element('cutoff-button'));
    worker.respond(); assertNoEvidence(app);
    await app.element('cutoff-button').click(); assert.equal(app.element('cutoff-times').value, '');
    assert.equal(app.document.activeElement, app.element('cutoff-dialog-title'));
  }
});

test('queued modal close events and old Worker messages cannot disturb a reopened study', async () => {
  const app = await opened(fixture(), { deferDialogClose: true }), old = await start(app);
  await app.element('cutoff-dialog').escape(); await app.element('cutoff-button').click();
  const current = await start(app, '11,12'); app.element('cutoff-times').focus();
  await app.flushDialogCloseEvents(); old.respond(); old.fail();
  assert.equal(app.element('cutoff-dialog').open, true); assert.equal(app.document.activeElement, app.element('cutoff-times'));
  current.respond(); assert.deepEqual(rows(app).map(row => row.children[0].textContent), ['11 s', '12 s']);
});

test('repeated launch dispatch does not reset open study inputs, focus or active work', async () => {
  const app = await opened(), worker = await start(app), count = app.workers.length;
  app.element('cutoff-times').focus(); await app.element('cutoff-button').emit('click');
  assert.equal(app.workers.length, count); assert.equal(worker.terminated, false);
  assert.equal(app.element('cutoff-times').value, '10, 11'); assert.equal(app.document.activeElement, app.element('cutoff-times'));
});

test('Tab wraps visible study controls, includes the result scroll region and does not toggle background playback', async () => {
  const app = await opened(); await app.element('cutoff-dialog').emit('keydown', { key: 'Tab' });
  assert.equal(app.document.activeElement, app.element('cutoff-close'));
  await app.element('cutoff-dialog').emit('keydown', { key: 'Tab', shiftKey: true }); assert.equal(app.document.activeElement, app.element('cutoff-run'));
  await complete(app); app.element('cutoff-close').focus(); await app.element('cutoff-dialog').emit('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(app.document.activeElement, app.element('cutoff-export'));
  await app.element('cutoff-dialog').emit('keydown', { key: 'Tab' }); assert.equal(app.document.activeElement, app.element('cutoff-close'));
  assert.equal(app.element('cutoff-table-region').tabIndex, 0);
  for (const id of ['cutoff-dialog-title', 'cutoff-table-region', 'cutoff-times']) {
    app.element(id).focus(); const event = app.windowEvent('keydown', { code: 'Space' });
    assert.equal(event.defaultPrevented, false); assert.equal(app.state.playing, false);
  }
});

test('completion hands focused Cancel to Run but does not reclaim a newer input focus', async () => {
  for (const focused of ['cutoff-cancel', 'cutoff-times']) {
    const app = await opened(), worker = await start(app); app.element(focused).focus(); worker.respond();
    assert.equal(app.document.activeElement, app.element(focused === 'cutoff-cancel' ? 'cutoff-run' : focused));
  }
});

test('superseded timeout callbacks cannot cancel a newer study or replace its finished result', async () => {
  const app = await opened(); await start(app);
  const oldTimeout = [...app.timers.values()].find(timer => timer.delay === 30000).callback;
  const current = await start(app, '11,12'); oldTimeout(); assert.equal(current.terminated, false);
  current.respond(); const shown = text(app); oldTimeout(); assert.equal(text(app), shown);
});

test('workspace edits invalidate study fields and evidence before a new workspace run can complete', async () => {
  const app = await opened(); await complete(app); app.element('cutoff-export').focus();
  await app.element('duplicate-variant').click(); assertNoEvidence(app);
  assert.equal(app.element('cutoff-fields').disabled, true); assert.equal(app.document.activeElement, app.element('cutoff-close'));
  assert.match(app.element('cutoff-status').textContent, /Workspace changed.*Close and reopen/);
  const count = app.workers.length; await app.element('cutoff-run').emit('click'); await app.element('cutoff-export').emit('click');
  assert.equal(app.workers.length, count); assert.equal(anchors(app).length, 0);
  app.latestWorker().respond(); assertNoEvidence(app); assert.equal(app.element('cutoff-fields').disabled, true);
  await app.element('cutoff-close').click(); await app.element('cutoff-button').click(); assert.equal(app.element('cutoff-fields').disabled, false);
});

test('workspace rerun, reset and lesson transitions cancel pending studies without adopting samples', async () => {
  for (const action of ['run-experiment', 'reset-button', 'lesson']) {
    const app = await opened(), worker = await start(app);
    if (action === 'lesson') { await app.element('try-example-button').click(); await app.element('lesson-start').click(); }
    else await app.element(action).click();
    assert.equal(worker.terminated, true); assert.equal(app.element('cutoff-fields').disabled, true); worker.respond(); assertNoEvidence(app);
    assert.notEqual(app.state.experiment.id, 'cutoff-comparison');
  }
});

test('a delayed valid mocked import invalidates studies; a rejected import preserves completed evidence', async () => {
  const app = await ready(), pending = deferredFile(), importing = app.importFile(pending.file);
  await app.element('cutoff-button').click(); const worker = await start(app); app.element('cutoff-times').focus();
  const newer = fixture(); newer.name = 'New synthetic input'; pending.resolve(new TextEncoder().encode(JSON.stringify(newer)).buffer); await importing;
  assert.equal(worker.terminated, true); assert.equal(app.element('cutoff-fields').disabled, true); assert.equal(app.document.activeElement, app.element('cutoff-close'));
  worker.respond(); assertNoEvidence(app);
  await app.element('cutoff-close').click(); app.latestWorker().respond(); await app.change('variant-select', 'close-at-10');
  await app.element('cutoff-button').click(); await complete(app); const before = text(app); app.element('cutoff-export').focus();
  await app.importFile(new Blob(['not JSON'])); assert.equal(text(app), before); assert.equal(app.document.activeElement, app.element('cutoff-export'));
  assert.equal(app.element('cutoff-export').disabled, false);
});

test('asynchronous workspace replacement moves a disabled launcher to Run without stealing newer focus', async () => {
  for (const focused of ['cutoff-button', 'road-search']) {
    const app = await ready(), pending = deferredFile(), importing = app.importFile(pending.file);
    app.element(focused).focus(); pending.resolve(new TextEncoder().encode(JSON.stringify(fixture())).buffer); await importing;
    assert.equal(app.element('cutoff-button').disabled, true);
    assert.equal(app.document.activeElement, app.element(focused === 'cutoff-button' ? 'run-experiment' : focused));
  }
});

test('workspace invalidation preserves a newer focus choice on the open dialog heading', async () => {
  const app = await ready(), pending = deferredFile(), importing = app.importFile(pending.file);
  await app.element('cutoff-button').click(); await complete(app); app.element('cutoff-dialog-title').focus();
  pending.resolve(new TextEncoder().encode(JSON.stringify(fixture())).buffer); await importing;
  assertNoEvidence(app); assert.equal(app.document.activeElement, app.element('cutoff-dialog-title'));
});

test('rejected oversized workspace edits preserve the valid study editor and the original source', async () => {
  const input = fixture(); input.variants = input.variants.slice(0,2);
  input.variants[1].closures = Array.from({ length: 4001 }, (_, index) => ({ id: index ? `event-${index}` : 'bc-closure', edgeIds: ['bc'], atS: 10 }));
  const app = await opened(input), source = app.state.experiment;
  // Study generation itself exceeds replication budgets; rejection must not
  // invalidate the still-valid source selection or start a Worker.
  await start(app); assert.match(app.element('cutoff-status').textContent, /aggregate closure-record/);
  const count = app.workers.length; await app.element('duplicate-variant').click();
  assert.equal(app.state.experiment, source); assert.equal(app.workers.length, count); assert.equal(app.element('cutoff-fields').disabled, false);
  assert.match(app.element('toast').textContent, /Change rejected/);
});

test('message, event, timeout and constructor failures show no partial study and permit a clean retry', async () => {
  for (const mode of ['message', 'event', 'timeout', 'constructor']) {
    let constructionFails = false;
    const app = await opened(fixture(), { workerConstructionError: () => constructionFails ? 'Worker construction blocked' : null });
    constructionFails = mode === 'constructor'; const before = app.workers.length; const worker = await start(app);
    if (mode === 'message') worker.respond({ error: 'Synthetic study budget exceeded' });
    if (mode === 'event') worker.fail('Synthetic event failure');
    if (mode === 'timeout') [...app.timers.values()].find(timer => timer.delay === 30000).callback();
    assertNoEvidence(app); assert.match(app.element('cutoff-status').textContent, /Study failed.*No partial results/);
    assert.equal(app.element('cutoff-cancel').hidden, true); assert.equal(app.element('cutoff-fields').disabled, false);
    if (mode === 'constructor') assert.equal(app.workers.length, before); else assert.equal(worker.terminated, true);
    constructionFails = false; await complete(app); assert.equal(rows(app).length, 2);
  }
});

test('a synchronous Worker postMessage failure is caught, terminated and cannot leak evidence', async () => {
  const app = await opened(), prototype = Object.getPrototypeOf(app.latestWorker()), post = prototype.postMessage;
  prototype.postMessage = () => { throw new Error('Synthetic clone failure'); };
  try { await start(app); } finally { prototype.postMessage = post; }
  assertNoEvidence(app); assert.equal(app.latestWorker().terminated, true);
  assert.match(app.element('cutoff-status').textContent, /Study failed.*Synthetic clone failure/);
  await complete(app); assert.equal(rows(app).length, 2);
});

test('a malformed completed ledger fails closed instead of rendering or exporting a subset', async () => {
  const app = await opened(), worker = await start(app), malformed = simulateExperiment(worker.request.experiment);
  malformed.variants.pop(); worker.respond(malformed);
  assertNoEvidence(app); assert.match(app.element('cutoff-status').textContent, /Study failed.*matching.*identities/);
  await app.element('cutoff-export').emit('click'); assert.equal(anchors(app).length, 0);
});

test('study export is explicit, standard schedules-only JSON and never mutates or adopts workspace state', async () => {
  const app = await opened(), source = app.state.experiment, results = app.state.allResults;
  await complete(app, '11,10', { extraLateJobs: 0 }); assert.equal(anchors(app).length, 0);
  await app.element('cutoff-export').click(); const link = anchors(app)[0];
  assert.equal(link.download, 'detourlab-closure-time-study.experiment.json');
  const downloaded = parseExperiment(await (await fetch(link.href)).text());
  assert.deepEqual(downloaded, createCutoffExperiment(source, 'close-at-10', 'bc-closure', [10,11]));
  assert.equal(Object.hasOwn(downloaded, 'thresholds'), false); assert.equal(Object.hasOwn(downloaded, 'results'), false);
  assert.equal(app.state.experiment, source); assert.equal(app.state.allResults, results);
  assert.match(app.element('cutoff-status').textContent, /download requested.*schedules only, not policy limits or results/);
  [...app.timers.values()].filter(timer => timer.delay === 1000).forEach(timer => timer.callback());
  await assert.rejects(fetch(link.href));
});

test('export preparation errors are reported without changing the workspace or claiming a download', async () => {
  const app = await opened(); await complete(app); const source = app.state.experiment;
  const create = URL.createObjectURL; URL.createObjectURL = () => { throw new Error('Synthetic object URL failure'); };
  try { await app.element('cutoff-export').click(); } finally { URL.createObjectURL = create; }
  assert.match(app.element('cutoff-status').textContent, /Synthetic object URL failure/);
  assert.doesNotMatch(app.element('cutoff-status').textContent, /download requested/);
  assert.equal(anchors(app).length, 0); assert.equal(app.state.experiment, source); assert.equal(rows(app).length, 2);
});

test('failed link activation still schedules object URL cleanup and retains the study for retry', async () => {
  const app = await opened(); await complete(app);
  const create = app.document.createElement;
  app.document.createElement = tag => { const item = create(tag); if (tag === 'a') item.click = () => { throw new Error('Synthetic link failure'); }; return item; };
  try { await app.element('cutoff-export').click(); } finally { app.document.createElement = create; }
  assert.match(app.element('cutoff-status').textContent, /Synthetic link failure/); assert.equal(rows(app).length, 2);
  const url = anchors(app)[0].href; [...app.timers.values()].filter(timer => timer.delay === 1000).forEach(timer => timer.callback());
  await assert.rejects(fetch(url));
  await app.element('cutoff-export').click(); assert.match(app.element('cutoff-status').textContent, /download requested/);
  [...app.timers.values()].filter(timer => timer.delay === 1000).forEach(timer => timer.callback());
});

test('forced export after input invalidation or dismissal creates no download link', async () => {
  const app = await opened(); await complete(app); await app.change('cutoff-times', '11,12', 'input');
  await app.element('cutoff-export').emit('click'); assert.equal(anchors(app).length, 0);
  await complete(app); await app.element('cutoff-close').click(); await app.element('cutoff-export').emit('click'); assert.equal(anchors(app).length, 0);
});

test('generated closure-record limit rejects before a Worker is created or export becomes available', async () => {
  const input = fixture(); input.variants[1].closures = Array.from({ length: 1400 }, (_, index) => ({ id: index ? `event-${index}` : 'bc-closure', edgeIds: ['bc'], atS: 10 }));
  const app = await opened(input), count = app.workers.length; await start(app, '0,1,2,3,4,5');
  assert.equal(app.workers.length, count); assertNoEvidence(app); assert.match(app.element('cutoff-status').textContent, /aggregate closure-record limit/);
});

test('generated closure-reference and UTF-8 byte limits are retained by the browser builder', async () => {
  for (const bytes of [false, true]) {
    const input = fixture(); input.baseScenario.edges = Array.from({ length: 1000 }, (_, index) => ({ ...input.baseScenario.edges[0], id: bytes ? `e${String(index).padStart(4, '0')}${'x'.repeat(91)}` : `e-${index}` }));
    input.variants.forEach(variant => { variant.closures = []; });
    input.variants[1].closures = Array.from({ length: bytes ? 5 : 9 }, (_, index) => ({ id: index ? `event-${index}` : 'bc-closure', edgeIds: input.baseScenario.edges.map(edge => edge.id), atS: 10 }));
    const app = await opened(input), count = app.workers.length; await start(app, '0,1,2,3,4,5');
    assert.equal(app.workers.length, count); assertNoEvidence(app); assert.match(app.element('cutoff-status').textContent, bytes ? /2 MiB/ : /aggregate closure-reference/);
  }
});

test('imported names remain literal text in study selectors and result captions', async () => {
  const input = fixture(); input.variants[1].name = '<img src=x onerror=alert(1)> & "source"';
  const app = await opened(input); await complete(app);
  assert.equal(app.element('cutoff-variant').children[1].textContent, input.variants[1].name);
  assert.ok(app.element('cutoff-caption').textContent.includes(input.variants[1].name));
  assert.equal(app.created.filter(element => ['IMG','SCRIPT','IFRAME'].includes(element.tagName)).length, 0);
});

test('closure options keep exact IDs while bounding road summaries and rendering hostile road names as text', async () => {
  const input = fixture();
  const names = ['<img src=x onerror=alert(1)> ' + 'x'.repeat(70), 'Second road', 'Third road', 'Fourth road'];
  input.baseScenario.edges.forEach((edge, index) => { edge.roadName = names[index]; });
  input.variants[1].closures[0].edgeIds = input.baseScenario.edges.map(edge => edge.id);
  const app = await opened(input), option = app.element('cutoff-closure').children[0];
  assert.equal(option.value, 'bc-closure');
  assert.equal(option.textContent, `${names[0].slice(0,60)}…, Second road + 2 more roads · bc-closure · currently 10 s`);
  assert.ok(app.element('cutoff-source-detail').textContent.includes(`${names[0].slice(0,60)}…, Second road + 2 more roads`));
  assert.equal(app.created.filter(element => ['IMG','SCRIPT','IFRAME'].includes(element.tagName)).length, 0);
  const worker = await start(app); assert.deepEqual(worker.request.experiment.variants[0].closures[0].edgeIds, input.variants[1].closures[0].edgeIds);
});
