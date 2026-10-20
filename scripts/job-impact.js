import { createHash } from 'node:crypto';
import { projectJobOutcomes } from '../src/job-impact.js';
import { canonicalExperiment, simulateExperiment, validateExperiment } from '../src/experiment.js';

/** Bound the complete, two-space-indented UTF-8 report and its final newline. */
export const IMPACT_LIMITS = Object.freeze({ maxBytes: 4 * 1024 * 1024 });

export { projectJobOutcomes };

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
