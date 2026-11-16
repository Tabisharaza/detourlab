import { isDeepStrictEqual } from 'node:util';
import { canonicalExperiment, parseExperiment } from '../src/experiment.js';
import { FILE_INPUT_MAX_BYTES } from '../src/file-input.js';
import { compareVariants, renderVariantComparisonJson } from './variant-comparison.js';

export const EVIDENCE_LIMIT = 8 * 1024 * 1024;
export const EVIDENCE_LIMIT_MESSAGE = 'Comparison evidence must be at most 8 MiB.';
const format = 'detourlab-comparison-evidence';
const version = 1;

export function createComparisonEvidence(input, reference, candidate) {
  const canonical = canonicalExperiment(input);
  if (Buffer.byteLength(canonical) > FILE_INPUT_MAX_BYTES) throw new Error('Canonical experiment must be at most 2 MiB.');
  const experiment = parseExperiment(canonical);
  const report = compareVariants(experiment, reference, candidate);
  // Compare the exact JSON representation, including normalized numeric values.
  return { format, version, experiment, report: JSON.parse(renderVariantComparisonJson(report)) };
}

export function renderComparisonEvidence(evidence) {
  // Compact JSON keeps both complete inputs and outputs within the transport bound.
  const output = JSON.stringify(evidence) + '\n';
  if (Buffer.byteLength(output) > EVIDENCE_LIMIT) throw new Error(EVIDENCE_LIMIT_MESSAGE);
  return output;
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
  if (!parsed || parsed.format !== format || parsed.version !== version) throw new Error('Unsupported comparison evidence format or version.');
  // Apply the original input bound before model validation or simulation.
  const embedded = JSON.stringify(parsed.experiment);
  if (!embedded || Buffer.byteLength(embedded) > FILE_INPUT_MAX_BYTES) throw new Error('Embedded experiment is missing or exceeds 2 MiB.');
  const expected = createComparisonEvidence(parseExperiment(embedded), parsed.report?.reference?.id, parsed.report?.candidate?.id);
  if (!isDeepStrictEqual(parsed, expected)) throw new Error('Comparison evidence differs from the complete recomputed result or canonical input.');
  return expected.report;
}
