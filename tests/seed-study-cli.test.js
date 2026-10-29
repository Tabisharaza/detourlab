import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExperiment } from '../src/experiment.js';
import { createMeridianExperiment } from '../scripts/meridian-study.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const run = (...args) => spawnSync(process.execPath, ['scripts/compare-seeds.js', ...args], { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
function success(result, status = 0) { assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, status, result.stderr); assert.equal(result.stderr, ''); return result.stdout; }
function failure(args, pattern = /seed|Seed|plan|input|Unknown|once|finite|combined/) { const r = run(...args); assert.equal(r.error, undefined); assert.equal(r.signal, null); assert.equal(r.status, 2); assert.equal(r.stdout, ''); assert.match(r.stderr, pattern); assert.ok(r.stderr.length <= 525); }

test('seed CLI emits complete deterministic failed policy evidence, not a mean-only pass', () => {
  const a = success(run('--seeds', '0,42,4294967295', '--max-extra-late', '120', '--json'), 1);
  const b = success(run('--json', '--plans', 'market-10,market-05', '--max-extra-late', '120', '--seeds', '4294967295, 42, 0'), 1);
  assert.equal(a, b); const result = JSON.parse(a);
  assert.equal(result.format, 'detourlab-meridian-seed-study'); assert.equal(result.version, 1);
  assert.equal(result.runs.length, 3); assert.equal(result.verdict, 'failed');
  assert.deepEqual(result.variants[0].failedSeeds, [0]); assert.equal(result.variants[0].summary.metrics.lateJobs.mean, 115);
  assert.equal(result.variants[1].verdict, 'passed');
  assert.equal(a, readFileSync(path.join(root, 'docs/examples/seed-study/three-seeds.json'), 'utf8'));
});

test('human view identifies every baseline, sample verdict and aggregate caveat', () => {
  const text = success(run('--seeds', '0,42', '--max-extra-late', '120'), 1);
  assert.match(text, /Seed 0 \/ experiment SHA-256/); assert.match(text, /Seed 42 \/ experiment SHA-256/);
  assert.equal(text.match(/Clear-road baseline:/g).length, 2);
  assert.equal(text.match(/market-05:/g).length, 3); assert.equal(text.match(/market-10:/g).length, 3);
  assert.match(text, /122 late/); assert.match(text, /Failed seeds: 0/); assert.match(text, /Overall policy: FAILED/);
  assert.match(text, /descriptive means never determine acceptance/);
});

test('no policy is explicitly not evaluated; a permissive policy passes all samples', () => {
  const noPolicy = JSON.parse(success(run('--seeds', '0,42', '--json')));
  assert.equal(noPolicy.verdict, 'not-evaluated'); assert.ok(noPolicy.variants.every(v => v.failedSeeds === null));
  const passed = JSON.parse(success(run('--seeds', '0,42', '--max-extra-late', '122', '--max-unreachable', '0', '--json')));
  assert.equal(passed.verdict, 'passed'); assert.ok(passed.variants.every(v => v.failedSeeds.length === 0));
});

test('single-seed export is standard input and reproduces the corresponding sample in existing runner', t => {
  const exported = success(run('--export-seed', '42'));
  assert.deepEqual(parseExperiment(exported), createMeridianExperiment(42));
  const directory = mkdtempSync(path.join(tmpdir(), 'detourlab-seeds-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'seed42.experiment.json'); writeFileSync(file, exported);
  const before = readdirSync(directory);
  const old = spawnSync(process.execPath, ['scripts/run-experiment.js', file, '--json', '--max-extra-late', '120'], { cwd: root, encoding: 'utf8', timeout: 15000 });
  const oldResult = JSON.parse(success(old)), study = JSON.parse(success(run('--seeds', '0,42', '--max-extra-late', '120', '--json'), 1));
  const sample = study.runs[1]; assert.equal(sample.experimentSha256, oldResult.experimentSha256);
  assert.deepEqual(sample.baseline, oldResult.baseline);
  sample.variants.forEach((variant, i) => { assert.deepEqual(variant.metrics, oldResult.variants[i].metrics); assert.deepEqual(variant.delta, oldResult.variants[i].delta); });
  assert.equal(readFileSync(file, 'utf8'), exported); assert.deepEqual(readdirSync(directory), before);
  const all = parseExperiment(success(run('--export-seed', '42', '--plans', 'clear-roads,all-bridges-05,market-10,market-05')));
  assert.deepEqual(all, JSON.parse(readFileSync(path.join(root, 'examples/meridian-experiment.json'), 'utf8')));
});

test('explicit lost-service plan warns per seed and retains its failed verdict beside clear control', () => {
  const text = success(run('--seeds', '0,42', '--plans', 'all-bridges-05,clear-roads', '--max-unreachable', '0'), 1);
  assert.match(text, /63 unreachable/); assert.match(text, /57 unreachable/);
  assert.equal(text.match(/CAUTION \[seed/g).length, 2);
  assert.match(text, /skipped/); assert.match(text, /Failed seeds: 0, 42/); assert.match(text, /Policy: PASSED/);
});

test('maximal bounded study completes with every requested seed and plan and stays under output cap', () => {
  const report = JSON.parse(success(run('--seeds', Array.from({ length: 12 }, (_, i) => i).join(','), '--plans', 'market-05,market-10,all-bridges-05,clear-roads', '--json')));
  assert.equal(report.runs.length, 12); assert.ok(report.runs.every(run => run.variants.length === 4));
});

test('malformed, duplicate, overflowing and excessive seed arguments fail with no partial report', () => {
  for (const value of ['', '0', '0,0', '0,00', '0,-1', '0,1.0', '0,1e2', '0,0x10', '0,4294967296', '0,1e999', '0,Infinity', 'NaN,2', '0,', ',1', '0,,1', Array.from({ length: 13 }, (_, i) => i).join(','), '0,'.repeat(600)]) failure(['--seeds', value]);
  for (const value of ['-1', '0.5', '4294967296', 'NaN', '0,1', '1e2', '0x10']) failure(['--export-seed', value]);
});

test('malformed selection and flag boundaries fail before generation', () => {
  for (const args of [[], ['input.json'], ['--seeds', '0,1', 'input.json'], ['--seeds', '0,1', '--unknown'], ['--seeds', '0,1', '--json', '--json'], ['--seeds', '0,1', '--seeds', '2,3'], ['--export-seed', '0', '--export-seed', '1'], ['--seeds', '0,1', '--plans', 'market-05'], ['--seeds', '0,1', '--plans', 'market-05,market-05'], ['--seeds', '0,1', '--plans', 'market-05,unknown'], ['--seeds', '0,1', '--plans', 'market-05,market-10', '--plans', 'market-05,market-10'], ['--seeds', '0,1', '--max-extra-late', '--plans', 'market-05,market-10'], ['--seeds', '0,1', '--max-extra-late', 'NaN'], ['--seeds', '0,1', '--max-extra-late', '0', '--max-extra-late', '0'], ['--export-seed', '0', '--seeds', '0,1'], ['--export-seed', '0', '--json'], ['--export-seed', '0', '--max-extra-late', '0']]) failure(args);
});

test('help bypasses invalid arguments and documents bounds, generation and safe export', () => {
  const text = success(run('--unknown', '--seeds', 'invalid', '--help'));
  assert.match(text, /2–12 distinct/); assert.match(text, /0–4294967295/); assert.match(text, /No input file/); assert.match(text, /NEW file/); assert.match(text, /no partial report/);
});
