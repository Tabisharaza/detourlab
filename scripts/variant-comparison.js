import { createHash } from 'node:crypto';
import { canonicalExperiment, EXPERIMENT_LIMITS, simulateExperiment, validateExperiment } from '../src/experiment.js';
import { createVariantComparisonReport, projectVariantComparison } from '../src/variant-comparison.js';
export { VARIANT_COMPARISON_MAX_BYTES, renderVariantComparisonJson } from '../src/variant-comparison.js';

export const isVariantId = value => typeof value === 'string' &&
  value.length <= EXPERIMENT_LIMITS.idLength && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(value);

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
  return createVariantComparisonReport(experiment.id,
    createHash('sha256').update(canonicalExperiment(experiment)).digest('hex'),
    { id: reference.id, name: reference.name, metrics: reference.result.metrics },
    { id: candidate.id, name: candidate.name, metrics: candidate.result.metrics },
    projectVariantComparison(experiment, reference.result, candidate.result));
}
