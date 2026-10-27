import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createExperimentReport, serializeExperimentReport, REPORT_LIMITS } from '../scripts/experiment-report.js';
import { createReportIdentity } from '../scripts/report-identity.js';
import { canonicalReport, renderReview } from '../src/experiment-report.js';
import { createBrowserReview } from '../src/browser-review.js';
import { simulateExperiment } from '../src/experiment.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = () => JSON.parse(readFileSync(path.join(root, 'examples/minimal-experiment.json'), 'utf8'));
const identity = await createReportIdentity();
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const run = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts/verify-review.js'), ...args], {
  cwd: root, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024,
});

function temporary(t) {
  const parent = mkdtempSync(path.join(tmpdir(), 'detourlab-verify-review-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return parent;
}
function save(directory, files) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'bundle.json'), files.bundleJson);
  writeFileSync(path.join(directory, 'REVIEW.md'), files.reviewMarkdown);
}
function packet(t, policy = {}, generator = identity, input = fixture()) {
  const directory = temporary(t);
  const bundle = createExperimentReport(input, policy, generator);
  const files = serializeExperimentReport(bundle);
  save(directory, files);
  return { directory, bundle, files };
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
  assert.equal(result.stdout, '', 'no success data for an unverified packet');
  assert.match(result.stderr, pattern);
  assert.ok(result.stderr.length <= 525);
  assert.doesNotMatch(result.stderr.slice(0, -1), /[\r\n\u202e]/u);
}
function reseal(bundle) {
  const { integrity, ...payload } = bundle;
  bundle.integrity = { algorithm: 'sha256', sha256: hash(canonicalReport(payload)) };
  bundle.integrity.reviewSha256 = hash(renderReview(bundle));
  return serializeExperimentReport(bundle);
}

test('one command verifies the existing checked-in packet without changing any bytes', () => {
  const directory = path.join(root, 'docs/examples/tiny-review');
  const before = ['bundle.json', 'REVIEW.md'].map(file => readFileSync(path.join(directory, file)));
  const output = success(run(directory));
  assert.match(output, /Exact packet reproduction verified/);
  assert.match(output, /Policy: PASSED/);
  assert.match(output, /not signatures/);
  assert.deepEqual(['bundle.json', 'REVIEW.md'].map(file => readFileSync(path.join(directory, file))), before);
});

for (const [name, policy, verdict, status] of [
  ['absent', {}, 'not-evaluated', 0],
  ['passing equality', { maxArrivalSlipS: 6 }, 'passed', 0],
  ['failing', { newlyLateJobs: 0 }, 'failed', 1],
]) {
  test(`exact verification keeps ${name} policy separate from reproducibility`, t => {
    const { directory, bundle, files } = packet(t, policy);
    const output = JSON.parse(success(run(directory, '--json'), status));
    assert.deepEqual(output, {
      format: 'detourlab-review-verification', version: 1, verified: true,
      mode: 'exact-implementation', implementationMatched: true,
      experimentSha256: bundle.experimentSha256, policySha256: bundle.policySha256,
      policyVerdict: verdict, authenticity: 'not-established',
    });
    assert.match(success(run(directory), status), new RegExp(`Policy: ${verdict.toUpperCase().replace('-', ' ')}`));
    assert.equal(readFileSync(path.join(directory, 'bundle.json'), 'utf8'), files.bundleJson);
    assert.equal(readFileSync(path.join(directory, 'REVIEW.md'), 'utf8'), files.reviewMarkdown);
    assert.deepEqual(readdirSync(directory).sort(), ['REVIEW.md', 'bundle.json']);
  });
}

test('no-comparable-jobs policy failure remains exit 1 after verification in either mode', t => {
  const input = fixture();
  input.baseScenario.jobs = [];
  const { directory } = packet(t, { maxArrivalSlipS: 0 }, identity, input);
  for (const flags of [[], ['--compare-outcomes']]) {
    const result = JSON.parse(success(run(directory, '--json', ...flags), 1));
    assert.equal(result.policyVerdict, 'failed');
    assert.equal(result.verified, true);
  }
});

test('actual browser-generated bytes require explicit outcome comparison and remain unauthenticated', async t => {
  const directory = temporary(t), input = fixture();
  save(directory, await createBrowserReview(input, simulateExperiment(input)));
  failure(run(directory), /Unknown or mismatched implementation fingerprint/);
  const result = JSON.parse(success(run('--compare-outcomes', directory, '--json')));
  assert.equal(result.mode, 'outcomes-only');
  assert.equal(result.implementationMatched, false);
  assert.equal(result.policyVerdict, 'not-evaluated');
  assert.equal(result.authenticity, 'not-established');
  const text = success(run(directory, '--compare-outcomes'));
  assert.match(text, /original implementation remains unverified/);
  assert.doesNotMatch(text, /Exact packet/);
});

test('mismatched source identity is never silently downgraded, and comparison does not imply a policy pass', t => {
  const claimed = structuredClone(identity);
  claimed.implementation.sha256 = '0'.repeat(64);
  const { directory } = packet(t, { newlyLateJobs: 0 }, claimed);
  failure(run(directory, '--json'), /Unknown or mismatched implementation fingerprint/);
  const result = JSON.parse(success(run(directory, '--compare-outcomes', '--json'), 1));
  assert.equal(result.implementationMatched, false);
  assert.equal(result.policyVerdict, 'failed');
});

test('outcome mode stays explicit even when implementation identity happens to match', t => {
  const { directory } = packet(t);
  const result = JSON.parse(success(run(directory, '--compare-outcomes', '--json')));
  assert.equal(result.mode, 'outcomes-only');
  assert.equal(result.implementationMatched, true);
});

test('fingerprint comparison includes the ordered source allowlist, not just its hash string', t => {
  const generator = structuredClone(identity);
  generator.implementation.files.reverse();
  const { directory } = packet(t, {}, generator);
  failure(run(directory), /Unknown or mismatched implementation fingerprint/);
});

test('supplied source revision and generator metadata are not authenticated even in exact mode', t => {
  const generator = { ...identity, sourceRevision: 'a'.repeat(40), name: 'CLAIM\n\u202e' };
  const { directory } = packet(t, {}, generator);
  const result = JSON.parse(success(run(directory, '--json')));
  assert.equal(result.authenticity, 'not-established');
  assert.doesNotMatch(success(run(directory)), /CLAIM/);
});

for (const [name, mutate] of [
  ['delivery arrival', bundle => { bundle.variants[1].jobs[0].arrivalS += 1; }],
  ['aggregate metrics', bundle => { bundle.baseline.metrics.distanceM += 1; }],
  ['policy verdict', bundle => { bundle.verdict = 'passed'; }],
  ['variant omission', bundle => { bundle.variants.pop(); }],
  ['job omission', bundle => { bundle.variants[1].jobs = []; }],
  ['experiment fingerprint', bundle => { bundle.experimentSha256 = '0'.repeat(64); }],
  ['policy fingerprint', bundle => { bundle.policySha256 = '0'.repeat(64); }],
  ['assumption omission', bundle => { bundle.assumptions.pop(); }],
]) {
  test(`recomputed evidence rejects self-consistent tampering with ${name} in both modes`, t => {
    const { directory, bundle } = packet(t);
    mutate(bundle);
    save(directory, reseal(bundle));
    for (const flags of [[], ['--compare-outcomes']]) failure(run(directory, ...flags), /bundle.json differs/);
  });
}

test('all machine rows are checked, including unchanged jobs omitted from the readable exceptions', t => {
  const input = fixture();
  input.baseScenario.jobs = Array.from({ length: 25 }, (_, i) => ({ ...input.baseScenario.jobs[0], id: `job-${i}`, dueTimeS: 1000 }));
  const { directory, bundle } = packet(t, {}, identity, input);
  bundle.variants[0].jobs[24].completedS += 1;
  save(directory, reseal(bundle));
  failure(run(directory, '--compare-outcomes'), /bundle.json differs/);
});

for (const file of ['bundle.json', 'REVIEW.md']) {
  test(`changed ${file} bytes, BOM, line endings and mixed packets never verify`, t => {
    const { directory, files } = packet(t);
    const original = file === 'bundle.json' ? files.bundleJson : files.reviewMarkdown;
    for (const changed of [original + '\n', '\ufeff' + original, original.replaceAll('\n', '\r\n')]) {
      save(directory, files);
      writeFileSync(path.join(directory, file), changed);
      failure(run(directory, '--compare-outcomes'), new RegExp(`${file.replace('.', '\\.')}( differs| must)`));
    }
    const other = serializeExperimentReport(createExperimentReport(fixture(), { newlyLateJobs: 0 }, identity));
    save(directory, files);
    writeFileSync(path.join(directory, file), file === 'bundle.json' ? other.bundleJson : other.reviewMarkdown);
    failure(run(directory), /REVIEW.md differs/);
  });

  test(`${file} malformed UTF-8 and excessive byte counts are rejected`, t => {
    const { directory, files } = packet(t);
    const limit = file === 'bundle.json' ? REPORT_LIMITS.maxBundleBytes : REPORT_LIMITS.maxReviewBytes;
    writeFileSync(path.join(directory, file), Buffer.from([0xc3, 0x28]));
    failure(run(directory), /valid UTF-8/);
    writeFileSync(path.join(directory, file), Buffer.alloc(limit + 1, 0x20));
    failure(run(directory), /byte limit/);
    save(directory, files);
    const original = Buffer.from(file === 'bundle.json' ? files.bundleJson : files.reviewMarkdown);
    writeFileSync(path.join(directory, file), Buffer.concat([original, Buffer.alloc(limit - original.length, 0x20)]));
    failure(run(directory), /differs/, 'exact byte limit is read but noncanonical contents cannot pass');
  });

  test(`${file} must exist and be a regular non-symlink file; unwritten pipes do not hang`, t => {
    const { directory, files } = packet(t), filename = path.join(directory, file);
    rmSync(filename);
    failure(run(directory), /ENOENT/);
    mkdirSync(filename);
    failure(run(directory), /regular file/);
    rmSync(filename, { recursive: true });
    const elsewhere = path.join(temporary(t), 'input');
    writeFileSync(elsewhere, file === 'bundle.json' ? files.bundleJson : files.reviewMarkdown);
    try {
      symlinkSync(elsewhere, filename);
      failure(run(directory), /symbolic link/);
      rmSync(filename);
    } catch (error) { if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error; }
    if (process.platform !== 'win32') {
      const made = spawnSync('mkfifo', [filename], { encoding: 'utf8' });
      if (made.error?.code !== 'ENOENT') {
        assert.equal(made.status, 0, made.stderr);
        failure(run(directory), /regular file/);
      }
    }
  });
}

test('a symlink packet root is rejected and unrelated entries are neither read nor changed', t => {
  const { directory } = packet(t), parent = temporary(t), link = path.join(parent, 'packet');
  writeFileSync(path.join(directory, 'unrelated.txt'), 'keep');
  success(run(directory));
  assert.equal(readFileSync(path.join(directory, 'unrelated.txt'), 'utf8'), 'keep');
  try {
    symlinkSync(directory, link, 'dir');
    for (const suffix of ['', path.sep, path.sep + '.']) failure(run(link + suffix), /real directory/);
  } catch (error) { if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error; }
});

for (const [name, args, pattern] of [
  ['missing directory', [], /directory is required/],
  ['multiple directories', ['one', 'two'], /Only one packet directory/],
  ['empty directory', [''], /directory is required/],
  ['unknown flag', ['--surprise'], /Unknown option/],
  ['duplicate comparison flag', ['x', '--compare-outcomes', '--compare-outcomes'], /only be supplied once/],
  ['duplicate JSON flag', ['x', '--json', '--json'], /only be supplied once/],
  ['threshold override', ['x', '--max-newly-late', '100'], /Unknown option/],
]) test(`CLI rejects ${name}`, () => failure(run(...args), pattern));

test('help ignores invalid arguments without reading anything', () => {
  const text = success(run('missing', '--surprise', '--help'));
  assert.match(text, /--compare-outcomes/);
  assert.match(text, /Exit 1.*failed/);
});

for (const value of ['{', 'null', '[]', '{}', '{"format":"other","version":1}', '{"format":"detourlab-experiment-report","version":2}']) {
  test(`invalid packet envelope ${value} fails without success output`, t => {
    const { directory } = packet(t);
    writeFileSync(path.join(directory, 'bundle.json'), value);
    failure(run(directory), /valid JSON|format or version/);
  });
}

test('deep untrusted extraneous data is not recursively hashed or rendered', t => {
  const { directory, files } = packet(t);
  writeFileSync(path.join(directory, 'bundle.json'), files.bundleJson.trimEnd().slice(0, -1) + ',"extra":' + '['.repeat(30000) + '0' + ']'.repeat(30000) + '}\n');
  failure(run(directory, '--compare-outcomes'), /bundle.json differs/);
});

test('embedded input and policy must pass authoritative validators before simulation', t => {
  const { directory, bundle } = packet(t);
  bundle.policy.newlyLateJobs = -1;
  writeFileSync(path.join(directory, 'bundle.json'), JSON.stringify(bundle));
  failure(run(directory, '--compare-outcomes'), /nonnegative/);
  bundle.policy = {};
  bundle.experiment.baseScenario.edges[0].to = 'missing';
  writeFileSync(path.join(directory, 'bundle.json'), JSON.stringify(bundle));
  failure(run(directory, '--compare-outcomes'), /unknown id/);
});

test('generator paths are validated claims, never files selected for reading', t => {
  const { directory, bundle } = packet(t);
  bundle.generator.implementation.files = ['../../private'];
  writeFileSync(path.join(directory, 'bundle.json'), JSON.stringify(bundle));
  failure(run(directory, '--compare-outcomes'), /safe relative file paths/);
  bundle.generator.implementation.files = ['not-present.js'];
  save(directory, reseal(bundle));
  const result = JSON.parse(success(run(directory, '--compare-outcomes', '--json')));
  assert.equal(result.implementationMatched, false);
});

test('both modes reject duplicate JSON keys even if the effective object matches', t => {
  const { directory, files } = packet(t);
  writeFileSync(path.join(directory, 'bundle.json'), files.bundleJson.replace('"version": 1,', '"version": 999,\n  "version": 1,'));
  for (const flags of [[], ['--compare-outcomes']]) failure(run(directory, ...flags), /bundle.json differs/);
});

test('six variants and fractional arrival/service times retain literal report precision', t => {
  const input = fixture();
  input.baseScenario.edges.forEach((edge, index) => { edge.travelTimeS = (index + 1) / 10; });
  input.baseScenario.jobs[0].serviceTimeS = 0.123456789;
  input.variants = Array.from({ length: 6 }, (_, i) => ({ ...input.variants[i % 3], id: `v${i}` }));
  const { directory } = packet(t, { newlyLateJobs: 0, maxArrivalSlipS: 0, unreachableJobs: 0 }, identity, input);
  for (const flags of [[], ['--compare-outcomes']]) success(run(directory, ...flags));
});

test('coherent replacement input and policy can verify, because hashes do not authenticate an original sender', t => {
  const input = fixture();
  input.name = 'Different valid experiment';
  input.baseScenario.jobs[0].dueTimeS = 1000;
  const { directory } = packet(t, { newlyLateJobs: 0 }, identity, input);
  const result = JSON.parse(success(run(directory, '--json')));
  assert.equal(result.policyVerdict, 'passed');
  assert.equal(result.authenticity, 'not-established');
});

test('hostile filesystem diagnostics remain short, one-line and escaped', () => {
  failure(run('missing\n\u202e' + 'x'.repeat(5000)), /DetourLab:/);
});
