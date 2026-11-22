import { isDeepStrictEqual } from 'node:util';
import { canonicalExperiment, parseExperiment } from '../src/experiment.js';
import { FILE_INPUT_MAX_BYTES } from '../src/file-input.js';
import { compareVariants, renderVariantComparisonJson } from './variant-comparison.js';

import { COMPARISON_EVIDENCE_FORMAT, COMPARISON_EVIDENCE_VERSION, EVIDENCE_LIMIT, EVIDENCE_LIMIT_MESSAGE } from '../src/variant-comparison.js';
export { EVIDENCE_LIMIT, EVIDENCE_LIMIT_MESSAGE, renderComparisonEvidence } from '../src/variant-comparison.js';

export function createComparisonEvidence(input, reference, candidate) {
  const canonical = canonicalExperiment(input);
  if (Buffer.byteLength(canonical) > FILE_INPUT_MAX_BYTES) throw new Error('Canonical experiment must be at most 2 MiB.');
  const experiment = parseExperiment(canonical);
  const report = compareVariants(experiment, reference, candidate);
  // Compare the exact JSON representation, including normalized numeric values.
  return { format: COMPARISON_EVIDENCE_FORMAT, version: COMPARISON_EVIDENCE_VERSION, experiment, report: JSON.parse(renderVariantComparisonJson(report)) };
}

/** Recompute the full comparison. Integrity, not authenticity or safety approval. */
export function verifyComparisonEvidence(bytes) {
  if (bytes.byteLength > EVIDENCE_LIMIT) throw new Error(EVIDENCE_LIMIT_MESSAGE);
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('Evidence must be a valid UTF-8 JSON document.');
  }
  if (!parsed || parsed.format !== COMPARISON_EVIDENCE_FORMAT || parsed.version !== COMPARISON_EVIDENCE_VERSION) throw new Error('Unsupported comparison evidence format or version.');
  // Apply the original input bound before model validation or simulation.
  const embedded = JSON.stringify(parsed.experiment);
  if (!embedded || Buffer.byteLength(embedded) > FILE_INPUT_MAX_BYTES) throw new Error('Embedded experiment is missing or exceeds 2 MiB.');
  const expected = createComparisonEvidence(parseExperiment(embedded), parsed.report?.reference?.id, parsed.report?.candidate?.id);
  if (!isDeepStrictEqual(parsed, expected)) throw new Error('Comparison evidence differs from the complete recomputed result or canonical input.');
  return expected.report;
}
