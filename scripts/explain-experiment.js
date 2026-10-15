#!/usr/bin/env node
import { parseExperiment } from '../src/experiment.js';
import { formatInputError } from '../src/file-input.js';
import { readInput } from './read-input.js';
import { formatCliLabel } from './cli-display.js';
import { createJobImpactReport } from './job-impact.js';

const usage = `DetourLab job-impact explainer

Usage: node scripts/explain-experiment.js experiment.json --variant ID [--json]

  --variant ID     Required existing variant ID, supplied once
  --json           Complete versioned job-impact report, at most 4 MiB
  --help           Show this help without reading a file

Compare each job's status, arrival, service completion and lateness against the
clear-road baseline. Human output shows the first 20 changed jobs in input order;
JSON includes every job (at most 2000), including unchanged and unreachable work.
Version-1 scenarios are upgraded to supplied and clear-roads variants.
All experiment variants are simulated under the usual work/result budgets.
Exit 0 means a report was produced, not that a threshold or safety policy passed.
Invalid input or failed simulation exits 2 with no partial report.
Use run-experiment.js for threshold gates. No route-causality claim is made.`;

function argumentsFor(args) {
  if (args.includes('--help')) return { help: true };
  let file;
  let variantId;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') { json = true; continue; }
    if (arg === '--variant') {
      if (variantId !== undefined) throw new Error('--variant may only be supplied once.');
      const value = args[++index];
      if (!value || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/u.test(value)) {
        throw new Error('--variant requires a safe variant ID of at most 96 characters.');
      }
      variantId = value;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    if (file !== undefined) throw new Error('Only one input file is allowed.');
    file = arg;
  }
  if (!file) throw new Error('An experiment or scenario JSON file is required. Use --help for usage.');
  if (variantId === undefined) throw new Error('--variant is required. Use --help for usage.');
  return { help: false, file, variantId, json };
}

const seconds = value => value === null ? 'n/a' : `${value} s`;
const difference = value => value === null ? 'n/a (not comparable)' : `${value > 0 ? '+' : ''}${value} s`;

function humanReport(report) {
  const { summary } = report;
  const lines = [
    'DETOURLAB / JOB IMPACT',
    `Experiment ${report.experimentId} / ${formatCliLabel(report.variant.name)} [${report.variant.id}]`,
    `SHA-256 ${report.experimentSha256}`,
    '',
    `Jobs: ${summary.totalJobs} total / ${summary.changedJobs} changed / ${summary.unchangedJobs} unchanged`,
    `Status changed: ${summary.statusChangedJobs} / arrival changed: ${summary.arrivalChangedJobs}`,
    'Status transitions (clear-road baseline -> selected variant):',
  ];
  for (const before of ['on-time', 'late', 'unreachable']) {
    for (const after of ['on-time', 'late', 'unreachable']) {
      const count = summary.transitions[before][after];
      if (count) lines.push(`  ${before} -> ${after}: ${count}`);
    }
  }
  const changed = report.jobs.filter(job => job.changed);
  lines.push('', `Changed jobs shown: ${Math.min(changed.length, 20)} of ${changed.length} (input order)`);
  for (const job of changed.slice(0, 20)) {
    lines.push(
      `${job.id} / vehicle ${job.vehicleId} / node ${job.nodeId}`,
      `  ${job.baseline.status} -> ${job.variant.status}; arrival deadline ${seconds(job.dueTimeS)}`,
      `  Arrival ${seconds(job.baseline.arrivalS)} -> ${seconds(job.variant.arrivalS)}; difference ${difference(job.arrivalDeltaS)}`,
      `  Service complete ${seconds(job.baseline.completedS)} -> ${seconds(job.variant.completedS)}; difference ${difference(job.completedDeltaS)}`,
      `  Lateness ${seconds(job.baseline.delayS)} -> ${seconds(job.variant.delayS)}; difference ${difference(job.delayDeltaS)}`,
    );
  }
  if (changed.length > 20) lines.push(`${changed.length - 20} additional changed jobs omitted from this view; use --json for every job.`);
  if (report.baselineMetrics.unreachableJobs || report.variantMetrics.unreachableJobs) {
    lines.push('', 'CAUTION: unreachable work is skipped. Missing timings and their differences are n/a, not zero or an improvement.');
  }
  lines.push('',
    'Changed means status, arrival or service completion changed. Equal outcomes do not prove identical routes.',
    'This is an outcome comparison, not complete causal attribution or a threshold verdict.',
    'Synthetic / fixed travel times / assigned order retained / arrival deadlines.');
  return lines.join('\n');
}

try {
  const options = argumentsFor(process.argv.slice(2));
  if (options.help) console.log(usage);
  else {
    const input = parseExperiment(await readInput(options.file));
    const report = createJobImpactReport(input, options.variantId);
    console.log(options.json ? JSON.stringify(report, null, 2) : humanReport(report));
  }
} catch (error) {
  console.error(`DetourLab: ${formatInputError(error)}`);
  process.exitCode = 2;
}
