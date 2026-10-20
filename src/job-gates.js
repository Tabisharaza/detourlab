const JOB_METRICS = ['newlyLateJobs', 'maxArrivalSlipS'];

export const hasJobThresholds = thresholds => JOB_METRICS.some(metric => Object.hasOwn(thresholds, metric));

function indexJobs(result) {
  const jobs = new Map();
  const vehicles = new Set();
  for (const vehicle of result.vehicles) {
    if (vehicles.has(vehicle.id)) throw new Error('Job comparison requires unique vehicle IDs.');
    vehicles.add(vehicle.id);
    for (const job of vehicle.jobs) {
      if (jobs.has(job.id)) throw new Error('Job comparison requires unique job IDs.');
      const reachable = job.status === 'on-time' || job.status === 'late';
      if (!(reachable ? Number.isFinite(job.arrivalS) && job.arrivalS >= 0 : job.status === 'unreachable' && job.arrivalS === null)) {
        throw new Error('Job comparison requires engine statuses and finite reachable arrivals or null unreachable arrivals.');
      }
      jobs.set(job.id, { vehicleId: vehicle.id, job });
    }
  }
  return { jobs, vehicles };
}

/**
 * Internal helper for completed engine ledgers from the SAME scenario/demand.
 * The engine supplies unique IDs, fixed vehicle assignments and arrival statuses;
 * it uses null arrivals for unreachable jobs. This is not an external-data parser.
 * Guard identity and timing invariants so mismatched ledgers cannot silently pass.
 * Pair by ID, never ledger order. Trust engine statuses (including its deadline
 * tolerance), retain literal timing precision, and never resimulate or mutate.
 */
export function compareJobOutcomes(baseline, variant) {
  const before = indexJobs(baseline), after = indexJobs(variant);
  if (before.vehicles.size !== after.vehicles.size || [...before.vehicles].some(id => !after.vehicles.has(id)) || before.jobs.size !== after.jobs.size) {
    throw new Error('Job comparison requires matching vehicle and job identities.');
  }
  const summary = { totalJobs: before.jobs.size, comparableJobs: 0, uncomparableJobs: 0, newlyLateJobs: 0, maxArrivalSlipS: null };
  for (const [id, original] of before.jobs) {
    const selected = after.jobs.get(id);
    if (!selected || original.vehicleId !== selected.vehicleId || original.job.nodeId !== selected.job.nodeId || original.job.dueTimeS !== selected.job.dueTimeS) {
      throw new Error('Job comparison requires matching job identities, assignments, destinations and deadlines.');
    }
    const a = original.job, b = selected.job;
    if (a.status === 'on-time' && b.status === 'late') summary.newlyLateJobs += 1;
    if (a.status === 'unreachable' || b.status === 'unreachable') {
      summary.uncomparableJobs += 1;
    } else {
      summary.comparableJobs += 1;
      summary.maxArrivalSlipS = Math.max(summary.maxArrivalSlipS ?? 0, b.arrivalS - a.arrivalS);
    }
  }
  return summary;
}

/** Preserve caller threshold order and the existing numeric violation shape. */
export function thresholdViolations(delta, thresholds, jobComparison) {
  if (hasJobThresholds(thresholds) && !jobComparison) throw new Error('Job thresholds require a job comparison.');
  const violations = [];
  for (const [metric, limit] of Object.entries(thresholds)) {
    const actual = JOB_METRICS.includes(metric) ? jobComparison[metric] : delta[metric];
    if (metric === 'maxArrivalSlipS' && actual === null) {
      violations.push({ metric, actual, limit, reason: 'no-comparable-jobs' });
    } else if (actual > limit) {
      violations.push({ metric, actual, limit });
    }
  }
  return violations;
}

export function formatThresholdViolation({ metric, actual, limit, reason }) {
  return reason === 'no-comparable-jobs'
    ? `${metric} unevaluable: no comparable arrivals (limit ${limit} s)`
    : `${metric} ${actual} > ${limit}`;
}

export function formatJobComparison(summary) {
  const maximum = summary.maxArrivalSlipS === null ? 'n/a (no comparable arrivals)' : `${summary.maxArrivalSlipS} s`;
  return `Job comparison: ${summary.totalJobs} total jobs; ${summary.comparableJobs} comparable; ${summary.uncomparableJobs} uncomparable (unreachable in baseline or variant).\nNewly late jobs (on-time -> late): ${summary.newlyLateJobs}; maximum arrival slip: ${maximum}.\nUnreachable jobs are omitted from timing comparisons; passing these gates does not establish overall service improvement.`;
}
