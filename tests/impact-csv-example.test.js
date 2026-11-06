import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
test('published tiny CSV is exact successful CLI output including CRLF bytes', () => {
  const run = spawnSync(process.execPath, ['scripts/explain-experiment.js', 'examples/minimal-experiment.json', '--variant', 'close-at-10', '--csv']);
  assert.equal(run.status, 0, run.stderr.toString());
  assert.deepEqual(run.stdout, readFileSync(new URL('../docs/examples/tiny-delivery-impact.csv', import.meta.url)));
});
