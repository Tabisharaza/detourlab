import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createComparisonEvidence, renderComparisonEvidence, verifyComparisonEvidence, EVIDENCE_LIMIT } from '../scripts/comparison-evidence.js';

const root = new URL('../', import.meta.url);
const load = name => JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url)));
const tiny = () => createComparisonEvidence(load('minimal-experiment'), 'close-at-10', 'close-at-11');
const encoded = value => Buffer.from(JSON.stringify(value));

test('bundle stores both inputs and entire exact report in one deterministic file', () => {
  const evidence = tiny();
  const fixture = readFileSync(new URL('../docs/examples/variant-comparison/tiny-evidence.json', import.meta.url), 'utf8');
  assert.equal(renderComparisonEvidence(evidence), fixture);
  assert.deepEqual(verifyComparisonEvidence(Buffer.from(fixture)), evidence.report);
  assert.equal(evidence.experiment.variants.length, 3);
  assert.equal(evidence.report.jobs[0].arrivalDeltaS, -6);
});

test('Meridian evidence retains every row, missing arrivals, and skipped-work tradeoff', () => {
  const input = load('meridian-experiment');
  const market = createComparisonEvidence(input, 'market-05', 'market-10');
  const marketReport = verifyComparisonEvidence(Buffer.from(renderComparisonEvidence(market)));
  assert.deepEqual(marketReport.summary.arrivals, { earlier: 46, unchanged: 81, later: 65, notComparable: 0 });
  assert.equal(marketReport.delta.lateJobs, -12);
  const skipped = createComparisonEvidence(input, 'market-05', 'all-bridges-05');
  const report = verifyComparisonEvidence(encoded(skipped));
  assert.equal(report.jobs.length, 192);
  assert.equal(report.jobs.filter(job => job.arrivalDeltaS === null).length, 57);
  assert.equal(report.delta.completedJobs, -57);
});

test('independently changing input, unused plan, identities, rows or metadata fails verification', () => {
  for (const change of [
    x => { x.experiment.variants[0].name = 'Edited unused plan'; },
    x => { x.report.experimentSha256 = '0'.repeat(64); },
    x => { x.report.jobs = []; },
    x => { x.report.jobs[0].candidate.arrivalS += 1; },
    x => { x.report.summary.arrivals.earlier = 0; },
    x => { x.report.engineVersion = 'tampered'; },
    x => { x.report.candidate.id = 'clear'; },
    x => { x.annotation = 'unknown'; },
  ]) {
    const evidence = tiny();
    change(evidence);
    assert.throws(() => verifyComparisonEvidence(encoded(evidence)), /differs/);
  }
});

test('weak or malformed envelopes and out-of-range bytes fail closed', () => {
  const evidence = tiny();
  assert.throws(() => verifyComparisonEvidence(Buffer.alloc(EVIDENCE_LIMIT + 1)), /8 MiB/);
  assert.throws(() => renderComparisonEvidence({ oversized: 'é'.repeat(EVIDENCE_LIMIT / 2) }), /8 MiB/);
  assert.throws(() => verifyComparisonEvidence(Buffer.from([0xc3, 0x28])), /UTF-8/);
  assert.throws(() => verifyComparisonEvidence(encoded({ ...evidence, version: 2 })), /format or version/);
  assert.throws(() => verifyComparisonEvidence(encoded({ ...evidence, experiment: {} })), /scenario.version is required/);
  assert.throws(() => verifyComparisonEvidence(encoded({ ...evidence, experiment: { oversized: 'x'.repeat(2 * 1024 * 1024) } })), /2 MiB/);
  assert.throws(() => verifyComparisonEvidence(encoded({ ...evidence, report: null })), /safe variant ID/);
});

test('CLI verifies a relocated bundle without source file and never prints success for tampering', t => {
  const run = (...args) => spawnSync(process.execPath, ['scripts/review-comparison.js', ...args], { cwd: root, encoding: 'utf8' });
  const dir = mkdtempSync(join(tmpdir(), 'detourlab-evidence-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = run('create', 'examples/minimal-experiment.json', 'close-at-10', 'close-at-11');
  assert.equal(out.status, 0, out.stderr);
  const file = join(dir, 'received.json');
  writeFileSync(file, out.stdout);
  const verified = run('verify', file);
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(verified.stdout, /1 complete delivery rows/);
  writeFileSync(file, out.stdout.replace('"arrivalDeltaS":-6', '"arrivalDeltaS":-7'));
  const link = join(dir, 'evidence-link');
  symlinkSync(file, link);
  for (const args of [['verify', link], ['verify', file], ['verify', dir], ['verify', file, 'unexpected'], ['create', 'examples/minimal-experiment.json', 'clear', 'clear']]) {
    const result = run(...args);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, '');
  }
});
