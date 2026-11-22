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

export const VARIANT_COMPARISON_MAX_BYTES = 4 * 1024 * 1024;
export const EVIDENCE_LIMIT = 8 * 1024 * 1024;
export const EVIDENCE_LIMIT_MESSAGE = 'Comparison evidence must be at most 8 MiB.';
export const COMPARISON_EVIDENCE_FORMAT = 'detourlab-comparison-evidence';
export const COMPARISON_EVIDENCE_VERSION = 1;
const asSide = ({ status, arrivalS, completedS, delayS }) => ({
  status, arrivalS, completedS, latenessS: delayS,
});

export function createVariantComparisonReport(experimentId, experimentSha256, reference, candidate, { delta, summary, jobs }) {
  return {
    format: 'detourlab-variant-comparison',
    version: 1,
    engineVersion: '0.1.0',
    experimentId, experimentSha256, reference, candidate, delta, summary,
    jobs: jobs.map(({ baseline, variant, delayDeltaS, ...row }) => ({
      ...row,
      reference: asSide(baseline),
      candidate: asSide(variant),
      latenessDeltaS: delayDeltaS,
    })),
  };
}

function encodeBounded(text, limit, message) {
  if (new TextEncoder().encode(text).byteLength > limit) throw new Error(message);
  return text;
}

export function renderVariantComparisonJson(report) {
  return encodeBounded(JSON.stringify(report, null, 2) + '\n', VARIANT_COMPARISON_MAX_BYTES,
    'Variant comparison report exceeds the 4 MiB limit.');
}

export function renderComparisonEvidence(evidence) {
  // Keep exact compact wire bytes in both Node and browsers.
  return encodeBounded(JSON.stringify(evidence) + '\n', EVIDENCE_LIMIT, EVIDENCE_LIMIT_MESSAGE);
}
