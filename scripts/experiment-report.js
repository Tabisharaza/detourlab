import { createHash } from 'node:crypto';
import { canonicalExperiment, simulateExperiment, validateExperiment } from '../src/experiment.js';
import { REPORT_LIMITS, canonicalReport, normalizePolicy, normalizeGenerator, projectExperimentReport, renderReview, serializeReportFiles } from '../src/experiment-report.js';

export { REPORT_LIMITS };
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');

/** Run exactly once; the browser consumes the same projection without rerunning. */
export function createExperimentReport(input, thresholds = {}, generator = null) {
  const experiment = validateExperiment(input);
  const policy = normalizePolicy(thresholds);
  const identity = normalizeGenerator(generator);
  const simulation = simulateExperiment(experiment);
  const payload = projectExperimentReport(experiment, simulation, policy, identity, hash(canonicalExperiment(experiment)), hash(canonicalReport(policy)));
  const bundle = { ...payload, integrity: { algorithm: 'sha256', sha256: hash(canonicalReport(payload)) } };
  bundle.integrity.reviewSha256 = hash(renderReview(bundle));
  serializeExperimentReport(bundle);
  return bundle;
}

/** Validate integrity before returning complete, bounded UTF-8 packet files. */
export function serializeExperimentReport(bundle) {
  const { integrity, ...payload } = bundle;
  if (integrity?.algorithm !== 'sha256' || integrity.sha256 !== hash(canonicalReport(payload))) throw new Error('Experiment report payload integrity does not match.');
  const files = serializeReportFiles(bundle);
  if (integrity.reviewSha256 !== hash(files.reviewMarkdown)) throw new Error('Experiment report review integrity does not match.');
  return files;
}
