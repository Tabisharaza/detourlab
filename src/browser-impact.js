import { copyCompletedResults } from './report-results.js';
import { projectJobOutcomes } from './job-impact.js';

export const IMPACT_PAGE_SIZE = 20;
const FILTERS = ['changed', 'status', 'timing', 'all'];

/**
 * Inspect internal, completed Worker results for an already validated input.
 * Reuse the report boundary and the CLI's exact outcome projection. No routing,
 * timing rounding, acceptance policy or implementation-authenticity claim.
 */
export function createBrowserImpact(experiment, completedResults, variantId) {
  const simulation = copyCompletedResults(experiment, completedResults);
  const selected = simulation.variants.find(variant => variant.id === variantId);
  if (!selected) throw new Error('Choose a variant from the completed experiment.');
  const projection = projectJobOutcomes(experiment, simulation.baseline, selected.result);
  return {
    variant: { id: selected.id, name: selected.name },
    baselineMetrics: simulation.baseline.metrics,
    variantMetrics: selected.result.metrics,
    delta: selected.delta,
    ...projection,
    sameStatusArrivalChanges: projection.jobs.filter(job => !job.statusChanged && job.baseline.arrivalS !== job.variant.arrivalS).length,
  };
}

/** Original input order, at most 20 rows, including a defined empty page. */
export function pageDeliveryImpact(impact, filter = 'changed', requestedPage = 0) {
  if (!FILTERS.includes(filter)) throw new Error('Choose a supported delivery filter.');
  const matches = impact.jobs.filter(job => filter === 'all' || (filter === 'changed' ? job.changed
    : filter === 'status' ? job.statusChanged : !job.statusChanged && job.baseline.arrivalS !== job.variant.arrivalS));
  const pageCount = Math.ceil(matches.length / IMPACT_PAGE_SIZE);
  const pageIndex = Math.max(0, Math.min(Math.max(0, pageCount - 1), Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0));
  const start = pageIndex * IMPACT_PAGE_SIZE;
  const jobs = matches.slice(start, start + IMPACT_PAGE_SIZE);
  return { jobs, filter, totalJobs: impact.summary.totalJobs, matchingJobs: matches.length, pageIndex, pageCount, from: jobs.length ? start + 1 : 0, to: start + jobs.length };
}
