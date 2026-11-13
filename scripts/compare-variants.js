#!/usr/bin/env node
import { EXPERIMENT_LIMITS, parseExperiment } from '../src/experiment.js';
import { formatInputError } from '../src/file-input.js';
import { formatCliLabel } from './cli-display.js';
import { readInput } from './read-input.js';
import { compareVariants, isVariantId, renderVariantComparisonJson } from './variant-comparison.js';

const usage = `DetourLab / Compare two named variants

Usage: node scripts/compare-variants.js experiment.json --reference ID --candidate ID [--json]

  --reference ID  Existing variant used as the comparison reference
  --candidate ID  Different existing variant to compare with the reference
  --json          Complete versioned report (at most 4 MiB); default is a short human view
  --help          Show help without reading a file

All signed differences are candidate minus reference. Missing arrival evidence is
not comparable, not zero. The command runs the full experiment under existing
budgets, including unselected variants. Legacy scenarios upgrade to supplied and
clear-roads. Exit 0 produces a comparison, not an acceptance decision; invalid
input or failed simulation exits 2 without a partial report.`;

function argumentsFor(args) {
  if (args.includes('--help')) return { help: true };
  let file;
  let json = false;
  const ids = new Map();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') {
      if (json) throw new Error('--json may only be supplied once.');
      json = true;
    } else if (arg === '--reference' || arg === '--candidate') {
      if (ids.has(arg)) throw new Error(`${arg} may only be supplied once.`);
      const id = args[++i];
      if (!isVariantId(id)) {
        throw new Error(`${arg} requires a safe variant ID of at most ${EXPERIMENT_LIMITS.idLength} characters.`);
      }
      ids.set(arg, id);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      if (file !== undefined) throw new Error('Only one input file is allowed.');
      file = arg;
    }
  }
  if (!file) throw new Error('An experiment or scenario JSON file is required. Use --help for usage.');
  for (const flag of ['--reference', '--candidate']) {
    if (!ids.has(flag)) throw new Error(`${flag} is required. Use --help for usage.`);
  }
  return { file, json, referenceId: ids.get('--reference'), candidateId: ids.get('--candidate') };
}

const signed = value => `${value > 0 ? '+' : ''}${value}`;
const time = value => value === null ? 'n/a' : `${value} s`;
const shift = value => value === null ? 'not comparable' : `${signed(value)} s`;

function humanReport(report) {
  const { summary, reference, candidate, delta } = report;
  const lines = ['DETOURLAB / VARIANT COMPARISON', `Experiment ${report.experimentId}`,
    `SHA-256 ${report.experimentSha256}`, ''];
  for (const [label, side] of [['Reference', reference], ['Candidate', candidate]]) {
    const { distanceM, lateJobs, unreachableJobs, completedJobs, totalJobs } = side.metrics;
    lines.push(`${label}: ${formatCliLabel(side.name)} [${side.id}]`,
      `  ${distanceM} m | ${lateJobs} late | ${unreachableJobs} unreachable | ${completedJobs}/${totalJobs} completed`);
  }
  lines.push(
    `Candidate minus reference: ${signed(delta.distanceM)} m | ${signed(delta.lateJobs)} late | ${signed(delta.unreachableJobs)} unreachable | ${signed(delta.completedJobs)} completed`,
    '',
    `Deliveries: ${summary.totalJobs} total | ${summary.changedJobs} changed | ${summary.statusChangedJobs} status changes`,
    `Arrivals: ${summary.arrivals.earlier} earlier | ${summary.arrivals.unchanged} unchanged | ${summary.arrivals.later} later | ${summary.arrivals.notComparable} not comparable`,
    'Delivery status transitions (reference -> candidate):',
  );
  for (const [before, next] of Object.entries(summary.transitions)) {
    for (const [after, count] of Object.entries(next)) {
      if (count) lines.push(`  ${before} -> ${after}: ${count}`);
    }
  }
  const changed = report.jobs.filter(job => job.changed);
  lines.push('', `Changed deliveries shown: ${Math.min(changed.length, 20)} of ${changed.length} (input order)`);
  for (const job of changed.slice(0, 20)) {
    lines.push(
      `${job.id} / vehicle ${job.vehicleId} / node ${job.nodeId}`,
      `  ${job.reference.status} -> ${job.candidate.status}; arrival deadline ${time(job.dueTimeS)}`,
      `  Arrival ${time(job.reference.arrivalS)} -> ${time(job.candidate.arrivalS)}; shift ${shift(job.arrivalDeltaS)}`,
      `  Service complete ${time(job.reference.completedS)} -> ${time(job.candidate.completedS)}; shift ${shift(job.completedDeltaS)}`,
      `  Lateness ${time(job.reference.latenessS)} -> ${time(job.candidate.latenessS)}; shift ${shift(job.latenessDeltaS)}`,
    );
  }
  if (changed.length > 20) lines.push('Use --json for every delivery, including unchanged and unreachable work.');
  if (reference.metrics.unreachableJobs || candidate.metrics.unreachableJobs) {
    lines.push('', 'Unreachable work is skipped. Fewer late jobs or fewer meters can reflect less work completed.');
  }
  lines.push('', 'Synthetic fixed-order outcomes. No acceptance policy or route-causality claim.');
  return `${lines.join('\n')}\n`;
}

try {
  const options = argumentsFor(process.argv.slice(2));
  if (options.help) console.log(usage);
  else {
    const experiment = parseExperiment(await readInput(options.file));
    const report = compareVariants(experiment, options.referenceId, options.candidateId);
    process.stdout.write(options.json ? renderVariantComparisonJson(report) : humanReport(report));
  }
} catch (error) {
  console.error(`DetourLab: ${formatInputError(error)}`);
  process.exitCode = 2;
}
