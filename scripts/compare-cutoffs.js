#!/usr/bin/env node
import { parseExperiment, exportExperiment } from '../src/experiment.js';
import { formatInputError } from '../src/file-input.js';
import { parseArguments } from './cli-arguments.js';
import { readInput } from './read-input.js';
import { formatCliLabel } from './cli-display.js';
import { formatJobComparison, formatThresholdViolation } from './job-gates.js';
import { createCutoffExperiment, normalizeCutoffTimes } from './cutoff-experiment.js';
import { compareCutoffs } from './cutoff-comparison.js';

const usage = `DetourLab sampled closure-cutoff comparison

Usage: node scripts/compare-cutoffs.js experiment.json --variant ID --closure ID --times 0,300,600 [options]

  --variant ID                   Existing source variant to copy
  --closure ID                   Existing closure event within that variant
  --times S,S,...                 2–6 unique finite decimal times, 0–604800 seconds
  --json                         Machine-readable comparison report
  --export-experiment            Print generated standard experiment only; no simulation
  --max-extra-distance-pct N      Limit additional distance versus clear-road baseline
  --max-extra-late N              Limit additional late jobs
  --max-unreachable N             Limit absolute unreachable jobs
  --max-newly-late N              Limit on-time to late jobs
  --max-arrival-slip-s N          Limit comparable arrival slip in seconds
  --help                         Show help without reading input

Each option may be supplied once. Samples are sorted numerically. Other closure
records, shared geometry, demand and job order are preserved. Existing experiment
and engine work limits apply, including baseline plus all candidate ledgers.
--export-experiment cannot be combined with --json or thresholds. Output is only
stdout; no file is created or overwritten by this command. If redirecting stdout,
use a NEW destination, never the input filename (shell redirection happens first).
Exit 0: comparison complete and every supplied gate passed, or no gates evaluated;
        or validated experiment exported without evaluation.
Exit 1: one or more sampled candidates failed a supplied gate (report still complete).
Exit 2: invalid input, exceeded budget, or simulation failure; no partial report.
Passing samples do not establish an optimal time, passing interval or safety.
Later cutoffs are not assumed better. Skipped work may reduce distance/lateness.`;

function argumentsFor(args) {
  if (args.includes('--help')) return { help: true };
  const remaining = [];
  const selected = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (['--variant', '--closure', '--times'].includes(arg)) {
      if (Object.hasOwn(selected, arg)) throw new Error(`${arg} may only be supplied once.`);
      const value = args[++index];
      if (value === undefined || !value.trim() || value.startsWith('-')) throw new Error(`${arg} requires a value.`);
      selected[arg] = value;
    } else if (arg === '--export-experiment') {
      if (selected.export) throw new Error('--export-experiment may only be supplied once.');
      selected.export = true;
    } else {
      if (arg === '--json' && remaining.includes('--json')) throw new Error('--json may only be supplied once.');
      remaining.push(arg);
      // Preserve shared threshold value boundaries while extracting our flags.
      if (/^--max-(extra-distance-pct|extra-late|unreachable|newly-late|arrival-slip-s)$/u.test(arg) && index + 1 < args.length) remaining.push(args[++index]);
    }
  }
  const parsed = parseArguments(remaining, { requireFile: true });
  for (const flag of ['--variant', '--closure', '--times']) if (!Object.hasOwn(selected, flag)) throw new Error(`${flag} is required.`);
  const raw = selected['--times'];
  if (raw.length > 1024) throw new Error('--times exceeds its 1024-character limit.');
  const tokens = raw.split(',').map(value => value.trim());
  if (tokens.some(value => !/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value))) throw new Error('--times requires comma-separated nonnegative decimal numbers.');
  const times = normalizeCutoffTimes(tokens.map(Number));
  if (selected.export && (parsed.json || Object.keys(parsed.thresholds).length)) throw new Error('--export-experiment cannot be combined with --json or thresholds.');
  return { ...parsed, variantId: selected['--variant'], closureId: selected['--closure'], times, exportOnly: !!selected.export };
}

try {
  const options = argumentsFor(process.argv.slice(2));
  if (options.help) console.log(usage);
  else {
    const input = parseExperiment(await readInput(options.file));
    if (options.exportOnly) console.log(exportExperiment(createCutoffExperiment(input, options.variantId, options.closureId, options.times)));
    else {
      const report = compareCutoffs(input, options.variantId, options.closureId, options.times, options.thresholds);
      if (options.json) console.log(JSON.stringify(report, null, 2));
      else {
        console.log(`DETOURLAB / SAMPLED CUTOFFS\nSource ${formatCliLabel(report.source.experimentId)} / ${formatCliLabel(report.source.variantId)} / ${formatCliLabel(report.source.closureId)}\nOriginal cutoff: ${report.source.originalCutoffS} s\nGenerated experiment SHA-256: ${report.experimentSha256}`);
        console.log(`Clear-road baseline: ${report.baseline.distanceM} m; ${report.baseline.lateJobs} late; ${report.baseline.unreachableJobs} unreachable; ${report.baseline.completedJobs}/${report.baseline.totalJobs} completed.`);
        for (const candidate of report.candidates) {
          console.log(`\n${candidate.cutoffS} s [${candidate.id}]: ${candidate.metrics.distanceM} m; ${candidate.metrics.lateJobs} late; ${candidate.metrics.unreachableJobs} unreachable; ${candidate.metrics.completedJobs}/${candidate.metrics.totalJobs} completed.`);
          console.log(`Delta versus clear roads: ${candidate.delta.extraDistancePct}% distance; ${candidate.delta.extraLateJobs} late jobs. Policy: ${candidate.verdict.toUpperCase().replace('-', ' ')}.`);
          if (candidate.jobComparison) console.log(formatJobComparison(candidate.jobComparison));
          for (const violation of candidate.violations) console.log(formatThresholdViolation(violation));
        }
        console.log(`\nOverall policy: ${report.verdict.toUpperCase().replace('-', ' ')}.`);
        if (report.passingSampleTimesS) console.log(`Passing sampled times (s): ${report.passingSampleTimesS.length ? report.passingSampleTimesS.join(', ') : 'none'}.`);
        for (const warning of report.warnings) console.log(`CAUTION [${warning.candidateId}]: ${warning.message}`);
        for (const limitation of report.limitations) console.log(limitation);
      }
      if (report.verdict === 'failed') process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(`DetourLab: ${formatInputError(error)}`);
  process.exitCode = 2;
}
