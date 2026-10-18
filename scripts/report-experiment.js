#!/usr/bin/env node
import { parseExperiment } from '../src/experiment.js';
import { formatInputError } from '../src/file-input.js';
import { parseArguments } from './cli-arguments.js';
import { formatCliLabel } from './cli-display.js';
import { readInput } from './read-input.js';
import { createExperimentReport, serializeExperimentReport } from './experiment-report.js';
import { createReportIdentity } from './report-identity.js';
import { writeReviewPacket } from './write-review-packet.js';

const usage = `DetourLab portable experiment review packet

Usage: node scripts/report-experiment.js experiment.json --out review-directory [options]

  --out DIRECTORY                Required new directory; its parent must exist
  --max-extra-distance-pct N      Limit additional distance percent
  --max-extra-late N              Limit additional late jobs
  --max-unreachable N             Limit variant unreachable jobs
  --max-newly-late N              Limit on-time to late jobs
  --max-arrival-slip-s N          Limit comparable arrival slip in seconds
  --help                         Show help without reading input

Writes bundle.json (at most 8 MiB) and REVIEW.md (at most 1 MiB).
Each option may be supplied once. --json is not supported.
Version-1 scenarios are upgraded to supplied and clear-road variants.
The destination must not exist, including symlinks; parent directories are not
created. Complete files are staged first and published without overwriting.
Publication requires filesystem hard links and is not an atomic directory swap.
Both files with matching integrity identify a complete packet.
Exit 0: complete packet, requested gates passed or no policy evaluated.
Exit 1: complete packet, one or more requested gates failed.
Exit 2: invalid input, simulation, output budget or filesystem failure.
Synthetic / fixed travel times / assigned order retained / arrival deadlines.`;

function argumentsFor(args) {
  if (args.includes('--help')) return { help: true };
  const remaining = [];
  let output;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--out') {
      if (output !== undefined) throw new Error('--out may only be supplied once.');
      const value = args[++index];
      if (value === undefined || !value.trim() || value.startsWith('-')) {
        throw new Error('--out requires a directory path.');
      }
      output = value;
    } else {
      if (arg === '--json') throw new Error('--json is not supported; the packet includes both JSON and Markdown.');
      remaining.push(arg);
      // Preserve the shared parser's value boundary: a missing threshold value
      // cannot be repaired accidentally by extracting a following --out pair.
      if (/^--max-(extra-distance-pct|extra-late|unreachable|newly-late|arrival-slip-s)$/u.test(arg) && index + 1 < args.length) {
        remaining.push(args[++index]);
      }
    }
  }
  const parsed = parseArguments(remaining, { requireFile: true });
  if (output === undefined) throw new Error('--out is required. Use --help for usage.');
  return { ...parsed, output };
}

try {
  const options = argumentsFor(process.argv.slice(2));
  if (options.help) console.log(usage);
  else {
    const input = parseExperiment(await readInput(options.file));
    const generator = await createReportIdentity();
    const bundle = createExperimentReport(input, options.thresholds, generator);
    await writeReviewPacket(options.output, serializeExperimentReport(bundle));
    const verdict = bundle.verdict === 'failed' ? 'FAILED' : bundle.verdict === 'passed' ? 'PASSED' : 'NOT EVALUATED';
    console.log(`DetourLab: review packet written to ${formatCliLabel(options.output)}`);
    console.log(`Policy: ${verdict}. Files: bundle.json, REVIEW.md.`);
    if (bundle.verdict === 'failed') process.exitCode = 1;
  }
} catch (error) {
  console.error(`DetourLab: ${formatInputError(error)}`);
  process.exitCode = 2;
}
