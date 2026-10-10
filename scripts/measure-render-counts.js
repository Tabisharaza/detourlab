#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { NetworkMap } from '../src/map.js';
import { createCanvasEnvironment } from '../tests/helpers/canvas.js';
import { renderFixtures, renderState } from '../tests/helpers/render-fixtures.js';

// Canvas stand-in: counts JS drawing operations; no rasterization or timing.
// A reference executes local JavaScript. Use only a reviewed renderer revision.
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--reference-map')) {
  console.error('Usage: node scripts/measure-render-counts.js [--reference-map trusted-local-map.mjs]');
  process.exitCode = 2;
} else {
  const currentPath = fileURLToPath(new URL('../src/map.js', import.meta.url));
  const implementations = [{ label: 'current', path: currentPath, MapClass: NetworkMap }];
  if (args.length) {
    const path = resolve(args[1]);
    implementations.unshift({ label: 'reference', path, MapClass: (await import(pathToFileURL(path).href)).NetworkMap });
  }
  const samples = 120, warmupCalls = 1;
  const results = [];
  for (const scenario of renderFixtures()) {
    const original = renderState(scenario);
    for (const implementation of implementations) {
      for (const mode of ['paused', 'playing']) {
        const env = createCanvasEnvironment({ width: 1000, height: 700, dpr: 1, recordOperations: false }), restore = env.install();
        try {
          const state = { ...original }, map = new implementation.MapClass(env.canvas, state, { onHover() {}, onRoad() {}, onVehicle() {} });
          map.render(); env.reset();
          for (let i = 0; i < samples; i += 1) {
            if (mode === 'playing') state.time += 1;
            map.render();
          }
          results.push({ fixture: scenario.id, nodes: scenario.nodes.length, directedEdges: scenario.edges.length, vehicles: scenario.vehicles.length, jobs: scenario.jobs.length, implementation: implementation.label, sourceSha256: createHash('sha256').update(await readFile(implementation.path)).digest('hex'), mode, renderCalls: samples, visibleClears: env.canvas.context.count('clearRect'), backgroundCopies: env.canvas.context.count('drawImage'), visibleOperations: env.canvas.context.operationCount });
        } finally { restore(); }
      }
    }
  }
  console.log(JSON.stringify({ method: 'Node canvas-operation stand-in, no pixel rasterization or elapsed-time measurement', node: process.version, platform: `${process.platform} ${process.arch}`, viewportCssPixels: [1000, 700], devicePixelRatio: 1, warmupCalls, samples, playingTimeStepS: 1, note: 'Counts per 120 deterministic render calls, not frames per second or measured browser CPU. The requestAnimationFrame scheduler remains active while paused.', results }, null, 2));
}
