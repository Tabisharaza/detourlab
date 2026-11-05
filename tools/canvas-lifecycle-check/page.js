// Serialized into the local profile document. Native Canvas/ResizeObserver are
// never replaced. resize() is wrapped only to count calls to the real method.
export async function prepareLifecycle(state) {
  const { NetworkMap } = await import('/src/map.js');
  const host = document.createElement('div');
  host.style.cssText = 'display:grid;grid-template-columns:1fr;width:960px;gap:16px';
  document.body.append(host);
  const events = { onHover() {}, onRoad() {}, onVehicle() {} };
  const maps = [];
  for (const view of ['compare', 'baseline']) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:420px;min-width:0';
    host.append(canvas);
    const map = new NetworkMap(canvas, { ...structuredClone(state), view }, events);
    const lane = { map, canvas, resizeCalls: 0, builds: 0 };
    const resize = map.resize, build = map.buildScene;
    map.resize = function(...args) { lane.resizeCalls++; return resize.apply(this, args); };
    map.buildScene = function(...args) { lane.builds++; return build.apply(this, args); };
    map.render();
    lane.initial = map.ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    maps.push(lane);
  }
  window.__lifecycle = { NetworkMap, host, maps, events };
}

export function lifecycleSnapshot() {
  return window.__lifecycle.maps.map(({ map, canvas, resizeCalls, builds }) => ({
    width: map.width, height: map.height, dpr: map.dpr,
    pixelWidth: canvas.width, pixelHeight: canvas.height, resizeCalls, builds,
    vehicles: map.vehiclePoints.length, roads: map.edgePoints?.length ?? 0,
  }));
}

export function initialDelivery() {
  return window.__lifecycle.maps.map(({ map, canvas, initial, resizeCalls, builds }) => {
    const actual = map.ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return { resizeCalls, builds, pixelsPreserved: actual.length === initial.length && actual.every((v, i) => v === initial[i]), repaint: map.render() };
  });
}

export function compareFresh() {
  const { maps, NetworkMap, events } = window.__lifecycle;
  return maps.map(({ map, canvas }) => {
    const paint = map.render();
    const freshCanvas = document.createElement('canvas');
    freshCanvas.style.cssText = `position:absolute;left:-20000px;top:0;display:block;width:${map.width}px;height:${map.height}px`;
    document.body.append(freshCanvas);
    const fresh = new NetworkMap(freshCanvas, structuredClone(map.state), events);
    try {
      fresh.render();
      const bytes = map.width && map.height ? map.ctx.getImageData(0, 0, canvas.width, canvas.height).data : new Uint8Array();
      const reference = map.width && map.height ? fresh.ctx.getImageData(0, 0, freshCanvas.width, freshCanvas.height).data : new Uint8Array();
      let differences = Math.abs(bytes.length - reference.length), nonempty = false;
      for (let i = 0; i < Math.min(bytes.length, reference.length); i++) {
        if (bytes[i] !== reference[i]) differences++;
        if (i % 4 === 3 && bytes[i]) nonempty = true;
      }
      const roadHits = candidate => (candidate.edgePoints || []).map(({ a, b }) => {
        const hit = candidate.nearestRoad({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        return { id: hit?.edge.id, distance: hit?.distance };
      });
      return { paint, width: map.width, height: map.height, dpr: map.dpr, pixelWidth: canvas.width, pixelHeight: canvas.height,
        differences, nonempty, comparedBytes: bytes.length,
        vehiclePointsEqual: JSON.stringify(map.vehiclePoints) === JSON.stringify(fresh.vehiclePoints),
        roadPointsEqual: JSON.stringify(map.edgePoints || []) === JSON.stringify(fresh.edgePoints || []),
        roadHitsEqual: JSON.stringify(roadHits(map)) === JSON.stringify(roadHits(fresh)),
        vehicles: map.vehiclePoints.length, roads: map.edgePoints?.length ?? 0 };
    } finally { freshCanvas.remove(); }
  });
}

export function repeatUnchanged() {
  return window.__lifecycle.maps.map(lane => {
    const { map, canvas, builds } = lane;
    const before = map.ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let paints = 0;
    for (let i = 0; i < 20; i++) { map.resize(); if (map.render()) paints++; }
    const after = map.ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return { paints, buildDelta: lane.builds - builds, pixelsPreserved: before.length === after.length && before.every((v, i) => v === after[i]) };
  });
}
