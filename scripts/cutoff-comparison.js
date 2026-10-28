import { createHash } from 'node:crypto';
import { canonicalExperiment, simulateExperiment, validateExperiment } from '../src/experiment.js';
import { normalizePolicy } from '../src/experiment-report.js';
import { summarizeCutoffResults } from '../src/cutoff-comparison.js';
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
  const summary = summarizeCutoffResults(experiment, closureId, simulation, policy);
  return {
    format: 'detourlab-cutoff-comparison', version: 1, engineVersion: '0.1.0',
    source: { experimentId: source.id, experimentSha256: hash(source), variantId, closureId, originalCutoffS: closure.atS },
    experimentSha256: hash(experiment), ...summary,
  };
}
