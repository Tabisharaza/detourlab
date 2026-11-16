#!/usr/bin/env node
import { parseExperiment } from '../src/experiment.js';
import { formatInputError } from '../src/file-input.js';
import { readInput } from './read-input.js';
import { readBoundedRegularFile } from './read-bounded-regular-file.js';
import {
  createComparisonEvidence, renderComparisonEvidence, verifyComparisonEvidence,
  EVIDENCE_LIMIT, EVIDENCE_LIMIT_MESSAGE,
} from './comparison-evidence.js';

const usage = `Usage:
  node scripts/review-comparison.js create EXPERIMENT.json REFERENCE_ID CANDIDATE_ID
  node scripts/review-comparison.js verify EVIDENCE.json

Create prints a self-contained JSON file. Verify recomputes the complete report
offline. A match confirms reproducibility, not who made or approved the file.
Exit 0 means success; exit 2 means invalid, mismatching or unreadable input.`;

try {
  const [action, path, reference, candidate, ...extra] = process.argv.slice(2);
  if (action === '--help' && path === undefined) console.log(usage);
  else if (action === 'create' && path && reference && candidate && !extra.length) {
    const experiment = parseExperiment(await readInput(path));
    process.stdout.write(renderComparisonEvidence(createComparisonEvidence(experiment, reference, candidate)));
  } else if (action === 'verify' && path && reference === undefined) {
    const report = verifyComparisonEvidence(await readBoundedRegularFile(path, EVIDENCE_LIMIT, 'Comparison evidence', EVIDENCE_LIMIT_MESSAGE));
    console.log(`Verified ${report.reference.id} → ${report.candidate.id}: ${report.summary.totalJobs} complete delivery rows; experiment SHA-256 ${report.experimentSha256}.`);
  } else throw new Error('Invalid arguments. Use --help for usage.');
} catch (error) {
  console.error(`DetourLab: ${formatInputError(error)}`);
  process.exitCode = 2;
}
