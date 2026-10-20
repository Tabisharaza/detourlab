import { canonicalExperiment, validateExperiment } from './experiment.js';
import { canonicalReport, projectExperimentReport, renderReview, serializeReportFiles } from './experiment-report.js';
import { copyCompletedResults } from './report-results.js';

export const BROWSER_REPORT_GENERATOR = Object.freeze({
  name: 'detourlab-browser', packageVersion: '0.1.0', reportVersion: 1,
  sourceRevision: null, implementation: null,
});

async function hash(text) {
  if (!globalThis.crypto?.subtle) throw new Error('Review export requires Web Crypto in a secure browser context.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Export the exact already-completed experiment, not a new simulation.
 * Validate/copy synchronously before yielding, so later UI edits cannot alter
 * the packet. This boundary accepts internal Worker results, not imported runs.
 */
export async function createBrowserReview(input, completedResults) {
  const experiment = validateExperiment(input);
  const simulation = copyCompletedResults(experiment, completedResults);
  const policy = {};
  const [experimentSha256, policySha256] = await Promise.all([hash(canonicalExperiment(experiment)), hash(canonicalReport(policy))]);
  const payload = projectExperimentReport(experiment, simulation, policy, { ...BROWSER_REPORT_GENERATOR }, experimentSha256, policySha256);
  const bundle = { ...payload, integrity: { algorithm: 'sha256', sha256: await hash(canonicalReport(payload)) } };
  bundle.integrity.reviewSha256 = await hash(renderReview(bundle));
  return serializeReportFiles(bundle);
}
