import { canonicalExperiment, EXPERIMENT_LIMITS } from './experiment.js';

/** Input snapshots only. The byte limit measures serialized UTF-8, not JS heap. */
export const EXPERIMENT_HISTORY_LIMITS = Object.freeze({
  maxUndo: 20,
  maxBytes: 16 * 1024 * 1024,
  labelLength: 120,
});

const byteLength = text => new TextEncoder().encode(text).byteLength;
// A valid maximum-sized experiment always fits with its bounded selection/label.
const MAX_SNAPSHOT_BYTES = EXPERIMENT_LIMITS.maxBytes + 1024;
const snapshotKeys = ['json', 'selectedId', 'label', 'bytes'];
// Only module-issued, deeply frozen state identities take the fast path. This
// retains no parsed graph/result cache and never trusts a caller-created copy.
const issuedHistories = new WeakSet();

function record(value, keys, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${path} must be a plain object.`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !keys.includes(key)) throw new Error(`${path} contains an unsupported property.`);
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) throw new Error(`${path} must not contain accessors.`);
  }
  for (const key of keys) if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key} is required.`);
  return value;
}

function stack(value, path) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > EXPERIMENT_HISTORY_LIMITS.maxUndo) {
    throw new Error(`${path} must be a plain array with at most 20 snapshots.`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) {
      throw new Error(`${path} must contain only snapshot data properties.`);
    }
  }
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) throw new Error(`${path} must not contain missing snapshots.`);
  return value;
}

function checkLabel(label) {
  if (typeof label !== 'string' || !label.trim() || label.length > EXPERIMENT_HISTORY_LIMITS.labelLength || /[\u0000-\u001f\u007f]/u.test(label)) {
    throw new Error('History action label must be a nonempty string of at most 120 characters without control characters.');
  }
}

function checkSelection(experiment, selectedId) {
  if (typeof selectedId !== 'string' || !experiment.variants.some(variant => variant.id === selectedId)) {
    throw new Error('History selectedId must reference an experiment variant.');
  }
}

function snapshotFromCanonical(canonical, selectedId, label) {
  const json = `{"experiment":${canonical},"selectedId":${JSON.stringify(selectedId)},"label":${JSON.stringify(label)}}`;
  return Object.freeze({ json, selectedId, label, bytes: byteLength(json) });
}

function createSnapshot(input, selectedId, label) {
  checkLabel(label);
  // Validate before serializing: no caller getters, toJSON or result caches.
  const canonical = canonicalExperiment(input);
  checkSelection(JSON.parse(canonical), selectedId);
  return snapshotFromCanonical(canonical, selectedId, label);
}

function decodeSnapshot(value) {
  const source = record(value, snapshotKeys, 'History snapshot');
  if (typeof source.json !== 'string' || source.json.length > MAX_SNAPSHOT_BYTES || byteLength(source.json) > MAX_SNAPSHOT_BYTES) {
    throw new Error('History snapshot exceeds its bounded JSON input limit.');
  }
  let decoded;
  try { decoded = JSON.parse(source.json); } catch { throw new Error('History snapshot is not valid JSON.'); }
  record(decoded, ['experiment', 'selectedId', 'label'], 'History snapshot data');
  const snapshot = createSnapshot(decoded.experiment, decoded.selectedId, decoded.label);
  if (source.json !== snapshot.json || source.selectedId !== snapshot.selectedId || source.label !== snapshot.label || source.bytes !== snapshot.bytes) {
    throw new Error('History snapshot metadata or canonical input does not match its data.');
  }
  // This parse returns only independently validated inputs, never stored objects.
  return { snapshot, experiment: JSON.parse(snapshot.json).experiment };
}

function inspectHistory(value) {
  if (issuedHistories.has(value)) return value;
  const source = record(value, ['undo', 'current', 'redo', 'bytes'], 'History');
  const undo = stack(source.undo, 'History undo'), redo = stack(source.redo, 'History redo');
  if (undo.length + redo.length > EXPERIMENT_HISTORY_LIMITS.maxUndo) throw new Error('History exceeds 20 retained transitions.');
  // Validate the complete state before any operation. In particular, a damaged
  // later redo snapshot cannot silently survive a different successful restore.
  const decoded = { undo: undo.map(decodeSnapshot), current: decodeSnapshot(source.current), redo: redo.map(decodeSnapshot) };
  const bytes = [...decoded.undo, decoded.current, ...decoded.redo].reduce((sum, item) => sum + item.snapshot.bytes, 0);
  if (source.bytes !== bytes || bytes > EXPERIMENT_HISTORY_LIMITS.maxBytes) throw new Error('History exceeds or misreports its 16 MiB snapshot budget.');
  return {
    undo: decoded.undo.map(item => item.snapshot), current: decoded.current.snapshot,
    redo: decoded.redo.map(item => item.snapshot), bytes,
  };
}

function buildHistory(undo, current, redo) {
  const past = [...undo], future = [...redo];
  let bytes = [...past, current, ...future].reduce((sum, item) => sum + item.bytes, 0);
  // Editing discards redo before pruning. Navigation can grow selection metadata
  // slightly: evict the oldest past first, then the farthest redo if necessary.
  while (past.length > EXPERIMENT_HISTORY_LIMITS.maxUndo || bytes > EXPERIMENT_HISTORY_LIMITS.maxBytes) {
    const removed = past.length ? past.shift() : future.shift();
    if (!removed) throw new Error('Current history snapshot exceeds the 16 MiB budget.');
    bytes -= removed.bytes;
  }
  const history = Object.freeze({ undo: Object.freeze(past), current, redo: Object.freeze(future), bytes });
  issuedHistories.add(history);
  return history;
}

/** Start/reset an import boundary. No earlier state or simulation result survives. */
export function createExperimentHistory(experiment, selectedId) {
  return buildHistory([], createSnapshot(experiment, selectedId, 'Initial experiment'), []);
}

/** Change presentation selection without creating an edit or clearing redo. */
export function selectExperimentHistory(history, selectedId) {
  const clean = inspectHistory(history);
  const experiment = JSON.parse(clean.current.json).experiment;
  checkSelection(experiment, selectedId);
  if (selectedId === clean.current.selectedId) return history;
  const current = snapshotFromCanonical(JSON.stringify(experiment), selectedId, clean.current.label);
  return buildHistory(clean.undo, current, clean.redo);
}

/**
 * Record a validated edit, preserving the selection on either side. Canonically
 * equal inputs are no-ops; selection-only changes keep the existing action label.
 * Invalid edits throw without changing any input, stack, or redo branch.
 */
export function recordExperimentHistory(history, experiment, selectedId, label) {
  const clean = inspectHistory(history);
  const next = createSnapshot(experiment, selectedId, label);
  // Both objects were parsed from the canonical serializer above. Comparing
  // their JSON preserves significant array order without revalidating twice.
  const nextInput = JSON.stringify(JSON.parse(next.json).experiment);
  const currentInput = JSON.stringify(JSON.parse(clean.current.json).experiment);
  if (nextInput === currentInput) {
    if (selectedId === clean.current.selectedId) return history;
    const current = snapshotFromCanonical(currentInput, selectedId, clean.current.label);
    return buildHistory(clean.undo, current, clean.redo);
  }
  return buildHistory([...clean.undo, clean.current], next, []);
}

/** Restore fresh validated inputs. The returned label names the undone edit. */
export function undoExperimentHistory(history) {
  const clean = inspectHistory(history);
  if (!clean.undo.length) return null;
  const target = decodeSnapshot(clean.undo.at(-1));
  const next = buildHistory(clean.undo.slice(0, -1), target.snapshot, [...clean.redo, clean.current]);
  return { history: next, experiment: target.experiment, selectedId: target.snapshot.selectedId, label: clean.current.label };
}

/** Restore fresh validated inputs. The returned label names the redone edit. */
export function redoExperimentHistory(history) {
  const clean = inspectHistory(history);
  if (!clean.redo.length) return null;
  const target = decodeSnapshot(clean.redo.at(-1));
  const next = buildHistory([...clean.undo, clean.current], target.snapshot, clean.redo.slice(0, -1));
  return { history: next, experiment: target.experiment, selectedId: target.snapshot.selectedId, label: target.snapshot.label };
}
