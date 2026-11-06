import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderJobImpactCsv } from '../src/job-impact-csv.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const example = 'examples/minimal-experiment.json';
const run = (...args) => spawnSync(process.execPath, ['scripts/explain-experiment.js', ...args], {
  cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024,
});
function success(result) {
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, ''); return result.stdout;
}
function failure(result, pattern) {
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, 2); assert.equal(result.stdout, ''); assert.match(result.stderr, pattern);
}
function file(t, data) {
  const dir = mkdtempSync(path.join(tmpdir(), 'detourlab-csv-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'input.json'); writeFileSync(filename, typeof data === 'string' ? data : JSON.stringify(data)); return filename;
}
// Independently tokenize RFC fields, never splitting quoted newlines or commas.
function parse(csv) {
  const rows = [], pattern = /(?:"((?:[^"]|"")*)"|([^",\r\n]*))(,|\r\n)/gy;
  let row = [], offset = 0, match;
  while ((match = pattern.exec(csv))) {
    offset = pattern.lastIndex;
    row.push(match[1] === undefined ? match[2] : match[1].replace(/""/gu, '"'));
    if (match[3] === '\r\n') { rows.push(row); row = []; }
  }
  assert.equal(offset, csv.length); assert.deepEqual(row, []); return rows;
}

test('CSV CLI is exact, deterministic, full and agrees with unchanged machine JSON', () => {
  for (const [file, variant] of [[example, 'close-at-10'], [example, 'clear'], ['examples/meridian-experiment.json', 'market-05'], ['examples/meridian-experiment.json', 'all-bridges-05']]) {
    const report = JSON.parse(success(run(file, '--variant', variant, '--json')));
    const csv = success(run(file, '--variant', variant, '--csv'));
    assert.equal(csv, renderJobImpactCsv(report, { experimentId: report.experimentId }));
    assert.equal(csv, success(run('--csv', '--variant', variant, file)));
    const [columns, ...rows] = parse(csv);
    assert.equal(columns.length, 20); assert.equal(rows.length, report.jobs.length);
    assert.deepEqual(rows.map(row => row[3]), report.jobs.map(job => job.id));
    for (const [index, row] of rows.entries()) {
      const job = report.jobs[index]; assert.equal(row.length, 20);
      assert.equal(row[8], job.baseline.arrivalS === null ? '' : String(job.baseline.arrivalS));
      assert.equal(row[12], job.variant.arrivalS === null ? '' : String(job.variant.arrivalS));
      assert.equal(row[18], String(job.changed));
    }
    assert.ok(csv.endsWith('\r\n')); assert.ok(!csv.endsWith('\r\n\n'));
  }
});

test('CSV display escaping does not change JSON label data or quoted Unicode', t => {
  const data = JSON.parse(readFileSync(path.join(root, example), 'utf8'));
  data.variants[0].name = '\t＝SUM(1,2) "橋"\r\nnext';
  const filename = file(t, data), variant = data.variants[0].id;
  const json = JSON.parse(success(run(filename, '--variant', variant, '--json')));
  const csv = success(run(filename, '--variant', variant, '--csv'));
  assert.equal(json.variant.name, data.variants[0].name);
  assert.equal(parse(csv)[1][2], "'\\u{9}＝SUM(1,2) \"橋\"\r\nnext");
});

test('CSV accepts legacy scenarios with upgraded supplied variant', () => {
  const rows = parse(success(run('examples/minimal-directed.json', '--variant', 'supplied', '--csv')));
  assert.equal(rows[1][1], 'supplied');
});

test('incompatible CSV/JSON flags fail before opening input with no stdout', () => {
  for (const flags of [['--json', '--csv'], ['--csv', '--json']]) failure(run('/missing/input.json', '--variant', 'clear', ...flags), /mutually exclusive/);
});

test('invalid CSV input, selection and options fail closed with no stdout', t => {
  failure(run(file(t, '{'), '--variant', 'clear', '--csv'), /DetourLab:/);
  failure(run(example, '--variant', 'missing', '--csv'), /Unknown experiment variant/);
  failure(run(example, '--csv'), /--variant is required/);
  failure(run(example, '--variant', 'clear', '--csv', '--bogus'), /Unknown option/);
  const data = JSON.parse(readFileSync(path.join(root, example), 'utf8'));
  data.baseScenario.jobs[0].nodeId = 'missing';
  failure(run(file(t, data), '--variant', 'clear', '--csv'), /DetourLab:/);
});

test('help documents CSV and still exits without reading an input', () => {
  const help = success(run('/missing/file', '--help'));
  assert.match(help, /--json \| --csv/); assert.match(help, /display-escaped CSV/);
});

test('CSV retains the full-experiment simulation budget and emits no partial report', t => {
  const data = JSON.parse(readFileSync(path.join(root, example), 'utf8')), scenario = data.baseScenario;
  scenario.nodes = Array.from({ length: 600 }, (_, i) => ({ id: `n${i}`, x: i, y: 0 }));
  scenario.edges = [];
  for (let i = 0; i < 599; i += 1) {
    scenario.edges.push({ id: `out-${i}`, from: `n${i}`, to: `n${i + 1}`, travelTimeS: 0.1, distanceM: 0.01, roadName: 'Out' });
    scenario.edges.push({ id: `back-${i}`, from: `n${i + 1}`, to: `n${i}`, travelTimeS: 0.1, distanceM: 0.01, roadName: 'Back' });
  }
  scenario.vehicles[0].startNode = 'n0';
  scenario.jobs = Array.from({ length: 450 }, (_, i) => ({ id: `job-${i}`, nodeId: i % 2 ? 'n0' : 'n599', vehicleId: 'van-1', dueTimeS: 0, serviceTimeS: 0 }));
  data.variants.forEach(variant => { variant.closures = []; });
  failure(run(file(t, data), '--variant', 'clear', '--csv'), /segments work limit/);
});
