import { createHash } from 'node:crypto';
import { createDemoScenario } from '../src/scenario.js';
import { canonicalExperiment, simulateExperiment, validateExperiment } from '../src/experiment.js';
import { normalizePolicy } from '../src/experiment-report.js';
import { compareJobOutcomes, thresholdViolations } from '../src/job-gates.js';

export const SEED_STUDY_LIMITS = Object.freeze({ minSeeds: 2, maxSeeds: 12, maxReportBytes: 1024 * 1024 });
export const MERIDIAN_PLAN_IDS = Object.freeze(['market-05', 'market-10', 'all-bridges-05', 'clear-roads']);
const DEFAULT_PLANS = Object.freeze(['market-05', 'market-10']);

// Inspect array descriptors before reading items or calling an iterator.
function plainList(value, min, max, name) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < min || value.length > max) {
    throw new Error(`${name} requires ${min}–${max} unique entries in a plain array.`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) {
      throw new Error(`${name} requires a plain array of data values.`);
    }
  }
  for (let i = 0; i < value.length; i += 1) if (!Object.hasOwn(value, i)) throw new Error(`${name} must not have missing entries.`);
}

export function normalizeSeed(seed) {
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('A seed must be an unsigned 32-bit integer (0–4294967295).');
  return seed === 0 ? 0 : seed;
}

export function normalizeSeeds(seeds) {
  plainList(seeds, SEED_STUDY_LIMITS.minSeeds, SEED_STUDY_LIMITS.maxSeeds, 'Seed study');
  const clean = seeds.map(normalizeSeed);
  if (new Set(clean).size !== clean.length) throw new Error('Seeds must be unique.');
  return clean.sort((a, b) => a - b);
}

export function normalizeMeridianPlans(plans = DEFAULT_PLANS) {
  plainList(plans, 2, MERIDIAN_PLAN_IDS.length, 'Meridian plans');
  for (const plan of plans) if (typeof plan !== 'string' || !MERIDIAN_PLAN_IDS.includes(plan)) throw new Error('Unknown Meridian plan; use market-05, market-10, all-bridges-05 or clear-roads.');
  if (new Set(plans).size !== plans.length) throw new Error('Meridian plans must be unique.');
  return MERIDIAN_PLAN_IDS.filter(id => plans.includes(id));
}

/** Author only the original generator's fixtures; imported seed metadata is NOT a recipe. */
export function createMeridianExperiment(seed, plans = DEFAULT_PLANS) {
  const selected = normalizeMeridianPlans(plans);
  const scenario = createDemoScenario(normalizeSeed(seed));
  const market = atS => [{ id: 'market-bridge-closure', edgeIds: ['bridge-central-east', 'bridge-central-west'], atS }];
  const variants = [
    { id: 'market-05', name: 'Market Bridge at 05:00', closures: market(300) },
    { id: 'market-10', name: 'Market Bridge at 10:00', closures: market(600) },
    { id: 'all-bridges-05', name: 'All bridges at 05:00', closures: [{ id: 'all-bridges-closure', edgeIds: ['north', 'central', 'south'].flatMap(id => [`bridge-${id}-east`, `bridge-${id}-west`]), atS: 300 }] },
    { id: 'clear-roads', name: 'Clear-road control', closures: [] },
  ];
  return validateExperiment({
    format: 'detourlab-experiment', version: 1, id: 'meridian-closure-comparison', name: 'Meridian closure comparison',
    baseScenario: { ...scenario, closures: [] }, variants: variants.filter(variant => selected.includes(variant.id)),
  });
}

/** Descriptive equal-weight sample statistics, never a pooled metric or policy gate. */
function statistics(rows, pick) {
  const values = rows.map(row => ({ seed: row.seed, value: pick(row) }));
  const available = values.filter(row => row.value !== null);
  const count = available.length;
  const min = count ? Math.min(...available.map(row => row.value)) : null;
  const max = count ? Math.max(...available.map(row => row.value)) : null;
  return {
    samples: count, missingSamples: values.length - count,
    min, max, mean: count ? Number((available.reduce((sum, row) => sum + row.value, 0) / count).toFixed(6)) : null,
    minSeeds: available.filter(row => row.value === min).map(row => row.seed),
    maxSeeds: available.filter(row => row.value === max).map(row => row.seed),
  };
}

function summarize(rows) {
  const fields = {
    metrics: ['distanceM', 'lateJobs', 'unreachableJobs', 'completedJobs'],
    delta: ['distanceM', 'extraDistancePct', 'extraLateJobs', 'unreachableJobs'],
    jobComparison: ['comparableJobs', 'uncomparableJobs', 'newlyLateJobs', 'maxArrivalSlipS'],
  };
  return Object.fromEntries(Object.entries(fields).map(([group, keys]) => [group, Object.fromEntries(keys.map(key => [key, statistics(rows, row => row[group][key])]))]));
}

/** Validate the complete request first, then retain compact projections, not cross-seed ledgers. */
export function compareMeridianSeeds(seeds, plans = DEFAULT_PLANS, thresholds = {}) {
  const samples = normalizeSeeds(seeds), selected = normalizeMeridianPlans(plans), policy = normalizePolicy(thresholds);
  const evaluated = Object.keys(policy).length > 0;
  const runs = samples.map(seed => {
    const experiment = createMeridianExperiment(seed, selected);
    const simulation = simulateExperiment(experiment);
    const variants = simulation.variants.map(variant => {
      // Pair jobs ONLY inside this seed. Job IDs do not identify the same demand across seeds.
      const jobComparison = compareJobOutcomes(simulation.baseline, variant.result);
      const violations = thresholdViolations(variant.delta, policy, jobComparison);
      return { id: variant.id, name: variant.name, metrics: variant.result.metrics, delta: variant.delta, jobComparison,
        verdict: !evaluated ? 'not-evaluated' : violations.length ? 'failed' : 'passed', violations };
    });
    return { seed, experimentSha256: createHash('sha256').update(canonicalExperiment(experiment)).digest('hex'),
      baseline: simulation.baseline.metrics, variants };
  });
  const variants = selected.map(id => {
    const rows = runs.map(run => ({ seed: run.seed, ...run.variants.find(variant => variant.id === id) }));
    const failedSeeds = evaluated ? rows.filter(row => row.verdict === 'failed').map(row => row.seed) : null;
    return { id, name: rows[0].name, verdict: !evaluated ? 'not-evaluated' : failedSeeds.length ? 'failed' : 'passed',
      failedSeeds, summary: summarize(rows) };
  });
  const report = {
    format: 'detourlab-meridian-seed-study', version: 1, engineVersion: '0.1.0',
    generator: 'DetourLab original Meridian fixture (createDemoScenario)', seeds: samples, plans: selected, thresholds: policy,
    verdict: !evaluated ? 'not-evaluated' : variants.some(variant => variant.verdict === 'failed') ? 'failed' : 'passed',
    runs, variants,
    warnings: runs.flatMap(run => run.variants.filter(variant => variant.metrics.unreachableJobs > 0).map(variant => ({ seed: run.seed, variantId: variant.id,
      message: 'Unreachable jobs were skipped; lower distance or lateness does not establish equal-service improvement.' }))),
    limitations: [
      'Only these explicit synthetic fixture seeds were evaluated. No probability, confidence interval, optimal plan, real-world robustness or operational safety is established.',
      'Seeds vary edge travel times, delivery destinations, service durations and deadline slack. Topology, edge distances and fleet structure stay fixed; this is not demand-only variation.',
      'Within each seed, all plans share exactly the same network, vehicles, jobs and order and are compared with that seed’s clear-road baseline. Jobs are not paired across seeds.',
      'Every seed and plan must pass every supplied threshold; descriptive means never determine acceptance. Statistics weight each available seed equally and means are rounded to six decimals.',
      'Arrival-slip summaries exclude null (uncomparable) samples and report missing counts. Unreachable work is not zero delay. Fingerprints identify generated input content, not authenticity or the executing implementation.',
      'The seed is a recipe only for this original generator, not for arbitrary imported scenarios. Save the exported ordinary experiment and source revision to reproduce a sample after generator changes.',
    ],
  };
  serializeSeedStudy(report);
  return report;
}

/** Bound the full pretty-printed UTF-8 output before any stdout emission. */
export function serializeSeedStudy(report) {
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(text, 'utf8') > SEED_STUDY_LIMITS.maxReportBytes) throw new Error('Seed study report exceeds the 1 MiB output limit.');
  return text;
}
