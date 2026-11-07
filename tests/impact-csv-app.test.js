import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { application, deferredFile } from './helpers/application.js';
import { createBrowserImpact } from '../src/browser-impact.js';
import { renderJobImpactCsv } from '../src/job-impact-csv.js';
const fixture = (name = 'minimal-experiment.json') => JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
async function ready(input = fixture(), options = {}) { const app = application(options); await app.importExperiment(input); app.latestWorker().respond(); return app; }
const links = app => app.created.filter(el => el.tagName === 'A');
const expected = app => renderJobImpactCsv(createBrowserImpact(app.state.experiment, app.state.allResults, app.state.selectedVariantId), { experimentId: app.state.experiment.id });
async function downloaded(app) { const response = await fetch(links(app).at(-1).href); return { text: await response.text(), type: response.headers.get('content-type') }; }

test('CSV is disabled before completed comparison, including forced events', async () => {
  const app = application(); assert.equal(app.element('impact-download-csv').disabled, true);
  await app.element('impact-download-csv').emit('click'); assert.equal(links(app).length, 0);
  app.latestWorker().respond(); await app.element('impact-download-csv').emit('click'); assert.equal(links(app).length, 0);
});
test('CSV exports every Meridian delivery regardless of filter/page with exact shared bytes and no rerun', async () => {
  const app = await ready(fixture('meridian-experiment.json')); await app.change('variant-select', 'market-05');
  await app.element('impact-button').click(); const count = app.workers.length;
  assert.equal(links(app).length, 0); assert.equal(app.element('impact-rows').children.length, 20);
  await app.element('impact-next').click(); await app.element('impact-download-csv').click();
  const first = await downloaded(app); assert.equal(first.text, expected(app)); assert.equal(first.type, 'text/csv;charset=utf-8');
  assert.equal(links(app)[0].download, 'detourlab-delivery-impact.csv');
  assert.match(app.element('impact-export-status').textContent, /all 192 deliveries/);
  await app.change('impact-filter', 'timing'); assert.equal(app.element('impact-rows').children.length, 7);
  await app.element('impact-download-csv').click(); assert.equal((await downloaded(app)).text, first.text);
  await app.change('impact-search', 'no matches here', 'input');
  await app.change('impact-sort', 'arrival-desc'); assert.equal(app.element('impact-rows').children.length, 0);
  await app.element('impact-download-csv').click(); assert.equal((await downloaded(app)).text, first.text);
  await app.change('impact-variant', 'all-bridges-05');
  await app.element('impact-download-csv').click(); assert.equal((await downloaded(app)).text, expected(app));
  assert.notEqual((await downloaded(app)).text, first.text); assert.equal(app.workers.length, count);
});
test('zero-delivery CSV remains an explicit header-only export', async () => {
  const input = fixture(); input.baseScenario.jobs = []; const app = await ready(input);
  await app.element('impact-button').click(); assert.equal(app.element('impact-download-csv').disabled, false);
  await app.element('impact-download-csv').click(); const data = await downloaded(app);
  assert.equal(data.text, expected(app)); assert.equal(data.text.split('\r\n').length, 2);
  assert.match(app.element('impact-export-status').textContent, /all 0 deliveries/);
});
for (const boundary of ['rerun', 'close', 'escape', 'edit', 'reset', 'undo']) test(`CSV cannot leak stale results after ${boundary}`, async () => {
  const app = await ready();
  if (boundary === 'undo') { await app.change('variant-name', 'Edited', 'input'); await app.element('rename-variant').click(); app.latestWorker().respond(); }
  await app.element('impact-button').click(); app.element('impact-download-csv').focus();
  if (boundary === 'rerun') await app.element('run-experiment').click();
  if (boundary === 'close') await app.element('impact-close').click();
  if (boundary === 'escape') await app.element('impact-dialog').escape();
  if (boundary === 'edit') await app.element('duplicate-variant').click();
  if (boundary === 'reset') await app.element('reset-button').click();
  if (boundary === 'undo') await app.element('undo-edit').click();
  assert.equal(app.element('impact-download-csv').disabled, true);
  await app.element('impact-download-csv').emit('click'); assert.equal(links(app).length, 0);
  assert.notEqual(app.document.activeElement, app.element('impact-download-csv'));
});
test('completed newer import invalidates download and restores focus before disabling', async () => {
  const app = await ready(); const incoming = deferredFile(); const reading = app.importFile(incoming.file);
  await app.element('impact-button').click(); app.element('impact-download-csv').focus();
  const input = fixture(); input.id = 'newer'; incoming.resolve(new TextEncoder().encode(JSON.stringify(input)).buffer); await reading;
  assert.equal(app.element('impact-download-csv').disabled, true); assert.equal(app.document.activeElement, app.element('impact-close'));
  await app.element('impact-download-csv').emit('click'); assert.equal(links(app).length, 0);
});
test('serializer failure is bounded, creates no link, and does not discard completed results', async () => {
  const app = await ready(fixture(), { impactCsvBuilder() { throw new Error('CSV exceeds 4 MiB.'); } });
  await app.element('impact-button').click(); const result = app.state.allResults;
  await app.element('impact-download-csv').click(); assert.equal(links(app).length, 0);
  assert.match(app.element('impact-export-status').textContent, /CSV could not be prepared.*4 MiB/);
  assert.strictEqual(app.state.allResults, result); assert.equal(app.element('impact-dialog').open, true);
});
test('close and reopen clears old download status and queued old close leaves fresh CSV valid', async () => {
  const app = await ready(fixture(), { deferDialogClose: true });
  await app.element('impact-button').click(); await app.element('impact-download-csv').click();
  await app.element('impact-close').click(); await app.element('impact-button').click(); await app.flushDialogCloseEvents();
  assert.equal(app.element('impact-download-csv').disabled, false);
  assert.match(app.element('impact-export-status').textContent, /CSV includes all/);
  await app.element('impact-download-csv').click(); assert.equal((await downloaded(app)).text, expected(app));
});
