import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { application } from './helpers/application.js';
import { createBrowserImpact } from '../src/browser-impact.js';
import { simulateExperiment } from '../src/experiment.js';
import { renderJobImpactCsv } from '../src/job-impact-csv.js';
import { parseCsv } from '../tools/impact-csv-check/run.js';

const fixture = (name = 'minimal-experiment.json') => JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
const actions = app => app.element('impact-rows').querySelectorAll('button');
const rowIds = app => app.element('impact-rows').children.map(row => row.children[0].children[0].textContent);
const optionIds = app => app.element('impact-reference').children.map(option => option.value);
async function ready(input = fixture(), candidate = 'close-at-11', options) {
  const app = application(options);
  await app.importExperiment(input); app.latestWorker().respond();
  await app.change('variant-select', candidate); await app.element('impact-button').click();
  return app;
}

test('a fresh inspector defaults to clear roads; a named reference uses the existing result without changing workspace or creating work', async () => {
  const app = await ready();
  const snapshot = () => [app.state.experiment, app.state.allResults, app.state.selectedVariantId, app.state.time, app.posted.length, app.element('history-status').textContent];
  const before = snapshot();
  assert.deepEqual(optionIds(app), ['', 'clear', 'close-at-10']);
  assert.equal(app.element('impact-reference').value, '');
  await app.change('impact-reference', 'close-at-10');
  assert.deepEqual(snapshot(), before);
  assert.match(app.element('impact-metrics').textContent, /distance 260 → 200 \(-60 m\); late 1 → 0 \(-1\); unreachable 0 → 0 \(0\); completed 1 → 1 \(0\)/);
  assert.match(app.element('impact-summary').textContent, /1 earlier, 0 unchanged, 0 later, 0 not comparable/);
  assert.match(app.element('impact-table-caption').textContent, /Reference:.*10.*Candidate:.*11/);
  assert.match(app.element('impact-rows').textContent, /Late → On time.*26 s → 20 s.*Change -6 s/);
  assert.deepEqual(actions(app).map(button => button.textContent), ['Replay reference arrival', 'Replay candidate arrival']);
  assert.equal(app.element('impact-replay-note').hidden, false);
  await app.element('impact-close').click(); await app.element('impact-button').click();
  assert.equal(app.element('impact-reference').value, '');
  assert.equal(app.element('impact-replay-note').hidden, true);
  assert.equal(app.element('impact-rows').children.length, 0);
});

test('changing reference starts at page one while preserving search and sort; swapping candidates reverses the named pair and never self-compares', async () => {
  const app = await ready(fixture('meridian-experiment.json'), 'market-10');
  await app.change('impact-filter', 'all'); await app.change('impact-search', 'job-0', 'input');
  await app.change('impact-sort', 'arrival-desc'); await app.element('impact-next').click();
  assert.match(app.element('impact-status').textContent, /page 2 of/);
  const number = app.posted.length;
  await app.change('impact-reference', 'market-05');
  assert.match(app.element('impact-status').textContent, /page 1 of.*candidate minus reference/);
  assert.equal(app.element('impact-search').value, 'job-0'); assert.equal(app.element('impact-sort').value, 'arrival-desc');
  assert.match(app.element('impact-summary').textContent, /46 earlier, 81 unchanged, 65 later, 0 not comparable/);
  await app.change('impact-variant', 'market-05');
  assert.equal(app.element('impact-reference').value, 'market-10');
  assert.equal(optionIds(app).includes('market-05'), false);
  assert.match(app.element('impact-summary').textContent, /65 earlier, 81 unchanged, 46 later, 0 not comparable/);
  assert.equal(app.posted.length, number);
  await app.change('impact-variant', 'all-bridges-05');
  assert.equal(app.element('impact-reference').value, 'market-10');
  assert.match(app.element('impact-metrics').textContent, /candidate completes fewer deliveries/);
  assert.match(app.element('impact-summary').textContent, /57 not comparable/);
  await app.change('impact-reference', '');
  assert.equal(optionIds(app).includes('all-bridges-05'), false);
  assert.match(app.element('impact-metrics').textContent, /Baseline →/);
});

test('named-pair replay and return preserve the pair, row, filter, query, and later replay perspective; stale rows cannot navigate', async () => {
  let encoded;
  const app = await ready(fixture('meridian-experiment.json'), 'market-10', {
    impactCsvBuilder(report, options) { encoded = parseCsv(renderJobImpactCsv(report, options)); return 'download'; },
  });
  const baselineAction = actions(app).find(button => button.dataset.impactReplay === 'baseline');
  assert.ok(baselineAction);
  await app.change('impact-reference', 'market-05');
  await baselineAction.emit('click'); assert.equal(app.element('impact-dialog').open, true);
  await app.change('impact-filter', 'all'); await app.change('impact-search', 'job-0', 'input');
  await app.change('impact-sort', 'arrival-desc'); await app.element('impact-next').click();
  const origin = actions(app)[0], ids = rowIds(app), workers = app.posted.length;
  const experiment = app.state.experiment, completed = app.state.allResults;
  const [candidateMap, referenceMap] = app.maps;
  assert.equal(referenceMap, undefined, 'lazy renderer is not created just by inspecting');
  await origin.click(); assert.equal(app.element('impact-dialog').open, false);
  assert.equal(app.state.time, Number(origin.dataset.time)); assert.equal(app.state.selectedVariantId, 'market-10');
  assert.equal(app.state.experiment, experiment); assert.equal(app.state.allResults, completed);
  assert.equal(app.maps[1].state.disrupted, completed.variants.find(v => v.id === 'market-05').result);
  assert.equal(candidateMap.state.disrupted, completed.variants.find(v => v.id === 'market-10').result);
  assert.equal(app.maps[1].state.scenario.closures[0].atS, 300);
  assert.equal(candidateMap.state.scenario.closures[0].atS, 600);
  assert.match(app.element('replay-events-announcement').textContent, /Reference ·/);
  await app.change('timeline', '497.25', 'input'); await app.element('impact-return').click();
  assert.equal(app.state.time, 497.25); assert.equal(app.posted.length, workers);
  assert.equal(app.element('impact-reference').value, 'market-05'); assert.deepEqual(rowIds(app), ids);
  assert.equal(app.document.activeElement.dataset.jobId, origin.dataset.jobId);
  assert.equal(app.document.activeElement.dataset.impactReplay, 'baseline');
  const candidate = actions(app).find(button => button.dataset.jobId === origin.dataset.jobId && button.dataset.impactReplay === 'variant');
  await candidate.click();
  assert.match(app.element('replay-events-announcement').textContent, /Candidate ·/);
  assert.equal(app.state.time, Number(candidate.dataset.time));
  await app.element('impact-return').click();
  await app.element('impact-download-csv').click();
  assert.deepEqual(encoded[0].slice(1, 5), ['referenceId', 'referenceName', 'candidateId', 'candidateName']);
  assert.deepEqual(encoded.slice(1).map(row => row[5]), app.state.experiment.baseScenario.jobs.map(job => job.id));
  assert.ok(encoded.slice(1).every(row => row[1] === 'market-05' && row[3] === 'market-10'));
});

test('named reference distinguishes duplicate labels, handles unreachable candidate without a replay action, and invalidates on rerun', async () => {
  const input = fixture();
  input.variants[1].closures[0].edgeIds = ['bc', 'bd'];
  input.variants[0].name = input.variants[1].name = 'Clear-road baseline';
  const app = await ready(input, 'close-at-10');
  await app.change('impact-reference', 'clear');
  assert.match(app.element('impact-table-caption').textContent, /Reference: Clear-road baseline \(clear\) → Candidate: Clear-road baseline \(close-at-10\)/);
  assert.match(app.element('impact-rows').textContent, /On time → Unreachable.*Not reached.*Not comparable/);
  assert.deepEqual(actions(app).map(button => button.textContent), ['Replay reference arrival']);
  await actions(app)[0].click();
  assert.equal(app.state.time, 20); assert.match(app.element('replay-events-summary').textContent, /0 reference, 1 candidate/);
  await app.element('run-experiment').click();
  assert.equal(app.element('named-replay-controls').hidden, true);
  assert.equal(app.element('impact-return').hidden, true);
  assert.equal(app.element('impact-reference').disabled, true);
  assert.equal(app.element('impact-download-csv').disabled, true);
});

test('named CSV matches the exact pair result and distinguishes unreachable blanks from true zeros', () => {
  const input = fixture();
  input.variants[0].name = '＝pair, "reference"';
  input.variants[1].closures[0].edgeIds = ['bc', 'bd'];
  const report = createBrowserImpact(input, simulateExperiment(input), 'close-at-10', 'clear');
  const [header, row] = parseCsv(renderJobImpactCsv(report, { experimentId: input.id }));
  const record = Object.fromEntries(header.map((key, index) => [key, row[index]]));
  assert.equal(record.referenceName, `'${input.variants[0].name}`);
  assert.equal(record.referenceLatenessS, '0');
  for (const key of ['candidateArrivalS', 'candidateCompletedS', 'candidateLatenessS', 'arrivalDeltaS', 'completedDeltaS', 'latenessDeltaS']) assert.equal(record[key], '');
  assert.equal(record.candidateStatus, 'unreachable');
});

test('two named schedules use one exact clock; exit clears the projection without losing time, vehicle or the return point', async () => {
  const app = await ready();
  await app.change('impact-reference', 'close-at-10');
  const posts = app.posted.length, baseline = app.state.baseline;
  await actions(app)[0].click();
  const left = app.maps[1].state, right = app.map.state;
  assert.equal(left.time, right.time); assert.equal(right.time, 26);
  assert.equal(left.selectedVehicle, right.selectedVehicle);
  assert.equal(left.view, 'disruption'); assert.equal(left.editing, false);
  assert.deepEqual(left.scenario.closures.map(closure => closure.atS), [10]);
  assert.deepEqual(right.scenario.closures.map(closure => closure.atS), [11]);
  assert.equal(right.baseline, baseline, 'fleet baseline is not rebound');
  assert.match(app.element('baseline-pane-label').textContent, /Reference: .*10/);
  assert.match(app.element('variant-pane-label').textContent, /Candidate: .*11/);
  assert.equal(app.element('route-baseline-distance').textContent, '260 m');
  assert.equal(app.element('route-scenario-distance').textContent, '200 m');
  assert.equal(app.element('save-replay').disabled, true);
  await app.change('replay-events-filter', 'closures');
  const [reference, candidate] = app.element('replay-events-list').querySelectorAll('button');
  assert.equal(reference.dataset.run, 'reference-schedule');
  assert.equal(candidate.dataset.run, 'candidate-schedule');
  await reference.click(); assert.equal(right.time, 10);
  await app.element('view-split').click(); assert.equal(app.element('named-replay-controls').hidden, false);
  await app.element('exit-named-replay').click();
  assert.equal(app.document.activeElement, app.element('view-split'));
  assert.equal(right.time, 10); assert.equal(left.view, 'baseline');
  assert.equal(app.element('impact-return').hidden, false);
  assert.equal(app.element('save-replay').disabled, false);
  await candidate.emit('click'); assert.equal(right.time, 10, 'discarded named event is inert');
  await app.element('impact-return').click();
  assert.equal(app.element('impact-reference').value, 'close-at-10');
  assert.equal(app.document.activeElement.dataset.impactReplay, 'baseline');
  await actions(app)[1].click();
  assert.equal(right.time, 20); assert.equal(left.view, 'disruption');
  await app.change('variant-select', 'clear');
  assert.equal(app.element('named-replay-controls').hidden, true);
  assert.equal(app.element('impact-return').hidden, true);
  assert.equal(app.posted.length, posts);
});

test('zero and fractional named arrivals use ledger times rather than the rounded timeline control', async () => {
  const input = fixture();
  input.baseScenario.vehicles[0].startNode = input.baseScenario.jobs[0].nodeId;
  input.baseScenario.vehicles[0].startTimeS = 0;
  const app = await ready(input);
  await app.change('impact-reference', 'close-at-10');
  await app.change('impact-filter', 'all');
  assert.equal(actions(app)[0].dataset.time, '0');
  await actions(app)[0].click(); assert.equal(app.state.time, 0);
  input.baseScenario.vehicles[0].startTimeS = 0.375;
  await app.importExperiment(input); app.latestWorker().respond();
  assert.equal(app.element('named-replay-controls').hidden, true);
  await app.change('variant-select', 'close-at-11'); await app.element('impact-button').click();
  await app.change('impact-reference', 'close-at-10'); await app.change('impact-filter', 'all');
  await actions(app)[1].click(); assert.equal(app.state.time, 0.375); assert.equal(app.maps[1].state.time, 0.375);
});
