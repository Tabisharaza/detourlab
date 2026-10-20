import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createReportIdentity } from '../scripts/report-identity.js';
import { canonicalExperiment, simulateExperiment, validateExperiment } from '../src/experiment.js';
import { createJobImpactReport, projectJobOutcomes } from '../scripts/job-impact.js';
import { compareJobOutcomes, thresholdViolations } from '../scripts/job-gates.js';
import { createExperimentReport, serializeExperimentReport, REPORT_LIMITS } from '../scripts/experiment-report.js';

const fixture = (name = 'minimal-experiment.json') => JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value;
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const generator = () => ({ name: 'detourlab', packageVersion: '0.1.0', reportVersion: 1, sourceRevision: null, implementation: { algorithm: 'sha256', files: ['src/engine.js', 'scripts/experiment-report.js'], sha256: 'a'.repeat(64) } });
const selected = (report, id = 'close-at-10') => report.variants.find(variant => variant.id === id);
const bytes = value => Buffer.byteLength(value, 'utf8');

// Keep the public API free of testing switches. As with job-impact tests, load the
// checked-in pure module with narrow runner/limit substitutions, no ESM mocking.
function instrument({ runner = simulateExperiment, maxBundleBytes = REPORT_LIMITS.maxBundleBytes, maxReviewBytes = REPORT_LIMITS.maxReviewBytes } = {}) {
  const source = ['../src/experiment-report.js', '../scripts/experiment-report.js']
    .map(file => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n')
    .replace(/^import .*;\n/gm, '').replace(/^export \{.*\};\n/gm, '').replace(/^export /gm, '')
    .replace('maxBundleBytes: 8 * 1024 * 1024', `maxBundleBytes: ${maxBundleBytes}`)
    .replace('maxReviewBytes: 1024 * 1024', `maxReviewBytes: ${maxReviewBytes}`);
  return new Function('createHash', 'canonicalExperiment', 'simulateExperiment', 'validateExperiment', 'projectJobOutcomes', 'compareJobOutcomes', 'thresholdViolations', `${source}\nreturn { createExperimentReport, serializeExperimentReport };`)(createHash, canonicalExperiment, runner, validateExperiment, projectJobOutcomes, compareJobOutcomes, thresholdViolations);
}

function assertIntegrity(bundle) {
  const { integrity, ...payload } = bundle;
  assert.deepEqual(integrity, { algorithm: 'sha256', sha256: hash(canonical(payload)), reviewSha256: hash(serializeExperimentReport(bundle).reviewMarkdown) });
  assert.equal(bundle.experimentSha256, hash(canonicalExperiment(bundle.experiment)));
  assert.equal(bundle.policySha256, hash(canonical(bundle.policy)));
}

test('report limits and explicit unknown provenance are stable', () => {
  assert.deepEqual(REPORT_LIMITS, { maxBundleBytes: 8388608, maxReviewBytes: 1048576, maxExceptionJobs: 20 });
  assert.ok(Object.isFrozen(REPORT_LIMITS));
  const report = createExperimentReport(fixture());
  assert.equal(report.format, 'detourlab-experiment-report');
  assert.equal(report.version, 1);
  assert.deepEqual(report.generator, { name: 'unknown', packageVersion: 'unknown', reportVersion: 1, sourceRevision: null, implementation: null });
  assert.equal(report.verdict, 'not-evaluated');
  assert.deepEqual(report.policy, {});
  assert.ok(report.variants.every(variant => variant.verdict === 'not-evaluated' && !variant.violations.length));
  assertIntegrity(report);
});

test('tiny report contains every variant and one baseline with literal 20 versus 26 seconds', () => {
  const input = fixture(), report = createExperimentReport(input);
  assert.deepEqual(report.experiment, input);
  assert.deepEqual(report.variants.map(variant => variant.id), input.variants.map(variant => variant.id));
  assert.deepEqual(report.baseline.jobs, [{ id: 'job-1', vehicleId: 'van-1', nodeId: 'C', dueTimeS: 22, status: 'on-time', arrivalS: 20, completedS: 23, delayS: 0 }]);
  assert.deepEqual(selected(report).jobs, [{ id: 'job-1', vehicleId: 'van-1', nodeId: 'C', dueTimeS: 22, status: 'late', arrivalS: 26, completedS: 29, delayS: 4, changed: true, statusChanged: true, arrivalDeltaS: 6, completedDeltaS: 6, delayDeltaS: 4 }]);
  assert.equal(selected(report, 'close-at-11').summary.changedJobs, 0);
  assert.equal(selected(report).jobComparison.newlyLateJobs, 1);
  assert.equal(selected(report).jobComparison.maxArrivalSlipS, 6);
  for (const variant of report.variants) for (const row of variant.jobs) {
    assert.equal(Object.hasOwn(row, 'baseline'), false);
    assert.equal(Object.hasOwn(row, 'variant'), false);
  }
});

test('new pure projection preserves every old report field and existing output bytes', () => {
  for (const name of ['minimal-experiment.json', 'meridian-experiment.json']) {
    const input = fixture(name), simulation = simulateExperiment(input), report = createExperimentReport(input);
    for (const variant of report.variants) {
      const legacy = createJobImpactReport(input, variant.id);
      const projection = projectJobOutcomes(input, simulation.baseline, simulation.variants.find(item => item.id === variant.id).result);
      assert.equal(JSON.stringify(projection), JSON.stringify({ summary: legacy.summary, jobs: legacy.jobs }));
      assert.deepEqual(variant.summary, legacy.summary);
      assert.deepEqual(variant.metrics, legacy.variantMetrics);
      assert.deepEqual(variant.delta, legacy.delta);
      assert.deepEqual(variant.jobs, legacy.jobs.map(({ baseline: ignored, variant: outcome, ...row }) => {
        const { id, vehicleId, nodeId, dueTimeS, ...comparison } = row;
        return { id, vehicleId, nodeId, dueTimeS, ...outcome, ...comparison };
      }));
    }
  }
});

test('all five gates preserve their exact semantics and canonical violation ordering', () => {
  const thresholds = { maxArrivalSlipS: 5, newlyLateJobs: 0, unreachableJobs: 0, extraLateJobs: 0, extraDistancePct: 0 };
  const report = createExperimentReport(fixture(), thresholds);
  assert.deepEqual(Object.keys(report.policy), ['extraDistancePct', 'extraLateJobs', 'unreachableJobs', 'newlyLateJobs', 'maxArrivalSlipS']);
  assert.equal(report.verdict, 'failed');
  assert.equal(selected(report, 'clear').verdict, 'passed');
  assert.deepEqual(selected(report).violations, [
    { metric: 'extraDistancePct', actual: 30, limit: 0 },
    { metric: 'extraLateJobs', actual: 1, limit: 0 },
    { metric: 'newlyLateJobs', actual: 1, limit: 0 },
    { metric: 'maxArrivalSlipS', actual: 6, limit: 5 },
  ]);
  const equal = createExperimentReport(fixture(), { extraDistancePct: 30, extraLateJobs: 1, unreachableJobs: 0, newlyLateJobs: 1, maxArrivalSlipS: 6 });
  assert.equal(equal.verdict, 'passed');
  assert.equal(createExperimentReport(fixture(), { newlyLateJobs: 0.999 }).verdict, 'failed');
  assert.equal(createExperimentReport(fixture(), { maxArrivalSlipS: 5.999999999 }).verdict, 'failed');
  assert.deepEqual(createExperimentReport(fixture(), reverseKeys(thresholds)), report);
});

test('masked regressions retain signed aggregate deltas, absolute unreachable counts and skipped-work nulls', () => {
  const input = JSON.parse(readFileSync(new URL('../docs/examples/net-lateness.experiment.json', import.meta.url), 'utf8'));
  const report = createExperimentReport(input, { extraLateJobs: 0, unreachableJobs: 1, newlyLateJobs: 0, maxArrivalSlipS: 6 });
  const cut = selected(report, 'cut');
  assert.equal(cut.delta.extraLateJobs, 0);
  assert.equal(cut.delta.unreachableJobs, 1);
  assert.equal(cut.jobComparison.newlyLateJobs, 1);
  assert.equal(cut.jobComparison.maxArrivalSlipS, 6);
  assert.deepEqual(cut.violations, [{ metric: 'newlyLateJobs', actual: 1, limit: 0 }]);
  const skipped = cut.jobs.find(job => job.id === 'skipped');
  for (const key of ['arrivalS', 'completedS', 'delayS', 'arrivalDeltaS', 'completedDeltaS', 'delayDeltaS']) assert.equal(skipped[key], null);
  assert.equal(cut.jobs.find(job => job.id === 'previously-late').arrivalDeltaS, -120);
  assert.equal(report.verdict, 'failed');
});

test('Meridian exposes 125 changed jobs, 118 newly late, seven still on time and 57 unreachable', () => {
  const report = createExperimentReport(fixture('meridian-experiment.json'), { newlyLateJobs: 100, unreachableJobs: 0 });
  const market = selected(report, 'market-05');
  assert.equal(market.summary.changedJobs, 125);
  assert.equal(market.jobComparison.newlyLateJobs, 118);
  assert.equal(market.jobs.filter(job => job.changed && job.status === 'on-time').length, 7);
  assert.equal(selected(report, 'all-bridges-05').metrics.unreachableJobs, 57);
  const { reviewMarkdown } = serializeExperimentReport(report);
  assert.match(reviewMarkdown, /7 arrive later but remain on time/);
  assert.match(reviewMarkdown, /Showing 20 of 125 changed jobs; 105 omitted here/);
  assert.match(reviewMarkdown, /full 192 machine rows/);
  assert.equal((reviewMarkdown.match(/^## Variant /gm) ?? []).length, 4);
  for (const variant of report.variants) assert.equal(variant.jobs.length, 192);
});

test('no comparable arrivals and empty demand fail an arrival-slip policy closed but are not invented failures without it', () => {
  for (const empty of [false, true]) {
    const input = fixture();
    input.baseScenario.edges = [];
    input.variants.forEach(variant => { variant.closures = []; });
    if (empty) input.baseScenario.jobs = [];
    const report = createExperimentReport(input, { maxArrivalSlipS: 100 });
    assert.equal(report.verdict, 'failed');
    for (const variant of report.variants) {
      assert.equal(variant.jobComparison.comparableJobs, 0);
      assert.equal(variant.jobComparison.maxArrivalSlipS, null);
      assert.deepEqual(variant.violations, [{ metric: 'maxArrivalSlipS', actual: null, limit: 100, reason: 'no-comparable-jobs' }]);
      assert.equal(variant.jobs.length, empty ? 0 : 1);
      assert.equal(variant.summary.changedJobs, 0);
    }
    const text = serializeExperimentReport(report).reviewMarkdown;
    assert.match(text, /null, unevaluable because there are no comparable arrivals/);
    assert.equal(createExperimentReport(input).verdict, 'not-evaluated');
    assert.equal(createExperimentReport(input, { newlyLateJobs: 0 }).verdict, 'passed');
  }
});

test('arrival statuses honor engine tolerance while raw timing differences remain unrounded', () => {
  const input = fixture();
  const times = { ab: 0.1, bc: 0.2, bd: 0.123456789, dc: 0.234567891 };
  input.baseScenario.edges.forEach(edge => { edge.travelTimeS = times[edge.id]; });
  input.baseScenario.jobs[0].dueTimeS = 0.3;
  input.baseScenario.jobs[0].serviceTimeS = 0.123456789;
  input.variants[1].closures[0].atS = 0.1;
  const report = createExperimentReport(input);
  const before = report.baseline.jobs[0], after = selected(report).jobs[0];
  assert.ok(before.arrivalS > before.dueTimeS);
  assert.equal(before.status, 'on-time');
  assert.equal(before.delayS, 0);
  assert.equal(after.arrivalDeltaS, 0.1 + 0.123456789 + 0.234567891 - (0.1 + 0.2));
  assert.notEqual(after.arrivalDeltaS, Number(after.arrivalDeltaS.toFixed(6)));
  assert.equal(createExperimentReport(input, { maxArrivalSlipS: after.arrivalDeltaS }).verdict, 'passed');
});

test('baseline and every variant retain interleaved input order rather than vehicle or identifier sorting', () => {
  const input = fixture(), job = input.baseScenario.jobs[0];
  input.baseScenario.vehicles = ['z-van', 'a-van'].map(id => ({ id, startNode: 'A', startTimeS: 0 }));
  input.baseScenario.jobs = [
    { ...job, id: 'z-job', vehicleId: 'z-van' },
    { ...job, id: 'a-job', vehicleId: 'a-van' },
    { ...job, id: 'm-job', vehicleId: 'z-van' },
  ];
  const report = createExperimentReport(input);
  for (const rows of [report.baseline.jobs, ...report.variants.map(variant => variant.jobs)]) assert.deepEqual(rows.map(row => row.id), ['z-job', 'a-job', 'm-job']);
});

test('canonical identities ignore object-key order and whitespace but preserve significant array order', () => {
  const input = fixture(), policy = { maxArrivalSlipS: 6, newlyLateJobs: 1 }, identity = generator();
  const report = createExperimentReport(input, policy, identity);
  const files = serializeExperimentReport(report);
  assert.deepEqual(createExperimentReport(reverseKeys(input), reverseKeys(policy), reverseKeys(identity)), report);
  assert.deepEqual(serializeExperimentReport(createExperimentReport(JSON.parse(JSON.stringify(input, null, 7)), policy, identity)), files);
  assertIntegrity(report);
  const reordered = structuredClone(input); reordered.variants.reverse();
  assert.notEqual(createExperimentReport(reordered, policy, identity).experimentSha256, report.experimentSha256);
  const newPolicy = createExperimentReport(input, { ...policy, maxArrivalSlipS: 7 }, identity);
  assert.equal(newPolicy.experimentSha256, report.experimentSha256);
  assert.notEqual(newPolicy.policySha256, report.policySha256);
  assert.notEqual(newPolicy.integrity.sha256, report.integrity.sha256);
  const newIdentity = createExperimentReport(input, policy, { ...identity, packageVersion: '0.1.1' });
  assert.equal(newIdentity.experimentSha256, report.experimentSha256);
  assert.equal(newIdentity.policySha256, report.policySha256);
  assert.notEqual(newIdentity.integrity.sha256, report.integrity.sha256);
  assert.deepEqual(createExperimentReport(input, { extraLateJobs: -0 }).policy, { extraLateJobs: 0 });
});

test('normalized embedded input and policy reproduce exact packet bytes, including failures', () => {
  const report = createExperimentReport(fixture(), { maxArrivalSlipS: 0, newlyLateJobs: 0 }, generator());
  const files = serializeExperimentReport(report), decoded = JSON.parse(files.bundleJson);
  const repeat = createExperimentReport(decoded.experiment, decoded.policy, decoded.generator);
  assert.deepEqual(serializeExperimentReport(repeat), files);
  assert.equal(repeat.verdict, 'failed');
  assert.match(files.reviewMarkdown, /saved\.experiment, saved\.policy, saved\.generator/);
  assert.match(files.reviewMarkdown, /hashes canonical JSON of all fields except integrity/);
  assert.match(files.reviewMarkdown, /not signatures/);
  assert.match(files.reviewMarkdown, /fixed placeholder path review-packet\//);
});

test('frozen inputs and metadata stay unchanged and result fields never alias each other', () => {
  const input = fixture(), policy = { newlyLateJobs: 0 }, identity = generator();
  const originals = structuredClone({ input, policy, identity });
  freeze(input); freeze(policy); freeze(identity);
  const report = createExperimentReport(input, policy, identity), expected = structuredClone(report);
  report.experiment.variants[0].name = 'Edited';
  report.generator.implementation.files[0] = 'other.js';
  report.baseline.jobs[0].arrivalS = 900;
  report.variants[0].jobs[0].arrivalS = 800;
  report.variants[0].summary.transitions['on-time'].late = 7;
  report.policy.newlyLateJobs = 99;
  assert.equal(report.variants[1].jobs[0].arrivalS, 26);
  assert.equal(report.variants[0].summary.transitions.late.late, 0);
  assert.deepEqual({ input, policy, identity }, originals);
  assert.deepEqual(createExperimentReport(input, policy, identity), expected);
});

test('threshold policy is defensive, never coerces and never invokes getters', () => {
  const malformed = [null, [], true, 1, 'x', new Number(1), new Date(), Object.create({ newlyLateJobs: 0 }), { unknown: 0 }, { [Symbol('x')]: 0 }, JSON.parse('{"__proto__":0}')];
  let invoked = 0;
  const getter = {}; Object.defineProperty(getter, 'newlyLateJobs', { enumerable: true, get() { invoked += 1; return 0; } });
  malformed.push(getter);
  for (const value of [null, false, '0', NaN, Infinity, -Infinity, -1, new Number(0), { valueOf() { invoked += 1; return 0; } }]) malformed.push({ newlyLateJobs: value });
  let calls = 0;
  const model = instrument({ runner() { calls += 1; throw new Error('must not simulate'); } });
  for (const thresholds of malformed) assert.throws(() => model.createExperimentReport(fixture(), thresholds), /Report policy/);
  assert.equal(invoked, 0);
  assert.equal(calls, 0);
  const safe = Object.create(null); safe.maxArrivalSlipS = 6;
  assert.equal(createExperimentReport(fixture(), safe).verdict, 'passed');
});

test('generator provenance validates plain JSON data and safe relative coverage without getters', () => {
  const malformed = [true, [], {}, { ...generator(), extra: true }, { ...generator(), sourceRevision: '/home/user/project' }, { ...generator(), reportVersion: 2 }];
  for (const files of [['/private/source.js'], ['../secret'], ['src/../secret'], ['src/engine.js', 'src/engine.js'], new Array(1)]) malformed.push({ ...generator(), implementation: { ...generator().implementation, files } });
  let invoked = 0;
  const getter = generator(); Object.defineProperty(getter, 'name', { enumerable: true, get() { invoked += 1; return 'no'; } });
  malformed.push(getter);
  for (const identity of malformed) assert.throws(() => createExperimentReport(fixture(), {}, identity), /Report generator/);
  assert.equal(invoked, 0);
});

test('all variants are simulated together exactly once and runner budget failures never return partial data', () => {
  const input = fixture(); let calls = 0;
  const model = instrument({ runner(actual) { calls += 1; assert.deepEqual(actual, input); assert.notEqual(actual, input); return simulateExperiment(actual); } });
  const report = model.createExperimentReport(input);
  assert.equal(calls, 1);
  model.serializeExperimentReport(report);
  assert.equal(calls, 1, 'serialization never simulates');
  assert.deepEqual(report, createExperimentReport(input));
  for (const message of ['Simulation exceeds the routingEdgeVisits work limit.', 'Simulation exceeds the pathEdgeVisits work limit.', 'Experiment exceeds the aggregate result limit of 500000 route segments.']) {
    const error = new Error(message), failing = instrument({ runner() { throw error; } });
    let partial;
    assert.throws(() => { partial = failing.createExperimentReport(input); }, thrown => thrown === error);
    assert.equal(partial, undefined);
  }
  const invalid = fixture(); invalid.variants[2].closures[0].edgeIds = ['missing'];
  assert.throws(() => model.createExperimentReport(invalid), /unknown id/);
  assert.equal(calls, 1);
});

test('hostile labels remain literal in JSON but cannot create Markdown, HTML, bidi or command content', () => {
  const input = fixture();
  const hostile = '<script>alert(1)</script> [link](https://bad.invalid) `x`\n# spoof\t\\u202e\u202e\u007f';
  input.name = hostile;
  input.variants[1].name = hostile;
  input.baseScenario.name = hostile;
  input.baseScenario.description = hostile;
  const identity = generator(); identity.name = hostile;
  const report = createExperimentReport(input, {}, identity), { bundleJson, reviewMarkdown } = serializeExperimentReport(report);
  assert.equal(JSON.parse(bundleJson).experiment.name, hostile);
  assert.equal(JSON.parse(bundleJson).generator.name, hostile);
  assert.doesNotMatch(reviewMarkdown, /<script>|\[link\]\(|^# spoof|\u202e|\u007f|\t/mu);
  assert.match(reviewMarkdown, /&#60;script&#62;/);
  assert.match(reviewMarkdown, /&#92;u202e/);
  const code = reviewMarkdown.split('```sh\n')[1].split('\n```')[0];
  assert.doesNotMatch(code, /bad\.invalid|script>|spoof|alert\(1\)/);
  assert.equal((reviewMarkdown.match(/^```/gm) ?? []).length, 2);
});

test('complete closure summaries include every record, edge and time without assuming first closure represents a variant', () => {
  const input = fixture();
  input.variants[1].closures = [
    { id: 'later', atS: 40, edgeIds: ['bc', 'bd'] },
    { id: 'earliest', atS: 10, edgeIds: ['bc'] },
    { id: 'third', atS: 35.125, edgeIds: ['dc'] },
  ];
  const text = serializeExperimentReport(createExperimentReport(input)).reviewMarkdown;
  assert.match(text, /3 closure records; 4 directed-edge references; 3 distinct affected directed edges/);
  assert.match(text, /\| later \| 40 \| bc, bd \|/);
  assert.match(text, /\| earliest \| 10 \| bc \|/);
  assert.match(text, /\| third \| 35.125 \| dc \|/);
  assert.ok(text.indexOf('| later |') < text.indexOf('| earliest |'));
  assert.match(text, /earliest listed closure time/);
  assert.match(text, /already-entered edge finishes/);
});

test('exception rows prioritize newly unreachable, newly late, then maximum slips with stable ties', () => {
  const input = fixture(), original = input.baseScenario.jobs[0];
  input.baseScenario.vehicles = ['one', 'two', 'three', 'four', 'five'].map(id => ({ id, startNode: 'A', startTimeS: 0 }));
  input.baseScenario.edges.push({ id: 'ce', from: 'C', to: 'E', distanceM: 10, travelTimeS: 1, roadName: 'Final' });
  input.baseScenario.nodes.push({ id: 'E', x: 3, y: 0 });
  input.baseScenario.jobs = [
    { ...original, id: 'firsttie', vehicleId: 'one', dueTimeS: 99 },
    { ...original, id: 'secondtie', vehicleId: 'two', dueTimeS: 99 },
    { ...original, id: 'newlate', vehicleId: 'three' },
    { ...original, id: 'blocked', vehicleId: 'four', nodeId: 'E' },
    { ...original, id: 'otherlate', vehicleId: 'five' },
  ];
  input.variants[1].closures[0].edgeIds.push('ce');
  const report = createExperimentReport(input), text = serializeExperimentReport(report).reviewMarkdown;
  const section = text.split('## Variant 2:')[1].split('## Variant 3:')[0].split('### Exception jobs')[1];
  assert.ok(section.indexOf('| blocked /') < section.indexOf('| newlate /'));
  assert.ok(section.indexOf('| newlate /') < section.indexOf('| otherlate /'));
  assert.ok(section.indexOf('| otherlate /') < section.indexOf('| firsttie /'));
  assert.ok(section.indexOf('| firsttie /') < section.indexOf('| secondtie /'));
  assert.deepEqual(selected(report).jobs.map(job => job.id), input.baseScenario.jobs.map(job => job.id), 'machine rows never get sorted for display');
});

test('UTF-8 limits include pretty output and final newline at the exact inclusive boundary', () => {
  const input = fixture(); input.name = 'é🌉'.repeat(25);
  const report = createExperimentReport(input), files = serializeExperimentReport(report);
  assert.ok(files.bundleJson.endsWith('\n') && !files.bundleJson.endsWith('\n\n'));
  assert.ok(files.reviewMarkdown.endsWith('\n') && !files.reviewMarkdown.endsWith('\n\n'));
  assert.ok(bytes(files.bundleJson) > files.bundleJson.length);
  assert.ok(bytes(files.reviewMarkdown) > files.reviewMarkdown.length);
  assert.ok(bytes(files.bundleJson) > bytes(JSON.stringify(report)));
  const exact = instrument({ maxBundleBytes: bytes(files.bundleJson), maxReviewBytes: bytes(files.reviewMarkdown) });
  assert.deepEqual(exact.createExperimentReport(input), report);
  assert.deepEqual(exact.serializeExperimentReport(report), files);
  assert.throws(() => instrument({ maxBundleBytes: bytes(files.bundleJson) - 1 }).createExperimentReport(input), /bundle exceeds the 8 MiB limit/);
  assert.throws(() => instrument({ maxReviewBytes: bytes(files.reviewMarkdown) - 1 }).createExperimentReport(input), /review exceeds the 1 MiB limit/);
  assert.throws(() => instrument({ maxBundleBytes: files.bundleJson.length }).serializeExperimentReport(report), /bundle exceeds/);
  assert.throws(() => instrument({ maxReviewBytes: files.reviewMarkdown.length }).serializeExperimentReport(report), /review exceeds/);
});

test('machine assumptions, skipped-work warnings and ordered evaluations retain policy evidence', () => {
  const input = fixture(); input.baseScenario.edges = []; input.variants.forEach(variant => { variant.closures = []; });
  const report = createExperimentReport(input, { maxArrivalSlipS: 0, newlyLateJobs: 0, unreachableJobs: 0 });
  assert.ok(report.assumptions.some(value => value.includes('not a forecast')));
  assert.ok(report.assumptions.some(value => value.includes('not authenticated')));
  assert.deepEqual(report.warnings.map(warning => [warning.scope, warning.variantId, warning.unreachableJobs, warning.completedJobs, warning.totalJobs]), [
    ['baseline', null, 1, 0, 1], ['variant', 'clear', 1, 0, 1], ['variant', 'close-at-10', 1, 0, 1], ['variant', 'close-at-11', 1, 0, 1],
  ]);
  for (const variant of report.variants) assert.deepEqual(variant.gateEvaluations, [
    { metric: 'unreachableJobs', actual: 1, limit: 0, verdict: 'failed' },
    { metric: 'newlyLateJobs', actual: 0, limit: 0, verdict: 'passed' },
    { metric: 'maxArrivalSlipS', actual: null, limit: 0, verdict: 'failed', reason: 'no-comparable-jobs' },
  ]);
  assert.deepEqual(createExperimentReport(fixture()).warnings, []);
  assert.ok(createExperimentReport(fixture()).variants.every(variant => !variant.gateEvaluations.length));
});

test('payload and exact review bytes have independent hashes and serialization rejects edited model data', () => {
  const report = createExperimentReport(fixture()), output = serializeExperimentReport(report);
  assert.equal(report.integrity.reviewSha256, hash(output.reviewMarkdown));
  const badPayload = structuredClone(report); badPayload.variants[0].metrics.distanceM += 1;
  assert.throws(() => serializeExperimentReport(badPayload), /payload integrity does not match/);
  const badReview = structuredClone(report); badReview.integrity.reviewSha256 = '0'.repeat(64);
  assert.throws(() => serializeExperimentReport(badReview), /review integrity does not match/);
  assert.notEqual(hash(`${output.reviewMarkdown}edited\n`), report.integrity.reviewSha256);
});

test('generated reproduction command executes and rejects altered packets, source mismatches and unsafe file inputs', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'detourlab-reproduce-'));
  try {
    // Resolve implementation from this real source checkout; the command uses
    // its fixed relative module paths through a local link in the isolated cwd.
    symlinkSync(fileURLToPath(new URL('../scripts', import.meta.url)), path.join(directory, 'scripts'), 'dir');
    mkdirSync(path.join(directory, 'review-packet'));
    const report = createExperimentReport(fixture(), { newlyLateJobs: 0 }, await createReportIdentity());
    const output = serializeExperimentReport(report);
    const shell = output.reviewMarkdown.split('```sh\n')[1].split('\n```')[0];
    assert.ok(shell.startsWith("node --input-type=module -e '\n") && shell.endsWith("\n'"));
    const code = shell.slice("node --input-type=module -e '\n".length, -2);
    const run = () => spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: directory, encoding: 'utf8', timeout: 10000 });
    const save = (bundle = output.bundleJson, review = output.reviewMarkdown) => {
      writeFileSync(path.join(directory, 'review-packet/bundle.json'), bundle);
      writeFileSync(path.join(directory, 'review-packet/REVIEW.md'), review);
    };
    save();
    const valid = run(); assert.equal(valid.status, 0, valid.stderr); assert.match(valid.stdout, /Exact packet reproduction verified/);
    for (const mutate of [
      value => { value.experiment.variants[1].closures[0].atS += 1; },
      value => { value.variants[1].jobs[0].arrivalS += 1; },
      value => { value.policy.newlyLateJobs = 1; },
      value => { value.integrity.sha256 = '0'.repeat(64); },
      value => { value.integrity.reviewSha256 = '0'.repeat(64); },
    ]) {
      const altered = structuredClone(report); mutate(altered); save(`${JSON.stringify(altered, null, 2)}\n`);
      const result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Report differs/);
    }
    for (const implementation of [null, { ...report.generator.implementation, sha256: '0'.repeat(64) }, { ...report.generator.implementation, files: ['src/engine.js'] }]) {
      const altered = structuredClone(report); altered.generator.implementation = implementation; save(`${JSON.stringify(altered, null, 2)}\n`);
      const result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Unknown or mismatched implementation fingerprint/);
    }
    save(output.bundleJson, `${output.reviewMarkdown}edited\n`);
    assert.match(run().stderr, /Report differs/);
    save(Buffer.from([0xc3, 0x28]));
    assert.match(run().stderr, /not valid for encoding utf-8/);
    save(Buffer.alloc(REPORT_LIMITS.maxBundleBytes + 1, 32));
    assert.match(run().stderr, /exceeds byte limit/);
    save(output.bundleJson, Buffer.alloc(REPORT_LIMITS.maxReviewBytes + 1, 32));
    assert.match(run().stderr, /exceeds byte limit/);
    rmSync(path.join(directory, 'review-packet/bundle.json'));
    mkdirSync(path.join(directory, 'review-packet/bundle.json'));
    assert.match(run().stderr, /regular file/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('literal bare URL and email labels contain no GFM autolink syntax', () => {
  const input = fixture(); input.name = 'https://bad.invalid/a www.bad.invalid name@bad.invalid <x@y.test>';
  const report = createExperimentReport(input), { reviewMarkdown, bundleJson } = serializeExperimentReport(report);
  assert.equal(JSON.parse(bundleJson).experiment.name, input.name);
  assert.doesNotMatch(reviewMarkdown, /https:\/\/bad|www\.bad|name@bad|<x@y/);
  assert.match(reviewMarkdown, /https&#58;&#47;&#47;bad&#46;invalid/);
  assert.match(reviewMarkdown, /name&#64;bad&#46;invalid/);
});

test('largest positive same-status arrival slip precedes smaller slips without reordering machine rows', () => {
  const input = fixture(), original = input.baseScenario.jobs[0];
  input.baseScenario.nodes.push({ id: 'E', x: 3, y: 1 });
  input.baseScenario.edges.push(
    { id: 'ae', from: 'A', to: 'E', distanceM: 50, travelTimeS: 5, roadName: 'Direct' },
    { id: 'de', from: 'D', to: 'E', distanceM: 300, travelTimeS: 30, roadName: 'Long detour' },
  );
  input.baseScenario.vehicles = ['one', 'two'].map(id => ({ id, startNode: 'A', startTimeS: 0 }));
  input.baseScenario.jobs = [
    { ...original, id: 'smallerslip', vehicleId: 'one', dueTimeS: 100 },
    { ...original, id: 'largerslip', vehicleId: 'two', nodeId: 'E', dueTimeS: 100 },
  ];
  input.variants[1].closures.push({ id: 'blockdirect', edgeIds: ['ae'], atS: 0 });
  const report = createExperimentReport(input), variant = selected(report);
  assert.deepEqual(variant.jobs.map(job => [job.id, job.status, job.arrivalDeltaS]), [['smallerslip', 'on-time', 6], ['largerslip', 'on-time', 43]]);
  const section = serializeExperimentReport(report).reviewMarkdown.split('## Variant 2:')[1].split('## Variant 3:')[0].split('### Exception jobs')[1];
  assert.ok(section.indexOf('| largerslip /') < section.indexOf('| smallerslip /'));
});

test('actual bounded valid inputs can exceed either output budget and reject without a partial bundle', () => {
  const closures = fixture();
  closures.variants[1].closures = Array.from({ length: 2500 }, (_, i) => ({ id: `c${i}${'.'.repeat(80)}`, edgeIds: ['bc'], atS: 10 }));
  assert.ok(bytes(JSON.stringify(closures)) < 2 * 1024 * 1024);
  assert.throws(() => createExperimentReport(closures), /review exceeds the 1 MiB limit/);
  const jobs = fixture(), nodeId = 'n'.repeat(96), vehicleId = 'v'.repeat(96);
  Object.assign(jobs.baseScenario, {
    nodes: [{ id: nodeId, x: 0, y: 0 }], edges: [], vehicles: [{ id: vehicleId, startNode: nodeId, startTimeS: 0 }],
    jobs: Array.from({ length: 2000 }, (_, i) => ({ id: `j${String(i).padStart(4, '0')}${'x'.repeat(91)}`, nodeId, vehicleId, dueTimeS: 0, serviceTimeS: 0 })),
  });
  jobs.variants = Array.from({ length: 6 }, (_, i) => ({ id: `v${i}`, name: `Variant ${i}`, closures: [] }));
  assert.ok(bytes(JSON.stringify(jobs)) < 2 * 1024 * 1024);
  assert.throws(() => createExperimentReport(jobs), /bundle exceeds the 8 MiB limit/);
});
