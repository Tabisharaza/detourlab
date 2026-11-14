import { createHash } from 'node:crypto';
import { canonicalExperiment, EXPERIMENT_LIMITS, simulateExperiment, validateExperiment } from '../src/experiment.js';
import { projectVariantComparison } from '../src/variant-comparison.js';

export const VARIANT_COMPARISON_MAX_BYTES = 4 * 1024 * 1024;

export const isVariantId = value => typeof value === 'string' &&
  value.length <= EXPERIMENT_LIMITS.idLength && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(value);

const asSide = ({ status, arrivalS, completedS, delayS }) => ({
  status, arrivalS, completedS, latenessS: delayS,
});

/** Compare two named schedules in one experiment run, not two baseline-relative deltas. */
export function compareVariants(input, referenceId, candidateId) {
  const experiment = validateExperiment(input);
  for (const [role, id] of [['reference', referenceId], ['candidate', candidateId]]) {
    if (!isVariantId(id)) {
      throw new Error(`The ${role} requires a safe variant ID of at most ${EXPERIMENT_LIMITS.idLength} characters.`);
    }
    if (!experiment.variants.some(variant => variant.id === id)) throw new Error(`Unknown ${role} variant "${id}".`);
  }
  if (referenceId === candidateId) throw new Error('Reference and candidate must be distinct variants.');

  // Reuse full validation, simulation and shared aggregate result limits.
  const { variants } = simulateExperiment(experiment);
  const reference = variants.find(variant => variant.id === referenceId);
  const candidate = variants.find(variant => variant.id === candidateId);
  const { delta, summary, jobs } = projectVariantComparison(experiment, reference.result, candidate.result);

  const referenceMetrics = reference.result.metrics;
  const candidateMetrics = candidate.result.metrics;
  return {
    format: 'detourlab-variant-comparison',
    version: 1,
    engineVersion: '0.1.0',
    experimentId: experiment.id,
    experimentSha256: createHash('sha256').update(canonicalExperiment(experiment)).digest('hex'),
    reference: { id: reference.id, name: reference.name, metrics: referenceMetrics },
    candidate: { id: candidate.id, name: candidate.name, metrics: candidateMetrics },
    delta,
    summary,
    jobs: jobs.map(({ baseline, variant, delayDeltaS, ...row }) => ({
      ...row,
      reference: asSide(baseline),
      candidate: asSide(variant),
      latenessDeltaS: delayDeltaS,
    })),
  };
}

/** Complete UTF-8 machine output; check the bound before writing any bytes. */
export function renderVariantComparisonJson(report) {
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(json, 'utf8') > VARIANT_COMPARISON_MAX_BYTES) {
    throw new Error('Variant comparison report exceeds the 4 MiB limit.');
  }
  return json;
}
