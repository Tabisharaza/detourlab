import { formatCliLabel } from './cli-display.js';

const EXAMPLE_LIMIT = 5;
const signed = n => n > 0 ? `+${n}` : String(n);
const sideLabel = side => `${formatCliLabel(side.name)} [${side.id}]`;
const arrival = side => side.arrivalS === null ? 'no arrival' : `${side.arrivalS} s`;

/** Render a bounded human summary of an already verified comparison report. */
export function renderComparisonBrief(report) {
  const { reference, candidate, delta, summary, jobs } = report;
  const { earlier, unchanged, later, notComparable } = summary.arrivals;
  const newlyUnreachable = jobs.filter(row => row.reference.status !== 'unreachable' && row.candidate.status === 'unreachable');
  const recovered = jobs.filter(row => row.reference.status === 'unreachable' && row.candidate.status !== 'unreachable');
  const bothUnreachable = jobs.filter(row => row.reference.status === 'unreachable' && row.candidate.status === 'unreachable');
  const newlyLate = jobs.filter(row => row.reference.status !== 'late' && row.candidate.status === 'late');
  // Array.sort is stable; equal delays therefore retain original workload order.
  const laterRows = jobs.filter(row => row.arrivalDeltaS > 0)
    .sort((a, b) => b.arrivalDeltaS - a.arrivalDeltaS);
  const lines = [
    'DetourLab decision brief (verified synthetic comparison)',
    `Reference: ${sideLabel(reference)}`,
    `Candidate: ${sideLabel(candidate)}`,
    `Experiment SHA-256: ${report.experimentSha256}`,
    '',
    'Fleet results (reference → candidate; candidate minus reference):',
  ];
  for (const [key, label, unit] of [
    ['completedJobs', 'Completed deliveries', ''],
    ['lateJobs', 'Late deliveries', ''],
    ['unreachableJobs', 'Unreachable deliveries', ''],
    ['distanceM', 'Distance', ' m'],
  ]) {
    lines.push(`  ${label}: ${reference.metrics[key]}${unit} → ${candidate.metrics[key]}${unit} (${signed(delta[key])}${unit})`);
  }
  lines.push('', `Arrivals (${summary.totalJobs} delivery ${summary.totalJobs === 1 ? 'row' : 'rows'}): ${earlier} earlier, ${unchanged} unchanged, ${later} later, ${notComparable} not comparable`);
  if (delta.completedJobs === 0 && newlyUnreachable.length && recovered.length) {
    lines.push('Completed total is unchanged, but different deliveries were reached.');
  }
  function section(label, rows) {
    lines.push('', `${label}: ${rows.length}${rows.length > EXAMPLE_LIMIT ? ` (showing first ${EXAMPLE_LIMIT})` : ''}`);
    for (const row of rows.slice(0, EXAMPLE_LIMIT)) {
      lines.push(`  ${row.id} [${row.vehicleId}] at ${row.nodeId}: ${row.reference.status} (${arrival(row.reference)}) → ${row.candidate.status} (${arrival(row.candidate)})${row.arrivalDeltaS === null ? '' : `; ${signed(row.arrivalDeltaS)} s`}`);
    }
  }
  section('Newly unreachable deliveries', newlyUnreachable);
  section('Recovered deliveries', recovered);
  section('Unreachable under both plans', bothUnreachable);
  section('Newly late deliveries', newlyLate);
  section('Largest arrival regressions', laterRows);
  lines.push('', 'This is a bounded summary, not an approval or prediction. See the evidence JSON for all rows.');
  return `${lines.join('\n')}\n`;
}
