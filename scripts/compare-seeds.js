#!/usr/bin/env node
import { exportExperiment } from '../src/experiment.js';
import { formatInputError } from '../src/file-input.js';
import { parseArguments } from './cli-arguments.js';
import { formatThresholdViolation } from './job-gates.js';
import { compareMeridianSeeds, createMeridianExperiment, normalizeMeridianPlans, normalizeSeed, normalizeSeeds, serializeSeedStudy } from './meridian-study.js';

const usage = `DetourLab Meridian synthetic seed study

Usage: node scripts/compare-seeds.js --seeds 7,42,99 [options]
       node scripts/compare-seeds.js --export-seed 42 [--plans ID,ID,...]

  --seeds N,N,...                 2–12 distinct integer seeds, 0–4294967295
  --plans ID,ID,...               2–4 distinct named plans (default market-05,market-10)
                                 Choices: market-05, market-10, all-bridges-05, clear-roads
  --json                         Complete deterministic machine-readable report
  --export-seed N                 Print a standard experiment without simulation
  --max-extra-distance-pct N      Limit per-sample distance growth versus clear roads
  --max-extra-late N              Limit per-sample additional late jobs
  --max-unreachable N             Limit per-sample absolute unreachable jobs
  --max-newly-late N              Limit per-sample on-time to late jobs
  --max-arrival-slip-s N          Limit per-sample comparable arrival slip
  --help                         Show help without generating or simulating

Generated Meridian fixtures ONLY. No input file is accepted. Seeds vary assumed
travel times, destinations, service durations and deadline slack, not just demand.
Seeds are sorted numerically; plans use fixed documented order. Each flag once.
Every selected seed and plan must meet every supplied gate, never just the mean.
No policy means NOT EVALUATED. Results are descriptive samples, not probabilities,
confidence intervals, an optimal plan or operational safety evidence.
--export-seed excludes --seeds, --json and thresholds; --plans still applies.
The command writes only stdout. Redirect to a NEW file, never an existing input.
Exit 0: completed/all supplied gates pass, no gates evaluated, or export complete.
Exit 1: at least one sampled plan fails policy; the complete report is retained.
Exit 2: invalid request, exceeded budget or simulation failure; no partial report.`;

function argumentsFor(args) {
  if (args.includes('--help')) return { help: true };
  const selected = {}, remaining = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (['--seeds', '--plans', '--export-seed'].includes(arg)) {
      if (Object.hasOwn(selected, arg)) throw new Error(`${arg} may only be supplied once.`);
      const value = args[++i];
      if (value === undefined || !value.trim() || value.startsWith('-')) throw new Error(`${arg} requires a value.`);
      if (value.length > 1024) throw new Error(`${arg} exceeds its 1024-character limit.`);
      selected[arg] = value;
    } else {
      if (arg === '--json' && remaining.includes('--json')) throw new Error('--json may only be supplied once.');
      remaining.push(arg);
      // Preserve shared threshold value boundaries while extracting study flags.
      if (/^--max-(extra-distance-pct|extra-late|unreachable|newly-late|arrival-slip-s)$/u.test(arg) && i + 1 < args.length) remaining.push(args[++i]);
    }
  }
  const options = parseArguments(remaining);
  if (options.file) throw new Error('No input file is accepted; this study generates original Meridian fixtures only.');
  const plans = normalizeMeridianPlans(selected['--plans']?.split(',').map(id => id.trim()));
  const integer = raw => {
    if (!/^\d+$/u.test(raw.trim())) throw new Error('Seeds require unsigned decimal integers, not fractions, exponents or hexadecimal.');
    return normalizeSeed(Number(raw.trim()));
  };
  const exportOnly = Object.hasOwn(selected, '--export-seed');
  if (exportOnly) {
    if (Object.hasOwn(selected, '--seeds') || options.json || Object.keys(options.thresholds).length) throw new Error('--export-seed cannot be combined with --seeds, --json or thresholds.');
    return { ...options, plans, exportOnly, seed: integer(selected['--export-seed']) };
  }
  if (!Object.hasOwn(selected, '--seeds')) throw new Error('--seeds is required (or use --export-seed).');
  return { ...options, plans, seeds: normalizeSeeds(selected['--seeds'].split(',').map(integer)) };
}

function renderStudy(report) {
  const lines = ['DETOURLAB / MERIDIAN SYNTHETIC SEED STUDY', `Seeds: ${report.seeds.join(', ')}. Plans: ${report.plans.join(', ')}.`];
  for (const run of report.runs) {
    lines.push(`\nSeed ${run.seed} / experiment SHA-256 ${run.experimentSha256}`);
    lines.push(`Clear-road baseline: ${run.baseline.distanceM} m; ${run.baseline.lateJobs} late; ${run.baseline.unreachableJobs} unreachable; ${run.baseline.completedJobs}/${run.baseline.totalJobs} completed.`);
    for (const variant of run.variants) {
      lines.push(`${variant.id}: ${variant.metrics.distanceM} m; ${variant.metrics.lateJobs} late; ${variant.metrics.unreachableJobs} unreachable; ${variant.metrics.completedJobs}/${variant.metrics.totalJobs} completed. Delta: ${variant.delta.extraDistancePct}% distance, ${variant.delta.extraLateJobs} late. Policy: ${variant.verdict.toUpperCase().replace('-', ' ')}.`);
      for (const violation of variant.violations) lines.push(`  ${formatThresholdViolation(violation)}`);
    }
  }
  lines.push('\nDESCRIPTIVE PER-PLAN SUMMARY (min / mean / max across these seeds)');
  const stats = value => `${value.min ?? 'n/a'} / ${value.mean ?? 'n/a'} / ${value.max ?? 'n/a'}`;
  for (const variant of report.variants) {
    const s = variant.summary;
    lines.push(`${variant.id}: late ${stats(s.metrics.lateJobs)}; completed ${stats(s.metrics.completedJobs)}; unreachable ${stats(s.metrics.unreachableJobs)}; extra distance % ${stats(s.delta.extraDistancePct)}.`);
    lines.push(`  Arrival slip s: ${stats(s.jobComparison.maxArrivalSlipS)} (${s.jobComparison.maxArrivalSlipS.samples} available, ${s.jobComparison.maxArrivalSlipS.missingSamples} missing). Policy: ${variant.verdict.toUpperCase().replace('-', ' ')}.${variant.failedSeeds === null ? '' : ` Failed seeds: ${variant.failedSeeds.join(', ') || 'none'}.`}`);
  }
  lines.push(`\nOverall policy: ${report.verdict.toUpperCase().replace('-', ' ')}.`);
  for (const warning of report.warnings) lines.push(`CAUTION [seed ${warning.seed} / ${warning.variantId}]: ${warning.message}`);
  lines.push(...report.limitations);
  return `${lines.join('\n')}\n`;
}

try {
  const options = argumentsFor(process.argv.slice(2));
  if (options.help) console.log(usage);
  else if (options.exportOnly) console.log(exportExperiment(createMeridianExperiment(options.seed, options.plans)));
  else {
    const report = compareMeridianSeeds(options.seeds, options.plans, options.thresholds);
    process.stdout.write(options.json ? serializeSeedStudy(report) : renderStudy(report));
    if (report.verdict === 'failed') process.exitCode = 1;
  }
} catch (error) {
  console.error(`DetourLab: ${formatInputError(error)}`);
  process.exitCode = 2;
}
