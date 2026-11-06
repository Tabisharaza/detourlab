import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderJobImpactCsv, JOB_IMPACT_CSV_COLUMNS } from '../src/job-impact-csv.js';
import { createJobImpactReport } from '../scripts/job-impact.js';
import { createBrowserImpact } from '../src/browser-impact.js';
import { simulateExperiment } from '../src/experiment.js';

// Independent state-machine CSV reader, including doubled quotes and embedded CRLF.
export function parseCsv(csv) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') { assert.equal(cell, ''); quoted = true; }
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\r') {
      assert.equal(csv[++i], '\n');
      row.push(cell); rows.push(row); row = []; cell = '';
    } else { assert.notEqual(char, '\n'); cell += char; }
  }
  assert.equal(quoted, false); assert.equal(cell, ''); assert.deepEqual(row, []);
  return rows;
}
const input = name => JSON.parse(readFileSync(new URL(`../examples/${name}-experiment.json`, import.meta.url), 'utf8'));
const tiny = () => createJobImpactReport(input('minimal'), 'close-at-10');
const render = report => renderJobImpactCsv(report, { experimentId: report.experimentId });
const records = report => { const [headers, ...rows] = parseCsv(render(report)); return rows.map(row => Object.fromEntries(headers.map((key, index) => [key, row[index]]))); };

test('CSV is deterministic RFC-style UTF-8 without BOM and a final CRLF', () => {
  const report = tiny();
  const before = structuredClone(report);
  report.variant.name = 'Café, "橋"\r\nsecond line';
  const csv = render(report);
  assert.equal(csv, render(report));
  assert.ok(csv.endsWith('\r\n')); assert.notEqual(csv[0], '\ufeff');
  assert.deepEqual(parseCsv(csv)[0], JOB_IMPACT_CSV_COLUMNS);
  assert.equal(records(report)[0].variantName, report.variant.name);
  report.variant.name = before.variant.name;
  assert.deepEqual(report, before);
});

for (const label of ['=SUM(A1)', '+1', '-1', '@SUM(A1)', '  =1', '\t\u0000=1', '\u200b＝1', '　＋1', '－1', '＠x', "'literal"]) {
  test(`formula-like text is prefixed, including compatibility/hidden prefix ${JSON.stringify(label)}`, () => {
    const report = tiny(); report.variant.name = label;
    assert.ok(records(report)[0].variantName.startsWith("'"));
  });
}

test('control and backslash display escaping is explicit while quoted newlines remain intact', () => {
  const report = tiny(); report.variant.name = 'a\\b\u0000\t\u007f\u200b\nline';
  assert.equal(records(report)[0].variantName, 'a\\\\b\\u{0}\\u{9}\\u{7f}\\u{200b}\nline');
  assert.equal(records(report)[0].jobId, report.jobs[0].id);
});

test('zero, negative deltas, fractional precision and signed zero remain numeric', () => {
  const report = tiny(), job = report.jobs[0];
  job.dueTimeS = -0;
  job.baseline = { status: 'on-time', arrivalS: 0.1234567890123456, completedS: 2.75, delayS: 0 };
  job.variant = { status: 'on-time', arrivalS: 0, completedS: 1.125, delayS: 0 };
  job.arrivalDeltaS = -0.1234567890123456; job.completedDeltaS = -1.625; job.delayDeltaS = 0; job.changed = true; job.statusChanged = false;
  const row = records(report)[0];
  assert.equal(row.dueTimeS, '-0'); assert.equal(row.variantArrivalS, '0');
  assert.equal(row.baselineArrivalS, '0.1234567890123456');
  assert.equal(row.arrivalDeltaS, '-0.1234567890123456'); assert.equal(row.completedDeltaS, '-1.625');
  assert.equal(row.delayDeltaS, '0'); assert.equal(row.changed, 'true'); assert.equal(row.statusChanged, 'false');
});

test('complete Meridian rows correspond to report and browser projection, including unchanged and unreachable', () => {
  for (const id of ['market-05', 'all-bridges-05', 'clear-roads']) {
    const experiment = input('meridian');
    if (!experiment.variants.some(variant => variant.id === id)) continue;
    const report = createJobImpactReport(experiment, id);
    const browser = createBrowserImpact(experiment, simulateExperiment(experiment), id);
    assert.equal(render(report), renderJobImpactCsv(browser, { experimentId: experiment.id }));
    const rows = records(report);
    assert.equal(rows.length, 192);
    for (const [index, job] of report.jobs.entries()) {
      const row = rows[index];
      const expected = [report.experimentId, report.variant.id, report.variant.name, job.id, job.vehicleId, job.nodeId, job.dueTimeS,
        job.baseline.status, job.baseline.arrivalS, job.baseline.completedS, job.baseline.delayS,
        job.variant.status, job.variant.arrivalS, job.variant.completedS, job.variant.delayS,
        job.arrivalDeltaS, job.completedDeltaS, job.delayDeltaS, job.changed, job.statusChanged].map(value => value === null ? '' : String(value));
      assert.deepEqual(Object.values(row), expected);
    }
    assert.ok(rows.some(row => row.changed === 'false'));
    if (id === 'all-bridges-05') assert.ok(rows.some(row => row.variantStatus === 'unreachable' && row.variantArrivalS === '' && row.arrivalDeltaS === ''));
  }
});

test('empty complete reports produce a header only', () => {
  const report = tiny(); report.jobs = []; report.summary.totalJobs = 0;
  assert.equal(parseCsv(render(report)).length, 1);
});

for (const [name, change] of [
  ['count mismatch', r => r.summary.totalJobs++], ['fractional count', r => r.summary.totalJobs = 1.5],
  ['missing jobs', r => delete r.jobs], ['missing identity', r => delete r.experimentId],
  ['missing variant', r => delete r.variant], ['empty label', r => r.variant.name = ''],
  ['non-string label', r => r.jobs[0].id = 1], ['oversized label', r => r.variant.name = 'x'.repeat(4097)],
  ['lone surrogate', r => r.variant.name = '\ud800'], ['infinite time', r => r.jobs[0].dueTimeS = Infinity],
  ['NaN time', r => r.jobs[0].baseline.arrivalS = NaN], ['missing time', r => delete r.jobs[0].variant.delayS],
  ['string number', r => r.jobs[0].dueTimeS = '1'], ['null deadline', r => r.jobs[0].dueTimeS = null],
  ['unknown status', r => r.jobs[0].baseline.status = 'other'], ['false unreachable', r => r.jobs[0].variant.status = 'unreachable'],
  ['false reachable', r => r.jobs[0].variant.arrivalS = null], ['invalid boolean', r => r.jobs[0].changed = 'true'],
  ['false flag', r => r.jobs[0].statusChanged = false], ['false delta', r => r.jobs[0].arrivalDeltaS = null],
  ['duplicate ID', r => { r.jobs.push(structuredClone(r.jobs[0])); r.summary.totalJobs++; }],
]) {
  test(`rejects ${name} without returning a partial CSV`, () => { const report = tiny(); change(report); assert.throws(() => render(report), /Job impact CSV:/); });
}

test('row and UTF-8 byte bounds are enforced, including multibyte labels', () => {
  const report = tiny(); const job = report.jobs[0];
  report.jobs = Array.from({ length: 2000 }, (_, index) => ({ ...job, id: `job-${index}` })); report.summary.totalJobs = 2000;
  assert.equal(parseCsv(render(report)).length, 2001);
  report.jobs.push({ ...job, id: 'last' }); report.summary.totalJobs++;
  assert.throws(() => render(report), /2000/);
  report.jobs.pop(); report.summary.totalJobs--;
  report.variant.name = '橋'.repeat(800);
  assert.throws(() => render(report), /4 MiB/);
});

test('all label columns receive the same formula mitigation', () => {
  const report = tiny();
  report.experimentId = '=experiment'; report.variant.id = '+variant'; report.variant.name = '-name';
  report.jobs[0].id = '@job'; report.jobs[0].vehicleId = ' ＝vehicle'; report.jobs[0].nodeId = '\u200b+node';
  const row = records(report)[0];
  for (const key of ['experimentId', 'variantId', 'variantName', 'jobId', 'vehicleId', 'nodeId']) assert.ok(row[key].startsWith("'"));
});

test('invalid final rows and missing reports reject without partial results', () => {
  const report = tiny(); report.jobs.push({ ...report.jobs[0], id: 'second', arrivalDeltaS: Infinity }); report.summary.totalJobs = 2;
  assert.throws(() => render(report), /finite numbers/);
  assert.throws(() => renderJobImpactCsv(null, { experimentId: 'x' }), /complete impact/);
});
