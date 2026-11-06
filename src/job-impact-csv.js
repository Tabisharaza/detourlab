/** Display-oriented CSV, not a lossless machine interchange or a safety verdict. */
export const JOB_IMPACT_CSV_LIMITS = Object.freeze({ maxJobs: 2000, maxBytes: 4 * 1024 * 1024, maxTextLength: 4096 });
export const JOB_IMPACT_CSV_COLUMNS = Object.freeze([
  'experimentId', 'variantId', 'variantName', 'jobId', 'vehicleId', 'nodeId', 'dueTimeS',
  'baselineStatus', 'baselineArrivalS', 'baselineCompletedS', 'baselineDelayS',
  'variantStatus', 'variantArrivalS', 'variantCompletedS', 'variantDelayS',
  'arrivalDeltaS', 'completedDeltaS', 'delayDeltaS', 'changed', 'statusChanged',
]);
const statuses = new Set(['on-time', 'late', 'unreachable']);
const encoder = new TextEncoder();
function requireValue(condition, message) {
  if (!condition) throw new Error(`Job impact CSV: ${message}`);
}
function text(value) {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= JOB_IMPACT_CSV_LIMITS.maxTextLength,
    'text fields must be nonempty strings of at most 4096 UTF-16 code units.');
  requireValue(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value), 'text must contain well-formed Unicode.');
  // Inspect compatibility-normalized text, ignoring leading whitespace, controls
  // and format characters, but never normalize the exported label itself.
  const leading = value.normalize('NFKC').replace(/^[\s\p{Cc}\p{Cf}]*/u, '');
  const prefix = /^[=+\-@']/u.test(leading) ? "'" : '';
  // Keep RFC-quoted CR/LF; expose other controls/format characters as literal
  // escapes. Double existing backslashes so this display transform is explicit.
  const display = value.replace(/\\/gu, '\\\\').replace(/[\p{Cc}\p{Cf}]/gu, char =>
    char === '\r' || char === '\n' ? char : `\\u{${char.codePointAt(0).toString(16)}}`);
  return prefix + display;
}
function number(value, nullable = false) {
  requireValue((nullable && value === null) || (typeof value === 'number' && Number.isFinite(value)), 'timings must be finite numbers or explicitly allowed nulls.');
  return value === null ? '' : Object.is(value, -0) ? '-0' : String(value);
}
function outcome(value) {
  requireValue(value && statuses.has(value.status), 'unsupported or missing job status.');
  for (const key of ['arrivalS', 'completedS', 'delayS']) {
    number(value[key], true);
    requireValue((value[key] === null) === (value.status === 'unreachable'), 'unreachable timings must be null; reachable timings must be finite.');
  }
  return [value.status, number(value.arrivalS, true), number(value.completedS, true), number(value.delayS, true)];
}
const quote = value => /[",\r\n]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;

/**
 * Serialize every completed job, never a page/filter, with no simulation/hash.
 * Text is display-escaped (backslashes doubled, controls except CR/LF rendered
 * as \\u{hex}, formula-like/apostrophe-leading labels prefixed with apostrophe).
 * This mitigates common spreadsheet formula interpretation, not every importer.
 * JSON is the unchanged machine format. Empty numeric cells mean null, not zero.
 * Validate and bound the entire string before callers can write/download it.
 */
export function renderJobImpactCsv(impact, { experimentId } = {}) {
  requireValue(impact && typeof impact === 'object', 'a complete impact report is required.');
  const identity = [text(experimentId), text(impact.variant?.id), text(impact.variant?.name)];
  requireValue(Array.isArray(impact.jobs) && impact.jobs.length <= JOB_IMPACT_CSV_LIMITS.maxJobs, 'jobs must be an array of at most 2000 rows.');
  requireValue(Number.isInteger(impact.summary?.totalJobs) && impact.summary.totalJobs === impact.jobs.length, 'summary totalJobs must equal the complete row count.');
  const lines = [JOB_IMPACT_CSV_COLUMNS.join(',') + '\r\n'];
  let bytes = encoder.encode(lines[0]).byteLength;
  const ids = new Set();
  for (const job of impact.jobs) {
    requireValue(job && typeof job === 'object', 'each job must be an object.');
    const labels = [text(job.id), text(job.vehicleId), text(job.nodeId)];
    requireValue(!ids.has(job.id), 'duplicate job ID.');
    ids.add(job.id);
    const baseline = outcome(job.baseline);
    const variant = outcome(job.variant);
    requireValue(typeof job.changed === 'boolean' && typeof job.statusChanged === 'boolean', 'change flags must be booleans.');
    requireValue(job.statusChanged === (job.baseline.status !== job.variant.status)
      && job.changed === (job.statusChanged || job.baseline.arrivalS !== job.variant.arrivalS || job.baseline.completedS !== job.variant.completedS), 'change flags must match outcomes.');
    for (const [key, delta] of [['arrivalS', 'arrivalDeltaS'], ['completedS', 'completedDeltaS'], ['delayS', 'delayDeltaS']]) {
      number(job[delta], true);
      const expected = job.baseline[key] === null || job.variant[key] === null ? null : job.variant[key] - job.baseline[key];
      requireValue(job[delta] === expected, 'deltas must match outcomes.');
    }
    const row = [...identity, ...labels, number(job.dueTimeS), ...baseline, ...variant,
      number(job.arrivalDeltaS, true), number(job.completedDeltaS, true), number(job.delayDeltaS, true), String(job.changed), String(job.statusChanged)];
    const line = row.map(quote).join(',') + '\r\n';
    bytes += encoder.encode(line).byteLength;
    requireValue(bytes <= JOB_IMPACT_CSV_LIMITS.maxBytes, 'output exceeds the 4 MiB UTF-8 limit.');
    lines.push(line);
  }
  return lines.join('');
}
