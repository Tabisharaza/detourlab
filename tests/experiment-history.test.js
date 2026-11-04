import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIMITS } from '../src/scenario.js';
import { canonicalExperiment, EXPERIMENT_LIMITS, exportExperiment, parseExperiment, simulateExperiment, validateExperiment } from '../src/experiment.js';
import {
  EXPERIMENT_HISTORY_LIMITS, createExperimentHistory, recordExperimentHistory,
  selectExperimentHistory, undoExperimentHistory, redoExperimentHistory,
} from '../src/experiment-history.js';

const fixture = () => JSON.parse(readFileSync(new URL('../examples/minimal-experiment.json', import.meta.url), 'utf8'));
const selected = 'close-at-10';
const bytes = text => Buffer.byteLength(text, 'utf8');
const changed = (input, change) => { const next = structuredClone(input); change(next); return next; };
const renamed = (input, index) => changed(input, next => { next.name = `Experiment ${String(index).padStart(2, '0')}`; });
const snapshots = history => [...history.undo, history.current, ...history.redo];
const snapshotInput = snapshot => JSON.parse(snapshot.json).experiment;
const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value;

function assertBudget(history) {
  assert.ok(history.undo.length + history.redo.length <= EXPERIMENT_HISTORY_LIMITS.maxUndo);
  assert.ok(history.bytes <= EXPERIMENT_HISTORY_LIMITS.maxBytes);
  assert.equal(history.bytes, snapshots(history).reduce((sum, item) => sum + bytes(item.json), 0));
  for (const item of snapshots(history)) assert.equal(item.bytes, bytes(item.json));
}

// Large legal labels exercise byte accounting without relaxing graph/string or
// experiment limits. Unicode labels make UTF-16 character counts insufficient.
function byteSized(target, unicode = false) {
  const input = fixture(), base = input.baseScenario;
  input.name = 'Experiment 00';
  base.edges = Array.from({ length: LIMITS.edges }, (_, index) => ({
    ...base.edges[0], id: `e${index}`.padEnd(96, 'x'), roadName: 'R',
  }));
  input.variants.forEach(variant => { variant.closures = []; });
  let remaining = target - bytes(JSON.stringify(input));
  assert.ok(remaining >= 0);
  for (const edge of base.edges) {
    const count = Math.min(119, Math.floor(remaining / (unicode ? 3 : 1)));
    edge.roadName += (unicode ? '路' : 'R').repeat(count);
    remaining -= count * (unicode ? 3 : 1);
  }
  // An ASCII suffix handles the final one/two UTF-8 bytes precisely.
  for (const edge of base.edges) {
    const count = Math.min(120 - edge.roadName.length, remaining);
    edge.roadName += 'R'.repeat(count); remaining -= count;
  }
  assert.equal(remaining, 0);
  assert.equal(bytes(JSON.stringify(input)), target);
  validateExperiment(input);
  return input;
}

test('history limits are fixed and initialization makes a validated empty boundary', () => {
  assert.deepEqual(EXPERIMENT_HISTORY_LIMITS, { maxUndo: 20, maxBytes: 16 * 1024 * 1024, labelLength: 120 });
  assert.ok(Object.isFrozen(EXPERIMENT_HISTORY_LIMITS));
  const input = fixture(), history = createExperimentHistory(input, selected);
  assert.deepEqual(history.undo, []); assert.deepEqual(history.redo, []);
  assert.equal(history.current.selectedId, selected);
  assert.equal(history.current.label, 'Initial experiment');
  assert.deepEqual(snapshotInput(history.current), input);
  assert.equal(undoExperimentHistory(history), null);
  assert.equal(redoExperimentHistory(history), null);
  assertBudget(history);
});

test('undo and redo preserve exact input, variant selection and action labels across edits', () => {
  const initial = fixture();
  const cutoff = changed(initial, input => { input.variants[1].closures[0].atS = 10.125; });
  const duplicate = changed(cutoff, input => {
    input.variants.push({ ...structuredClone(input.variants[1]), id: 'copied', name: 'Independent copy' });
  });
  const removed = changed(duplicate, input => { input.variants.splice(1, 1); });
  const start = createExperimentHistory(initial, selected);
  const first = recordExperimentHistory(start, cutoff, selected, 'Change closure cutoff');
  const second = recordExperimentHistory(first, duplicate, 'copied', 'Duplicate variant');
  const third = recordExperimentHistory(second, removed, 'copied', 'Delete variant');
  let result = undoExperimentHistory(third);
  assert.equal(result.label, 'Delete variant'); assert.equal(result.selectedId, 'copied');
  assert.deepEqual(result.experiment, duplicate);
  result = undoExperimentHistory(result.history);
  assert.equal(result.label, 'Duplicate variant'); assert.equal(result.selectedId, selected);
  assert.deepEqual(result.experiment, cutoff);
  result = undoExperimentHistory(result.history);
  assert.equal(result.label, 'Change closure cutoff'); assert.deepEqual(result.experiment, initial);
  assert.equal(undoExperimentHistory(result.history), null);
  for (const [input, label, id] of [[cutoff, 'Change closure cutoff', selected], [duplicate, 'Duplicate variant', 'copied'], [removed, 'Delete variant', 'copied']]) {
    result = redoExperimentHistory(result.history);
    assert.deepEqual(result.experiment, input); assert.equal(result.label, label); assert.equal(result.selectedId, id);
    assertBudget(result.history);
  }
  assert.equal(redoExperimentHistory(result.history), null);
  assert.deepEqual(third.undo.map(item => item.label), ['Initial experiment', 'Change closure cutoff', 'Duplicate variant']);
});

test('restored inputs roundtrip and reproduce every ledger instead of trusting result caches', () => {
  const input = fixture(), expected = simulateExperiment(input);
  const edited = changed(input, next => { next.variants[1].closures = []; });
  const history = recordExperimentHistory(createExperimentHistory(input, selected), edited, selected, 'Clear closures');
  const restored = undoExperimentHistory(history);
  assert.deepEqual(parseExperiment(exportExperiment(restored.experiment)), input);
  assert.deepEqual(simulateExperiment(restored.experiment), expected);
  assert.deepEqual(Object.keys(JSON.parse(restored.history.current.json)), ['experiment', 'selectedId', 'label']);
  assert.equal(canonicalExperiment(restored.experiment), canonicalExperiment(input));
  assert.throws(() => createExperimentHistory({ ...input, results: expected }, selected), /unsupported property/);
});

test('caller mutations, restored mutations and externally supplied stacks cannot alter retained states', () => {
  const input = fixture(), original = structuredClone(input);
  const start = createExperimentHistory(input, selected);
  input.baseScenario.nodes[0].x += 100; input.variants[1].closures[0].edgeIds.push('ab');
  assert.deepEqual(snapshotInput(start.current), original);
  const next = renamed(original, 1);
  const history = recordExperimentHistory(start, next, selected, 'Rename experiment');
  next.variants[1].closures[0].atS = 300;
  const restored = undoExperimentHistory(history);
  restored.experiment.baseScenario.jobs[0].id = 'changed';
  restored.experiment.variants[1].closures[0].edgeIds.length = 0;
  assert.deepEqual(undoExperimentHistory(history).experiment, original);
  assert.deepEqual(redoExperimentHistory(restored.history).experiment, renamed(original, 1));
  assert.ok(Object.isFrozen(history)); assert.ok(Object.isFrozen(history.undo)); assert.ok(Object.isFrozen(history.redo));
  for (const item of snapshots(history)) assert.ok(Object.isFrozen(item));
  assert.throws(() => { history.current.selectedId = 'clear'; }, TypeError);
  assert.throws(() => { history.undo.length = 0; }, TypeError);
  const supplied = structuredClone(history), before = structuredClone(supplied);
  const moved = undoExperimentHistory(supplied);
  assert.deepEqual(supplied, before, 'even a valid caller-owned history is never mutated');
  supplied.current.json = '{}'; supplied.undo.length = 0;
  assert.deepEqual(redoExperimentHistory(moved.history).experiment, renamed(original, 1));
});

test('canonical no-ops and selection navigation preserve redo and do not create undo steps', () => {
  const input = fixture(), edit = renamed(input, 1);
  const recorded = recordExperimentHistory(createExperimentHistory(input, selected), edit, selected, 'Rename experiment');
  let history = undoExperimentHistory(recorded).history;
  assert.strictEqual(recordExperimentHistory(history, reverseKeys(input), selected, 'Unchanged'), history);
  assert.strictEqual(selectExperimentHistory(history, selected), history);
  const before = history;
  history = selectExperimentHistory(history, 'clear');
  assert.equal(history.undo.length, 0); assert.equal(history.redo.length, 1);
  assert.equal(history.current.label, 'Initial experiment');
  assert.equal(history.current.selectedId, 'clear');
  assert.equal(before.current.selectedId, selected);
  assert.deepEqual(redoExperimentHistory(history).experiment, edit);
  const selectionOnly = recordExperimentHistory(history, input, 'close-at-11', 'Ignored navigation label');
  assert.equal(selectionOnly.current.selectedId, 'close-at-11');
  assert.equal(selectionOnly.current.label, 'Initial experiment');
  assert.equal(selectionOnly.undo.length, 0); assert.equal(selectionOnly.redo.length, 1);
  // Navigation becomes the pre-edit selection, restored when the edit is undone.
  const branch = recordExperimentHistory(selectionOnly, renamed(input, 2), 'clear', 'Branch edit');
  assert.equal(branch.redo.length, 0);
  assert.equal(undoExperimentHistory(branch).selectedId, 'close-at-11');
});

test('only a valid meaningful edit clears redo; array-order changes are meaningful', () => {
  const input = fixture(), edit = renamed(input, 1);
  const history = undoExperimentHistory(recordExperimentHistory(createExperimentHistory(input, selected), edit, selected, 'Rename experiment')).history;
  const preserved = JSON.stringify(history);
  const invalid = changed(input, next => { next.variants[1].closures[0].edgeIds = ['missing']; });
  for (const action of [
    () => recordExperimentHistory(history, invalid, selected, 'Invalid edit'),
    () => recordExperimentHistory(history, edit, 'missing', 'Invalid selection'),
    () => recordExperimentHistory(history, edit, selected, ''),
    () => recordExperimentHistory(history, edit, selected, 'x'.repeat(121)),
    () => recordExperimentHistory(history, edit, selected, 'Invalid\nlabel'),
    () => selectExperimentHistory(history, 'missing'),
    () => createExperimentHistory(input, null),
  ]) {
    assert.throws(action);
    assert.equal(JSON.stringify(history), preserved);
    assert.deepEqual(redoExperimentHistory(history).experiment, edit);
  }
  const reorder = changed(input, next => { next.variants.reverse(); });
  const branched = recordExperimentHistory(history, reorder, selected, 'Reorder variants');
  assert.equal(branched.undo.length, 1); assert.equal(branched.redo.length, 0);
  assert.equal(redoExperimentHistory(branched), null);
  assert.deepEqual(undoExperimentHistory(branched).experiment, input);
});

test('twenty undo transitions retain current plus twenty prior states and evict the oldest predictably', () => {
  const input = fixture();
  let history = createExperimentHistory(renamed(input, 0), selected);
  for (let index = 1; index <= 25; index += 1) {
    history = recordExperimentHistory(history, renamed(input, index), selected, `Edit ${index}`);
    assertBudget(history);
  }
  assert.equal(history.undo.length, 20); assert.equal(snapshots(history).length, 21);
  assert.equal(snapshotInput(history.undo[0]).name, 'Experiment 05');
  const bytesBefore = history.bytes;
  for (let index = 24; index >= 5; index -= 1) {
    const restored = undoExperimentHistory(history);
    assert.equal(restored.experiment.name, `Experiment ${String(index).padStart(2, '0')}`);
    history = restored.history; assertBudget(history);
    assert.equal(history.bytes, bytesBefore, 'moving the cursor does not duplicate snapshots');
  }
  assert.equal(undoExperimentHistory(history), null); assert.equal(history.redo.length, 20);
  for (let index = 6; index <= 25; index += 1) history = redoExperimentHistory(history).history;
  assert.equal(redoExperimentHistory(history), null); assert.equal(history.bytes, bytesBefore);
});

test('current remains representable at the exact experiment byte limit, with UTF-8 history eviction', () => {
  const input = byteSized(EXPERIMENT_LIMITS.maxBytes, true);
  let history = createExperimentHistory(input, selected);
  assert.equal(bytes(canonicalExperiment(input)), EXPERIMENT_LIMITS.maxBytes);
  assert.ok(history.current.json.length < history.current.bytes, 'multibyte names count as UTF-8, not string length');
  for (let index = 1; index <= 9; index += 1) {
    history = recordExperimentHistory(history, renamed(input, index), selected, `Edit ${String(index).padStart(2, '0')}`);
    assertBudget(history);
    assert.equal(snapshotInput(history.current).name, `Experiment ${String(index).padStart(2, '0')}`);
  }
  // Eight 2 MiB experiments plus their metadata exceed the aggregate 16 MiB.
  assert.equal(snapshots(history).length, 7); assert.equal(history.undo.length, 6);
  assert.equal(snapshotInput(history.undo[0]).name, 'Experiment 03');
  assert.ok(snapshots(history).reduce((sum, item) => sum + item.json.length, 0) < 12 * 1024 * 1024);
  const total = history.bytes;
  const restored = undoExperimentHistory(history);
  assert.equal(restored.history.bytes, total); assertBudget(restored.history);
  assert.equal(redoExperimentHistory(restored.history).history.bytes, total);
});

test('exactly 16 MiB fits; selection metadata growth evicts oldest past or farthest redo without losing current', () => {
  const small = fixture(), boundary = createExperimentHistory(small, 'clear');
  const overhead = boundary.current.bytes - bytes(canonicalExperiment(small));
  const input = byteSized(EXPERIMENT_LIMITS.maxBytes - overhead, true);
  let history = createExperimentHistory(input, 'clear');
  assert.equal(history.current.bytes, EXPERIMENT_LIMITS.maxBytes);
  for (let index = 1; index <= 7; index += 1) {
    history = recordExperimentHistory(history, renamed(input, index), 'clear', 'Initial experiment');
  }
  assert.equal(history.bytes, EXPERIMENT_HISTORY_LIMITS.maxBytes);
  assert.equal(snapshots(history).length, 8);
  assert.strictEqual(selectExperimentHistory(history, 'clear'), history);
  const selection = selectExperimentHistory(history, 'close-at-11');
  assert.equal(selection.current.selectedId, 'close-at-11');
  assert.equal(snapshotInput(selection.current).name, 'Experiment 07');
  assert.equal(snapshotInput(selection.undo[0]).name, 'Experiment 01');
  assert.equal(selection.undo.length, 6); assert.equal(selection.redo.length, 0);
  assertBudget(selection);
  // Moving the cursor itself does not alter the budget. At the first retained
  // state no past can be dropped, so only the farthest redo is expendable.
  while (history.undo.length) history = undoExperimentHistory(history).history;
  assert.equal(history.bytes, EXPERIMENT_HISTORY_LIMITS.maxBytes);
  const navigated = selectExperimentHistory(history, 'close-at-11');
  assert.equal(navigated.undo.length, 0); assert.equal(navigated.redo.length, 6);
  assert.equal(snapshotInput(navigated.current).name, 'Experiment 00');
  assert.equal(snapshotInput(navigated.redo[0]).name, 'Experiment 06');
  assert.equal(redoExperimentHistory(navigated).experiment.name, 'Experiment 01');
  assertBudget(navigated);
});

test('new boundaries discard both stacks without mutating the previous workspace history', () => {
  const input = fixture(), edit = renamed(input, 1);
  const old = undoExperimentHistory(recordExperimentHistory(createExperimentHistory(input, selected), edit, selected, 'Edit')).history;
  const reset = createExperimentHistory(edit, 'clear');
  assert.equal(reset.undo.length, 0); assert.equal(reset.redo.length, 0);
  assert.equal(reset.current.selectedId, 'clear'); assert.deepEqual(snapshotInput(reset.current), edit);
  assert.equal(old.redo.length, 1); assert.deepEqual(redoExperimentHistory(old).experiment, edit);
});

test('invalid or tampered snapshot states reject atomically before undo, redo, record or selection', () => {
  const input = fixture();
  const first = recordExperimentHistory(createExperimentHistory(input, selected), renamed(input, 1), selected, 'First edit');
  const second = recordExperimentHistory(first, renamed(input, 2), selected, 'Second edit');
  const valid = undoExperimentHistory(second).history;
  const corruptions = [
    value => { value.current.json = '{'; },
    value => { value.undo[0].selectedId = 'missing'; },
    value => { value.redo[0].label = 'Wrong action'; },
    value => { value.current.bytes += 1; },
    value => { value.bytes -= 1; },
    value => { const data = JSON.parse(value.redo[0].json); data.experiment.variants[1].closures[0].edgeIds = ['missing']; value.redo[0].json = JSON.stringify(data); },
    value => { const data = JSON.parse(value.current.json); data.selectedId = 'missing'; value.current.json = JSON.stringify(data); },
    value => { value.current.json = ' '.repeat(EXPERIMENT_LIMITS.maxBytes + 1025); },
    value => { value.redo.push(...Array(20).fill(value.redo[0])); },
    value => { delete value.undo[0]; },
    value => { value.redo.extra = true; },
    value => { value.results = {}; },
  ];
  for (const corrupt of corruptions) {
    const history = structuredClone(valid); corrupt(history);
    const before = structuredClone(history);
    for (const action of [
      () => undoExperimentHistory(history), () => redoExperimentHistory(history),
      () => recordExperimentHistory(history, renamed(input, 3), selected, 'Third edit'),
      () => selectExperimentHistory(history, 'clear'),
    ]) {
      assert.throws(action); assert.deepEqual(history, before);
    }
  }
});

test('history rejects accessors and inherited data without executing caller code', () => {
  const input = fixture(), valid = createExperimentHistory(input, selected);
  let executed = 0;
  const withGetter = (object, key) => Object.defineProperty(object, key, { enumerable: true, get() { executed += 1; throw new Error('Executed getter'); } });
  assert.throws(() => createExperimentHistory(withGetter(input, 'name'), selected), /accessor/);
  assert.throws(() => undoExperimentHistory(withGetter(structuredClone(valid), 'undo')), /accessor/);
  const history = structuredClone(valid); withGetter(history.current, 'json');
  assert.throws(() => redoExperimentHistory(history), /accessor/);
  const arrayHistory = structuredClone(valid); arrayHistory.undo = [valid.current]; withGetter(arrayHistory.undo, '0');
  assert.throws(() => undoExperimentHistory(arrayHistory), /data properties/);
  assert.throws(() => undoExperimentHistory(Object.create(valid)), /plain object/);
  assert.equal(executed, 0);
});

test('freezing a forged history does not grant the trusted identity fast path', () => {
  const history = structuredClone(createExperimentHistory(fixture(), selected));
  history.current.json = '{}';
  Object.freeze(history.current); Object.freeze(history.undo); Object.freeze(history.redo); Object.freeze(history);
  for (const action of [
    () => undoExperimentHistory(history), () => redoExperimentHistory(history),
    () => selectExperimentHistory(history, selected),
    () => recordExperimentHistory(history, fixture(), selected, 'No change'),
  ]) assert.throws(action, /required/);
});
