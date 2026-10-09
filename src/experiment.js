import { LIMITS, validateScenario } from './scenario.js';
import { simulate } from './engine.js';

/** A bounded set of closure schedules over exactly one supplied network/demand. */
export const EXPERIMENT_LIMITS = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  minVariants: 2,
  maxVariants: 6,
  nameLength: 120,
  idLength: 96,
  totalClosures: 8000,
  totalClosureReferences: 48000,
  totalResultSegments: 500000,
});

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const byteLength = text => new TextEncoder().encode(text).byteLength;

// Inspect descriptors before reading values: JSON-like inputs must never run getters.
function record(value, keys, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${path} must be a plain object; inherited data is not allowed.`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key) || !keys.includes(key)) throw new Error(`${path} contains unsupported property ${String(key)}.`);
    if (!hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) throw new Error(`${path}.${key} must be a data property, not an accessor.`);
  }
  for (const key of keys) if (!hasOwn(value, key)) throw new Error(`${path}.${key} is required.`);
  return value;
}

function array(value, path, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${path} must be an array with ${min}–${max} entries.`);
  if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error(`${path} must be a plain array; inherited overrides are not allowed.`);
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length) throw new Error(`${path} contains unsupported array property ${String(key)}.`);
    if (!hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) throw new Error(`${path}[${key}] must not be an accessor.`);
  }
  for (let i = 0; i < value.length; i += 1) if (!hasOwn(value, i)) throw new Error(`${path}[${i}] is missing.`);
  return value;
}

function label(value, path, max = EXPERIMENT_LIMITS.nameLength) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${path} must be a nonempty string of at most ${max} characters.`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value)) throw new Error(`${path} contains unsupported control characters.`);
  return value;
}

function identifier(value, path) {
  label(value, path, EXPERIMENT_LIMITS.idLength);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(value) || FORBIDDEN_KEYS.has(value)) throw new Error(`${path} must be a safe identifier using letters, numbers, ., :, _, or -.`);
  return value;
}

function unique(id, ids, path) {
  if (ids.has(id)) throw new Error(`${path} contains duplicate id "${id}".`);
  ids.add(id);
}

/** Validate and independently copy an experiment; baseScenario must have no closures. */
export function validateExperiment(input) {
  const source = record(input, ['format', 'version', 'id', 'name', 'baseScenario', 'variants'], 'experiment');
  if (source.format !== 'detourlab-experiment') throw new Error('experiment.format must be "detourlab-experiment".');
  if (source.version !== 1) throw new Error('experiment.version must be 1.');
  const id = identifier(source.id, 'experiment.id');
  const name = label(source.name, 'experiment.name');
  // Check the variant count before validating the larger shared graph.
  const inputVariants = array(source.variants, 'experiment.variants', EXPERIMENT_LIMITS.minVariants, EXPERIMENT_LIMITS.maxVariants);
  const baseScenario = validateScenario(source.baseScenario);
  if (baseScenario.closures.length) throw new Error('experiment.baseScenario.closures must be empty; put closure schedules in variants.');
  const edgeIds = new Set(baseScenario.edges.map(edge => edge.id));
  const variantIds = new Set();
  let totalClosures = 0;
  let totalClosureReferences = 0;
  const variants = inputVariants.map((variant, index) => {
    const path = `experiment.variants[${index}]`;
    record(variant, ['id', 'name', 'closures'], path);
    const variantId = identifier(variant.id, `${path}.id`);
    unique(variantId, variantIds, 'experiment.variants');
    const variantName = label(variant.name, `${path}.name`);
    const inputClosures = array(variant.closures, `${path}.closures`, 0, LIMITS.closures);
    totalClosures += inputClosures.length;
    if (totalClosures > EXPERIMENT_LIMITS.totalClosures) throw new Error(`Experiment exceeds the aggregate limit of ${EXPERIMENT_LIMITS.totalClosures} closure records.`);
    const closureIds = new Set();
    const closures = inputClosures.map((closure, closureIndex) => {
      const closurePath = `${path}.closures[${closureIndex}]`;
      record(closure, ['id', 'edgeIds', 'atS'], closurePath);
      const closureId = identifier(closure.id, `${closurePath}.id`);
      unique(closureId, closureIds, `${path}.closures`);
      const affected = array(closure.edgeIds, `${closurePath}.edgeIds`, 1, LIMITS.edges);
      totalClosureReferences += affected.length;
      if (totalClosureReferences > EXPERIMENT_LIMITS.totalClosureReferences) throw new Error(`Experiment exceeds the aggregate limit of ${EXPERIMENT_LIMITS.totalClosureReferences} closure edge references.`);
      const seen = new Set();
      const closureEdges = affected.map((edgeId, edgeIndex) => {
        identifier(edgeId, `${closurePath}.edgeIds[${edgeIndex}]`);
        if (!edgeIds.has(edgeId)) throw new Error(`${closurePath}.edgeIds[${edgeIndex}] references unknown id "${edgeId}".`);
        if (seen.has(edgeId)) throw new Error(`${closurePath}.edgeIds contains duplicate edge ids.`);
        seen.add(edgeId);
        return edgeId;
      });
      if (typeof closure.atS !== 'number' || !Number.isFinite(closure.atS) || closure.atS < 0 || closure.atS > LIMITS.maxTimeS) throw new Error(`${closurePath}.atS must be a finite number from 0 to ${LIMITS.maxTimeS}.`);
      return { id: closureId, edgeIds: closureEdges, atS: closure.atS };
    });
    return { id: variantId, name: variantName, closures };
  });
  const clean = { format: 'detourlab-experiment', version: 1, id, name, baseScenario, variants };
  if (byteLength(JSON.stringify(clean)) > EXPERIMENT_LIMITS.maxBytes) throw new Error('Experiment data exceeds the 2 MiB limit.');
  return clean;
}

/**
 * Explicitly upgrade a scenario without regenerating geometry, demand, metadata,
 * job order, or closure schedules. Empty supplied schedules remain empty.
 */
export function experimentFromScenario(input) {
  const scenario = validateScenario(input);
  return validateExperiment({
    format: 'detourlab-experiment', version: 1, id: scenario.id, name: scenario.name,
    baseScenario: { ...scenario, closures: [] },
    variants: [
      { id: 'supplied', name: 'Supplied scenario', closures: scenario.closures },
      { id: 'clear-roads', name: 'Clear-road control', closures: [] },
    ],
  });
}

/** Parse a bounded JSON experiment, or explicitly upgrade a validated v1 scenario. */
export function parseExperiment(text) {
  if (typeof text !== 'string') throw new Error('Experiment import must be JSON text.');
  if (text.length > EXPERIMENT_LIMITS.maxBytes || byteLength(text) > EXPERIMENT_LIMITS.maxBytes) throw new Error('Experiment import exceeds the 2 MiB limit.');
  let input;
  try { input = JSON.parse(text); } catch { throw new Error('Experiment import is not valid JSON.'); }
  if (input !== null && typeof input === 'object' && hasOwn(input, 'format')) return validateExperiment(input);
  return experimentFromScenario(input);
}

/** Return an independent validated scenario with only the chosen closure schedule. */
export function scenarioForVariant(input, variantId) {
  const experiment = validateExperiment(input);
  const variant = experiment.variants.find(item => item.id === variantId);
  if (!variant) throw new Error(`Unknown experiment variant "${String(variantId)}".`);
  // Both pieces are already independently copied and fully validated above.
  return { ...experiment.baseScenario, closures: variant.closures };
}

const round = value => Number(value.toFixed(6));

/**
 * Run the clear-road baseline once and every variant over identical supplied demand.
 * Distance and late-job differences are signed. Fewer traveled meters may reflect
 * skipped unreachable jobs, so always compare completed/unreachable counts too.
 * delta.unreachableJobs is the variant's absolute count, matching CLI thresholds.
 */
export function simulateExperiment(input) {
  const experiment = validateExperiment(input);
  const baseline = simulate(experiment.baseScenario);
  const segmentCount = result => result.vehicles.reduce((sum, vehicle) => sum + vehicle.segments.length, 0);
  const baselineSegments = segmentCount(baseline);
  let totalResultSegments = 0;
  const reserveResult = count => {
    totalResultSegments += count;
    if (totalResultSegments > EXPERIMENT_LIMITS.totalResultSegments) throw new Error(`Experiment exceeds the aggregate result limit of ${EXPERIMENT_LIMITS.totalResultSegments} route segments. Reduce the graph, jobs, or variants.`);
  };
  reserveResult(baselineSegments);
  const variants = experiment.variants.map(variant => {
    // Count controls before cloning: their ledgers consume output memory too.
    // Every result remains independent, and a rejected run returns no partial data.
    let result;
    if (variant.closures.length) {
      result = simulate({ ...experiment.baseScenario, closures: variant.closures });
      reserveResult(segmentCount(result));
    } else {
      reserveResult(baselineSegments);
      result = structuredClone(baseline);
    }
    const distanceM = result.metrics.distanceM - baseline.metrics.distanceM;
    return {
      id: variant.id, name: variant.name, result,
      delta: {
        distanceM: round(distanceM),
        extraDistancePct: baseline.metrics.distanceM ? round(distanceM / baseline.metrics.distanceM * 100) : 0,
        extraLateJobs: result.metrics.lateJobs - baseline.metrics.lateJobs,
        unreachableJobs: result.metrics.unreachableJobs,
      },
    };
  });
  return { baseline, variants };
}

/** Pretty when it fits; always importable under the same UTF-8 byte bound. */
export function exportExperiment(input) {
  const experiment = validateExperiment(input);
  const pretty = JSON.stringify(experiment, null, 2);
  if (byteLength(pretty) <= EXPERIMENT_LIMITS.maxBytes) return pretty;
  const compact = JSON.stringify(experiment);
  if (byteLength(compact) > EXPERIMENT_LIMITS.maxBytes) throw new Error('Experiment export exceeds the 2 MiB limit.');
  return compact;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Stable hash input, not a signature: keys are sorted; array order stays significant. */
export function canonicalExperiment(input) {
  return canonical(validateExperiment(input));
}
