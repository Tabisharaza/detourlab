import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { canonicalExperiment, parseExperiment } from '../src/experiment.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const example = 'examples/minimal-experiment.json';
const run = (...args) => spawnSync(process.execPath, ['scripts/explain-experiment.js', ...args], {
  cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024,
});
const input = () => JSON.parse(readFileSync(path.join(root, example), 'utf8'));
function file(t, bytes) {
  const dir = mkdtempSync(path.join(tmpdir(), 'detourlab-impact-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'input.json');
  writeFileSync(filename, typeof bytes === 'object' && !Buffer.isBuffer(bytes) ? JSON.stringify(bytes) : bytes);
  return filename;
}
function success(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return result.stdout;
}
function failure(result, pattern) {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, '', 'failures must not expose a partial report');
  assert.match(result.stderr, pattern);
  assert.ok(result.stderr.length <= 525, 'diagnostic remains bounded');
}

test('job-impact CLI emits deterministic complete tiny-example JSON', () => {
  const output = success(run(example, '--variant', 'close-at-10', '--json'));
  const report = JSON.parse(output);
  assert.equal(report.format, 'detourlab-job-impact');
  assert.equal(report.version, 1);
  assert.equal(report.engineVersion, '0.1.0');
  assert.equal(report.summary.changedJobs, 1);
  assert.equal(report.summary.transitions['on-time'].late, 1);
  assert.equal(report.jobs[0].baseline.arrivalS, 20);
  assert.equal(report.jobs[0].variant.arrivalS, 26);
  assert.equal(report.jobs[0].arrivalDeltaS, 6);
  assert.equal(report.jobs[0].baseline.completedS, 23);
  assert.equal(report.jobs[0].variant.completedS, 29);
  assert.equal(report.jobs[0].delayDeltaS, 4);
  assert.equal(output, success(run('--json', '--variant', 'close-at-10', example)));
  assert.equal(output, success(run(example, '--json', '--variant', 'close-at-10')));
  assert.equal(report.experimentSha256, createHash('sha256').update(canonicalExperiment(input())).digest('hex'));
});

test('human impact report distinguishes arrival deadlines, service completion and diagnostic exit', () => {
  const text = success(run(example, '--variant', 'close-at-10'));
  assert.match(text, /Jobs: 1 total \/ 1 changed \/ 0 unchanged/);
  assert.match(text, /on-time -> late; arrival deadline 22 s/);
  assert.match(text, /Arrival 20 s -> 26 s; difference \+6 s/);
  assert.match(text, /Service complete 23 s -> 29 s/);
  assert.match(text, /Lateness 0 s -> 4 s/);
  assert.match(text, /not complete causal attribution or a threshold verdict/);
  assert.doesNotMatch(text, /^PASS|^FAIL/mu);
});

for (const variant of ['clear', 'close-at-11']) {
  test(`${variant} includes unchanged jobs without claiming identical routes`, () => {
    const report = JSON.parse(success(run(example, '--variant', variant, '--json')));
    assert.equal(report.summary.changedJobs, 0);
    assert.equal(report.summary.unchangedJobs, 1);
    assert.equal(report.jobs.length, 1);
    assert.equal(report.jobs[0].arrivalDeltaS, 0);
    const text = success(run(example, '--variant', variant));
    assert.match(text, /Changed jobs shown: 0 of 0/);
    assert.match(text, /Equal outcomes do not prove identical routes/);
  });
}

test('legacy scenario upgrades retain supplied/control IDs and canonical fingerprint', () => {
  const filename = 'examples/minimal-directed.json';
  const report = JSON.parse(success(run(filename, '--variant', 'supplied', '--json')));
  const upgraded = parseExperiment(readFileSync(path.join(root, filename), 'utf8'));
  assert.equal(report.variant.id, 'supplied');
  assert.equal(report.experimentSha256, createHash('sha256').update(canonicalExperiment(upgraded)).digest('hex'));
  assert.equal(JSON.parse(success(run(filename, '--variant', 'clear-roads', '--json'))).summary.changedJobs, 0);
});

test('Meridian report exposes later arrivals that remain on time', () => {
  const report = JSON.parse(success(run('examples/meridian-experiment.json', '--variant', 'market-05', '--json')));
  assert.equal(report.jobs.length, 192);
  assert.equal(report.summary.changedJobs, 125);
  assert.equal(report.summary.arrivalChangedJobs, 125);
  assert.equal(report.summary.statusChangedJobs, 118);
  assert.equal(report.summary.transitions['on-time'].late, 118);
  const row = report.jobs.find(job => job.id === 'job-01-4');
  assert.equal(row.vehicleId, 'van-01');
  assert.equal(row.dueTimeS, 749);
  assert.equal(row.baseline.arrivalS, 690);
  assert.equal(row.variant.arrivalS, 741);
  assert.equal(row.arrivalDeltaS, 51);
  assert.equal(row.baseline.status, 'on-time');
  assert.equal(row.variant.status, 'on-time');
  assert.equal(row.delayDeltaS, 0);
});

test('human view states its 20-row limit while JSON contains every job', () => {
  const text = success(run('examples/meridian-experiment.json', '--variant', 'market-05'));
  assert.match(text, /Changed jobs shown: 20 of 125 \(input order\)/);
  assert.match(text, /105 additional changed jobs omitted from this view; use --json for every job/);
  assert.equal(text.split('\n').filter(line => /^job-.* \/ vehicle /u.test(line)).length, 20);
});

test('unreachable jobs have null comparison timings and explicit human caution', () => {
  const args = ['examples/meridian-experiment.json', '--variant', 'all-bridges-05'];
  const report = JSON.parse(success(run(...args, '--json')));
  const row = report.jobs.find(job => job.id === 'job-01-4');
  assert.equal(report.variantMetrics.unreachableJobs, 57);
  assert.equal(row.variant.status, 'unreachable');
  assert.equal(row.variant.arrivalS, null);
  assert.equal(row.variant.completedS, null);
  assert.equal(row.variant.delayS, null);
  assert.equal(row.arrivalDeltaS, null);
  assert.equal(row.completedDeltaS, null);
  assert.equal(row.delayDeltaS, null);
  assert.match(success(run(...args)), /unreachable work is skipped.*n\/a, not zero or an improvement/);
});

for (const [name, args, pattern] of [
  ['missing file', [], /file is required/],
  ['missing variant', [example], /--variant is required/],
  ['missing selector value', [example, '--variant'], /--variant requires/],
  ['flag instead of selector', [example, '--variant', '--json'], /--variant requires/],
  ['duplicate selector', [example, '--variant', 'clear', '--variant', 'clear'], /only be supplied once/],
  ['unsafe selector', [example, '--variant', 'bad id'], /safe variant ID/],
  ['oversized selector', [example, '--variant', 'x'.repeat(97)], /safe variant ID/],
  ['unknown selector', [example, '--variant', 'missing'], /Unknown.*variant/],
  ['reserved selector', [example, '--variant', 'constructor'], /Unknown.*variant/],
  ['unknown option', [example, '--variant', 'clear', '--max-extra-late', '0'], /Unknown option/],
  ['multiple files', [example, example, '--variant', 'clear'], /Only one input file/],
]) {
  test(`job-impact CLI rejects ${name} without partial output`, () => failure(run(...args), pattern));
}

test('help is read-free, including a nonexistent filename and otherwise invalid args', () => {
  const text = success(run('missing-file.json', '--nonsense', '--help'));
  assert.match(text, /--variant ID/);
  assert.match(text, /Exit 0 means a report was produced/);
  assert.match(text, /JSON includes every job/);
});

test('malformed UTF-8 and malformed JSON fail safely', t => {
  for (const [bytes, pattern] of [[Buffer.from([0xc3, 0x28]), /UTF-8/], ['{', /valid JSON/]]) {
    failure(run(file(t, bytes), '--variant', 'clear', '--json'), pattern);
  }
});

test('BOM and exactly 2 MiB input preserve reports and input bytes', t => {
  const text = JSON.stringify(input());
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]);
  const exact = Buffer.concat([Buffer.from(text), Buffer.alloc(2 * 1024 * 1024 - Buffer.byteLength(text), 0x20)]);
  const expected = success(run(example, '--variant', 'clear', '--json'));
  for (const bytes of [bom, exact]) {
    const filename = file(t, bytes);
    assert.equal(success(run(filename, '--variant', 'clear', '--json')), expected);
    assert.deepEqual(readFileSync(filename), bytes);
  }
});

test('oversized and nonregular inputs fail before report generation', t => {
  failure(run(file(t, Buffer.alloc(2 * 1024 * 1024 + 1, 0x20)), '--variant', 'clear', '--json'), /2 MiB/);
  failure(run(root, '--variant', 'clear', '--json'), /regular file/);
});

test('hostile labels stay on one human line while JSON preserves original text', t => {
  const data = input();
  data.variants[1].name = 'Start\rFAKE\nPASS\t\u009b2J\u202eEnd\\u202e';
  const filename = file(t, data);
  const text = success(run(filename, '--variant', 'close-at-10'));
  assert.match(text, /Start\\u000dFAKE\\u000aPASS\\u0009\\u009b2J\\u202eEnd\\\\u202e/);
  assert.doesNotMatch(text, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u206f]/u);
  assert.equal(JSON.parse(success(run(filename, '--variant', 'close-at-10', '--json'))).variant.name, data.variants[1].name);
});

test('hostile unsupported field produces a bounded escaped diagnostic', t => {
  const data = input();
  data['x\n\u202e' + 'a'.repeat(6000)] = true;
  const result = run(file(t, data), '--variant', 'clear', '--json');
  failure(result, /unsupported property/);
  assert.match(result.stderr, /\\u000a\\u202e/);
  assert.doesNotMatch(result.stderr.slice(0, -1), /[\r\n\u202e]/u);
});

function longRun(jobCount) {
  const data = input(), scenario = data.baseScenario;
  scenario.nodes = Array.from({ length: 600 }, (_, i) => ({ id: `n${i}`, x: i, y: 0 }));
  scenario.edges = [];
  for (let i = 0; i < 599; i += 1) {
    scenario.edges.push({ id: `out-${i}`, from: `n${i}`, to: `n${i + 1}`, travelTimeS: 0.1, distanceM: 0.01, roadName: 'Out' });
    scenario.edges.push({ id: `back-${i}`, from: `n${i + 1}`, to: `n${i}`, travelTimeS: 0.1, distanceM: 0.01, roadName: 'Back' });
  }
  scenario.vehicles[0].startNode = 'n0';
  scenario.jobs = Array.from({ length: jobCount }, (_, i) => ({ id: `job-${i}`, nodeId: i % 2 ? 'n0' : 'n599', vehicleId: 'van-1', dueTimeS: 0, serviceTimeS: 0 }));
  data.variants.forEach(variant => { variant.closures = []; });
  return data;
}

for (const [count, pattern] of [[450, /segments work limit/], [300, /aggregate result limit/]]) {
  test(`job-impact CLI preserves simulation budgets with ${count} long-route jobs`, t => {
    failure(run(file(t, longRun(count)), '--variant', 'clear', '--json'), pattern);
  });
}

test('unwritten named pipes fail without waiting for a writer', { skip: process.platform === 'win32' }, t => {
  const filename = file(t, '{}') + '.fifo';
  const made = spawnSync('mkfifo', [filename], { encoding: 'utf8' });
  if (made.error?.code === 'ENOENT') { t.skip('mkfifo unavailable'); return; }
  assert.equal(made.status, 0, made.stderr);
  failure(run(filename, '--variant', 'clear', '--json'), /regular file/);
});
