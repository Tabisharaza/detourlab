import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const example = 'examples/minimal-experiment.json';
const args = ['--reference', 'close-at-10', '--candidate', 'close-at-11'];
const run = (...cliArgs) => spawnSync(process.execPath, ['scripts/compare-variants.js', ...cliArgs], {
  cwd: root, encoding: 'utf8', timeout: 20000, maxBuffer: 5 * 1024 * 1024,
});
const source = () => readFileSync(join(root, example), 'utf8');
function file(t, bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'detourlab-variant-comparison-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, 'experiment.json');
  writeFileSync(filename, typeof bytes === 'object' && !Buffer.isBuffer(bytes) ? JSON.stringify(bytes) : bytes);
  return filename;
}
function output(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return result.stdout;
}
function rejected(result, diagnostic) {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, diagnostic);
}

test('CLI regenerates the tiny JSON artifact byte-for-byte regardless of flag order', () => {
  const expected = readFileSync(join(root, 'docs/examples/variant-comparison/tiny.json'), 'utf8');
  assert.equal(output(run(example, ...args, '--json')), expected);
  assert.equal(output(run('--json', '--candidate', 'close-at-11', example, '--reference', 'close-at-10')), expected);
  const report = JSON.parse(expected);
  assert.equal(report.format, 'detourlab-variant-comparison');
  assert.equal(report.version, 1);
  assert.equal(report.experimentSha256, '7a757f1b53531826e98f44a706d3c6d235986682e6517c3c542f116fa8bf7395');
});

test('human view labels both sides and makes skipped work visible despite lower totals', () => {
  const text = output(run('examples/meridian-experiment.json', '--reference', 'market-05', '--candidate', 'all-bridges-05'));
  assert.match(text, /Reference: .*\[market-05\]/);
  assert.match(text, /Candidate: .*\[all-bridges-05\]/);
  assert.match(text, /Candidate minus reference: -231400 m \| -118 late \| \+57 unreachable \| -57 completed/);
  assert.match(text, /57 not comparable/);
  assert.match(text, /Arrival \d+ s -> n\/a; shift not comparable/);
  assert.match(text, /Changed deliveries shown: 20 of 126 \(input order\)/);
  assert.equal(text.split('\n').filter(line => /^job-.* \/ vehicle /u.test(line)).length, 20);
  assert.match(text, /Fewer late jobs or fewer meters can reflect less work completed/);
  assert.match(text, /No acceptance policy or route-causality claim/);
});

test('legacy scenario uses existing supplied and clear-road control upgrade', () => {
  const report = JSON.parse(output(run('examples/minimal-directed.json', '--reference', 'supplied', '--candidate', 'clear-roads', '--json')));
  assert.equal(report.reference.id, 'supplied');
  assert.equal(report.candidate.id, 'clear-roads');
  assert.equal(report.summary.totalJobs, 1);
});

test('human labels cannot forge rows; machine labels stay exact', t => {
  const input = JSON.parse(source());
  const name = 'Reference\r\nFAKE\t\u202e\\';
  input.variants[1].name = name;
  const filename = file(t, input);
  const text = output(run(filename, ...args));
  assert.match(text, /Reference: Reference\\u000d\\u000aFAKE\\u0009\\u202e\\\\ \[close-at-10\]/);
  assert.equal(JSON.parse(output(run(filename, ...args, '--json'))).reference.name, name);
});

test('strict UTF-8, bounded files and read-free help retain the CLI contract', t => {
  const text = output(run('missing-file.json', '--nonsense', '--help'));
  assert.match(text, /candidate minus reference/);
  rejected(run(file(t, Buffer.from([0xc3, 0x28])), ...args), /UTF-8/);
  rejected(run(file(t, Buffer.alloc(2 * 1024 * 1024 + 1)), ...args), /2 MiB/);
  rejected(run(root, ...args), /regular file/);
});

for (const [name, options, pattern] of [
  ['missing input', args, /file is required/],
  ['missing reference', [example, '--candidate', 'clear'], /--reference is required/],
  ['missing candidate', [example, '--reference', 'clear'], /--candidate is required/],
  ['missing value', [example, ...args.slice(0, -1)], /--candidate requires a safe/],
  ['oversized value', [example, ...args.slice(0, -1), 'a'.repeat(97)], /at most 96/],
  ['flag as a selector', [example, ...args.slice(0, -1), '--json'], /safe variant ID/],
  ['duplicate selector', [example, ...args, '--reference', 'clear'], /only be supplied once/],
  ['duplicate output format', [example, ...args, '--json', '--json'], /only be supplied once/],
  ['unknown candidate', [example, ...args.slice(0, -1), 'missing'], /Unknown candidate variant/],
  ['same sides', [example, ...args.slice(0, -1), 'close-at-10'], /distinct/],
  ['unsupported policy', [example, ...args, '--max-newly-late', '0'], /Unknown option/],
  ['two files', [example, example, ...args], /Only one input file/],
]) {
  test(`rejects ${name} with no partial output`, () => rejected(run(...options), pattern));
}

test('all variants are validated, even an unselected variant', t => {
  const input = JSON.parse(source());
  input.variants[0].closures = [{ id: 'missing', atS: 1, edgeIds: ['no-edge'] }];
  rejected(run(file(t, input), ...args, '--json'), /unknown id "no-edge"/);
});

test('full-run aggregate budgets are not bypassed when selecting two small plans', t => {
  const input = JSON.parse(source());
  const scenario = input.baseScenario;
  scenario.nodes = Array.from({ length: 600 }, (_, i) => ({ id: `n${i}`, x: i, y: 0 }));
  scenario.edges = [];
  for (let i = 0; i < 599; i += 1) {
    scenario.edges.push({ id: `out-${i}`, from: `n${i}`, to: `n${i + 1}`, travelTimeS: 0.1, distanceM: 0.01, roadName: 'Out' });
    scenario.edges.push({ id: `back-${i}`, from: `n${i + 1}`, to: `n${i}`, travelTimeS: 0.1, distanceM: 0.01, roadName: 'Back' });
  }
  scenario.vehicles[0].startNode = 'n0';
  scenario.jobs = Array.from({ length: 300 }, (_, i) => ({
    id: `job-${i}`, nodeId: i % 2 ? 'n0' : 'n599', vehicleId: 'van-1', dueTimeS: 0, serviceTimeS: 0,
  }));
  for (const variant of input.variants) variant.closures = [];
  rejected(run(file(t, input), ...args, '--json'), /aggregate result limit/);
});
