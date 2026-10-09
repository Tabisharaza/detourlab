#!/usr/bin/env node
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { EXPERIMENT_LIMITS, canonicalExperiment, parseExperiment, simulateExperiment } from '../src/experiment.js';

const usage = `DetourLab experiment runner

Usage: node scripts/run-experiment.js experiment.json [options]

  --json                         Machine-readable deterministic result
  --max-extra-distance-pct N      Fail if any variant's distance grows over N percent
  --max-extra-late N              Fail if any variant's additional late jobs exceed N
  --max-unreachable N             Fail if any variant's unreachable jobs exceed N
  --help                         Show this help

Version-1 scenario files are upgraded to supplied and clear-road variants.
Threshold failures exit 1; invalid input or failed simulation exits 2.
Signed distance differences can fall when jobs are skipped. Compare completed and
unreachable jobs; a shorter traveled distance does not establish an improvement.`;

const thresholdOptions = {
  '--max-extra-distance-pct': 'extraDistancePct',
  '--max-extra-late': 'extraLateJobs',
  '--max-unreachable': 'unreachableJobs',
};

async function boundedRead(file) {
  // Nonblocking open lets us reject named pipes before a read can wait forever.
  // It has no effect on ordinary files, whose type and actual byte count follow.
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('Experiment input must be a regular file.');
    if (info.size > EXPERIMENT_LIMITS.maxBytes) throw new Error('Experiment import exceeds the 2 MiB limit.');
    // Bound the actual read too, in case the file grows after stat().
    const buffer = Buffer.alloc(EXPERIMENT_LIMITS.maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > EXPERIMENT_LIMITS.maxBytes) throw new Error('Experiment import exceeds the 2 MiB limit.');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
  } finally {
    await handle.close();
  }
}

try {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(usage);
  } else {
    let file;
    let json = false;
    const selectedThresholds = {};
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === '--json') { json = true; continue; }
      if (Object.hasOwn(thresholdOptions, arg)) {
        const raw = args[++index];
        const value = Number(raw);
        if (raw === undefined || raw.trim() === '' || !Number.isFinite(value) || value < 0) throw new Error(`${arg} requires a finite nonnegative number.`);
        const metric = thresholdOptions[arg];
        if (Object.hasOwn(selectedThresholds, metric)) throw new Error(`${arg} may only be supplied once.`);
        selectedThresholds[metric] = value;
        continue;
      }
      if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
      if (file) throw new Error('Only one experiment file is allowed.');
      file = arg;
    }
    if (!file) throw new Error('An experiment or scenario JSON file is required. Use --help for usage.');
    const thresholds = Object.fromEntries(Object.values(thresholdOptions).filter(metric => Object.hasOwn(selectedThresholds, metric)).map(metric => [metric, selectedThresholds[metric]]));
    const experiment = parseExperiment(await boundedRead(file));
    const simulation = simulateExperiment(experiment);
    const variants = simulation.variants.map(variant => {
      const violations = Object.entries(thresholds).filter(([metric, limit]) => variant.delta[metric] > limit).map(([metric, limit]) => ({ metric, actual: variant.delta[metric], limit }));
      return { id: variant.id, name: variant.name, metrics: variant.result.metrics, delta: variant.delta, passed: violations.length === 0, violations };
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
      console.log(`\nDETOURLAB / ${experiment.name}\nExperiment ${experiment.id} · seed ${result.seed}\nSHA-256 ${result.experimentSha256}\n`);
      console.log(`Clear-road baseline: ${(result.baseline.distanceM / 1000).toFixed(2)} km · ${result.baseline.lateJobs} late · ${result.baseline.unreachableJobs} unreachable · ${result.baseline.completedJobs}/${result.baseline.totalJobs} completed`);
      for (const variant of variants) {
        console.log(`\n${variant.name} [${variant.id}]\n${(variant.metrics.distanceM / 1000).toFixed(2)} km · ${variant.metrics.lateJobs} late · ${variant.metrics.unreachableJobs} unreachable · ${variant.metrics.completedJobs}/${variant.metrics.totalJobs} completed\nDelta: ${variant.delta.extraDistancePct >= 0 ? '+' : ''}${variant.delta.extraDistancePct}% distance · ${variant.delta.extraLateJobs >= 0 ? '+' : ''}${variant.delta.extraLateJobs} late`);
        console.log(variant.passed ? 'PASS: all requested thresholds met' : `FAIL: ${variant.violations.map(item => `${item.metric} ${item.actual} > ${item.limit}`).join('; ')}`);
      }
      for (const warning of warnings) console.log(`\nCAUTION [${warning.variantId}]: ${warning.message}`);
      console.log(`\n${result.passed ? 'PASS' : 'FAIL'}: experiment thresholds apply to every variant.\nSynthetic / fixed travel times / assigned order retained / arrival deadlines.`);
    }
    if (!result.passed) process.exitCode = 1;
  }
} catch (error) {
  console.error(`DetourLab: ${error.message}`);
  process.exitCode = 2;
}
