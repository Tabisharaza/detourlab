import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EXPERIMENT_LIMITS, canonicalExperiment, experimentFromScenario, parseExperiment, simulateExperiment } from '../src/experiment.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const example = 'examples/meridian-experiment.json';
const legacy = 'examples/minimal-directed.json';
const fixture = () => experimentFromScenario(JSON.parse(readFileSync(path.join(root, legacy), 'utf8')));
const run = (...args) => spawnSync(process.execPath, ['scripts/run-experiment.js', ...args], { cwd: root, encoding: 'utf8', timeout: 15000 });
function withFile(t, content, name = 'input.json') {
  const directory = mkdtempSync(path.join(tmpdir(), 'detourlab-experiment-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, name); writeFileSync(file, content); return file;
}
const jsonFile = (t, input = fixture()) => withFile(t, JSON.stringify(input));
const parsed = result => { assert.equal(result.stderr, ''); return JSON.parse(result.stdout); };
const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value;

function longRun(jobCount) {
  const input = fixture(), scenario = input.baseScenario;
  scenario.nodes = Array.from({ length: 600 }, (_, i) => ({ id: `n${i}`, x: i, y: 0 }));
  scenario.edges = [];
  for (let i = 0; i < 599; i += 1) {
    scenario.edges.push({ id: `out-${i}`, from: `n${i}`, to: `n${i + 1}`, travelTimeS: 0.1, distanceM: 0.01, roadName: 'Out' });
    scenario.edges.push({ id: `back-${i}`, from: `n${i + 1}`, to: `n${i}`, travelTimeS: 0.1, distanceM: 0.01, roadName: 'Back' });
  }
  scenario.vehicles[0].startNode = 'n0';
  scenario.jobs = Array.from({ length: jobCount }, (_, i) => ({ id: `job-${i}`, nodeId: i % 2 ? 'n0' : 'n599', vehicleId: 'van-1', dueTimeS: 0, serviceTimeS: 0 }));
  input.variants.forEach(variant => { variant.closures = []; });
  return input;
}

test('experiment CLI reports deterministic, engine-equivalent metrics for every named variant', () => {
  const first = run(example, '--json'), second = run(example, '--json');
  assert.equal(first.status, 0, first.stderr); assert.equal(first.stdout, second.stdout);
  const output = parsed(first), input = parseExperiment(readFileSync(path.join(root, example), 'utf8')), actual = simulateExperiment(input);
  assert.equal(output.engineVersion, '0.1.0'); assert.equal(output.experimentId, input.id);
  assert.equal(output.seed, input.baseScenario.seed); assert.deepEqual(output.baseline, actual.baseline.metrics);
  assert.equal(output.experimentSha256, createHash('sha256').update(canonicalExperiment(input)).digest('hex'));
  assert.match(output.experimentSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(output.variants.map(variant => variant.id), input.variants.map(variant => variant.id));
  output.variants.forEach((variant, index) => {
    assert.equal(variant.name, actual.variants[index].name);
    assert.deepEqual(variant.metrics, actual.variants[index].result.metrics);
    assert.deepEqual(variant.delta, actual.variants[index].delta);
    assert.equal(variant.passed, true); assert.deepEqual(variant.violations, []);
  });
  assert.equal(output.passed, true); assert.deepEqual(output.thresholds, {}); assert.deepEqual(output.violations, []);
});

test('legacy CLI input upgrades to supplied and clear-road IDs without changing engine results', () => {
  const result = run(legacy, '--json'); assert.equal(result.status, 0, result.stderr);
  const output = parsed(result);
  assert.deepEqual(output.variants.map(variant => variant.id), ['supplied', 'clear-roads']);
  assert.equal(output.baseline.distanceM, 200); assert.equal(output.variants[0].metrics.distanceM, 260);
  assert.deepEqual(output.variants[1].metrics, output.baseline);
  assert.deepEqual(output.variants[1].delta, { distanceM: 0, extraDistancePct: 0, extraLateJobs: 0, unreachableJobs: 0 });
});

test('hash and entire JSON output are stable across whitespace, key ordering, and threshold flag ordering', t => {
  const input = fixture();
  const first = withFile(t, JSON.stringify(input)), second = withFile(t, JSON.stringify(reverseKeys(input), null, 4));
  const a = run(first, '--json', '--max-unreachable', '0', '--max-extra-late', '1', '--max-extra-distance-pct', '30');
  const b = run('--max-extra-distance-pct', '30', '--max-extra-late', '1', '--json', second, '--max-unreachable', '0');
  assert.equal(a.status, 0, a.stderr); assert.equal(b.status, 0, b.stderr); assert.equal(a.stdout, b.stdout);
  const changed = structuredClone(input); changed.variants[0].closures[0].atS += 1;
  const c = parsed(run(jsonFile(t, changed), '--json'));
  assert.notEqual(parsed(a).experimentSha256, c.experimentSha256);
});

test('all three threshold flags accept the exact boundary and fail only when exceeded', () => {
  const pass = run(legacy, '--json', '--max-extra-distance-pct', '30', '--max-extra-late', '1', '--max-unreachable', '0');
  assert.equal(pass.status, 0, pass.stderr); assert.equal(parsed(pass).passed, true);
  for (const [flag, value, metric, actual] of [['--max-extra-distance-pct', '29.999999', 'extraDistancePct', 30], ['--max-extra-late', '0', 'extraLateJobs', 1]]) {
    const result = run(legacy, '--json', flag, value); assert.equal(result.status, 1, result.stderr);
    const output = parsed(result); assert.equal(output.passed, false);
    assert.deepEqual(output.violations, [{ variantId: 'supplied', metric, actual, limit: Number(value) }]);
    assert.equal(output.variants[0].passed, false); assert.equal(output.variants[1].passed, true);
  }
});

test('thresholds evaluate every variant and retain all violations in stable variant/metric order', t => {
  const input = fixture(); input.variants.push({ id: 'second-closure', name: 'Second closure', closures: structuredClone(input.variants[0].closures) });
  const result = run(jsonFile(t, input), '--json', '--max-extra-late', '0', '--max-extra-distance-pct', '0');
  assert.equal(result.status, 1, result.stderr);
  const output = parsed(result);
  assert.deepEqual(output.variants.map(variant => variant.passed), [false, true, false]);
  assert.deepEqual(output.violations, [
    { variantId: 'supplied', metric: 'extraDistancePct', actual: 30, limit: 0 },
    { variantId: 'supplied', metric: 'extraLateJobs', actual: 1, limit: 0 },
    { variantId: 'second-closure', metric: 'extraDistancePct', actual: 30, limit: 0 },
    { variantId: 'second-closure', metric: 'extraLateJobs', actual: 1, limit: 0 },
  ]);
});

test('unreachable thresholds use absolute counts and skipped-job distance gets an explicit caution', t => {
  const input = fixture(); input.variants[0].closures = [{ id: 'disconnect', edgeIds: ['ab'], atS: 0 }];
  const file = jsonFile(t, input);
  const result = run(file, '--json', '--max-unreachable', '0', '--max-extra-distance-pct', '0');
  assert.equal(result.status, 1, result.stderr);
  const output = parsed(result);
  assert.deepEqual(output.violations, [{ variantId: 'supplied', metric: 'unreachableJobs', actual: 1, limit: 0 }]);
  assert.equal(output.variants[0].delta.extraDistancePct, -100);
  assert.equal(output.variants[0].metrics.completedJobs, 0);
  assert.equal(output.warnings[0].variantId, 'supplied'); assert.match(output.warnings[0].message, /skipped/);
  assert.equal(run(file, '--json', '--max-unreachable', '1').status, 0);
  const human = run(file); assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /CAUTION \[supplied\].*skipped/); assert.match(human.stdout, /0\/1 completed/);
  input.baseScenario.edges = []; input.variants[0].closures = [];
  const disconnected = parsed(run(jsonFile(t, input), '--json', '--max-unreachable', '0'));
  assert.equal(disconnected.baseline.unreachableJobs, 1);
  assert.equal(disconnected.violations.length, 2);
});

test('human-readable CLI output includes identities, baseline, every variant, and honest pass/fail', () => {
  const pass = run(legacy), fail = run(legacy, '--max-extra-late', '0');
  assert.equal(pass.status, 0, pass.stderr); assert.equal(fail.status, 1, fail.stderr);
  assert.match(pass.stdout, /DETOURLAB \/ Four-node directed example/);
  assert.match(pass.stdout, /Clear-road baseline: 0.20 km/);
  assert.match(pass.stdout, /Supplied scenario \[supplied\]/);
  assert.match(pass.stdout, /Clear-road control \[clear-roads\]/);
  assert.match(pass.stdout, /PASS: experiment thresholds apply to every variant/);
  assert.match(fail.stdout, /FAIL: extraLateJobs 1 > 0/);
  assert.match(fail.stdout, /FAIL: experiment thresholds apply to every variant/);
  assert.match(fail.stdout, /assigned order retained \/ arrival deadlines/);
});

test('help describes legacy compatibility, exit codes, thresholds, and skipped-work caveat', () => {
  const result = run('--help'); assert.equal(result.status, 0); assert.equal(result.stderr, '');
  for (const phrase of ['--json', '--max-extra-distance-pct', '--max-extra-late', '--max-unreachable', 'Version-1 scenario', 'exit 1', 'exits 2', 'skipped']) assert.ok(result.stdout.includes(phrase), phrase);
});

test('invalid flags, duplicate thresholds, missing values, and malformed numeric bounds exit 2 without output', () => {
  const cases = [[], ['--unknown'], ['--json=1'], ['a.json', 'b.json'], ['--max-unreachable'], [legacy, '--max-extra-late', '0', '--max-extra-late', '1']];
  for (const flag of ['--max-extra-distance-pct', '--max-extra-late', '--max-unreachable']) {
    for (const value of ['', ' ', 'NaN', 'Infinity', '-Infinity', '-1', 'abc', '--json']) cases.push([legacy, flag, value]);
  }
  for (const args of cases) {
    const result = run(...args); assert.equal(result.status, 2, `args: ${JSON.stringify(args)}; ${result.stderr}`);
    assert.equal(result.stdout, ''); assert.match(result.stderr, /^DetourLab:/);
  }
});

test('missing, malformed, invalid-schema, and non-regular input files fail with exit 2', t => {
  const paths = [path.join(root, 'examples/no-such-experiment.json'), root, withFile(t, '{bad json'), withFile(t, '{}'), withFile(t, '{"format":"wrong"}')];
  for (const file of paths) {
    const result = run(file, '--json'); assert.equal(result.status, 2, result.stderr); assert.equal(result.stdout, ''); assert.match(result.stderr, /^DetourLab:/);
  }
});

test('CLI rejects oversized files and malformed UTF-8 before returning any metrics', t => {
  const oversized = withFile(t, Buffer.alloc(EXPERIMENT_LIMITS.maxBytes + 1, 0x20));
  const result = run(oversized, '--json'); assert.equal(result.status, 2); assert.equal(result.stdout, ''); assert.match(result.stderr, /2 MiB/);
  const malformed = withFile(t, Buffer.from([0xc3, 0x28]));
  const invalid = run(malformed, '--json'); assert.equal(invalid.status, 2); assert.equal(invalid.stdout, ''); assert.match(invalid.stderr, /encoded data|UTF-8/i);
  const multibyte = withFile(t, 'é'.repeat(EXPERIMENT_LIMITS.maxBytes / 2 + 1));
  assert.match(run(multibyte, '--json').stderr, /2 MiB/);
});

test('CLI accepts an exactly 2 MiB regular file and does not write back to its input', t => {
  const compact = JSON.stringify(fixture()), content = compact + ' '.repeat(EXPERIMENT_LIMITS.maxBytes - Buffer.byteLength(compact));
  const file = withFile(t, content), result = run(file, '--json');
  assert.equal(result.status, 0, result.stderr); assert.equal(parsed(result).variants.length, 2);
  assert.equal(readFileSync(file, 'utf8'), content);
});

test('a failed simulation exits 2 without publishing partial metrics', t => {
  const file = jsonFile(t, longRun(450)), result = run(file, '--json');
  assert.equal(result.status, 2, result.stderr); assert.match(result.stderr, /segments work limit/); assert.equal(result.stdout, '');
});

test('aggregate result-budget failure exits 2 without partial success even for clear-road controls', t => {
  const file = jsonFile(t, longRun(300)), result = run(file, '--json');
  assert.equal(result.status, 2, result.stderr); assert.match(result.stderr, /aggregate result limit of 500000 route segments/); assert.equal(result.stdout, '');
});

test('non-regular named pipes are rejected without blocking while waiting for a writer', { skip: process.platform === 'win32' }, t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'detourlab-experiment-pipe-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'input.fifo');
  const made = spawnSync('mkfifo', [file], { encoding: 'utf8' });
  if (made.error?.code === 'ENOENT') { t.skip('mkfifo is not installed on this platform'); return; }
  assert.equal(made.status, 0, made.stderr);
  const result = run(file, '--json');
  assert.equal(result.status, 2, String(result.error ?? result.stderr));
  assert.equal(result.stdout, ''); assert.match(result.stderr, /regular file/);
});
