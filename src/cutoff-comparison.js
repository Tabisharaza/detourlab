import { validateExperiment } from './experiment.js';
import { normalizeCutoffTimes } from './cutoff-experiment.js';
import { normalizePolicy } from './experiment-report.js';
import { compareJobOutcomes, hasJobThresholds, thresholdViolations } from './job-gates.js';
import { copyCompletedResults } from './report-results.js';

/**
 * Project a completed study without routing, hashing, I/O, or mutation.
 * The internal Worker-result boundary rejects incomplete/mismatched results;
 * it does not authenticate them or prove their originating implementation.
 * All candidates must vary only the selected closure's start time.
 */
export function summarizeCutoffResults(input, closureId, completedResults, thresholds = {}) {
  const policy = normalizePolicy(thresholds);
  const experiment = validateExperiment(input);
  if (typeof closureId !== 'string') throw new Error('A closure ID is required for the completed study.');
  let schedule;
  const times = experiment.variants.map(variant => {
    const selected = variant.closures.find(closure => closure.id === closureId);
    if (!selected) throw new Error('Every study candidate must contain the selected closure ID.');
    const fixed = JSON.stringify(variant.closures.map(closure => closure.id === closureId ? { ...closure, atS: 0 } : closure));
    if (schedule !== undefined && fixed !== schedule) throw new Error('Study candidates must preserve all other closure records and selected edges.');
    schedule = fixed;
    return selected.atS;
  });
  const sorted = normalizeCutoffTimes(times);
  if (times.some((time, index) => time !== sorted[index])) throw new Error('Study candidates must be ordered by increasing closure start time.');
  const simulation = copyCompletedResults(experiment, completedResults);
  const evaluated = Object.keys(policy).length > 0;
  const candidates = simulation.variants.map((variant, index) => {
    const jobComparison = hasJobThresholds(policy) ? compareJobOutcomes(simulation.baseline, variant.result) : undefined;
    const violations = thresholdViolations(variant.delta, policy, jobComparison);
    return {
      id: variant.id, cutoffS: times[index], metrics: variant.result.metrics, delta: variant.delta,
      ...(jobComparison ? { jobComparison } : {}),
      verdict: !evaluated ? 'not-evaluated' : violations.length ? 'failed' : 'passed', violations,
    };
  });
  return {
    baseline: simulation.baseline.metrics, candidates, thresholds: policy,
    verdict: !evaluated ? 'not-evaluated' : candidates.some(candidate => candidate.verdict === 'failed') ? 'failed' : 'passed',
    passingSampleTimesS: evaluated ? candidates.filter(candidate => candidate.verdict === 'passed').map(candidate => candidate.cutoffS) : null,
    warnings: candidates.filter(candidate => candidate.metrics.unreachableJobs > 0).map(candidate => ({ candidateId: candidate.id, message: 'Unreachable jobs were skipped; lower distance or lateness does not establish equal-service improvement.' })),
    limitations: [
      'Only the explicitly sampled times were evaluated; no optimal cutoff, continuous passing interval, monotonicity or operational safety is established.',
      'Every candidate is compared with the clear-road baseline, not with the source variant. All other closure records remain unchanged; overlapping earlier closures can dominate.',
      'Fixed travel times, vehicle assignments and delivery order; arrival deadlines. Fingerprints identify content, not authenticity.',
    ],
  };
}
