import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENT_LIMITS, experimentFromScenario, simulateExperiment } from '../src/experiment.js';
import { application, deferredFile, minimalScenario, scenarioText } from './helpers/application.js';

// These execute the production app's real handlers and result-rendering code.
// Workers and DOM are controlled stand-ins, not a browser or layout assertion.
const copy = value => structuredClone(value);
const formatKm = meters => meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1)} km`;
const clock = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const eventInput = (app, index) => app.element('event-list').children[index].children[2].children[1];
const eventRemove = (app, index) => app.element('event-list').children[index].children[2].children[2];
const card = (app, id) => app.element('variant-results').children.find(item => item.dataset.variant === id);
const selectedVariant = app => app.state.experiment.variants.find(item => item.id === app.state.selectedVariantId);

function comparisonExperiment() {
  const experiment = experimentFromScenario(minimalScenario());
  experiment.variants = [
    { id: 'detour', name: 'Detour', closures: [{ id: 'bc-cutoff', edgeIds: ['bc'], atS: 10 }] },
    { id: 'control', name: 'Clear roads', closures: [] },
    { id: 'blocked', name: 'Disconnected', closures: [{ id: 'ab-cutoff', edgeIds: ['ab'], atS: 0 }] },
    { id: 'later', name: 'After edge entry', closures: [{ id: 'later-cutoff', edgeIds: ['bc'], atS: 11 }] },
  ];
  return experiment;
}

async function loaded(experiment = comparisonExperiment()) {
  const app = application(); await app.importExperiment(experiment); return app;
}

function assertSelectedLedger(app, result, baseline) {
  const metrics = result.metrics;
  assert.equal(app.element('distance-value').textContent, formatKm(metrics.distanceM).replace(' ', ''));
  assert.equal(app.element('late-value').textContent, `${metrics.lateJobs}/ ${metrics.totalJobs}`);
  assert.equal(app.element('unreachable-value').textContent, `${metrics.unreachableJobs}stops`);
  assert.equal(app.element('distance-baseline').textContent, `BASE ${formatKm(baseline.metrics.distanceM)}`);
  assert.equal(app.element('late-baseline').textContent, `BASE ${baseline.metrics.lateJobs}`);
  assert.equal(app.element('unreachable-baseline').textContent, `BASE ${baseline.metrics.unreachableJobs}`);
  const vehicle = result.vehicles.find(item => item.id === app.state.selectedVehicle);
  const baseVehicle = baseline.vehicles.find(item => item.id === vehicle.id);
  assert.equal(app.element('route-baseline-distance').textContent, formatKm(baseVehicle.distanceM));
  assert.equal(app.element('route-scenario-distance').textContent, formatKm(vehicle.distanceM));
  assert.equal(app.element('job-list').children.length, vehicle.jobs.length);
  vehicle.jobs.forEach((job, index) => {
    const item = app.element('job-list').children[index];
    assert.equal(item.children[0].children[1].textContent, job.status === 'unreachable' ? 'NO PATH' : job.status === 'late' ? job.arrivalS - job.dueTimeS < 60 ? `+${job.arrivalS - job.dueTimeS} s` : `+${Math.ceil((job.arrivalS - job.dueTimeS) / 60)} min` : 'ON TIME');
    assert.equal(item.children[1].textContent, job.status === 'unreachable' ? `Due ${clock(job.dueTimeS)} · skipped` : `Arrived ${clock(job.arrivalS)} · due ${clock(job.dueTimeS)}`);
  });
}

test('variant handlers duplicate, rename and remove across the bounded 2–6 range', async () => {
  const app = await loaded(experimentFromScenario(minimalScenario()));
  const original = copy(app.latestExperiment());
  assert.equal(app.element('delete-variant').disabled, true);
  const originalRequests = app.posted.length;
  await app.element('delete-variant').emit('click'); // Guard holds even for a dispatched disabled-button event.
  assert.equal(app.posted.length, originalRequests);
  for (let count = 3; count <= 6; count += 1) {
    const source = copy(selectedVariant(app));
    await app.element('duplicate-variant').click();
    const duplicated = selectedVariant(app);
    assert.equal(app.latestExperiment().variants.length, count);
    assert.notEqual(duplicated.id, source.id);
    assert.deepEqual(duplicated.closures, source.closures);
    assert.notStrictEqual(duplicated.closures, app.state.experiment.variants.find(item => item.id === source.id).closures);
    await app.change('variant-name', `Plan ${count}`);
    await app.element('rename-variant').click();
    assert.equal(selectedVariant(app).name, `Plan ${count}`);
    assert.equal(app.element('variant-select').value, duplicated.id);
  }
  assert.equal(new Set(app.latestExperiment().variants.map(item => item.id)).size, 6);
  assert.equal(app.element('duplicate-variant').disabled, true);
  const atLimit = app.posted.length;
  await app.element('duplicate-variant').emit('click');
  assert.equal(app.posted.length, atLimit);
  assert.deepEqual(app.latestExperiment().variants.slice(0, 2), original.variants);
  while (app.latestExperiment().variants.length > 2) {
    const removed = app.state.selectedVariantId;
    await app.element('delete-variant').click();
    assert.ok(!app.latestExperiment().variants.some(item => item.id === removed));
    assert.equal(app.state.selectedVariantId, app.latestExperiment().variants[0].id);
  }
  assert.equal(app.element('delete-variant').disabled, true);
  assert.match(app.element('variant-limit').textContent, /^2 \/ 6 variants/u);
  const atMinimum = app.posted.length;
  await app.element('delete-variant').emit('click');
  assert.equal(app.posted.length, atMinimum);
});

test('rename rejects empty and overlong names while preserving the experiment', async () => {
  const app = await loaded();
  const before = copy(app.latestExperiment()), requests = app.posted.length;
  for (const name of ['   ', 'x'.repeat(EXPERIMENT_LIMITS.nameLength + 1)]) {
    await app.change('variant-name', name); await app.element('rename-variant').click();
    assert.deepEqual(app.state.experiment, before); assert.equal(app.posted.length, requests);
    assert.match(app.element('toast').textContent, /short nonempty name/u);
  }
  await app.change('variant-name', `  ${'x'.repeat(EXPERIMENT_LIMITS.nameLength)}  `);
  await app.element('rename-variant').click();
  assert.equal(selectedVariant(app).name, 'x'.repeat(EXPERIMENT_LIMITS.nameLength));
  assert.deepEqual(app.latestExperiment().variants.slice(1), before.variants.slice(1));
});

test('direction-aware edits and event cutoffs preserve other events and variants', async () => {
  const scenario = minimalScenario();
  scenario.edges.push({ id: 'cb', from: 'C', to: 'B', distanceM: 100, travelTimeS: 10, roadName: 'Second Street reverse' });
  const experiment = experimentFromScenario(scenario);
  experiment.variants[0].closures = [];
  experiment.variants[1].closures = [{ id: 'other-one', edgeIds: ['dc'], atS: 19 }, { id: 'other-two', edgeIds: ['bd'], atS: 71 }];
  const app = await loaded(experiment), other = copy(experiment.variants[1]);
  await app.change('road-select', 'bc'); await app.change('road-direction', 'forward'); await app.change('closure-time', 125);
  await app.element('toggle-road').click();
  assert.deepEqual(selectedVariant(app).closures, [{ id: 'road-edit', edgeIds: ['bc'], atS: 125 }]);
  await app.change('road-select', 'ab'); await app.change('closure-time', 500); await app.element('toggle-road').click();
  const unrelated = copy(selectedVariant(app).closures[1]);
  await app.change('road-select', 'bc'); await app.change('road-direction', 'reverse'); await app.change('closure-time', 245);
  await app.element('toggle-road').click();
  assert.deepEqual(selectedVariant(app).closures.map(item => [item.edgeIds, item.atS]), [[['bc'], 125], [['ab'], 500], [['cb'], 245]]);
  assert.deepEqual(app.latestExperiment().variants[1], other);
  const requests = app.posted.length;
  await app.change('closure-time', 720);
  assert.equal(app.posted.length, requests, 'new-event slider does not rewrite existing events');
  assert.equal(app.element('closure-time-label').textContent, '12:00');
  const input = eventInput(app, 0); input.value = '97.5'; await input.emit('change');
  assert.equal(selectedVariant(app).closures[0].atS, 97.5);
  assert.deepEqual(selectedVariant(app).closures[1], unrelated);
  assert.deepEqual(selectedVariant(app).closures[2], { id: 'road-edit-2', edgeIds: ['cb'], atS: 245 });
  assert.deepEqual(app.latestExperiment().variants[1], other);
  assert.deepEqual(app.latestExperiment().baseScenario, experiment.baseScenario);
  await eventRemove(app, 0).click();
  assert.deepEqual(selectedVariant(app).closures, [unrelated, { id: 'road-edit-2', edgeIds: ['cb'], atS: 245 }]);
  assert.deepEqual(app.latestExperiment().variants[1], other);
});

test('invalid individual event times are rejected without scheduling a run', async () => {
  const app = await loaded(), before = copy(app.latestExperiment()), requests = app.posted.length;
  for (const value of ['', '-1', 'NaN', 'Infinity', '604801']) {
    const input = eventInput(app, 0); input.value = value; await input.emit('change');
    assert.equal(input.value, '10');
    assert.deepEqual(app.state.experiment, before); assert.equal(app.posted.length, requests);
    assert.match(app.element('toast').textContent, /Enter a closure time/u);
  }
});

test('both-direction and one-way road edits honor the selected direction', async () => {
  const scenario = minimalScenario();
  scenario.edges.push({ id: 'cb', from: 'C', to: 'B', distanceM: 100, travelTimeS: 10, roadName: 'Second Street' });
  scenario.closures = [];
  const app = await loaded(experimentFromScenario(scenario));
  await app.change('road-select', 'ab'); await app.change('road-direction', 'reverse');
  const requests = app.posted.length;
  await app.element('toggle-road').click();
  assert.equal(app.posted.length, requests); assert.match(app.element('toast').textContent, /no reverse edge/u);
  await app.change('road-select', 'bc'); await app.change('road-direction', 'both');
  await app.element('toggle-road').click();
  assert.deepEqual(selectedVariant(app).closures[0].edgeIds, ['bc', 'cb']);
  await app.change('road-select', 'bc'); await app.element('toggle-road').click();
  assert.deepEqual(selectedVariant(app).closures, []);
});

test('all comparison cards and selected ledgers use the actual worker outcomes', async () => {
  const app = await loaded();
  const outcome = simulateExperiment(app.latestExperiment());
  app.latestWorker().respond(outcome);
  assert.deepEqual(app.state.allResults, outcome);
  assert.equal(app.element('variant-results').children.length, outcome.variants.length);
  for (const variant of outcome.variants) {
    const resultCard = card(app, variant.id), metrics = variant.result.metrics;
    assert.deepEqual(resultCard.children[1].children.map(item => item.textContent), [formatKm(metrics.distanceM), `${metrics.lateJobs} late`, `${metrics.unreachableJobs} unreachable`]);
    const skipped = metrics.unreachableJobs > outcome.baseline.metrics.unreachableJobs;
    assert.equal(resultCard.classList.contains('has-skips'), skipped);
    assert.equal(resultCard.children[2].textContent, skipped ? `${metrics.completedJobs}/${metrics.totalJobs} completed · skipped work reduces distance` : `${variant.delta.extraDistancePct > 0 ? '+' : ''}${variant.delta.extraDistancePct.toFixed(1)}% distance · ${metrics.completedJobs}/${metrics.totalJobs} completed`);
    await resultCard.click(); assertSelectedLedger(app, variant.result, outcome.baseline);
  }
  await card(app, 'blocked').click();
  assert.match(app.element('distance-delta').textContent, /some stops skipped/u);
  assert.equal(app.element('distance-delta').classList.contains('good'), false);
  assert.match(app.element('comparison-status').textContent, /Open-network baseline: 200 m, 0 late, 0 unreachable/u);
});

test('variant switching reuses cached results and preserves synchronized replay time', async () => {
  const app = await loaded(), worker = app.latestWorker();
  const outcome = worker.respond(); const requests = app.posted.length;
  await app.change('timeline', 17, 'input');
  const cached = app.state.allResults;
  await app.change('variant-select', 'blocked');
  assert.equal(app.posted.length, requests); assert.strictEqual(app.state.allResults, cached);
  assert.equal(app.state.time, 17); assert.equal(app.element('timeline').value, '17');
  assert.equal(app.element('clock-label').textContent, '00:17');
  assertSelectedLedger(app, outcome.variants.find(item => item.id === 'blocked').result, outcome.baseline);
  await card(app, 'control').click();
  assert.equal(app.state.selectedVariantId, 'control'); assert.equal(app.posted.length, requests);
  assert.equal(app.state.time, 17); assert.equal(app.element('timeline').value, '17');
  assert.deepEqual(app.state.disrupted, outcome.baseline);
  assert.equal(app.element('distance-delta').textContent, 'No change');
  assert.equal(app.element('late-delta').textContent, 'No change');
  assert.equal(app.element('unreachable-delta').textContent, 'No change');
  assert.equal(card(app, 'control').getAttribute('aria-pressed'), 'true');
  assert.equal(card(app, 'blocked').getAttribute('aria-pressed'), 'false');
});

test('latest worker request wins and superseded completion/error cannot change results', async () => {
  const app = await loaded(), older = app.latestWorker(), oldOutcome = simulateExperiment(app.latestExperiment());
  await app.change('variant-name', 'Newest plan'); await app.element('rename-variant').click();
  const newer = app.latestWorker(); assert.equal(older.terminated, true);
  older.respond(oldOutcome, newer.request.id); // Even a forged/current id cannot bypass the closed-over request guard.
  older.fail('older worker failed');
  assert.equal(app.state.pending, true); assert.equal(app.state.allResults, null);
  assert.equal(newer.terminated, false);
  newer.respond(oldOutcome, older.request.id); // Current worker carrying the wrong id is rejected too.
  assert.equal(app.state.allResults, null);
  const newestOutcome = newer.respond();
  const status = app.element('comparison-status').textContent, toast = app.element('toast').textContent;
  older.respond(oldOutcome); older.fail('late old error');
  assert.deepEqual(app.state.allResults, newestOutcome);
  assert.equal(app.element('comparison-status').textContent, status); assert.equal(app.element('toast').textContent, toast);
  assert.equal(app.element('variant-results').children[0].children[0].textContent, 'Newest plan');
});

test('cancel terminates the worker, clears results and rejects stale completion', async () => {
  const app = await loaded(), worker = app.latestWorker(), experiment = copy(app.state.experiment);
  await app.element('play-button').click(); assert.equal(app.state.playing, true);
  await app.element('cancel-run').click();
  assert.equal(worker.terminated, true); assert.equal(app.state.playing, false);
  assert.equal(app.state.pending, false); assert.equal(app.state.allResults, null);
  assert.equal(app.state.baseline, null); assert.equal(app.state.disrupted, null);
  assert.deepEqual(app.state.experiment, experiment);
  assert.equal(app.element('cancel-run').hidden, true); assert.equal(app.element('status-line').parentElement.getAttribute('aria-busy'), 'false');
  assert.match(app.element('comparison-status').textContent, /Run canceled/u);
  assert.equal(app.element('distance-value').textContent, '—'); assert.equal(app.element('job-list').children.length, 0);
  assert.ok(app.element('variant-results').children.every(item => item.textContent.includes('Run to compare')));
  worker.respond(); worker.fail('error after cancel');
  assert.equal(app.state.allResults, null); assert.match(app.element('comparison-status').textContent, /Run canceled/u);
});

test('cancel then rerun computes preserved variants and rejects the canceled response', async () => {
  const app = await loaded(), canceled = app.latestWorker(), experiment = copy(app.state.experiment);
  await app.change('timeline', 12, 'input'); await app.element('cancel-run').click();
  await app.element('run-experiment').click(); const rerun = app.latestWorker();
  assert.notStrictEqual(rerun, canceled); assert.ok(rerun.request.id > canceled.request.id);
  assert.deepEqual(rerun.request.experiment, experiment); assert.equal(app.state.pending, true);
  canceled.respond(); canceled.fail('Canceled worker error during rerun'); assert.equal(app.state.allResults, null); assert.equal(app.state.pending, true);
  const result = rerun.respond();
  assert.deepEqual(app.state.allResults, result); assert.equal(app.state.pending, false);
  assert.equal(app.state.time, 12); assert.equal(app.element('cancel-run').hidden, true);
  assertSelectedLedger(app, result.variants[0].result, result.baseline);
});

test('Reset rejects a pending import and results from the old experiment worker', async () => {
  const app = await loaded(), oldWorker = app.latestWorker(), pending = deferredFile();
  const importing = app.importFile(pending.file);
  await app.element('reset-button').click(); const resetWorker = app.latestWorker();
  pending.resolve(scenarioText('must-not-load')); await importing;
  oldWorker.respond(); oldWorker.fail('old worker after reset');
  assert.equal(app.latestScenario().id, 'meridian-seed-42');
  assert.equal(app.state.pending, true); assert.equal(app.state.allResults, null);
  assert.strictEqual(app.latestWorker(), resetWorker); assert.equal(resetWorker.terminated, false);
  assert.match(app.element('toast').textContent, /Original experiment restored/u);
});

test('variant edits and selection invalidate pending imports', async () => {
  for (const action of [async app => { await app.change('variant-name', 'Retained edit'); await app.element('rename-variant').click(); }, async app => app.change('variant-select', 'control')]) {
    const app = await loaded(), pending = deferredFile(); const importing = app.importFile(pending.file);
    await action(app); const experiment = copy(app.state.experiment), selection = app.state.selectedVariantId;
    pending.resolve(scenarioText('obsolete-import')); await importing;
    assert.deepEqual(app.state.experiment, experiment); assert.equal(app.state.selectedVariantId, selection);
  }
});

test('hostile experiment, variant and road labels are rendered only as text', async () => {
  const experiment = comparisonExperiment();
  experiment.name = '<img src=x onerror=alert(1)>';
  experiment.baseScenario.name = '<svg onload=alert(2)>';
  experiment.baseScenario.edges.find(edge => edge.id === 'bc').roadName = '<script>alert(3)</script>';
  experiment.variants[0].name = '<button onclick=alert(4)>Run</button>';
  const app = await loaded(experiment);
  app.latestWorker().respond();
  assert.equal(app.element('experiment-name').textContent, experiment.name);
  assert.equal(app.element('scene-name').textContent, experiment.baseScenario.name);
  assert.equal(card(app, 'detour').children[0].textContent, experiment.variants[0].name);
  assert.equal(app.element('variant-select').children[0].textContent, experiment.variants[0].name);
  assert.equal(app.element('event-list').children[0].children[0].textContent, '<script>alert(3)</script>');
  assert.equal(card(app, 'detour').children[0].children.length, 0);
  assert.equal(app.element('event-list').children[0].children[0].children.length, 0);
  assert.ok(!app.created.some(item => ['SCRIPT', 'IMG', 'SVG'].includes(item.tagName)));
});

test('completed worker ignores duplicate completion and subsequent terminal errors', async () => {
  const app = await loaded(), worker = app.latestWorker(), outcome = worker.respond();
  const currentResults = app.state.allResults, status = app.element('comparison-status').textContent, toast = app.element('toast').textContent;
  const duplicate = copy(outcome);
  duplicate.variants[0].result.metrics.distanceM += 100000;
  worker.respond(duplicate);
  assert.strictEqual(app.state.allResults, currentResults);
  assert.deepEqual(app.state.allResults, outcome);
  worker.fail('Error from completed worker');
  assert.strictEqual(app.state.allResults, currentResults);
  assert.equal(app.element('comparison-status').textContent, status);
  assert.equal(app.element('toast').textContent, toast);
  assertSelectedLedger(app, outcome.variants[0].result, outcome.baseline);
});

test('failed worker response exposes no partial result and rerun can recover', async () => {
  const app = await loaded(), worker = app.latestWorker();
  const partial = simulateExperiment(app.latestExperiment());
  worker.respond({ error: 'Deterministic routing budget exceeded', ...partial });
  assert.equal(worker.terminated, true); assert.equal(app.state.pending, false);
  assert.equal(app.state.allResults, null); assert.equal(app.state.disrupted, null); assert.equal(app.state.baseline, null);
  assert.equal(app.element('distance-value').textContent, '—'); assert.equal(app.element('distance-delta').textContent, 'Unavailable');
  assert.equal(app.element('job-list').children.length, 0);
  assert.match(app.element('comparison-status').textContent, /No partial results shown/u);
  assert.ok(app.element('variant-results').children.every(item => item.textContent.includes('Run to compare')));
  worker.respond(partial); assert.equal(app.state.allResults, null, 'failed worker is terminal even if it later reports success');
  await app.element('run-experiment').click(); const recovered = app.latestWorker().respond();
  assert.deepEqual(app.state.allResults, recovered);
  assertSelectedLedger(app, recovered.variants[0].result, recovered.baseline);
});

test('worker construction failure leaves a recoverable stopped run', async () => {
  let denied = true;
  const app = application({ workerConstructionError: () => denied ? 'Worker unavailable in this context' : null });
  assert.equal(app.workers.length, 0); assert.equal(app.state.pending, false);
  assert.equal(app.element('cancel-run').hidden, true); assert.equal(app.state.allResults, null);
  assert.match(app.element('comparison-status').textContent, /worker could not start/u);
  assert.match(app.element('toast').textContent, /Worker unavailable/u);
  denied = false;
  await app.importExperiment(comparisonExperiment());
  const recovered = app.latestWorker().respond();
  assert.deepEqual(app.state.allResults, recovered); assert.equal(app.state.pending, false);
});

test('safety timeout stops pending work and a later response cannot restore it', async () => {
  const app = await loaded(), worker = app.latestWorker(), request = copy(worker.request);
  const timeout = [...app.timers.values()].find(timer => timer.delay === 30000);
  assert.ok(timeout); timeout.callback();
  assert.equal(worker.terminated, true); assert.equal(app.state.pending, false);
  assert.equal(app.state.allResults, null); assert.equal(app.element('cancel-run').hidden, true);
  assert.match(app.element('comparison-status').textContent, /30-second safety limit/u);
  worker.respond(); assert.equal(app.state.allResults, null);
  await app.element('run-experiment').click();
  assert.deepEqual(app.latestWorker().request.experiment, request.experiment);
  app.latestWorker().respond(); assert.notEqual(app.state.allResults, null);
});
