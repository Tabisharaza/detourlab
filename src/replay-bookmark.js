import { canonicalExperiment, EXPERIMENT_LIMITS } from './experiment.js';

/** Presentation-only handoff. Results are deliberately absent and must be recomputed. */
export const REPLAY_BOOKMARK_LIMITS = Object.freeze({
  maxBytes: EXPERIMENT_LIMITS.maxBytes, minZoom: .65, maxZoom: 2.5,
  // Accumulated route/service durations can exceed a scenario's input time limit.
  // The app must clamp to its recomputed timeline with an explicit notice.
  maxTimeS: Number.MAX_SAFE_INTEGER,
});
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const byteLength = text => new TextEncoder().encode(text).byteLength;
const views = new Set(['disruption', 'baseline', 'compare', 'split']);

function record(value, keys, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${path} must be a plain object; inherited data is not allowed.`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !keys.includes(key)) throw new Error(`${path} contains unsupported property ${String(key)}.`);
    if (!hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) throw new Error(`${path}.${key} must be a data property, not an accessor.`);
  }
  for (const key of keys) if (!hasOwn(value, key)) throw new Error(`${path}.${key} is required.`);
  return value;
}
function boundedNumber(value, path, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${path} must be a finite number from ${min} to ${max}.`);
  return Object.is(value, -0) ? 0 : value;
}

/** Independently copy and validate JSON-like data without invoking accessors. */
export function validateReplayBookmark(value) {
  const source = record(value, ['format', 'version', 'experiment', 'perspective'], 'bookmark');
  if (source.format !== 'detourlab-replay-bookmark') throw new Error('bookmark.format must be "detourlab-replay-bookmark".');
  if (source.version !== 1) throw new Error('bookmark.version must be 1.');
  const p = record(source.perspective, ['variantId', 'vehicleId', 'timeS', 'view', 'zoom'], 'bookmark.perspective');
  // The shared canonical serializer performs strict nested validation and retains
  // significant array order; never pass caller objects to JSON.stringify directly.
  const experiment = JSON.parse(canonicalExperiment(source.experiment));
  if (typeof p.variantId !== 'string' || !experiment.variants.some(variant => variant.id === p.variantId)) throw new Error('bookmark.perspective.variantId must reference an experiment variant.');
  if (p.vehicleId !== null && (typeof p.vehicleId !== 'string' || !experiment.baseScenario.vehicles.some(vehicle => vehicle.id === p.vehicleId))) throw new Error('bookmark.perspective.vehicleId must be null or reference an experiment vehicle.');
  if (typeof p.view !== 'string' || !views.has(p.view)) throw new Error('bookmark.perspective.view must be disruption, baseline, compare or split.');
  const timeS = boundedNumber(p.timeS, 'bookmark.perspective.timeS', 0, REPLAY_BOOKMARK_LIMITS.maxTimeS);
  const zoom = boundedNumber(p.zoom, 'bookmark.perspective.zoom', REPLAY_BOOKMARK_LIMITS.minZoom, REPLAY_BOOKMARK_LIMITS.maxZoom);
  const clean = { format: 'detourlab-replay-bookmark', version: 1, experiment,
    perspective: { variantId: p.variantId, vehicleId: p.vehicleId, timeS, view: p.view, zoom } };
  if (byteLength(JSON.stringify(clean)) > REPLAY_BOOKMARK_LIMITS.maxBytes) throw new Error('Replay bookmark exceeds the 2 MiB limit.');
  return clean;
}

export function parseReplayBookmark(text) {
  if (typeof text !== 'string') throw new Error('Replay bookmark import must be JSON text.');
  if (text.length > REPLAY_BOOKMARK_LIMITS.maxBytes || byteLength(text) > REPLAY_BOOKMARK_LIMITS.maxBytes) throw new Error('Replay bookmark import exceeds the 2 MiB limit.');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('Replay bookmark import is not valid JSON.'); }
  return validateReplayBookmark(value);
}

/** Stable compact JSON under the same UTF-8 byte bound as imports. */
export function exportReplayBookmark(experiment, perspective) {
  return JSON.stringify(validateReplayBookmark({ format: 'detourlab-replay-bookmark', version: 1, experiment, perspective }));
}
