import { projectJobOutcomes } from './job-impact.js';
import { compareJobOutcomes, thresholdViolations } from './job-gates.js';

/** Exact UTF-8 budgets include indentation and each file's final newline. */
export const REPORT_LIMITS = Object.freeze({
  maxBundleBytes: 8 * 1024 * 1024,
  maxReviewBytes: 1024 * 1024,
  maxExceptionJobs: 20,
});

const POLICY_METRICS = ['extraDistancePct', 'extraLateJobs', 'unreachableJobs', 'newlyLateJobs', 'maxArrivalSlipS'];
const STATUSES = ['on-time', 'late', 'unreachable'];
const ASSUMPTIONS = Object.freeze([
  'Synthetic scenario with fixed travel times; not a forecast, operational safety certification or route optimization.',
  'Vehicle assignments and supplied per-vehicle job order remain fixed.',
  'Deadlines apply to arrival, not service completion; engine boundary tolerance and literal timing precision are preserved.',
  'Unreachable jobs are skipped; lower distance or fewer late jobs may reflect lost service rather than an equal-service improvement.',
  'Timing differences are null when either outcome is unreachable; a requested arrival-slip gate fails closed with no comparable arrivals.',
  'No automatic best variant is selected; changed outcomes do not establish route changes, closure causality or superiority.',
  'Hashes identify content and are not signatures; generator metadata and sourceRevision are supplied claims, not authenticated by the model helper.',
]);
const jsonFile = value => `${JSON.stringify(value, null, 2)}\n`;

// Canonical object keys, significant array order, and literal JSON numbers.
// Called only on independently copied, validated/generated plain JSON data.
export function canonicalReport(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalReport).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalReport(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function dataRecord(value, keys, path, required = keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be a plain object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${path} must be a plain object; inherited data is not allowed.`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !keys.includes(key)) throw new Error(`${path} contains an unsupported property.`);
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) throw new Error(`${path} must contain data properties, not accessors.`);
  }
  for (const key of required) if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key} is required.`);
  return value;
}

export function normalizePolicy(thresholds) {
  dataRecord(thresholds, POLICY_METRICS, 'Report policy', []);
  const policy = {};
  for (const metric of POLICY_METRICS) {
    if (!Object.hasOwn(thresholds, metric)) continue;
    const limit = thresholds[metric];
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) throw new Error(`Report policy.${metric} must be a finite nonnegative number.`);
    // JSON has one representation for zero; avoid returning a non-roundtripping -0.
    policy[metric] = limit === 0 ? 0 : limit;
  }
  return policy;
}

export function normalizeGenerator(generator) {
  if (generator === null) return { name: 'unknown', packageVersion: 'unknown', reportVersion: 1, sourceRevision: null, implementation: null };
  dataRecord(generator, ['name', 'packageVersion', 'reportVersion', 'sourceRevision', 'implementation'], 'Report generator');
  for (const field of ['name', 'packageVersion']) {
    if (typeof generator[field] !== 'string' || !generator[field].trim() || generator[field].length > 120) throw new Error(`Report generator.${field} must be a nonempty string of at most 120 characters.`);
  }
  if (generator.reportVersion !== 1) throw new Error('Report generator.reportVersion must be 1.');
  if (generator.sourceRevision !== null && (typeof generator.sourceRevision !== 'string' || !/^[a-f0-9]{40,64}$/u.test(generator.sourceRevision))) throw new Error('Report generator.sourceRevision must be null or a lowercase hexadecimal revision.');
  let implementation = null;
  if (generator.implementation !== null) {
    const value = dataRecord(generator.implementation, ['algorithm', 'files', 'sha256'], 'Report generator.implementation');
    if (value.algorithm !== 'sha256' || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sha256)) throw new Error('Report generator implementation requires a SHA-256 fingerprint.');
    const files = value.files;
    if (!Array.isArray(files) || Object.getPrototypeOf(files) !== Array.prototype || files.length < 1 || files.length > 64) throw new Error('Report generator implementation requires 1–64 relative file paths.');
    for (const key of Reflect.ownKeys(files)) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= files.length || !Object.hasOwn(Object.getOwnPropertyDescriptor(files, key), 'value')) throw new Error('Report generator files must be plain data entries.');
    }
    const copied = [];
    for (let i = 0; i < files.length; i += 1) {
      if (!Object.hasOwn(files, i) || typeof files[i] !== 'string' || files[i].length > 160 || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u.test(files[i]) || files[i].split('/').some(part => part === '.' || part === '..')) throw new Error('Report generator files must be safe relative file paths.');
      copied.push(files[i]);
    }
    if (new Set(copied).size !== copied.length) throw new Error('Report generator files must be unique.');
    implementation = { algorithm: 'sha256', files: copied, sha256: value.sha256 };
  }
  return { name: generator.name, packageVersion: generator.packageVersion, reportVersion: 1, sourceRevision: generator.sourceRevision, implementation };
}

/** Project every completed run without simulation, hashing, mutation, or I/O. */
export function projectExperimentReport(experiment, simulation, policy, identity, experimentSha256, policySha256) {
  // Projection also supplies the exact same status/tolerance rules to old reports.
  const baselineProjection = projectJobOutcomes(experiment, simulation.baseline, simulation.baseline);
  const baseline = {
    metrics: { ...simulation.baseline.metrics },
    jobs: baselineProjection.jobs.map(({ id, vehicleId, nodeId, dueTimeS, baseline: outcome }) => ({ id, vehicleId, nodeId, dueTimeS, ...outcome })),
  };
  const evaluated = Object.keys(policy).length > 0;
  const variants = simulation.variants.map(selected => {
    const { summary, jobs } = projectJobOutcomes(experiment, simulation.baseline, selected.result);
    const jobComparison = compareJobOutcomes(simulation.baseline, selected.result);
    const violations = thresholdViolations(selected.delta, policy, jobComparison);
    const gateEvaluations = Object.entries(policy).map(([metric, limit]) => {
      const actual = metric === 'newlyLateJobs' || metric === 'maxArrivalSlipS' ? jobComparison[metric] : selected.delta[metric];
      const violation = violations.find(item => item.metric === metric);
      return { metric, actual, limit, verdict: violation ? 'failed' : 'passed', ...(violation?.reason ? { reason: violation.reason } : {}) };
    });
    return {
      id: selected.id,
      name: selected.name,
      metrics: { ...selected.result.metrics },
      delta: { ...selected.delta },
      summary,
      jobComparison,
      jobs: jobs.map(({ baseline: ignored, variant, ...row }) => {
        const { id, vehicleId, nodeId, dueTimeS, ...comparison } = row;
        return { id, vehicleId, nodeId, dueTimeS, ...variant, ...comparison };
      }),
      verdict: !evaluated ? 'not-evaluated' : violations.length ? 'failed' : 'passed',
      violations,
      gateEvaluations,
    };
  });
  const warnings = [
    { scope: 'baseline', variantId: null, metrics: baseline.metrics },
    ...variants.map(variant => ({ scope: 'variant', variantId: variant.id, metrics: variant.metrics })),
  ].filter(run => run.metrics.unreachableJobs > 0).map(run => ({
    code: 'skipped-unreachable-work', scope: run.scope, variantId: run.variantId,
    unreachableJobs: run.metrics.unreachableJobs, completedJobs: run.metrics.completedJobs, totalJobs: run.metrics.totalJobs,
    message: 'Unreachable jobs were skipped. Lower distance or lateness does not establish an equal-service improvement.',
  }));
  const payload = {
    format: 'detourlab-experiment-report', version: 1, engineVersion: '0.1.0',
    generator: identity,
    experiment,
    experimentSha256,
    policy,
    policySha256,
    assumptions: [...ASSUMPTIONS],
    warnings,
    baseline,
    variants,
    verdict: !evaluated ? 'not-evaluated' : variants.some(variant => variant.verdict === 'failed') ? 'failed' : 'passed',
  };
  return payload;
}

/** Encode all markup punctuation; controls become visible escapes on one line. */
function label(value) {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u206f]|[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/gu, character => {
    const code = character.codePointAt(0);
    if (code < 32 || code >= 127 && (code <= 159 || /[\u061c\u200e\u200f\u2028-\u202e\u2066-\u206f]/u.test(character))) return `&#92;u${code.toString(16).padStart(4, '0')}`;
    return `&#${code};`;
  });
}

const timing = value => value === null ? 'null (unreachable)' : `${value} s`;
const signed = value => value === null ? 'null (not comparable)' : `${value >= 0 ? '+' : ''}${value}`;

function exceptionRows(variant, baselineById) {
  const rank = row => {
    const baseline = baselineById.get(row.id);
    if (baseline.status !== 'unreachable' && row.status === 'unreachable') return 0;
    if (baseline.status === 'on-time' && row.status === 'late') return 1;
    if (row.arrivalDeltaS !== null && row.arrivalDeltaS > 0) return 2;
    return 3;
  };
  return variant.jobs.map((row, index) => ({ row, index, rank: rank(row) })).filter(item => item.row.changed)
    .sort((a, b) => a.rank - b.rank || (a.rank === 2 ? b.row.arrivalDeltaS - a.row.arrivalDeltaS : 0) || a.index - b.index)
    .slice(0, REPORT_LIMITS.maxExceptionJobs).map(item => item.row);
}

export function renderReview(bundle) {
  const { experiment, policy, baseline } = bundle;
  const baselineById = new Map(baseline.jobs.map(job => [job.id, job]));
  const lines = [
    '# DetourLab experiment review', '',
    `${label(experiment.name)} · experiment ${label(experiment.id)}`, '',
    `Overall policy verdict: **${bundle.verdict}**. Every supplied variant is evaluated independently; no automatic best variant is selected.`, '',
    `Scenario: ${label(experiment.baseScenario.name)}. Seed: ${experiment.baseScenario.seed}. Network: ${experiment.baseScenario.nodes.length} nodes, ${experiment.baseScenario.edges.length} directed edges. Demand: ${experiment.baseScenario.vehicles.length} vehicles, ${baseline.jobs.length} jobs. Display horizon: ${experiment.baseScenario.durationS} s; it does not truncate the simulation.`, '',
    label(experiment.baseScenario.description), '',
    '## Decision limits', '',
    '- Synthetic scenario with fixed travel times; this is not a forecast, operational safety certification or route optimization.',
    '- Vehicle assignments and supplied per-vehicle job order remain fixed. Deadlines apply to arrival; service completion is separate. Engine floating-point boundary tolerance is preserved.',
    '- Unreachable jobs are skipped. Lower distance or fewer late jobs may reflect lost service and do not establish an equal-service improvement. Review completed and unreachable work together.',
    '- Timing differences are null if either arrival is unreachable. No comparable arrivals fails a requested maximum-arrival-slip gate; no policy means not-evaluated.',
    '- Changed outcomes do not prove a changed route, closure causality or a better plan. Unchanged outcomes do not prove identical routes.', '',
    '## Reproducibility and integrity', '',
    `- Experiment SHA-256: ${bundle.experimentSha256}`,
    `- Policy SHA-256: ${bundle.policySha256}`,
    `- Bundle integrity SHA-256: ${bundle.integrity.sha256}`,
    `- Engine version: ${label(bundle.engineVersion)}. Generator: ${label(bundle.generator.name)}; package version: ${label(bundle.generator.packageVersion)}; report version: ${bundle.generator.reportVersion}.`,
    `- Source revision: ${bundle.generator.sourceRevision ?? 'unknown'}. Generator metadata is supplied, not authenticated by the model helper.`,
    `- Implementation fingerprint: ${bundle.generator.implementation?.sha256 ?? 'unknown'}.`,
    '- Hashes identify content; they are not signatures or proof of authorship. Bundle integrity hashes canonical JSON of all fields except integrity. Canonical JSON sorts object keys and preserves array order; the file itself is readable indented JSON.',
    '- The full normalized experiment, ordered policy, every outcome and every violation are embedded in bundle.json. No timestamp, local input path or user identity is inferred.', '',
    '## Acceptance policy', '',
  ];
  if (!Object.keys(policy).length) lines.push('No thresholds supplied. All verdicts are **not-evaluated**; producing a packet does not mean the experiment passed.', '');
  else {
    const meaning = {
      extraDistancePct: 'Signed distance percentage change versus baseline; zero when baseline distance is zero.',
      extraLateJobs: 'Signed net change in late jobs; improvements can offset regressions.',
      unreachableJobs: 'Absolute unreachable-job count in this variant, not a baseline difference.',
      newlyLateJobs: 'Count changing from baseline on-time to variant late; recoveries do not cancel it.',
      maxArrivalSlipS: 'Maximum positive comparable arrival difference, floored at zero; null with no comparable jobs fails closed.',
    };
    lines.push('| Metric | Maximum allowed | Meaning |', '| --- | ---: | --- |');
    for (const [metric, limit] of Object.entries(policy)) lines.push(`| ${metric} | ${limit} | ${meaning[metric]} |`);
    lines.push('', 'Equality meets a limit. Thresholds apply to every variant and use literal timing precision.', '');
  }
  lines.push('## All-variant summary', '',
    '| Run | Verdict | Distance (m) | Completed / total | On-time | Late | Unreachable | Changed jobs | Newly late | Max arrival slip (s) |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| Clear-road baseline | reference | ${baseline.metrics.distanceM} | ${baseline.metrics.completedJobs} / ${baseline.metrics.totalJobs} | ${baseline.metrics.onTimeJobs} | ${baseline.metrics.lateJobs} | ${baseline.metrics.unreachableJobs} | — | — | — |`);
  for (const variant of bundle.variants) lines.push(`| ${label(variant.name)} (${label(variant.id)}) | ${variant.verdict} | ${variant.metrics.distanceM} | ${variant.metrics.completedJobs} / ${variant.metrics.totalJobs} | ${variant.metrics.onTimeJobs} | ${variant.metrics.lateJobs} | ${variant.metrics.unreachableJobs} | ${variant.summary.changedJobs} | ${variant.jobComparison.newlyLateJobs} | ${variant.jobComparison.maxArrivalSlipS ?? 'null: no comparable arrivals'} |`);
  lines.push('', `Baseline totals: ${baseline.metrics.totalTravelTimeS} s travel; ${baseline.metrics.totalDelayS} s arrival delay; ${baseline.metrics.reroutes} reroutes; ${baseline.metrics.affectedVehicles} affected vehicles.`, '');
  for (let index = 0; index < bundle.variants.length; index += 1) {
    const variant = bundle.variants[index], schedule = experiment.variants[index].closures;
    const uniqueEdges = new Set(schedule.flatMap(closure => closure.edgeIds));
    const references = schedule.reduce((sum, closure) => sum + closure.edgeIds.length, 0);
    lines.push(`## Variant ${index + 1}: ${label(variant.name)}`, '', `ID: ${label(variant.id)}. Policy verdict: **${variant.verdict}**.`, '',
      '### Complete closure schedule', '',
      `${schedule.length} closure records; ${references} directed-edge references; ${uniqueEdges.size} distinct affected directed edges. Records below retain input order. Each edge remains closed from its earliest listed closure time; repeated references do not reopen it. Entry decisions respect engine boundary tolerance; an already-entered edge finishes.`, '');
    if (!schedule.length) lines.push('Clear-road control: no closures.', '');
    else {
      lines.push('| Closure ID | Closes at (s) | Directed edge IDs |', '| --- | ---: | --- |');
      for (const closure of schedule) lines.push(`| ${label(closure.id)} | ${closure.atS} | ${closure.edgeIds.map(label).join(', ')} |`);
      lines.push('');
    }
    const stillOnTime = variant.jobs.filter(job => baselineById.get(job.id).status === 'on-time' && job.status === 'on-time' && job.arrivalDeltaS > 0).length;
    const newlyUnreachable = variant.jobs.filter(job => baselineById.get(job.id).status !== 'unreachable' && job.status === 'unreachable').length;
    lines.push('### Outcomes and gates', '',
      `- Completed ${variant.metrics.completedJobs}/${variant.metrics.totalJobs}; on-time ${variant.metrics.onTimeJobs}; late ${variant.metrics.lateJobs}; unreachable ${variant.metrics.unreachableJobs} (${newlyUnreachable} newly unreachable).`,
      `- Distance ${variant.metrics.distanceM} m; travel ${variant.metrics.totalTravelTimeS} s; arrival delay ${variant.metrics.totalDelayS} s; reroutes ${variant.metrics.reroutes}; affected vehicles ${variant.metrics.affectedVehicles}.`,
      `- Baseline differences: ${signed(variant.delta.distanceM)} m distance, ${signed(variant.delta.extraDistancePct)}% distance, ${signed(variant.delta.extraLateJobs)} net late jobs. The unreachable gate value is the absolute count ${variant.delta.unreachableJobs}.`,
      `- Job outcomes: ${variant.summary.changedJobs} changed, ${variant.summary.unchangedJobs} unchanged; ${variant.summary.statusChangedJobs} status changes; ${variant.summary.arrivalChangedJobs} arrival changes. ${stillOnTime} arrive later but remain on time.`,
      `- Comparable arrivals: ${variant.jobComparison.comparableJobs}; uncomparable: ${variant.jobComparison.uncomparableJobs}; newly late: ${variant.jobComparison.newlyLateJobs}; maximum arrival slip: ${variant.jobComparison.maxArrivalSlipS === null ? 'null (no comparable arrivals)' : `${variant.jobComparison.maxArrivalSlipS} s`}.`, '');
    if (variant.violations.length) {
      lines.push('Policy violations:', '');
      for (const violation of variant.violations) lines.push(violation.reason === 'no-comparable-jobs'
        ? `- ${violation.metric}: null, unevaluable because there are no comparable arrivals; requested limit ${violation.limit} s. This fails closed.`
        : `- ${violation.metric}: ${violation.actual} > ${violation.limit}.`);
      lines.push('');
    } else lines.push(Object.keys(policy).length ? 'All requested thresholds met for this variant.' : 'No thresholds were evaluated for this variant.', '');
    lines.push('Status transitions (baseline rows → variant columns):', '', '| Baseline → variant | on-time | late | unreachable |', '| --- | ---: | ---: | ---: |');
    for (const status of STATUSES) lines.push(`| ${status} | ${STATUSES.map(to => variant.summary.transitions[status][to]).join(' | ')} |`);
    const selected = exceptionRows(variant, baselineById);
    lines.push('', '### Exception jobs', '',
      `Showing ${selected.length} of ${variant.summary.changedJobs} changed jobs; ${variant.summary.changedJobs - selected.length} omitted here. The full ${variant.jobs.length} machine rows, including unchanged jobs, are in bundle.json.`, '',
      'Priority: newly unreachable, newly late, then largest positive comparable arrival slip, then other changed outcomes. Ties retain original input order. At most 20 rows per variant.', '');
    if (selected.length) {
      lines.push('| Job / vehicle / destination | Baseline → variant status | Arrival baseline → variant | Completion baseline → variant | Arrival slip | Delay baseline → variant | Arrival due |', '| --- | --- | --- | --- | ---: | --- | ---: |');
      for (const job of selected) {
        const original = baselineById.get(job.id);
        lines.push(`| ${label(job.id)} / ${label(job.vehicleId)} / ${label(job.nodeId)} | ${original.status} → ${job.status} | ${timing(original.arrivalS)} → ${timing(job.arrivalS)} | ${timing(original.completedS)} → ${timing(job.completedS)} | ${signed(job.arrivalDeltaS)}${job.arrivalDeltaS === null ? '' : ' s'} | ${timing(original.delayS)} → ${timing(job.delayS)} | ${job.dueTimeS} s |`);
      }
      lines.push('');
    } else lines.push('No changed job outcomes.', '');
  }
  if (bundle.generator.name === 'detourlab-browser' && bundle.generator.implementation === null) {
    lines.push('## Rerun from the embedded input and policy', '',
      'This browser packet has no verified implementation fingerprint or source revision. It projects the already-completed browser run without rerunning it. Its content hashes do not establish which implementation produced the original results, and this packet does not claim exact CLI reproduction.', '',
      'Use a trusted checkout and a supported Node version. Save both files at the fixed placeholder path review-packet/. The read-only command below checks both complete saved files against their content hashes, reruns the embedded experiment with its embedded policy under the current checkout, and compares all outcome data. It deliberately uses the current checkout identity, not the browser identity. Generator and integrity fields are expected to differ. A matching comparison does not retroactively verify the browser implementation or establish real-world validity. No experiment label is used as a command.', '',
      '```sh', "node --input-type=module -e '",
      'import { open } from "node:fs/promises";',
      'import { constants } from "node:fs";',
      'import { deepStrictEqual } from "node:assert";',
      'import { createExperimentReport, serializeExperimentReport, REPORT_LIMITS } from "./scripts/experiment-report.js";',
      'import { createReportIdentity } from "./scripts/report-identity.js";',
      'async function readBounded(file, limit) {',
      '  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);',
      '  try {',
      '    const stat = await handle.stat();',
      '    if (!stat.isFile()) throw new Error("Packet input must be a regular file");',
      '    if (stat.size > limit) throw new Error("Packet input exceeds byte limit");',
      '    const bytes = Buffer.alloc(limit + 1);',
      '    let length = 0;',
      '    while (length < bytes.length) {',
      '      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);',
      '      if (!bytesRead) break;',
      '      length += bytesRead;',
      '    }',
      '    if (length > limit) throw new Error("Packet input exceeds byte limit");',
      '    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));',
      '  } finally { await handle.close(); }',
      '}',
      'const original = await readBounded("review-packet/bundle.json", REPORT_LIMITS.maxBundleBytes);',
      'const originalReview = await readBounded("review-packet/REVIEW.md", REPORT_LIMITS.maxReviewBytes);',
      'const saved = JSON.parse(original);',
      'const verified = serializeExperimentReport(saved);',
      'if (verified.bundleJson !== original || verified.reviewMarkdown !== originalReview) throw new Error("Saved packet bytes differ");',
      'const rerun = createExperimentReport(saved.experiment, saved.policy, await createReportIdentity());',
      'const outcomes = ({ generator, integrity, ...data }) => data;',
      'deepStrictEqual(outcomes(rerun), outcomes(saved));',
      'console.log("Outcome comparison agrees under this checkout; browser implementation remains unverified");',
      "'", '```', '',
      'No thresholds were evaluated in the browser. Agreement is not a policy pass or proof of an equal-service improvement.', '');
    return lines.join('\n');
  }
  lines.push('## Reproduce from the embedded input and policy', '',
    'Use a trusted checkout and a supported Node version. Place both saved files at the fixed placeholder path review-packet/. This read-only check requires the recorded implementation fingerprint to match the checkout, reruns all variants with the embedded policy, and compares both complete files byte for byte. Unknown provenance fails explicitly. Hash agreement does not authenticate the supplied generator metadata or source revision. No experiment label is used as a command.', '',
    '```sh', "node --input-type=module -e '",
    'import { open } from "node:fs/promises";',
    'import { constants } from "node:fs";',
    'import { createExperimentReport, serializeExperimentReport, REPORT_LIMITS } from "./scripts/experiment-report.js";',
    'import { createReportIdentity } from "./scripts/report-identity.js";',
    'async function readBounded(file, limit) {',
    '  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);',
    '  try {',
    '    const stat = await handle.stat();',
    '    if (!stat.isFile()) throw new Error("Packet input must be a regular file");',
    '    if (stat.size > limit) throw new Error("Packet input exceeds byte limit");',
    '    const bytes = Buffer.alloc(limit + 1);',
    '    let length = 0;',
    '    while (length < bytes.length) {',
    '      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);',
    '      if (!bytesRead) break;',
    '      length += bytesRead;',
    '    }',
    '    if (length > limit) throw new Error("Packet input exceeds byte limit");',
    '    return bytes.subarray(0, length);',
    '  } finally { await handle.close(); }',
    '}',
    'const original = await readBounded("review-packet/bundle.json", REPORT_LIMITS.maxBundleBytes);',
    'const originalReview = await readBounded("review-packet/REVIEW.md", REPORT_LIMITS.maxReviewBytes);',
    'const saved = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(original));',
    'new TextDecoder("utf-8", { fatal: true }).decode(originalReview);',
    'const current = await createReportIdentity();',
    'const claimed = saved.generator?.implementation;',
    'if (!claimed || claimed.algorithm !== "sha256" || claimed.sha256 !== current.implementation.sha256 || JSON.stringify(claimed.files) !== JSON.stringify(current.implementation.files)) throw new Error("Unknown or mismatched implementation fingerprint");',
    'const rerun = createExperimentReport(saved.experiment, saved.policy, saved.generator);',
    'const repeated = serializeExperimentReport(rerun);',
    'if (!Buffer.from(repeated.bundleJson, "utf8").equals(original) || !Buffer.from(repeated.reviewMarkdown, "utf8").equals(originalReview)) throw new Error("Report differs");',
    'console.log("Exact packet reproduction verified");', "'", '```', '',
    'A reproduced policy failure remains a failure. An exact match establishes reproducibility under these inputs and implementation, not real-world validity.', '');
  return lines.join('\n');
}

/** Complete UTF-8 files; never truncate machine rows or review text. */
export function serializeReportFiles(bundle) {
  const bundleJson = jsonFile(bundle);
  if (new TextEncoder().encode(bundleJson).byteLength > REPORT_LIMITS.maxBundleBytes) throw new Error('Experiment report bundle exceeds the 8 MiB limit. Reduce the experiment; no rows were truncated.');
  const reviewMarkdown = renderReview(bundle);
  if (new TextEncoder().encode(reviewMarkdown).byteLength > REPORT_LIMITS.maxReviewBytes) throw new Error('Experiment review exceeds the 1 MiB limit. Reduce the experiment; no schedule records were truncated.');
  return { bundleJson, reviewMarkdown };
}
