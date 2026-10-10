import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const script = new URL('../scripts/measure-render-counts.js', import.meta.url);
test('render count diagnostic reports zero paused paints and retains active-frame work on both fixtures', () => {
  const result = spawnSync(process.execPath, [script.pathname], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.samples, 120); assert.equal(report.warmupCalls, 1);
  assert.equal(report.results.length, 4); assert.match(report.method, /no pixel rasterization or elapsed-time measurement/);
  for (const fixture of ['meridian-seed-42', 'render-grid-40x40']) {
    const rows = report.results.filter(row => row.fixture === fixture);
    assert.equal(rows.length, 2);
    const paused = rows.find(row => row.mode === 'paused'), playing = rows.find(row => row.mode === 'playing');
    assert.equal(paused.visibleClears, 0); assert.equal(paused.backgroundCopies, 0); assert.equal(paused.visibleOperations, 0);
    assert.equal(playing.visibleClears, 120); assert.equal(playing.backgroundCopies, 120); assert.ok(playing.visibleOperations > 0);
    assert.equal(paused.sourceSha256, playing.sourceSha256); assert.match(paused.sourceSha256, /^[a-f0-9]{64}$/);
  }
  const larger = report.results.find(row => row.fixture === 'render-grid-40x40');
  assert.deepEqual([larger.nodes, larger.directedEdges, larger.vehicles, larger.jobs], [1600, 6240, 48, 384]);
});

test('render count diagnostic rejects unknown or incomplete arguments', () => {
  for (const args of [['--unknown'], ['--reference-map']]) {
    const result = spawnSync(process.execPath, [script.pathname, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2); assert.match(result.stderr, /Usage:/); assert.equal(result.stdout, '');
  }
});
