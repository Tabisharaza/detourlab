import { createHash } from 'node:crypto';
import { canonicalExperiment, simulateExperiment, validateExperiment } from '../src/experiment.js';
import { normalizePolicy } from '../src/experiment-report.js';
import { compareJobOutcomes, hasJobThresholds, thresholdViolations } from '../src/job-gates.js';
import { createCutoffExperiment } from './cutoff-experiment.js';

const hash = experiment => createHash('sha256').update(canonicalExperiment(experiment)).digest('hex');

/** One bounded experiment: clear-road baseline once, then exactly the samples. */
export function compareCutoffs(input, variantId, closureId, times, thresholds = {}) {
  const policy = normalizePolicy(thresholds);
  const experiment = createCutoffExperiment(input, variantId, closureId, times);
  const source = validateExperiment(input);
  const selected = source.variants.find(variant => variant.id === variantId);
  const closure = selected.closures.find(event => event.id === closureId);
  const simulation = simulateExperiment(experiment);
  const evaluated = Object.keys(policy).length > 0;
  const candidates = simulation.variants.map((variant, index) => {
    const jobComparison = hasJobThresholds(policy) ? compareJobOutcomes(simulation.baseline, variant.result) : undefined;
    const violations = thresholdViolations(variant.delta, policy, jobComparison);
    return { id: variant.id, cutoffS: experiment.variants[index].closures.find(event => event.id === closureId).atS, metrics: variant.result.metrics, delta: variant.delta,
      ...(jobComparison ? { jobComparison } : {}), verdict: !evaluated ? 'not-evaluated' : violations.length ? 'failed' : 'passed', violations };
  });
  const failed = candidates.some(candidate => candidate.verdict === 'failed');
  return {
    format: 'detourlab-cutoff-comparison', version: 1, engineVersion: '0.1.0',
    source: { experimentId: source.id, experimentSha256: hash(source), variantId, closureId, originalCutoffS: closure.atS },
    experimentSha256: hash(experiment), baseline: simulation.baseline.metrics,
    candidates, thresholds: policy, verdict: !evaluated ? 'not-evaluated' : failed ? 'failed' : 'passed',
    passingSampleTimesS: evaluated ? candidates.filter(candidate => candidate.verdict === 'passed').map(candidate => candidate.cutoffS) : null,
    warnings: candidates.filter(candidate => candidate.metrics.unreachableJobs > 0).map(candidate => ({ candidateId: candidate.id, message: 'Unreachable jobs were skipped; lower distance or lateness does not establish equal-service improvement.' })),
    limitations: [
      'Only the explicitly sampled times were evaluated; no optimal cutoff, continuous passing interval, monotonicity or operational safety is established.',
      'Every candidate is compared with the clear-road baseline, not with the source variant. All other closure records remain unchanged; overlapping earlier closures can dominate.',
      'Fixed travel times, vehicle assignments and delivery order; arrival deadlines. Fingerprints identify content, not authenticity.',
    ],
  };
}
