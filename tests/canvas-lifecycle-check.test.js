import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runLifecycleCheck, assertFreshParity, usage } from '../tools/canvas-lifecycle-check/run.js';

const visible = () => ({ width: 320, height: 420, dpr: 1.5, pixelWidth: 480, pixelHeight: 630,
  differences: 0, nonempty: true, comparedBytes: 1209600, vehiclePointsEqual: true,
  roadPointsEqual: true, roadHitsEqual: true, vehicles: 1, roads: 4, paint: true });
const hidden = () => ({ ...visible(), width: 0, height: 0, pixelWidth: 0, pixelHeight: 0,
  nonempty: false, comparedBytes: 0, vehicles: 0, roads: 0, paint: false });

test('lifecycle help describes native coverage and honest scope limits', () => {
  const result = spawnSync(process.execPath, ['tools/canvas-lifecycle-check/run.js', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0); assert.equal(result.stdout.trim(), usage);
  assert.match(usage, /native ResizeObserver/); assert.match(usage, /Not native GPU context-loss/);
  assert.match(usage, /full-app split-view/);
});
test('lifecycle arguments reject relative browser paths before work', () => {
  const result = spawnSync(process.execPath, ['tools/canvas-lifecycle-check/run.js', '--browser', 'relative', '--out', 'unused'], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /absolute browser executable/);
});
test('fresh parity accepts visible and zero-size independent reference rows', () => {
  assertFreshParity([visible(), visible()]); assertFreshParity([hidden(), hidden()], true);
});
test('fresh parity rejects pixel, geometry and hit-target regressions in either pane', () => {
  for (const patch of [{ differences: 1 }, { vehiclePointsEqual: false }, { roadPointsEqual: false },
    { roadHitsEqual: false }, { nonempty: false }, { comparedBytes: 0 }, { pixelWidth: 320 },
    { pixelHeight: 420 }, { vehicles: 0 }, { roads: 0 }]) {
    assert.throws(() => assertFreshParity([visible(), { ...visible(), ...patch }]));
  }
  assert.throws(() => assertFreshParity([visible()]));
});
test('hidden parity rejects retained dimensions, targets or accidental rendering', () => {
  for (const patch of [{ width: 1 }, { height: 1 }, { pixelWidth: 1 }, { pixelHeight: 1 },
    { vehicles: 1 }, { roads: 1 }, { paint: true }]) {
    assert.throws(() => assertFreshParity([{ ...hidden(), ...patch }, hidden()], true));
  }
});
test('lifecycle evidence never overwrites an existing directory', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'lifecycle-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'evidence'); await mkdir(output);
  await assert.rejects(runLifecycleCheck({ executable: '/does/not/exist', output }), { code: 'EEXIST' });
});
test('failed launch writes bounded source-identified evidence and cleans resources', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'lifecycle-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'evidence');
  await assert.rejects(runLifecycleCheck({ executable: '/does/not/exist', output }), /ENOENT/);
  const evidence = JSON.parse(await readFile(path.join(output, 'evidence.json'), 'utf8'));
  assert.equal(evidence.status, 'failed'); assert.match(evidence.error, /ENOENT/);
  assert.ok(evidence.error.length <= 12000); assert.deepEqual(evidence.checks, []);
  assert.ok(evidence.completedAt); assert.equal(evidence.cleanupError, undefined);
  assert.ok(evidence.sourceFiles.some(file => file.path === 'src/map.js'));
  assert.ok(evidence.sourceFiles.some(file => file.path === 'tools/canvas-lifecycle-check/page.js'));
  assert.match(evidence.sourceSha256, /^[a-f0-9]{64}$/u);
});
