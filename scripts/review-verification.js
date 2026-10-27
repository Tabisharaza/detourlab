import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { normalizeGenerator } from '../src/experiment-report.js';
import { createExperimentReport, serializeExperimentReport, REPORT_LIMITS } from './experiment-report.js';
import { createReportIdentity } from './report-identity.js';

/** Read only the two fixed packet files, never paths supplied by bundle data. */
async function readPacketFile(directory, name, limit) {
  const filename = path.join(directory, name);
  const entry = await lstat(filename);
  if (entry.isSymbolicLink()) throw new Error(`${name} must not be a symbolic link.`);
  if (!entry.isFile()) throw new Error(`${name} must be a regular file.`);
  // O_NOFOLLOW protects the final component where supported; these checks are
  // not a sandbox against a co-writer replacing ancestor directories.
  const handle = await open(filename, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`${name} must be a regular file.`);
    if (info.size > limit) throw new Error(`${name} exceeds its ${limit}-byte limit.`);
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) throw new Error(`${name} exceeds its ${limit}-byte limit.`);
    const bytes = buffer.subarray(0, length);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error(`${name} must be valid UTF-8.`); }
    return { bytes, text };
  } finally {
    await handle.close();
  }
}

/**
 * Recompute once from validated input/policy, not from supplied outcomes.
 * Both modes require complete generated file bytes, including integrity and
 * presentation. Comparison mode changes only the provenance requirement.
 */
export async function verifyReview(directory, { compareOutcomes = false } = {}) {
  if (typeof compareOutcomes !== 'boolean') throw new Error('compareOutcomes must be a boolean.');
  directory = path.resolve(directory);
  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Packet root must be a real directory, not a symbolic link.');
  const original = await readPacketFile(directory, 'bundle.json', REPORT_LIMITS.maxBundleBytes);
  const originalReview = await readPacketFile(directory, 'REVIEW.md', REPORT_LIMITS.maxReviewBytes);
  let saved;
  try { saved = JSON.parse(original.text); }
  catch { throw new Error('bundle.json must contain valid JSON.'); }
  if (!saved || Array.isArray(saved) || saved.format !== 'detourlab-experiment-report' || saved.version !== 1) {
    throw new Error('Unsupported review packet format or version.');
  }
  // Validate and copy the small identity before comparing it. Its file paths
  // are claims only: createReportIdentity reads its own trusted allowlist.
  const generator = normalizeGenerator(saved.generator);
  const current = await createReportIdentity();
  const claimed = generator.implementation;
  const implementationMatched = claimed !== null
    && claimed.algorithm === current.implementation.algorithm
    && claimed.sha256 === current.implementation.sha256
    && JSON.stringify(claimed.files) === JSON.stringify(current.implementation.files);
  if (!compareOutcomes && !implementationMatched) {
    throw new Error('Unknown or mismatched implementation fingerprint. Use the matching trusted checkout, or explicitly choose --compare-outcomes without claiming original implementation verification.');
  }

  // Never recursively hash or render arbitrary saved report fields. The report
  // generator validates embedded experiment/policy and enforces normal engine
  // budgets. Retaining supplied metadata reproduces bytes, not authenticity.
  const rerun = createExperimentReport(saved.experiment, saved.policy, generator);
  const repeated = serializeExperimentReport(rerun);
  if (!Buffer.from(repeated.bundleJson, 'utf8').equals(original.bytes)) {
    throw new Error('bundle.json differs from the complete recomputed packet. Outcomes, policy, metadata, integrity or exact file bytes do not agree.');
  }
  if (!Buffer.from(repeated.reviewMarkdown, 'utf8').equals(originalReview.bytes)) {
    throw new Error('REVIEW.md differs from the complete recomputed packet. Keep the original matching pair without editing its bytes.');
  }
  return {
    format: 'detourlab-review-verification', version: 1, verified: true,
    mode: compareOutcomes ? 'outcomes-only' : 'exact-implementation',
    implementationMatched,
    experimentSha256: rerun.experimentSha256,
    policySha256: rerun.policySha256,
    policyVerdict: rerun.verdict,
    authenticity: 'not-established',
  };
}
