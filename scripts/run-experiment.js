#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { canonicalExperiment, parseExperiment, simulateExperiment } from '../src/experiment.js';
import { formatInputError } from '../src/file-input.js';
import { readInput } from './read-input.js';
import { parseArguments } from './cli-arguments.js';
import { formatCliLabel } from './cli-display.js';
import { compareJobOutcomes, formatJobComparison, formatThresholdViolation, hasJobThresholds, thresholdViolations } from './job-gates.js';

const usage = `DetourLab experiment runner

Usage: node scripts/run-experiment.js experiment.json [options]

  --json                         Machine-readable deterministic result
  --max-extra-distance-pct N      Fail if any variant's distance grows over N percent
  --max-extra-late N              Fail if any variant's additional late jobs exceed N
  --max-unreachable N             Fail if any variant's unreachable jobs exceed N
  --max-newly-late N              Fail if any variant's on-time to late jobs exceed N
  --max-arrival-slip-s N          Fail if any comparable arrival slips over N seconds
  --help                         Show this help

Version-1 scenario files are upgraded to supplied and clear-road variants.
Each threshold may be supplied once. Flag order does not affect results.
Threshold failures exit 1; invalid input or failed simulation exits 2.
Signed distance differences can fall when jobs are skipped. Compare completed and
unreachable jobs; a shorter traveled distance does not establish an improvement.
Arrival comparisons omit unreachable jobs. No comparable arrivals fails a requested
arrival-slip gate as unevaluable; newly-late counts use engine arrival status.`;

try {
  const { help, file, json, thresholds } = parseArguments(process.argv.slice(2), { requireFile: true });
  if (help) {
    console.log(usage);
  } else {
    const experiment = parseExperiment(await readInput(file));
    const simulation = simulateExperiment(experiment);
    const variants = simulation.variants.map(variant => {
      const jobComparison = hasJobThresholds(thresholds) ? compareJobOutcomes(simulation.baseline, variant.result) : undefined;
      const violations = thresholdViolations(variant.delta, thresholds, jobComparison);
      return { id: variant.id, name: variant.name, metrics: variant.result.metrics, delta: variant.delta, ...(jobComparison ? { jobComparison } : {}), passed: violations.length === 0, violations };
    });
    const violations = variants.flatMap(variant => variant.violations.map(violation => ({ variantId: variant.id, ...violation })));
    const warnings = variants.filter(variant => variant.metrics.unreachableJobs > 0).map(variant => ({
      variantId: variant.id,
      message: 'Unreachable jobs were skipped. Traveled distance and late-job counts cover attempted/completed work and do not establish equal-service improvements.',
    }));
    const result = {
      engineVersion: '0.1.0', experimentId: experiment.id,
      experimentSha256: createHash('sha256').update(canonicalExperiment(experiment)).digest('hex'),
      seed: experiment.baseScenario.seed, baseline: simulation.baseline.metrics,
      variants, thresholds, passed: violations.length === 0, violations, warnings,
    };
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`\nDETOURLAB / ${formatCliLabel(experiment.name)}\nExperiment ${experiment.id} · seed ${result.seed}\nSHA-256 ${result.experimentSha256}\n`);
      console.log(`Clear-road baseline: ${(result.baseline.distanceM / 1000).toFixed(2)} km · ${result.baseline.lateJobs} late · ${result.baseline.unreachableJobs} unreachable · ${result.baseline.completedJobs}/${result.baseline.totalJobs} completed`);
      for (const variant of variants) {
        console.log(`\n${formatCliLabel(variant.name)} [${variant.id}]\n${(variant.metrics.distanceM / 1000).toFixed(2)} km · ${variant.metrics.lateJobs} late · ${variant.metrics.unreachableJobs} unreachable · ${variant.metrics.completedJobs}/${variant.metrics.totalJobs} completed\nDelta: ${variant.delta.extraDistancePct >= 0 ? '+' : ''}${variant.delta.extraDistancePct}% distance · ${variant.delta.extraLateJobs >= 0 ? '+' : ''}${variant.delta.extraLateJobs} late`);
        if (variant.jobComparison) console.log(formatJobComparison(variant.jobComparison));
        console.log(variant.passed ? 'PASS: all requested thresholds met' : `FAIL: ${variant.violations.map(formatThresholdViolation).join('; ')}`);
      }
      for (const warning of warnings) console.log(`\nCAUTION [${warning.variantId}]: ${warning.message}`);
      console.log(`\n${result.passed ? 'PASS' : 'FAIL'}: experiment thresholds apply to every variant.\nSynthetic / fixed travel times / assigned order retained / arrival deadlines.`);
    }
    if (!result.passed) process.exitCode = 1;
  }
} catch (error) {
  console.error(`DetourLab: ${formatInputError(error)}`);
  process.exitCode = 2;
}
