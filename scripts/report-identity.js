import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * Explicit executable dependency coverage for report generation. The sequence
 * is part of the fingerprint contract. Browser-only UI, docs, tests, examples,
 * build outputs and the dependency-free lockfile do not execute in this CLI.
 * Update this list whenever a covered module gains a local runtime dependency.
 */
export const IMPLEMENTATION_FILES = Object.freeze([
  'package.json',
  'src/engine.js',
  'src/scenario.js',
  'src/experiment.js',
  'src/file-input.js',
  'src/experiment-report.js',
  'src/job-impact.js',
  'src/job-gates.js',
  'scripts/experiment-report.js',
  'scripts/job-impact.js',
  'scripts/job-gates.js',
  'scripts/report-experiment.js',
  'scripts/write-review-packet.js',
  'scripts/report-identity.js',
  'scripts/cli-arguments.js',
  'scripts/cli-display.js',
  'scripts/read-input.js',
]);

/** Hash exact source bytes with unambiguous path and length framing. */
export async function createReportIdentity(root = new URL('../', import.meta.url)) {
  const hash = createHash('sha256').update('detourlab-report-implementation-v1\0');
  let packageBytes;
  for (const file of IMPLEMENTATION_FILES) {
    const bytes = await readFile(new URL(file, root));
    if (file === 'package.json') packageBytes = bytes;
    hash.update(`${Buffer.byteLength(file, 'utf8')}:${file}\0${bytes.length}:`);
    hash.update(bytes);
    hash.update('\0');
  }
  const packageData = JSON.parse(packageBytes.toString('utf8'));
  if (typeof packageData.name !== 'string' || typeof packageData.version !== 'string') {
    throw new Error('Report generator package identity is invalid.');
  }
  return {
    name: packageData.name,
    packageVersion: packageData.version,
    reportVersion: 1,
    // No claim of a Git revision without a verified clean source tree. A version,
    // an environment variable, or a copied release receipt is not that evidence.
    sourceRevision: null,
    implementation: { algorithm: 'sha256', files: [...IMPLEMENTATION_FILES], sha256: hash.digest('hex') },
  };
}
