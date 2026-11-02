import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseReplayBookmark, exportReplayBookmark } from '../src/replay-bookmark.js';
import { simulateExperiment } from '../src/experiment.js';

test('documented tiny replay fixture is complete, canonical and hand-checkable', async () => {
  const bytes = await readFile(new URL('../docs/examples/tiny-replay.bookmark.json', import.meta.url), 'utf8');
  const bookmark = parseReplayBookmark(bytes);
  assert.equal(bytes, exportReplayBookmark(bookmark.experiment, bookmark.perspective) + '\n');
  assert.deepEqual(bookmark.perspective, { variantId: 'close-at-10', vehicleId: 'van-1', timeS: 15.5, view: 'split', zoom: 1.2 });
  const result = simulateExperiment(bookmark.experiment);
  assert.equal(result.baseline.vehicles[0].jobs[0].arrivalS, 20);
  assert.equal(result.variants.find(v => v.id === 'close-at-10').result.vehicles[0].jobs[0].arrivalS, 26);
});
