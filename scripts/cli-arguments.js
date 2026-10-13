/** Shared flag contract for both deterministic command-line runners. */
const thresholdOptions = Object.freeze({
  '--max-extra-distance-pct': 'extraDistancePct',
  '--max-extra-late': 'extraLateJobs',
  '--max-unreachable': 'unreachableJobs',
});

export function parseArguments(args, { requireFile = false } = {}) {
  // Preserve the existing help behavior: show usage without reading an input.
  if (args.includes('--help')) return { help: true };
  let file;
  let json = false;
  const selected = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') { json = true; continue; }
    if (Object.hasOwn(thresholdOptions, arg)) {
      const metric = thresholdOptions[arg];
      if (Object.hasOwn(selected, metric)) throw new Error(`${arg} may only be supplied once.`);
      const raw = args[++index], value = Number(raw);
      if (raw === undefined || raw.trim() === '' || !Number.isFinite(value) || value < 0) throw new Error(`${arg} requires a finite nonnegative number.`);
      selected[metric] = value;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    if (file) throw new Error('Only one input file is allowed.');
    file = arg;
  }
  if (requireFile && !file) throw new Error('An experiment or scenario JSON file is required. Use --help for usage.');
  // Argument order must not change serialized thresholds or violation order.
  const thresholds = Object.fromEntries(Object.values(thresholdOptions)
    .filter(metric => Object.hasOwn(selected, metric)).map(metric => [metric, selected[metric]]));
  return { help: false, file, json, thresholds };
}
