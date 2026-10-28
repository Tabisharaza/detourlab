import { EXPERIMENT_LIMITS, validateExperiment } from '../src/experiment.js';
import { LIMITS } from '../src/scenario.js';

/** Pure, bounded authoring helper; does not simulate or read/write files. */
export function normalizeCutoffTimes(times) {
  if (!Array.isArray(times) || Object.getPrototypeOf(times) !== Array.prototype || times.length < 2 || times.length > EXPERIMENT_LIMITS.maxVariants) {
    throw new Error('Cutoff comparison requires 2–6 unique sample times.');
  }
  for (const key of Reflect.ownKeys(times)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= times.length || !Object.hasOwn(Object.getOwnPropertyDescriptor(times, key), 'value')) {
      throw new Error('Sample times must be a plain array of numbers.');
    }
  }
  const clean = [];
  for (let i = 0; i < times.length; i += 1) {
    if (!Object.hasOwn(times, i)) throw new Error('Sample times must not have missing entries.');
    const time = times[i];
    if (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > LIMITS.maxTimeS) throw new Error(`Sample times must be finite numbers from 0 to ${LIMITS.maxTimeS} seconds.`);
    clean.push(time === 0 ? 0 : time);
  }
  if (new Set(clean).size !== clean.length) throw new Error('Sample times must be unique; duplicate cutoffs are not allowed.');
  return clean.sort((a, b) => a - b);
}

/** Replace the source variant set with 2–6 independently copied sampled plans. */
export function createCutoffExperiment(input, variantId, closureId, times) {
  const cutoffs = normalizeCutoffTimes(times);
  const experiment = validateExperiment(input);
  if (typeof variantId !== 'string' || typeof closureId !== 'string') throw new Error('A source variant ID and closure ID are required.');
  const selected = experiment.variants.find(variant => variant.id === variantId);
  if (!selected) throw new Error('Source variant ID does not exist in the experiment.');
  if (!selected.closures.some(closure => closure.id === closureId)) throw new Error('Closure ID does not exist in the selected variant.');
  if (selected.closures.length * cutoffs.length > EXPERIMENT_LIMITS.totalClosures) throw new Error('Sampled experiment exceeds the aggregate closure-record limit.');
  const references = selected.closures.reduce((count, closure) => count + closure.edgeIds.length, 0);
  if (references * cutoffs.length > EXPERIMENT_LIMITS.totalClosureReferences) throw new Error('Sampled experiment exceeds the aggregate closure-reference limit.');
  const reserved = new Set(['baseline', experiment.id, experiment.baseScenario.id, ...experiment.variants.map(variant => variant.id)]);
  function uniqueId(base) {
    let id = base;
    let suffix = 2;
    while (reserved.has(id)) id = `${base}-${suffix++}`;
    reserved.add(id);
    return id;
  }
  const generated = {
    format: 'detourlab-experiment', version: 1,
    id: uniqueId('cutoff-comparison'), name: 'Sampled closure cutoff comparison',
    baseScenario: experiment.baseScenario,
    variants: cutoffs.map((time, index) => ({
      id: uniqueId(`cutoff-${index + 1}`), name: `Closure at ${time} s`,
      closures: selected.closures.map(closure => ({ ...closure, edgeIds: [...closure.edgeIds], atS: closure.id === closureId ? time : closure.atS })),
    })),
  };
  // Replicating a valid source schedule can exceed aggregate reference/byte
  // limits. Revalidate BEFORE any simulation or export; never weaken limits.
  return validateExperiment(generated);
}
