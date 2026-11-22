import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { application } from './helpers/application.js';
import { createBrowserComparisonEvidence, createBrowserImpact } from '../src/browser-impact.js';
import { simulateExperiment } from '../src/experiment.js';
import { createComparisonEvidence, renderComparisonEvidence, verifyComparisonEvidence } from '../scripts/comparison-evidence.js';

const fixture = file => JSON.parse(readFileSync(new URL(`../examples/${file}-experiment.json`, import.meta.url)));
const links = app => app.created.filter(node => node.download === 'detourlab-comparison-evidence.json');
async function ready(input, candidate, options) {
  const app = application(options);
  await app.importExperiment(input);
  app.latestWorker().respond();
  await app.change('variant-select', candidate);
  await app.element('impact-button').click();
  return app;
}

test('browser packet is byte-identical to independent CLI evidence and rejects modified results', async () => {
  for (const [file, reference, candidate] of [
    ['minimal', 'close-at-10', 'close-at-11'],
    ['meridian', 'market-05', 'market-10'],
    ['meridian', 'market-05', 'all-bridges-05'],
    ['meridian', 'all-bridges-05', 'market-05'],
  ]) {
    const input = fixture(file);
    const impact = createBrowserImpact(input, simulateExperiment(input), candidate, reference);
    const bytes = await createBrowserComparisonEvidence(input, impact);
    const expected = createComparisonEvidence(input, reference, candidate);
    assert.equal(bytes, renderComparisonEvidence(expected));
    assert.deepEqual(verifyComparisonEvidence(Buffer.from(bytes)), expected.report);
    const changed = JSON.parse(bytes); changed.report.jobs[0].candidate.arrivalS = 1337;
    assert.throws(() => verifyComparisonEvidence(Buffer.from(JSON.stringify(changed))), /differs/);
  }
});

test('JSON disclosure precedes download; baseline cannot export evidence and filters do not remove rows or unused plans', async () => {
  const input = fixture('meridian');
  const app = await ready(input, 'market-10');
  const button = app.element('impact-download-evidence');
  assert.equal(button.disabled, true);
  assert.match(button.getAttribute('aria-describedby'), /impact-evidence-help/);
  const help = readFileSync(new URL('../index.html', import.meta.url), 'utf8').match(/id="impact-evidence-help">([^<]+)/u)[1];
  assert.match(help, /Unlike CSV.*full experiment.*every saved plan.*Download is local/);
  await button.emit('click');
  assert.equal(links(app).length, 0);
  await app.change('impact-reference', 'market-05');
  await app.change('impact-filter', 'all');
  await app.change('impact-search', 'no-such-delivery', 'input');
  const workers = app.posted.length;
  await button.click();
  const [link] = links(app);
  assert.equal(links(app).length, 1);
  const blob = resolveObjectURL(link.href);
  assert.equal(blob.type, 'application/json;charset=utf-8');
  const text = await blob.text();
  URL.revokeObjectURL(link.href);
  assert.equal(text, renderComparisonEvidence(createComparisonEvidence(input, 'market-05', 'market-10')));
  assert.equal(app.posted.length, workers);
  assert.match(app.element('impact-evidence-status').textContent, /Contains the entire experiment and all 192 delivery rows/);
});

test('repeated activation does not duplicate requests; closing, pair reselection and rerunning cancel stale downloads', async () => {
  const requests = [];
  const app = await ready(fixture('minimal'), 'close-at-11', {
    impactEvidenceBuilder() { return new Promise((resolve, reject) => requests.push({ resolve, reject })); },
  });
  const button = app.element('impact-download-evidence');
  await app.change('impact-reference', 'close-at-10');
  button.focus();
  const old = button.click();
  assert.equal(app.document.activeElement, button);
  assert.equal(button.getAttribute('aria-busy'), 'true');
  await button.click();
  assert.equal(requests.length, 1);
  await app.change('impact-reference', 'clear');
  await app.change('impact-reference', 'close-at-10');
  const current = button.click();
  requests[0].resolve('{}');
  await old;
  assert.equal(links(app).length, 0);
  assert.equal(button.getAttribute('aria-busy'), 'true');
  await app.element('impact-dialog').escape();
  requests[1].resolve('{}');
  await current;
  assert.equal(links(app).length, 0);
  assert.equal(button.getAttribute('aria-busy'), 'false');
  await app.element('impact-button').click();
  await app.change('impact-reference', 'close-at-10');
  const pending = button.click();
  await app.element('run-experiment').click();
  requests[2].reject(new Error('old digest failure'));
  await pending;
  assert.equal(links(app).length, 0);
  assert.equal(button.disabled, true);
  assert.doesNotMatch(app.element('impact-evidence-status').textContent, /old digest failure/);
});

test('failed preparation makes no download, restores readiness and permits retry', async () => {
  let attempts = 0;
  const app = await ready(fixture('minimal'), 'close-at-11', {
    async impactEvidenceBuilder(...args) {
      if (++attempts === 1) throw new Error('Web Crypto unavailable');
      return createBrowserComparisonEvidence(...args);
    },
  });
  await app.change('impact-reference', 'close-at-10');
  const button = app.element('impact-download-evidence');
  await button.click();
  assert.equal(links(app).length, 0);
  assert.match(app.element('impact-evidence-status').textContent, /Web Crypto unavailable.*No download/);
  assert.equal(button.getAttribute('aria-busy'), 'false');
  await button.click();
  const [link] = links(app);
  assert.ok(link);
  URL.revokeObjectURL(link.href);
});
