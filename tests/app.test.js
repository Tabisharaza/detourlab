import test from 'node:test';
import assert from 'node:assert/strict';
import { application, deferredFile, scenarioText as scenario } from './helpers/application.js';

// Actual checked-in handlers; mocked DOM/Worker tests are not browser/visual QA.
test('newer import wins when an older file read completes afterward', async () => {
  const app = application(), older = deferredFile(), newer = deferredFile();
  const oldImport = app.importFile(older.file), newImport = app.importFile(newer.file);
  newer.resolve(scenario('newer-selection')); await newImport;
  older.resolve(scenario('older-selection')); await oldImport;
  assert.equal(app.latestScenario().id, 'newer-selection');
  assert.equal(app.element('scene-name').textContent, 'newer-selection');
  assert.match(app.element('toast').textContent, /newer-selection/);
});

test('Reset invalidates an outstanding asynchronous import', async () => {
  const app = application(), pending = deferredFile();
  const original = structuredClone(app.latestExperiment());
  const importing = app.importFile(pending.file);
  app.element('reset-button').click();
  pending.resolve(scenario('before-reset')); await importing;
  assert.equal(app.latestScenario().id, 'meridian-seed-42');
  assert.deepEqual(app.latestExperiment(), original);
  assert.equal(app.latestExperiment().variants[0].name, 'Market Bridge closure');
  assert.match(app.element('toast').textContent, /Original experiment restored/);
});

test('a stale failed import cannot overwrite the latest successful import message', async () => {
  const app = application(), older = deferredFile(), newer = deferredFile();
  const oldImport = app.importFile(older.file), newImport = app.importFile(newer.file);
  newer.resolve(scenario('latest-success')); await newImport;
  older.reject(new Error('older file read failed')); await oldImport;
  assert.equal(app.latestScenario().id, 'latest-success');
  assert.match(app.element('toast').textContent, /Loaded “latest-success”/);
});
