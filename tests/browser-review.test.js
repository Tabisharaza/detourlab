import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createBrowserReview, BROWSER_REPORT_GENERATOR } from '../src/browser-review.js';
import { canonicalExperiment, experimentFromScenario, simulateExperiment, validateExperiment } from '../src/experiment.js';
import { createDemoScenario } from '../src/scenario.js';
import { canonicalReport, projectExperimentReport, renderReview, serializeReportFiles, REPORT_LIMITS } from '../src/experiment-report.js';
import { copyCompletedResults } from '../src/report-results.js';
import { createExperimentReport, serializeExperimentReport } from '../scripts/experiment-report.js';
import { projectJobOutcomes as browserProjection } from '../src/job-impact.js';
import { projectJobOutcomes as cliProjection } from '../scripts/job-impact.js';
import * as browserGates from '../src/job-gates.js';
import * as cliGates from '../scripts/job-gates.js';

const fixture = (name = 'minimal-experiment.json') => JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

function isolatedBrowser(crypto) {
  const source = readFileSync(new URL('../src/browser-review.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  return new Function('canonicalExperiment', 'validateExperiment', 'canonicalReport', 'projectExperimentReport', 'renderReview', 'serializeReportFiles', 'copyCompletedResults', 'globalThis', `${source}\nreturn createBrowserReview;`)(
    canonicalExperiment, validateExperiment, canonicalReport, projectExperimentReport, renderReview, serializeReportFiles, copyCompletedResults, { crypto },
  );
}

test('browser and CLI use the very same job projection and gates', () => {
  assert.equal(browserProjection, cliProjection);
  for (const key of Object.keys(browserGates)) assert.equal(browserGates[key], cliGates[key]);
});

test('browser packet matches CLI bytes under the explicit browser identity for tiny and Meridian inputs', async () => {
  for (const name of ['minimal-experiment.json', 'meridian-experiment.json']) {
    const input = fixture(name), completed = simulateExperiment(input);
    const files = await createBrowserReview(input, completed);
    const cli = createExperimentReport(input, {}, BROWSER_REPORT_GENERATOR);
    assert.deepEqual(files, serializeExperimentReport(cli));
    const bundle = JSON.parse(files.bundleJson), { integrity, ...payload } = bundle;
    assert.equal(bundle.experimentSha256, hash(canonicalExperiment(input)));
    assert.equal(bundle.policySha256, hash('{}'));
    assert.deepEqual(integrity, { algorithm: 'sha256', sha256: hash(canonicalReport(payload)), reviewSha256: hash(files.reviewMarkdown) });
    assert.equal(bundle.generator.sourceRevision, null);
    assert.equal(bundle.generator.implementation, null);
    assert.equal(bundle.generator.name, 'detourlab-browser');
    assert.equal(bundle.verdict, 'not-evaluated');
    assert.deepEqual(bundle.policy, {});
    for (const variant of bundle.variants) {
      assert.equal(variant.verdict, 'not-evaluated');
      assert.deepEqual(variant.violations, []);
      assert.deepEqual(variant.gateEvaluations, []);
      assert.equal(variant.jobs.length, input.baseScenario.jobs.length);
    }
    assert.match(files.reviewMarkdown, /no verified implementation fingerprint/);
    assert.match(files.reviewMarkdown, /does not claim exact CLI reproduction/);
    assert.doesNotMatch(files.reviewMarkdown, /Exact packet reproduction verified/);
  }
});

test('the real demo and literal floating-point service times export without reclassification or rounding', async () => {
  const floating = fixture();
  const times = { ab: 0.1, bc: 0.2, bd: 0.123456789, dc: 0.234567891 };
  floating.baseScenario.edges.forEach(edge => { edge.travelTimeS = times[edge.id]; });
  floating.baseScenario.jobs[0].dueTimeS = 0.3;
  floating.baseScenario.jobs[0].serviceTimeS = 0.123456789;
  floating.variants[1].closures[0].atS = 0.1;
  for (const input of [experimentFromScenario(createDemoScenario(42)), floating]) {
    const completed = simulateExperiment(input);
    assert.deepEqual(await createBrowserReview(input, completed), serializeExperimentReport(createExperimentReport(input, {}, BROWSER_REPORT_GENERATOR)));
  }
  const bundle = JSON.parse((await createBrowserReview(floating, simulateExperiment(floating))).bundleJson);
  assert.equal(bundle.baseline.jobs[0].status, 'on-time');
  assert.ok(bundle.baseline.jobs[0].arrivalS > bundle.baseline.jobs[0].dueTimeS);
  assert.equal(bundle.variants[1].jobs[0].arrivalDeltaS, 0.1 + 0.123456789 + 0.234567891 - (0.1 + 0.2));
});

test('export consumes completed results without rerunning, mutating or requiring route segments', async () => {
  const input = fixture(), completed = simulateExperiment(input);
  const expected = await createBrowserReview(input, completed);
  // simulateExperiment must clone its clear-road control; export never needs to.
  const originalClone = globalThis.structuredClone;
  globalThis.structuredClone = () => { throw new Error('Unexpected simulation clone'); };
  try {
    freeze(input); freeze(completed);
    assert.deepEqual(await createBrowserReview(input, completed), expected);
  } finally { globalThis.structuredClone = originalClone; }
  const withoutRoutes = originalClone(completed);
  for (const run of [withoutRoutes.baseline, ...withoutRoutes.variants.map(variant => variant.result)]) {
    for (const vehicle of run.vehicles) {
      // Those fields are not report inputs; the Worker already enforced the
      // routing-work/segment budgets before returning the completed result.
      vehicle.segments = null;
      vehicle.reroutes = null;
    }
  }
  assert.deepEqual(await createBrowserReview(input, withoutRoutes), expected);
});

test('export snapshots its input and ledgers synchronously before Web Crypto yields', async () => {
  const input = fixture(), completed = simulateExperiment(input);
  const expected = await createBrowserReview(input, completed);
  const pending = createBrowserReview(input, completed);
  input.name = 'Changed after click';
  completed.baseline.metrics.distanceM = 999;
  completed.variants[1].result.vehicles[0].jobs[0].arrivalS = 999;
  assert.deepEqual(await pending, expected);
});

test('Web Crypto is the sole browser hashing provider and unavailable crypto fails explicitly', async () => {
  const input = fixture(), completed = simulateExperiment(input), calls = [];
  const crypto = { subtle: { digest(algorithm, bytes) { calls.push(algorithm); return globalThis.crypto.subtle.digest(algorithm, bytes); } } };
  assert.deepEqual(await isolatedBrowser(crypto)(input, completed), await createBrowserReview(input, completed));
  assert.deepEqual(calls, ['SHA-256', 'SHA-256', 'SHA-256', 'SHA-256']);
  await assert.rejects(isolatedBrowser(undefined)(input, completed), /requires Web Crypto in a secure browser context/);
  for (const file of ['browser-review.js', 'experiment-report.js', 'report-results.js', 'job-impact.js', 'job-gates.js']) {
    // Node code printed inside the Markdown rerun instructions is just text.
    assert.doesNotMatch(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), /^import .*from ['"]node:|^\s*(?:const|let|return|if)\b.*\bBuffer\b/m);
  }
});

test('repeated export is byte-deterministic and Worker transport IDs do not enter the report', async () => {
  const input = fixture(), completed = simulateExperiment(input);
  const first = await createBrowserReview(input, completed);
  assert.deepEqual(await createBrowserReview(input, { id: 872, ...completed }), first);
  assert.deepEqual(await createBrowserReview(input, completed), first);
  assert.ok(first.bundleJson.endsWith('\n') && !first.bundleJson.endsWith('\n\n'));
  assert.ok(first.reviewMarkdown.endsWith('\n') && !first.reviewMarkdown.endsWith('\n\n'));
});

test('mismatched, missing, duplicate and reassigned ledgers reject the whole browser packet', async () => {
  const input = fixture(), original = simulateExperiment(input);
  for (const mutate of [
    value => { value.variants.pop(); },
    value => { value.variants.reverse(); },
    value => { value.variants[1].id = 'other'; },
    value => { value.variants[1].name = 'other'; },
    value => { value.baseline.vehicles[0].id = 'other'; },
    value => { value.variants[1].result.vehicles[0].jobs[0].id = 'other'; },
    value => { value.variants[1].result.vehicles[0].jobs[0].nodeId = 'other'; },
    value => { value.variants[1].result.vehicles[0].jobs[0].dueTimeS += 1; },
    value => { value.variants[1].result.vehicles[0].jobs.pop(); },
    value => { value.variants[1].result.vehicles[0].jobs.push(value.variants[1].result.vehicles[0].jobs[0]); },
    value => { value.variants[1].result.vehicles.push(value.variants[1].result.vehicles[0]); },
    value => { value.variants[1].result.metrics.totalJobs += 1; },
    value => { value.variants[1].result.metrics.lateJobs = 0; },
    value => { value.variants[1].delta.distanceM += 1; },
    value => { value.variants[1].delta.extraDistancePct += 1; },
  ]) {
    const changed = structuredClone(original); mutate(changed);
    await assert.rejects(createBrowserReview(input, changed), /Completed results/);
  }
  const two = fixture(), job = two.baseScenario.jobs[0];
  two.baseScenario.vehicles.push({ ...two.baseScenario.vehicles[0], id: 'van-2' });
  two.baseScenario.jobs.push({ ...job, id: 'job-2', vehicleId: 'van-2' });
  const duplicate = simulateExperiment(two);
  duplicate.variants[1].result.vehicles[1].jobs[0].id = job.id;
  await assert.rejects(createBrowserReview(two, duplicate), /matching unique job/);
});

test('all reported metrics, deltas and reachable timing fields must be finite', async () => {
  const input = fixture(), original = simulateExperiment(input);
  for (const invalid of [NaN, Infinity, -Infinity, '0', null]) {
    for (const field of Object.keys(original.baseline.metrics)) {
      const bad = structuredClone(original); bad.baseline.metrics[field] = invalid;
      await assert.rejects(createBrowserReview(input, bad), /finite/);
    }
    for (const field of Object.keys(original.variants[0].delta)) {
      const bad = structuredClone(original); bad.variants[0].delta[field] = invalid;
      await assert.rejects(createBrowserReview(input, bad), /finite/);
    }
    for (const field of ['arrivalS', 'completedS']) {
      const bad = structuredClone(original); bad.baseline.vehicles[0].jobs[0][field] = invalid;
      await assert.rejects(createBrowserReview(input, bad), /finite/);
    }
  }
  const bad = structuredClone(original);
  bad.baseline.vehicles[0].jobs[0].completedS += 1;
  await assert.rejects(createBrowserReview(input, bad), /completion timing/);
});

test('completed-result accessors, prototype overrides, holes and unknown fields are never executed', async () => {
  const input = fixture(), original = simulateExperiment(input);
  let invoked = 0;
  const malformed = [
    value => { Object.defineProperty(value.baseline.metrics, 'distanceM', { get() { invoked += 1; return 200; } }); },
    value => { Object.defineProperty(value.variants, '0', { get() { invoked += 1; return original.variants[0]; } }); },
    value => { value.baseline.vehicles[0].jobs[0].toJSON = () => { invoked += 1; return {}; }; },
    value => { value.baseline.vehicles[0].jobs[0].status = { toString() { invoked += 1; return 'on-time'; } }; },
    value => { Object.setPrototypeOf(value.baseline.metrics, { inherited: true }); },
    value => { delete value.variants[0]; },
  ];
  for (const mutate of malformed) {
    const bad = structuredClone(original); mutate(bad);
    await assert.rejects(createBrowserReview(input, bad), /Completed results/);
  }
  assert.equal(invoked, 0);
});

test('skipped-work warnings, unreachable nulls and empty demand preserve the CLI contract', async () => {
  for (const empty of [false, true]) {
    const input = fixture();
    input.baseScenario.edges = [];
    input.variants.forEach(variant => { variant.closures = []; });
    if (empty) input.baseScenario.jobs = [];
    const files = await createBrowserReview(input, simulateExperiment(input));
    assert.deepEqual(files, serializeExperimentReport(createExperimentReport(input, {}, BROWSER_REPORT_GENERATOR)));
    const report = JSON.parse(files.bundleJson);
    assert.equal(report.warnings.length, empty ? 0 : input.variants.length + 1);
    for (const variant of report.variants) {
      assert.equal(variant.jobComparison.maxArrivalSlipS, null);
      if (!empty) for (const field of ['arrivalS', 'completedS', 'delayS', 'arrivalDeltaS', 'completedDeltaS', 'delayDeltaS']) assert.equal(variant.jobs[0][field], null);
    }
  }
});

test('hostile labels stay literal in JSON and escaped in Markdown, never in rerun code', async () => {
  const input = fixture();
  const hostile = '<script>x</script> [link](https://bad.invalid) `code`\n# heading\u202e';
  input.name = hostile;
  input.baseScenario.description = hostile;
  input.variants[1].name = hostile;
  const files = await createBrowserReview(input, simulateExperiment(input));
  assert.equal(JSON.parse(files.bundleJson).experiment.name, hostile);
  assert.doesNotMatch(files.reviewMarkdown, /<script>|\[link\]\(|^# heading|\u202e/mu);
  assert.match(files.reviewMarkdown, /&#60;script&#62;/);
  assert.match(files.reviewMarkdown, /&#92;u202e/);
  const shell = files.reviewMarkdown.split('```sh\n')[1].split('\n```')[0];
  assert.doesNotMatch(shell, /bad\.invalid|heading|<script>/);
});

test('browser hashes detect payload and review tampering in the shared CLI verifier', async () => {
  const input = fixture();
  const files = await createBrowserReview(input, simulateExperiment(input)), bundle = JSON.parse(files.bundleJson);
  assert.deepEqual(serializeExperimentReport(bundle), files);
  const payload = structuredClone(bundle); payload.variants[0].metrics.distanceM += 1;
  assert.throws(() => serializeExperimentReport(payload), /payload integrity does not match/);
  const review = structuredClone(bundle); review.integrity.reviewSha256 = '0'.repeat(64);
  assert.throws(() => serializeExperimentReport(review), /review integrity does not match/);
});

test('valid bounded inputs exceeding either complete-file budget reject without truncation', async () => {
  const closures = fixture();
  closures.variants[1].closures = Array.from({ length: 2500 }, (_, i) => ({ id: `c${i}${'.'.repeat(80)}`, edgeIds: ['bc'], atS: 10 }));
  await assert.rejects(createBrowserReview(closures, simulateExperiment(closures)), /review exceeds the 1 MiB limit/);
  const jobs = fixture(), nodeId = 'n'.repeat(96), vehicleId = 'v'.repeat(96);
  Object.assign(jobs.baseScenario, {
    nodes: [{ id: nodeId, x: 0, y: 0 }], edges: [], vehicles: [{ id: vehicleId, startNode: nodeId, startTimeS: 0 }],
    jobs: Array.from({ length: 2000 }, (_, i) => ({ id: `j${String(i).padStart(4, '0')}${'x'.repeat(91)}`, nodeId, vehicleId, dueTimeS: 0, serviceTimeS: 0 })),
  });
  jobs.variants = Array.from({ length: 6 }, (_, i) => ({ id: `v${i}`, name: `Variant ${i}`, closures: [] }));
  await assert.rejects(createBrowserReview(jobs, simulateExperiment(jobs)), /bundle exceeds the 8 MiB limit/);
  assert.equal(REPORT_LIMITS.maxBundleBytes, 8 * 1024 * 1024);
  assert.equal(REPORT_LIMITS.maxReviewBytes, 1024 * 1024);
});

test('browser rerun instructions execute read-only and reject altered packet files', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'detourlab-browser-rerun-'));
  try {
    symlinkSync(fileURLToPath(new URL('../scripts', import.meta.url)), path.join(directory, 'scripts'), 'dir');
    mkdirSync(path.join(directory, 'review-packet'));
    const input = fixture(), files = await createBrowserReview(input, simulateExperiment(input));
    const shell = files.reviewMarkdown.split('```sh\n')[1].split('\n```')[0];
    const code = shell.slice("node --input-type=module -e '\n".length, -2);
    const run = () => spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: directory, encoding: 'utf8', timeout: 10000 });
    const save = (json = files.bundleJson, review = files.reviewMarkdown) => {
      writeFileSync(path.join(directory, 'review-packet/bundle.json'), json);
      writeFileSync(path.join(directory, 'review-packet/REVIEW.md'), review);
    };
    save();
    const valid = run();
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /Outcome comparison agrees.*browser implementation remains unverified/);
    assert.doesNotMatch(valid.stdout, /Exact packet reproduction verified/);
    const bad = JSON.parse(files.bundleJson); bad.variants[1].jobs[0].arrivalS += 1;
    save(`${JSON.stringify(bad, null, 2)}\n`);
    assert.match(run().stderr, /payload integrity does not match/);
    save(files.bundleJson, `${files.reviewMarkdown}edited\n`);
    assert.match(run().stderr, /Saved packet bytes differ/);
    save(Buffer.alloc(REPORT_LIMITS.maxBundleBytes + 1, 32));
    assert.match(run().stderr, /exceeds byte limit/);
    save(Buffer.from([0xc3, 0x28]));
    assert.match(run().stderr, /not valid for encoding utf-8/);
    rmSync(path.join(directory, 'review-packet/bundle.json'));
    mkdirSync(path.join(directory, 'review-packet/bundle.json'));
    assert.match(run().stderr, /regular file/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
