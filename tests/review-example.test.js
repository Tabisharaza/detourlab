import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createExperimentReport, serializeExperimentReport } from '../scripts/experiment-report.js';
import { createReportIdentity } from '../scripts/report-identity.js';

test('published tiny review is reproduced byte-for-byte by the current implementation', async () => {
  const input = JSON.parse(await readFile(new URL('../examples/minimal-experiment.json', import.meta.url), 'utf8'));
  const generator = await createReportIdentity();
  const report = createExperimentReport(input, { maxArrivalSlipS: 6, unreachableJobs: 0 }, generator);
  const actual = serializeExperimentReport(report);
  assert.equal(report.verdict, 'passed');
  assert.equal(report.variants.find(variant => variant.id === 'close-at-10').jobComparison.maxArrivalSlipS, 6);
  assert.equal(actual.bundleJson, await readFile(new URL('../docs/examples/tiny-review/bundle.json', import.meta.url), 'utf8'));
  assert.equal(actual.reviewMarkdown, await readFile(new URL('../docs/examples/tiny-review/REVIEW.md', import.meta.url), 'utf8'));
});
