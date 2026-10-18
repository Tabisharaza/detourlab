import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync, lstatSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { IMPLEMENTATION_FILES, createReportIdentity } from '../scripts/report-identity.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const example = 'examples/minimal-experiment.json';
const run = (...args) => spawnSync(process.execPath, ['scripts/report-experiment.js', ...args], {
  cwd: root, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024,
});
const input = () => JSON.parse(readFileSync(path.join(root, example), 'utf8'));
function temporary(t) {
  const parent = mkdtempSync(path.join(tmpdir(), 'detourlab-review-cli-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { parent, target: path.join(parent, 'review') };
}
function inputFile(parent, value) {
  const filename = path.join(parent, 'input.json');
  writeFileSync(filename, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
  return filename;
}
function success(result, status = 0) {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, status, result.stderr);
  assert.equal(result.stderr, '');
  return result.stdout;
}
function failure(result, pattern) {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, '', 'invalid or incomplete packets have no success output');
  assert.match(result.stderr, pattern);
  assert.ok(result.stderr.length <= 525, 'diagnostics stay bounded');
}
function packet(target) {
  assert.deepEqual(readdirSync(target).sort(), ['REVIEW.md', 'bundle.json']);
  const bundleJson = readFileSync(path.join(target, 'bundle.json'), 'utf8');
  const reviewMarkdown = readFileSync(path.join(target, 'REVIEW.md'), 'utf8');
  assert.ok(bundleJson.endsWith('\n'));
  assert.ok(reviewMarkdown.endsWith('\n'));
  const bundle = JSON.parse(bundleJson);
  assert.ok(reviewMarkdown.includes(bundle.integrity.sha256));
  return { bundle, bundleJson, reviewMarkdown };
}

test('CLI writes a complete no-policy packet and explicit not-evaluated verdict', async t => {
  const { parent, target } = temporary(t);
  const output = success(run(example, '--out', target));
  assert.match(output, /Policy: NOT EVALUATED/);
  assert.equal(output.split('\n').length, 3);
  assert.deepEqual(readdirSync(parent), ['review']);
  const { bundle } = packet(target);
  assert.equal(bundle.format, 'detourlab-experiment-report');
  assert.equal(bundle.verdict, 'not-evaluated');
  assert.deepEqual(bundle.policy, {});
  assert.equal(bundle.variants.length, 3);
  assert.deepEqual(bundle.generator, await createReportIdentity());
  assert.equal(bundle.generator.sourceRevision, null);
});

test('CLI publishes the full packet for both passing and failing policies', t => {
  const { parent } = temporary(t);
  for (const [limit, exitCode, verdict] of [['1', 0, 'passed'], ['0', 1, 'failed']]) {
    const target = path.join(parent, verdict);
    assert.match(success(run(example, '--out', target, '--max-newly-late', limit), exitCode), new RegExp(`Policy: ${verdict.toUpperCase()}`));
    const { bundle } = packet(target);
    assert.equal(bundle.verdict, verdict);
    const variant = bundle.variants.find(row => row.id === 'close-at-10');
    assert.equal(variant.verdict, verdict);
    assert.deepEqual(variant.violations, verdict === 'failed' ? [{ metric: 'newlyLateJobs', actual: 1, limit: 0 }] : []);
    assert.equal(bundle.variants.length, 3);
    assert.equal(bundle.baseline.jobs.length, 1);
  }
});

test('all five flags are canonical and repeated runs in different directories are byte-identical', t => {
  const { parent } = temporary(t);
  const pairs = [['--max-extra-distance-pct', '30'], ['--max-extra-late', '1'], ['--max-unreachable', '0'], ['--max-newly-late', '1'], ['--max-arrival-slip-s', '6']];
  const a = path.join(parent, 'a'), b = path.join(parent, 'b'), c = path.join(parent, 'c');
  success(run(example, '--out', a, ...pairs.flat()));
  success(run(...pairs.toReversed().flat(), '--out', b, example));
  success(run('--out', c, example, ...pairs.flat()));
  const first = packet(a);
  assert.deepEqual(Object.keys(first.bundle.policy), ['extraDistancePct', 'extraLateJobs', 'unreachableJobs', 'newlyLateJobs', 'maxArrivalSlipS']);
  for (const target of [b, c]) {
    const next = packet(target);
    assert.equal(next.bundleJson, first.bundleJson);
    assert.equal(next.reviewMarkdown, first.reviewMarkdown);
  }
  assert.doesNotMatch(first.bundleJson, new RegExp(parent));
});

test('legacy input is upgraded without mutating the source file', t => {
  const { parent, target } = temporary(t);
  const bytes = readFileSync(path.join(root, 'examples/minimal-directed.json'));
  const filename = inputFile(parent, bytes);
  success(run(filename, '--out', target));
  assert.deepEqual(packet(target).bundle.variants.map(row => row.id), ['supplied', 'clear-roads']);
  assert.deepEqual(readFileSync(filename), bytes);
});

test('no comparable arrivals fail closed but still publish the complete review', t => {
  const { parent, target } = temporary(t), data = input();
  data.baseScenario.jobs = [];
  success(run(inputFile(parent, data), '--out', target, '--max-arrival-slip-s', '0'), 1);
  const { bundle, reviewMarkdown } = packet(target);
  assert.equal(bundle.verdict, 'failed');
  for (const variant of bundle.variants) assert.deepEqual(variant.violations, [{ metric: 'maxArrivalSlipS', actual: null, limit: 0, reason: 'no-comparable-jobs' }]);
  assert.match(reviewMarkdown, /no comparable arrivals/iu);
});

for (const [name, args, pattern] of [
  ['missing file', ['--out', 'unused'], /file is required/],
  ['missing output', [example], /--out is required/],
  ['missing output value', [example, '--out'], /--out requires/],
  ['empty output value', [example, '--out', ''], /--out requires/],
  ['flag as output', [example, '--out', '--max-extra-late', '0'], /--out requires/],
  ['duplicate output', [example, '--out', 'a', '--out', 'b'], /--out may only/],
  ['JSON flag', [example, '--out', 'unused', '--json'], /--json is not supported/],
  ['unknown option', [example, '--out', 'unused', '--surprise'], /Unknown option/],
  ['multiple inputs', [example, example, '--out', 'unused'], /Only one input file/],
  ['output hidden inside missing threshold value', [example, '--max-newly-late', '--out', 'unused', '0'], /finite nonnegative/],
]) {
  test(`CLI rejects ${name}`, () => failure(run(...args), pattern));
}

for (const flag of ['--max-extra-distance-pct', '--max-extra-late', '--max-unreachable', '--max-newly-late', '--max-arrival-slip-s']) {
  test(`CLI shares validation and duplicate rejection for ${flag}`, () => {
    for (const value of ['', ' ', '-1', 'NaN', 'Infinity', '1e309', 'bad']) {
      failure(run(example, '--out', 'unused', flag, value), /finite nonnegative/);
    }
    failure(run(example, '--out', 'unused', flag), /finite nonnegative/);
    failure(run(example, '--out', 'unused', flag, '0', flag, '0'), /only be supplied once/);
  });
}

test('help does not read an input or create output even with invalid arguments', t => {
  const { parent, target } = temporary(t);
  const text = success(run('missing-file.json', '--surprise', '--out', target, '--json', '--help'));
  assert.match(text, /--out DIRECTORY/);
  assert.match(text, /not an atomic directory swap/);
  assert.deepEqual(readdirSync(parent), []);
});

test('invalid UTF-8, invalid JSON and oversized inputs leave no output', t => {
  const { parent, target } = temporary(t);
  for (const [bytes, pattern] of [[Buffer.from([0xc3, 0x28]), /UTF-8/], ['{', /valid JSON/], [Buffer.alloc(2 * 1024 * 1024 + 1, 0x20), /2 MiB/]]) {
    failure(run(inputFile(parent, bytes), '--out', target), pattern);
    assert.equal(existsSync(target), false);
  }
});

test('BOM and exactly 2 MiB inputs produce the same deterministic packet', t => {
  const { parent } = temporary(t), text = JSON.stringify(input());
  const plain = path.join(parent, 'plain');
  success(run(example, '--out', plain));
  const expected = packet(plain);
  const samples = [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]), Buffer.concat([Buffer.from(text), Buffer.alloc(2 * 1024 * 1024 - Buffer.byteLength(text), 0x20)])];
  samples.forEach((bytes, i) => {
    const filename = inputFile(parent, bytes), target = path.join(parent, `sample-${i}`);
    success(run(filename, '--out', target));
    assert.equal(packet(target).bundleJson, expected.bundleJson);
    assert.equal(packet(target).reviewMarkdown, expected.reviewMarkdown);
    assert.deepEqual(readFileSync(filename), bytes);
  });
});

test('input directories and unwritten named pipes are rejected promptly', t => {
  const { parent, target } = temporary(t);
  failure(run(parent, '--out', target), /regular file/);
  if (process.platform === 'win32') return;
  const pipe = path.join(parent, 'input.fifo');
  const made = spawnSync('mkfifo', [pipe], { encoding: 'utf8' });
  if (made.error?.code === 'ENOENT') return;
  assert.equal(made.status, 0, made.stderr);
  failure(run(pipe, '--out', target), /regular file/);
  assert.equal(existsSync(target), false);
});

test('CLI refuses existing file, directory and dangling symlink outputs', t => {
  const { parent } = temporary(t);
  const targets = [path.join(parent, 'file'), path.join(parent, 'directory')];
  writeFileSync(targets[0], 'keep');
  mkdirSync(targets[1]);
  try { const link = path.join(parent, 'link'); symlinkSync(path.join(parent, 'absent'), link, 'dir'); targets.push(link); }
  catch (error) { if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error; }
  for (const target of targets) {
    const original = lstatSync(target);
    failure(run(example, '--out', target), /already exists/);
    assert.equal(lstatSync(target).ino, original.ino);
  }
  assert.equal(readFileSync(targets[0], 'utf8'), 'keep');
  assert.deepEqual(readdirSync(targets[1]), []);
  assert.equal(readdirSync(parent).some(name => name.startsWith('.detourlab-review-')), false);
});

test('missing output parent is not created', t => {
  const { parent } = temporary(t), missing = path.join(parent, 'missing');
  failure(run(example, '--out', path.join(missing, 'packet')), /ENOENT/);
  assert.equal(existsSync(missing), false);
});

test('human output escapes path controls and does not echo untrusted labels', t => {
  const { parent } = temporary(t), target = path.join(parent, 'review\nFAKE\u202e'), data = input();
  data.name = 'FAKE\nPASS\u202e';
  const output = success(run(inputFile(parent, data), '--out', target));
  assert.equal(output.split('\n').length, 3);
  assert.match(output, /review\\u000aFAKE\\u202e/);
  assert.doesNotMatch(output, /[\r\u202e]/u);
  assert.equal(packet(target).bundle.experiment.name, data.name);
});

test('hostile errors remain bounded and escaped', t => {
  const { parent, target } = temporary(t), data = input();
  data['bad\n\u202e' + 'a'.repeat(6000)] = true;
  const result = run(inputFile(parent, data), '--out', target);
  failure(result, /unsupported property/);
  assert.match(result.stderr, /\\u000a\\u202e/);
  assert.doesNotMatch(result.stderr.slice(0, -1), /[\r\n\u202e]/u);
  assert.equal(existsSync(target), false);
});

test('implementation fingerprint uses documented framing and complete local runtime coverage', async () => {
  const identity = await createReportIdentity();
  const hash = createHash('sha256').update('detourlab-report-implementation-v1\0');
  for (const filename of IMPLEMENTATION_FILES) {
    const bytes = readFileSync(path.join(root, filename));
    hash.update(`${Buffer.byteLength(filename, 'utf8')}:${filename}\0${bytes.length}:`).update(bytes).update('\0');
    if (!filename.endsWith('.js')) continue;
    for (const match of bytes.toString('utf8').matchAll(/^import[^\n]*?(?:from\s+|import\s*)['"]([.][^'"]+)['"]/gmu)) {
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(filename), match[1]));
      assert.ok(IMPLEMENTATION_FILES.includes(dependency), `${filename} dependency ${dependency} must be fingerprinted`);
    }
  }
  assert.equal(identity.implementation.sha256, hash.digest('hex'));
  assert.equal(identity.sourceRevision, null);
  assert.equal(identity.reportVersion, 1);
  assert.equal(identity.name, 'detourlab');
  assert.deepEqual(identity.implementation.files, IMPLEMENTATION_FILES);
});

test('fingerprint is independent of checkout path and responds to every covered source file', async t => {
  const { parent } = temporary(t);
  for (const filename of IMPLEMENTATION_FILES) {
    const destination = path.join(parent, filename);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(path.join(root, filename)));
  }
  const sourceRoot = pathToFileURL(parent + path.sep);
  const expected = await createReportIdentity();
  assert.deepEqual(await createReportIdentity(sourceRoot), expected);
  for (const filename of IMPLEMENTATION_FILES) {
    const destination = path.join(parent, filename), bytes = readFileSync(destination);
    writeFileSync(destination, Buffer.concat([bytes, Buffer.from('\n')]));
    assert.notEqual((await createReportIdentity(sourceRoot)).implementation.sha256, expected.implementation.sha256, filename);
    writeFileSync(destination, bytes);
  }
  assert.deepEqual(await createReportIdentity(sourceRoot), expected);
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
  test(`CLI preserves simulation budgets for ${count} long-route jobs with no partial output`, t => {
    const { parent, target } = temporary(t);
    failure(run(inputFile(parent, longRun(count)), '--out', target), pattern);
    assert.equal(existsSync(target), false);
    assert.deepEqual(readdirSync(parent), ['input.json']);
  });
}

test('CLI rejects an oversized complete Markdown review before creating a directory', t => {
  const { parent, target } = temporary(t), data = input();
  data.variants[1].closures = Array.from({ length: 2500 }, (_, i) => ({ id: `c${i}${'.'.repeat(80)}`, edgeIds: ['bc'], atS: 10 }));
  assert.ok(Buffer.byteLength(JSON.stringify(data)) < 2 * 1024 * 1024);
  failure(run(inputFile(parent, data), '--out', target), /review exceeds the 1 MiB limit/);
  assert.equal(existsSync(target), false);
  assert.deepEqual(readdirSync(parent), ['input.json']);
});

test('CLI rejects an oversized complete JSON bundle without truncation or output', t => {
  const { parent, target } = temporary(t), data = input(), nodeId = 'n'.repeat(96), vehicleId = 'v'.repeat(96);
  data.baseScenario.nodes = [{ id: nodeId, x: 0, y: 0 }];
  data.baseScenario.edges = [];
  data.baseScenario.vehicles = [{ id: vehicleId, startNode: nodeId, startTimeS: 0 }];
  data.baseScenario.jobs = Array.from({ length: 2000 }, (_, i) => ({
    id: `j${String(i).padStart(4, '0')}${'j'.repeat(91)}`, nodeId, vehicleId, dueTimeS: 22, serviceTimeS: 3,
  }));
  data.variants = Array.from({ length: 6 }, (_, i) => ({ id: `v${i}`, name: `Variant ${i}`, closures: [] }));
  assert.ok(Buffer.byteLength(JSON.stringify(data)) < 2 * 1024 * 1024);
  failure(run(inputFile(parent, data), '--out', target), /bundle exceeds the 8 MiB limit/);
  assert.equal(existsSync(target), false);
  assert.deepEqual(readdirSync(parent), ['input.json']);
});
