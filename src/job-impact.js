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

