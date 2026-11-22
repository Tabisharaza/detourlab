import { copyCompletedResults } from './report-results.js';
import { projectJobOutcomes } from './job-impact.js';
import { canonicalExperiment, parseExperiment } from './experiment.js';
import { FILE_INPUT_MAX_BYTES } from './file-input.js';
import {
  COMPARISON_EVIDENCE_FORMAT, COMPARISON_EVIDENCE_VERSION, createVariantComparisonReport,
  projectVariantComparison, renderComparisonEvidence, renderVariantComparisonJson,
} from './variant-comparison.js';

export const IMPACT_PAGE_SIZE = 20;
const FILTERS = ['changed', 'status', 'timing', 'all'];
const SORTS = ['input', 'arrival-desc'];

/**
 * Inspect internal, completed Worker results for an already validated input.
 * Reuse the report boundary and the CLI's exact outcome projection. No routing,
 * timing rounding, acceptance policy or implementation-authenticity claim.
 */
export function createBrowserImpact(experiment, completedResults, variantId, referenceId = null) {
  const simulation = copyCompletedResults(experiment, completedResults);
  const selected = simulation.variants.find(variant => variant.id === variantId);
  if (!selected) throw new Error('Choose a variant from the completed experiment.');
  const reference = referenceId === null ? null : simulation.variants.find(variant => variant.id === referenceId);
  if (referenceId !== null && (!reference || reference === selected)) throw new Error('Choose a distinct reference from the completed experiment.');
  const comparison = reference
    ? { reference: { id: reference.id, name: reference.name }, referenceMetrics: reference.result.metrics,
        ...projectVariantComparison(experiment, reference.result, selected.result) }
    : { baselineMetrics: simulation.baseline.metrics, delta: selected.delta,
        ...projectJobOutcomes(experiment, simulation.baseline, selected.result) };
  return {
    variant: { id: selected.id, name: selected.name },
    variantMetrics: selected.result.metrics,
    ...comparison,
    sameStatusArrivalChanges: comparison.jobs.filter(job => !job.statusChanged && job.baseline.arrivalS !== job.variant.arrivalS).length,
  };
}

/** Serialize a named inspector snapshot; verify independently with the CLI. */
export async function createBrowserComparisonEvidence(input, impact) {
  if (!impact.reference) throw new Error('Choose two saved plans to export comparison evidence.');
  if (!globalThis.crypto?.subtle) throw new Error('Comparison evidence requires Web Crypto in a secure browser context.');
  const canonical = canonicalExperiment(input);
  const bytes = new TextEncoder().encode(canonical);
  if (bytes.byteLength > FILE_INPUT_MAX_BYTES) throw new Error('Canonical experiment must be at most 2 MiB.');
  const experiment = parseExperiment(canonical);
  const report = structuredClone(createVariantComparisonReport(experiment.id, '',
    { ...impact.reference, metrics: impact.referenceMetrics },
    { ...impact.variant, metrics: impact.variantMetrics }, impact));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  report.experimentSha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return renderComparisonEvidence({
    format: COMPARISON_EVIDENCE_FORMAT, version: COMPARISON_EVIDENCE_VERSION,
    experiment, report: JSON.parse(renderVariantComparisonJson(report)),
  });
}

/**
 * Filter, literal ID search, then stable ordering before a bounded page.
 * Arrival order compares numeric deltas only: incomparable nulls come last,
 * including after negative changes. This is not an overall severity ranking.
 * Case folding uses JavaScript toLowerCase, not locale-sensitive collation.
 */
export function pageDeliveryImpact(impact, filter = 'changed', requestedPage = 0, options = {}) {
  if (!FILTERS.includes(filter)) throw new Error('Choose a supported delivery filter.');
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Choose supported delivery search options.');
  const { query = '', sort = 'input' } = options;
  if (typeof query !== 'string') throw new Error('Enter delivery search text as a string.');
  if (!SORTS.includes(sort)) throw new Error('Choose a supported delivery order.');
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = impact.jobs.filter(job => filter === 'all' || (filter === 'changed' ? job.changed
    : filter === 'status' ? job.statusChanged : !job.statusChanged && job.baseline.arrivalS !== job.variant.arrivalS));
  const matches = filtered.filter(job => !normalizedQuery || [job.id, job.vehicleId, job.nodeId]
    .some(id => id.toLowerCase().includes(normalizedQuery)));
  if (sort === 'arrival-desc') matches.sort((left, right) => {
    if (left.arrivalDeltaS === null) return right.arrivalDeltaS === null ? 0 : 1;
    if (right.arrivalDeltaS === null) return -1;
    return right.arrivalDeltaS - left.arrivalDeltaS;
  });
  const pageCount = Math.ceil(matches.length / IMPACT_PAGE_SIZE);
  const pageIndex = Math.max(0, Math.min(Math.max(0, pageCount - 1), Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0));
  const start = pageIndex * IMPACT_PAGE_SIZE;
  const jobs = matches.slice(start, start + IMPACT_PAGE_SIZE);
  return { jobs, filter, query: normalizedQuery, sort, filteredJobs: filtered.length, totalJobs: impact.summary.totalJobs, matchingJobs: matches.length, pageIndex, pageCount, from: jobs.length ? start + 1 : 0, to: start + jobs.length };
}
