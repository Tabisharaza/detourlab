import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { browserFixtures, invalidBrowserFiles } from '../tools/browser-check/fixtures.js';
import { canonicalExperiment, exportExperiment, simulateExperiment, parseExperiment } from '../src/experiment.js';
import { decodeFileInput, FILE_INPUT_MAX_BYTES } from '../src/file-input.js';
const tiny = JSON.parse(await readFile(new URL('../examples/minimal-experiment.json', import.meta.url), 'utf8'));

test('browser fixture authoring is deterministic, original and leaves its input untouched', () => {
  const before = structuredClone(tiny);
  const fixtures = browserFixtures(tiny);
  assert.deepEqual(browserFixtures(tiny), fixtures);
  assert.deepEqual(tiny, before);
  assert.deepEqual(fixtures.map(f => f.variants.length), [2, 6, 2]);
  for (const fixture of fixtures) assert.equal(canonicalExperiment(parseExperiment(exportExperiment(fixture))), canonicalExperiment(fixture));
});

test('six-plan browser fixture exercises cutoff boundaries and unreachable continuation', () => {
  const result = simulateExperiment(browserFixtures(tiny)[1]);
  const metrics = Object.fromEntries(result.variants.map(v => [v.id, [v.result.metrics.distanceM, v.result.metrics.lateJobs, v.result.metrics.unreachableJobs]]));
  assert.deepEqual(metrics.clear, [200, 0, 1]);
  assert.deepEqual(metrics['close-at-10'], [260, 1, 1]);
  assert.deepEqual(metrics['close-at-11'], [200, 0, 1]);
  assert.deepEqual(metrics.fractional, [200, 0, 1]);
  assert.deepEqual(metrics.disconnect, [0, 0, 2]);
  assert.deepEqual(metrics['equal-time'], [100, 0, 1]);
});

test('browser invalid bytes exercise actual decoding and size failures', () => {
  const files = invalidBrowserFiles(exportExperiment(browserFixtures(tiny)[0]));
  assert.equal(files[2].bytes.length, FILE_INPUT_MAX_BYTES + 1);
  assert.equal(files[3].bytes.length, FILE_INPUT_MAX_BYTES + 1);
  for (const file of files) assert.throws(() => parseExperiment(decodeFileInput(file.bytes)));
  const hostile = browserFixtures(tiny)[2];
  assert.equal(parseExperiment(decodeFileInput(Buffer.from(exportExperiment(hostile)))).name, hostile.name);
});
