import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NetworkMap } from '../src/map.js';
import { simulate } from '../src/engine.js';
import { createCanvasEnvironment } from './helpers/canvas.js';

// Real renderer and simulation ledgers, with a recording canvas. These assert
// redraw decisions and draw/hit-test coordinates, not raster output or FPS.
function fixture(t, options = {}) {
  const env = createCanvasEnvironment(options);
  t.after(env.install());
  const scenario = JSON.parse(readFileSync(new URL('../examples/minimal-directed.json', import.meta.url), 'utf8'));
  const state = {
    scenario, baseline: simulate(scenario, { closures: [] }), disrupted: simulate(scenario),
    selectedVehicle: 'van-1', view: 'disruption', time: 5, zoom: 1,
    editing: false, playing: false, pending: false, speed: 60,
  };
  const events = { roads: [], vehicles: [], hovers: [] };
  const map = new NetworkMap(env.canvas, state, {
    onRoad: id => events.roads.push(id), onVehicle: id => events.vehicles.push(id),
    onHover: (...args) => events.hovers.push(args),
  });
  return { env, canvas: env.canvas, ctx: env.canvas.context, background: map.background.context, map, state, events };
}

function assertPoint(actual, expected) {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9, `x: ${actual.x} != ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9, `y: ${actual.y} != ${expected.y}`);
}

function assertOneOverlayPaint(f) {
  assert.equal(f.map.render(), true);
  assert.equal(f.ctx.count('clearRect'), 1);
  assert.equal(f.ctx.count('drawImage'), 1);
  assert.equal(f.background.operationCount, 0, 'overlay changes preserve scene geometry');
  f.env.reset();
  assert.equal(f.map.render(), false);
  assert.equal(f.ctx.operationCount, 0);
}

test('unchanged frames skip every canvas operation despite new animation timestamps', t => {
  const f = fixture(t);
  assert.equal(f.map.render(0), true);
  assert.equal(f.ctx.count('clearRect'), 1);
  assert.ok(f.background.operationCount > 0);
  const points = f.map.vehiclePoints, roads = f.map.edgePoints;
  f.env.reset();
  // Throwing traversals prove the unchanged-frame guard runs before ledger work.
  f.map.position = () => { throw new Error('Unchanged frame traversed the ledger'); };
  f.map.drawRoute = () => { throw new Error('Unchanged frame rebuilt a route'); };
  for (let timestamp = 1; timestamp <= 120; timestamp += 1) assert.equal(f.map.render(timestamp * 16.7), false);
  assert.equal(f.ctx.operationCount, 0);
  assert.equal(f.background.operationCount, 0);
  assert.strictEqual(f.map.vehiclePoints, points);
  assert.strictEqual(f.map.edgePoints, roads);
});

test('nonvisual controls do not paint and explicit frame/full invalidation stay distinct', t => {
  const f = fixture(t); f.map.render(); f.env.reset();
  Object.assign(f.state, { editing: true, playing: true, pending: true, speed: 120 });
  assert.equal(f.map.render(), false);
  assert.equal(f.ctx.operationCount, 0);
  f.map.invalidateFrame(); f.map.invalidateFrame();
  assertOneOverlayPaint(f);
  f.map.invalidate(); f.map.invalidate();
  assert.equal(f.map.render(), true);
  assert.equal(f.ctx.count('clearRect'), 1);
  assert.equal(f.background.count('setTransform'), 1);
  f.env.reset(); assert.equal(f.map.render(), false);
  assert.equal(f.ctx.operationCount + f.background.operationCount, 0);
});

test('selection, view and either result identity repaint without rebuilding the scene', t => {
  const f = fixture(t); f.map.render(); f.env.reset();
  for (const [key, value] of [
    ['selectedVehicle', null], ['selectedVehicle', 'van-1'],
    ['view', 'baseline'], ['view', 'compare'], ['view', 'disruption'],
    ['baseline', structuredClone(f.state.baseline)],
    ['disrupted', structuredClone(f.state.disrupted)],
  ]) {
    f.state[key] = value;
    assertOneOverlayPaint(f);
  }
});

test('clearing and receiving worker results replaces stale hit points while paused', t => {
  const f = fixture(t); f.map.render();
  const before = { ...f.map.vehiclePoints[0] }, baseline = f.state.baseline, disrupted = f.state.disrupted;
  f.state.baseline = null; f.state.disrupted = null; f.env.reset();
  assertOneOverlayPaint(f);
  assert.deepEqual(f.map.vehiclePoints, []);
  f.canvas.emit('click', { clientX: before.x, clientY: before.y });
  assert.deepEqual(f.events.vehicles, []);
  f.state.baseline = baseline; f.state.disrupted = disrupted;
  assertOneOverlayPaint(f);
  assertPoint(f.map.vehiclePoints[0], before);
  f.canvas.emit('click', { clientX: before.x, clientY: before.y });
  assert.deepEqual(f.events.vehicles, ['van-1']);
});

test('exact playback time drives ledger interpolation and preserves endpoint/service waits', t => {
  const f = fixture(t); f.map.render(); f.env.reset();
  for (const [time, x, y] of [[0, 0, 0], [5, .5, 0], [9.99, .999, 0], [10, 1, 0], [14, 1, .5], [18, 1, 1], [22, 1.5, .5], [26, 2, 0], [27, 2, 0], [29, 2, 0], [60, 2, 0]]) {
    f.state.time = time;
    assertOneOverlayPaint(f);
    assertPoint(f.map.vehiclePoints[0], f.map.project(x, y));
  }
  // Both values display the same whole second in the UI but have different pixels.
  f.state.time = 5.1; assertOneOverlayPaint(f);
  assertPoint(f.map.vehiclePoints[0], f.map.project(.51, 0));
  f.state.time = 5.2; assertOneOverlayPaint(f);
  assertPoint(f.map.vehiclePoints[0], f.map.project(.52, 0));
});

test('baseline and comparison views keep the visible foreground vehicle as the hit target', t => {
  const f = fixture(t); f.state.time = 14; f.state.view = 'baseline';
  f.map.render(); assert.equal(f.map.vehiclePoints.length, 1);
  assertPoint(f.map.vehiclePoints[0], f.map.project(1.4, 0));
  f.state.view = 'compare'; f.env.reset(); assertOneOverlayPaint(f);
  assert.equal(f.map.vehiclePoints.length, 1, 'ghost vehicles are not extra click targets');
  assertPoint(f.map.vehiclePoints[0], f.map.project(1, .5));
  f.state.view = 'disruption'; assertOneOverlayPaint(f);
  assertPoint(f.map.vehiclePoints[0], f.map.project(1, .5));
});

test('closure cutoff and selected-stop arrival repaint at their exact boundaries', t => {
  const f = fixture(t);
  const hasStroke = (color, width) => f.ctx.operations.some(op => op.method === 'stroke' && op.styles.strokeStyle === color && op.styles.lineWidth === width);
  const selectedStopFill = () => {
    const index = f.ctx.operations.findIndex(op => op.method === 'arc' && op.args[2] === 4);
    return f.ctx.operations.slice(index + 1).find(op => op.method === 'fill')?.styles.fillStyle;
  };
  f.state.time = 9.99; f.map.render();
  assert.ok(hasStroke('#d4a26b', 3)); assert.equal(selectedStopFill(), '#10222d');
  f.env.reset(); f.state.time = 10; assert.equal(f.map.render(), true);
  assert.ok(hasStroke('#f68170', 5)); assert.equal(f.background.operationCount, 0);
  f.env.reset(); f.state.time = 25.99; f.map.render(); assert.equal(selectedStopFill(), '#10222d');
  f.env.reset(); f.state.time = 26; f.map.render(); assert.equal(selectedStopFill(), '#f68170');
});

test('full invalidation rebuilds closure records after in-place closure changes', t => {
  const f = fixture(t); f.map.render(); f.env.reset();
  f.state.scenario.closures[0].atS = 0;
  f.map.invalidate();
  assert.equal(f.map.render(), true);
  assert.equal(f.map.closureGeometries.get('B|C')[0].atS, 0);
  assert.ok(f.ctx.operations.some(op => op.method === 'stroke' && op.styles.strokeStyle === '#f68170' && op.styles.lineWidth === 5));
  f.env.reset(); f.state.scenario.closures.length = 0; f.map.invalidate(); f.map.render();
  assert.equal(f.map.closureGeometries.size, 0);
  assert.ok(!f.ctx.operations.some(op => op.method === 'stroke' && op.styles.lineWidth === 5));
  f.env.reset(); assert.equal(f.map.render(), false);
});

test('state swaps, same-ID scenario replacements and direct zoom changes redraw correctly', t => {
  const f = fixture(t); f.map.render(); f.env.reset();
  f.map.state = { ...f.state }; assertOneOverlayPaint(f);
  const previousEdges = f.map.edgePoints;
  const scenario = structuredClone(f.state.scenario); scenario.nodes.find(node => node.id === 'D').y = 2;
  f.map.state.scenario = scenario;
  assert.equal(f.map.render(), true);
  assert.notStrictEqual(f.map.edgePoints, previousEdges);
  assert.strictEqual(f.map.nodeMap.get('D'), scenario.nodes.find(node => node.id === 'D'));
  assert.equal(f.background.count('setTransform'), 1);
  f.env.reset(); const scale = f.map.scale; f.map.state.zoom = 1.2;
  assert.equal(f.map.render(), true); assert.equal(f.map.scale, scale * 1.2);
  assert.equal(f.background.count('setTransform'), 1);
  f.env.reset(); assert.equal(f.map.render(), false);
});

test('resize rebuilds projection/backing canvas, but identical notifications preserve the frame', t => {
  const f = fixture(t, { width: 800.2, height: 600.2, dpr: 1.5 }); f.map.render(); f.env.reset();
  assert.equal(f.canvas.width, 1200); assert.equal(f.canvas.height, 900);
  f.env.resize(f.canvas, 800.2, 600.2);
  assert.equal(f.map.render(), false); assert.equal(f.ctx.operationCount, 0);
  const oldScale = f.map.scale;
  // CSS geometry changes matter even when rounded backing dimensions do not.
  f.env.resize(f.canvas, 800.25, 600.25);
  assert.equal(f.canvas.width, 1200); assert.equal(f.canvas.height, 900);
  assert.equal(f.map.render(), true); assert.notEqual(f.map.scale, oldScale);
  f.env.reset(); f.env.resize(f.canvas, 960, 480);
  assert.equal(f.map.render(), true);
  assert.equal(f.canvas.width, 1440); assert.equal(f.canvas.height, 720);
  assert.equal(f.map.background.width, 1440); assert.equal(f.map.background.height, 720);
  assertPoint(f.map.vehiclePoints[0], f.map.project(.5, 0));
  assert.equal(f.background.count('setTransform'), 1);
});

test('DPR-only changes redraw without a resize notification and retain the existing cap', t => {
  const f = fixture(t); f.map.render(); f.env.reset();
  f.env.setDpr(1.5);
  assert.equal(f.map.render(), true); assert.equal(f.map.dpr, 1.5);
  assert.equal(f.canvas.width, 1200); assert.equal(f.canvas.height, 900);
  assert.deepEqual(f.ctx.operations.filter(op => op.method === 'setTransform').at(-1).args, [1.5, 0, 0, 1.5, 0, 0]);
  f.env.reset(); f.env.setDpr(3);
  assert.equal(f.map.render(), true); assert.equal(f.map.dpr, 2);
  assert.equal(f.canvas.width, 1600); assert.equal(f.canvas.height, 1200);
  f.env.reset(); f.env.setDpr(4);
  assert.equal(f.map.render(), false); assert.equal(f.ctx.operationCount, 0);
  f.env.setDpr(1); assert.equal(f.map.render(), true); assert.equal(f.canvas.width, 800);
});

test('zero-sized canvases defer painting and repaint when shown again', t => {
  const f = fixture(t); f.map.render(); f.env.reset();
  f.env.resize(f.canvas, 0, 0);
  assert.equal(f.map.render(), false); assert.equal(f.ctx.operationCount, 0);
  f.state.time = 14;
  f.env.resize(f.canvas, 800, 600);
  assert.equal(f.map.render(), true); assertPoint(f.map.vehiclePoints[0], f.map.project(1, .5));
  f.env.reset(); assert.equal(f.map.render(), false);
  f.env.resize(f.canvas, 800, 0);
  assert.equal(f.map.render(), false);
  f.env.resize(f.canvas, 800, 600); assert.equal(f.map.render(), true);
});

test('skipped frames retain correct vehicle/road hit tests and pointer offsets', t => {
  const f = fixture(t); f.canvas.setRect({ left: 40, top: 25 }); f.map.render();
  const vehicle = f.map.vehiclePoints[0]; f.env.reset(); assert.equal(f.map.render(), false);
  f.canvas.emit('click', { clientX: vehicle.x + 40, clientY: vehicle.y + 25 });
  assert.deepEqual(f.events.vehicles, ['van-1']);
  f.state.editing = true; assert.equal(f.map.render(), false);
  const road = f.map.edgePoints.find(item => item.edge.id === 'bc');
  const point = { x: (road.a.x + road.b.x) / 2, y: (road.a.y + road.b.y) / 2 };
  f.canvas.emit('pointermove', { clientX: point.x + 40, clientY: point.y + 25 });
  f.canvas.emit('click', { clientX: point.x + 40, clientY: point.y + 25 });
  assert.deepEqual(f.events.roads, ['bc']);
  assert.match(f.events.hovers.at(-1)[0], /Second Street/);
  f.canvas.emit('pointerleave'); assert.deepEqual(f.events.hovers.at(-1), ['', 0, 0]);
  assert.equal(f.ctx.operationCount, 0);
});

test('an interrupted paint is retried instead of caching an incomplete frame', t => {
  const f = fixture(t); f.map.render(); f.env.reset();
  f.state.time = 14;
  const drawRoute = f.map.drawRoute;
  f.map.drawRoute = () => { throw new Error('Synthetic interrupted paint'); };
  assert.throws(() => f.map.render(), /Synthetic interrupted paint/);
  f.map.drawRoute = drawRoute; f.env.reset();
  assertOneOverlayPaint(f);
  assertPoint(f.map.vehiclePoints[0], f.map.project(1, .5));
  f.state.time = 18;
  f.map.drawRoute = () => { throw new Error('Synthetic interrupted paint'); };
  assert.throws(() => f.map.render(), /Synthetic interrupted paint/);
  // Returning to the last successful timestamp must not retain a partial paint.
  f.state.time = 14; f.map.drawRoute = drawRoute; f.env.reset();
  assertOneOverlayPaint(f);
});

test('restored visible and background canvas contexts repaint the appropriate layers', t => {
  const f = fixture(t); f.map.render(); f.env.reset();
  f.canvas.emit('contextrestored');
  assertOneOverlayPaint(f);
  f.map.background.emit('contextrestored');
  assert.equal(f.map.render(), true);
  assert.equal(f.background.count('setTransform'), 1);
  assert.equal(f.ctx.count('clearRect'), 1);
  f.env.reset(); assert.equal(f.map.render(), false);
  assert.equal(f.ctx.operationCount + f.background.operationCount, 0);
});
