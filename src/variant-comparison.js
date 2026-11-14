import { projectJobOutcomes } from './job-impact.js';

/** Inspect two completed ledgers over the same validated demand, without routing or rounding. */
export function projectVariantComparison(experiment, referenceResult, candidateResult) {
  const { summary, jobs } = projectJobOutcomes(experiment, referenceResult, candidateResult);
  const arrivals = { earlier: 0, unchanged: 0, later: 0, notComparable: 0 };
  for (const { arrivalDeltaS } of jobs) {
    if (arrivalDeltaS === null) arrivals.notComparable += 1;
    else if (arrivalDeltaS < 0) arrivals.earlier += 1;
    else if (arrivalDeltaS > 0) arrivals.later += 1;
    else arrivals.unchanged += 1;
  }
  const delta = Object.fromEntries(['distanceM', 'lateJobs', 'unreachableJobs', 'completedJobs']
    .map(key => [key, candidateResult.metrics[key] - referenceResult.metrics[key]]));
  return { delta, summary: { ...summary, arrivals }, jobs };
}
