import { createHash } from 'node:crypto';
import { canonicalExperiment, simulateExperiment, validateExperiment } from '../src/experiment.js';

/** Bound the complete, two-space-indented UTF-8 report and its final newline. */
export const IMPACT_LIMITS = Object.freeze({ maxBytes: 4 * 1024 * 1024 });

const STATUSES = ['on-time', 'late', 'unreachable'];

function outcomesById(result) {
  return new Map(result.vehicles.flatMap(vehicle => vehicle.jobs.map(job => [job.id, job])));
}

function outcome(job) {
  // Trust the engine's deadline tolerance rather than reclassifying a tiny
  // positive floating-point difference as late. Unreachable is never zero delay.
  return {
    status: job.status,
    arrivalS: job.arrivalS,
    completedS: job.completedS,
    delayS: job.status === 'unreachable' ? null : job.status === 'on-time' ? 0 : Math.max(0, job.arrivalS - job.dueTimeS),
  };
}

const difference = (baseline, variant) => baseline === null || variant === null ? null : variant - baseline;

/**
 * Pure projection of two completed ledgers from the same validated experiment.
 * No validation, simulation, mutation or rounding: callers own those boundaries.
 * Preserve the legacy report's property order as well as its job semantics.
 */
export function projectJobOutcomes(experiment, baselineResult, variantResult) {
  const baselineJobs = outcomesById(baselineResult);
  const variantJobs = outcomesById(variantResult);
  const summary = {
    totalJobs: experiment.baseScenario.jobs.length,
    changedJobs: 0,
    unchangedJobs: 0,
    statusChangedJobs: 0,
    arrivalChangedJobs: 0,
    transitions: Object.fromEntries(STATUSES.map(from => [from, Object.fromEntries(STATUSES.map(to => [to, 0]))])),
  };
  const jobs = experiment.baseScenario.jobs.map(job => {
    const baseline = outcome(baselineJobs.get(job.id));
    const variant = outcome(variantJobs.get(job.id));
    const statusChanged = baseline.status !== variant.status;
    const arrivalChanged = baseline.arrivalS !== variant.arrivalS;
    const changed = statusChanged || arrivalChanged || baseline.completedS !== variant.completedS;
    summary.changedJobs += Number(changed);
    summary.unchangedJobs += Number(!changed);
    summary.statusChangedJobs += Number(statusChanged);
    summary.arrivalChangedJobs += Number(arrivalChanged);
    summary.transitions[baseline.status][variant.status] += 1;
    return {
      id: job.id,
      vehicleId: job.vehicleId,
      nodeId: job.nodeId,
      dueTimeS: job.dueTimeS,
      baseline,
      variant,
      changed,
      statusChanged,
      arrivalDeltaS: difference(baseline.arrivalS, variant.arrivalS),
      completedDeltaS: difference(baseline.completedS, variant.completedS),
      delayDeltaS: difference(baseline.delayS, variant.delayS),
    };
  });
  return { summary, jobs };
}

/**
 * Compare one existing variant's job outcomes with the clear-road baseline.
 * Validate first and run the unchanged, fully budgeted experiment runner; an
 * unselected variant can still reject the experiment. No partial report escapes.
 * Rows retain original input job order. Changed outcomes do not imply changed
 * routes, equal paths, closure causality, or an equal-service improvement.
 */
export function createJobImpactReport(input, variantId) {
  const experiment = validateExperiment(input);
  if (typeof variantId !== 'string') throw new Error('Experiment variant ID must be a string.');
  if (!experiment.variants.some(variant => variant.id === variantId)) throw new Error(`Unknown experiment variant "${variantId}".`);
  const simulation = simulateExperiment(experiment);
  const selected = simulation.variants.find(variant => variant.id === variantId);
  const { summary, jobs } = projectJobOutcomes(experiment, simulation.baseline, selected.result);
  const report = {
    format: 'detourlab-job-impact',
    version: 1,
    engineVersion: '0.1.0',
    experimentId: experiment.id,
    experimentSha256: createHash('sha256').update(canonicalExperiment(experiment)).digest('hex'),
    variant: { id: selected.id, name: selected.name },
    baselineMetrics: { ...simulation.baseline.metrics },
    variantMetrics: { ...selected.result.metrics },
    // Keep the experiment runner's established delta semantics and precision.
    delta: { ...selected.delta },
    summary,
    jobs,
  };
  if (Buffer.byteLength(`${JSON.stringify(report, null, 2)}\n`, 'utf8') > IMPACT_LIMITS.maxBytes) throw new Error('Job impact report exceeds the 4 MiB limit.');
  return report;
}
