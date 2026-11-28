import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { application } from './helpers/application.js';
import { compareVariants } from '../scripts/variant-comparison.js';
import { verifyComparisonEvidence } from '../scripts/comparison-evidence.js';
import { parseCsv } from '../tools/impact-csv-check/run.js';

const fixture = () => JSON.parse(readFileSync(new URL('../examples/meridian-experiment.json', import.meta.url), 'utf8'));
const matchingFile = 'detourlab-matching-deliveries.csv';
const matchingLinks = app => app.created.filter(node => node.download === matchingFile);

async function open(reference, candidate, input = fixture()) {
  const app = application();
  await app.importExperiment(input);
  app.latestWorker().respond();
  await app.change('variant-select', candidate);
  await app.element('impact-button').click();
  await app.change('impact-reference', reference);
  return { app, input };
}

async function readDownload(app, filename) {
  const link = app.created.findLast(node => node.download === filename);
  assert.ok(link, filename);
  try { return await resolveObjectURL(link.href).text(); }
  finally { URL.revokeObjectURL(link.href); }
}

test('matching CSV takes all filtered rows in the selected order even from page two without exposing the search string', async () => {
  const { app, input } = await open('market-05', 'market-10');
  const report = compareVariants(input, 'market-05', 'market-10');
  await app.change('impact-filter', 'later');
  await app.change('impact-sort', 'candidate-lateness-desc');
  await app.change('impact-search', '  JOB-  ', 'input');
  await app.element('impact-next').click();
  assert.match(app.element('impact-status').textContent, /page 2 of 4/);
  const workers = app.posted.length;
  const exportButton = app.element('impact-download-cohort');
  exportButton.focus();
  await exportButton.click();
  assert.equal(app.document.activeElement, exportButton);
  assert.equal(app.posted.length, workers);
  const content = await readDownload(app, matchingFile);
  assert.doesNotMatch(content, /JOB-/);
  const [header, ...rows] = parseCsv(content);
  const expected = report.jobs.filter(job => job.arrivalDeltaS > 0)
    .sort((a, b) => b.candidate.latenessS - a.candidate.latenessS);
  assert.equal(expected.length, 65);
  assert.deepEqual(rows.map(row => row[header.indexOf('jobId')]), expected.map(row => row.id));
  assert.deepEqual(header.slice(-6), ['exportScope', 'outcomeFilter', 'rowOrder', 'searchApplied', 'matchingRows', 'totalComparisonRows']);
  assert.ok(rows.every(row => JSON.stringify(row.slice(-6)) === JSON.stringify(['matching-deliveries', 'later', 'candidate-lateness-desc', 'true', '65', '192'])));
  assert.match(app.element('impact-cohort-status').textContent, /65 of 192/);
});

test('deadline cohort is a separate file; full CSV and independently verified JSON remain complete', async () => {
  const { app, input } = await open('market-10', 'market-05');
  const report = compareVariants(input, 'market-10', 'market-05');
  await app.change('impact-filter', 'newly-late');
  await app.change('impact-sort', 'candidate-lateness-desc');
  await app.element('impact-download-cohort').click();
  await app.element('impact-download-csv').click();
  await app.element('impact-download-evidence').click();
  const [header, ...rows] = parseCsv(await readDownload(app, matchingFile));
  const matches = report.jobs.filter(job => job.reference.status === 'on-time' && job.candidate.status === 'late')
    .sort((a, b) => b.candidate.latenessS - a.candidate.latenessS);
  assert.equal(matches.length, 12);
  assert.deepEqual(rows.map(row => row[header.indexOf('jobId')]), matches.map(job => job.id));
  assert.ok(rows.every(row => row[header.indexOf('outcomeFilter')] === 'newly-late' && row[header.indexOf('searchApplied')] === 'false'));
  const [fullHeader, ...fullRows] = parseCsv(await readDownload(app, 'detourlab-variant-comparison.csv'));
  assert.equal(fullHeader.includes('exportScope'), false);
  assert.deepEqual(fullRows.map(row => row[fullHeader.indexOf('jobId')]), report.jobs.map(job => job.id));
  const evidence = await readDownload(app, 'detourlab-comparison-evidence.json');
  assert.deepEqual(verifyComparisonEvidence(Buffer.from(evidence)), report);
});

test('empty searches, closed dialog and invalidated completed runs do not download a cohort', async () => {
  const { app } = await open('market-05', 'market-10');
  const button = app.element('impact-download-cohort');
  button.focus();
  await app.change('impact-search', 'no-matching-id', 'input');
  assert.equal(button.disabled, true);
  assert.equal(app.document.activeElement, app.element('impact-search'));
  await button.emit('click');
  assert.equal(matchingLinks(app).length, 0);
  await app.change('impact-search', '', 'input');
  assert.equal(button.disabled, false);
  await app.element('impact-close').click();
  await button.emit('click');
  await app.element('impact-button').click();
  await app.element('run-experiment').click();
  await button.emit('click');
  assert.equal(matchingLinks(app).length, 0);
  assert.equal(button.disabled, true);
});

test('matching download uses the complete CSV sanitizer, exact fractional numbers and null blanks', async () => {
  const input = JSON.parse(readFileSync(new URL('../examples/minimal-experiment.json', import.meta.url), 'utf8'));
  input.baseScenario.edges[0].travelTimeS = 10.125;
  input.variants[0].name = '=reference';
  input.variants[1].name = '@candidate';
  input.variants[1].closures[0].edgeIds = ['bc', 'bd'];
  const { app } = await open('clear', 'close-at-10', input);
  await app.change('impact-filter', 'newly-unreachable');
  await app.element('impact-download-cohort').click();
  const [header, ...rows] = parseCsv(await readDownload(app, matchingFile));
  assert.equal(rows.length, 1);
  const cell = key => rows[0][header.indexOf(key)];
  assert.equal(cell('referenceName'), "'=reference");
  assert.equal(cell('candidateName'), "'@candidate");
  assert.equal(cell('referenceArrivalS'), '20.125');
  assert.equal(cell('referenceLatenessS'), '0');
  assert.equal(cell('candidateArrivalS'), '');
  assert.equal(cell('candidateLatenessS'), '');
  assert.equal(cell('arrivalDeltaS'), '');
});
