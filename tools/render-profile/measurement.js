// Original bounded native-Canvas profiling protocol. No timing acceptance gate.
export const PROFILE = Object.freeze({ batches: 6, callsPerBatch: 60, warmupCalls: 12, startTimeS: 360, stepS: 1, width: 1000, height: 700 });

export function summarizeSamples(samples, mode, treatment) {
  if (!['paused', 'playing'].includes(mode) || !['guarded', 'forced'].includes(treatment)) throw new Error('Unknown profile lane.');
  if (!Array.isArray(samples) || samples.length !== PROFILE.batches) throw new Error('Incomplete profile samples.');
  const expectedPaints = mode === 'paused' && treatment === 'guarded' ? 0 : PROFILE.callsPerBatch;
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    if (!sample || sample.batch !== index || sample.calls !== PROFILE.callsPerBatch || sample.paints !== expectedPaints || !Number.isFinite(sample.elapsedMs) || sample.elapsedMs < 0) throw new Error('Invalid profile sample or unexpected repaint count.');
  }
  const durations = samples.map(s => s.elapsedMs).sort((a, b) => a - b);
  const sum = durations.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sum)) throw new Error('Invalid profile duration total.');
  return { batches: samples.length, calls: samples.length * PROFILE.callsPerBatch, paints: samples.length * expectedPaints, minBatchMs: durations[0], medianBatchMs: (durations[2] + durations[3]) / 2, maxBatchMs: durations.at(-1), meanCallMs: sum / (samples.length * PROFILE.callsPerBatch) };
}

export function assertParity(result) {
  if (!result || result.pixelsEqual !== true || result.hitPointsEqual !== true || result.nonemptyPixels !== true || result.width !== PROFILE.width || result.height !== PROFILE.height) throw new Error('Native Canvas pixel/hit-point parity failed.');
}

// These functions are serialized into the dedicated local browser page. The
// application, its RAF scheduler and native Canvas methods are never replaced.
export async function preparePage(state, settings) {
  const { NetworkMap } = await import('/src/map.js');
  const maps = {};
  for (const treatment of ['guarded', 'forced']) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = `width:${settings.width}px;height:${settings.height}px;display:block`;
    document.body.append(canvas);
    const copy = structuredClone(state);
    const map = new NetworkMap(canvas, copy, { onHover() {}, onRoad() {}, onVehicle() {} });
    maps[treatment] = { canvas, state: copy, map };
  }
  window.__profile = { maps, settings };
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  for (const { map, canvas } of Object.values(maps)) {
    if (canvas.width !== settings.width || canvas.height !== settings.height || map.dpr !== 1) throw new Error('Unexpected Canvas geometry.');
    map.render();
  }
}

export function measureBatch(mode, treatment, batch) {
  const { maps, settings } = window.__profile;
  const { map, state } = maps[treatment];
  for (let i = 0; i < settings.warmupCalls; i++) {
    state.time = settings.startTimeS + (mode === 'playing' ? i : 0);
    if (treatment === 'forced') map.invalidateFrame();
    map.render();
  }
  state.time = settings.startTimeS;
  map.invalidateFrame(); map.render(); // same excluded starting paint in both lanes
  let paints = 0;
  const start = performance.now();
  for (let i = 0; i < settings.callsPerBatch; i++) {
    if (mode === 'playing') state.time = settings.startTimeS + (i + 1) * settings.stepS;
    if (treatment === 'forced') map.invalidateFrame();
    if (map.render()) paints++;
  }
  return { batch, calls: settings.callsPerBatch, paints, elapsedMs: performance.now() - start };
}

export function comparePixels() {
  const { maps, settings } = window.__profile;
  // Readbacks happen after ALL timed batches to avoid influencing later timings.
  const a = maps.guarded.map.ctx.getImageData(0, 0, settings.width, settings.height).data;
  const b = maps.forced.map.ctx.getImageData(0, 0, settings.width, settings.height).data;
  let pixelsEqual = a.length === b.length, nonemptyPixels = false;
  for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) pixelsEqual = false; if (i % 4 === 3 && a[i]) nonemptyPixels = true; }
  return { pixelsEqual, nonemptyPixels, hitPointsEqual: JSON.stringify(maps.guarded.map.vehiclePoints) === JSON.stringify(maps.forced.map.vehiclePoints), width: settings.width, height: settings.height };
}
