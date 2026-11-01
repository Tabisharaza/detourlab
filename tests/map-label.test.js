import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkMap } from '../src/map.js';
import { createCanvasEnvironment } from './helpers/canvas.js';

// Operation-level geometry checks, not native glyph rasterization or screenshot QA.
function label(point, id = 'van-1', width = 320, height = 240) {
  const env = createCanvasEnvironment({ width, height });
  const ctx = env.canvas.context;
  NetworkMap.prototype.drawVehicleLabel.call({ ctx, width, height }, point, id);
  return { ctx, box: ctx.operations.find(op => op.method === 'fillRect')?.args,
    text: ctx.operations.find(op => op.method === 'fillText')?.args };
}
function inside(result, width = 320, height = 240) {
  const [x, y, w, h] = result.box;
  assert.ok(x >= 4 && y >= 4);
  assert.ok(x + w <= width - 4 && y + h <= height - 4);
  assert.ok(result.text[1] >= x + 6 && result.text[1] + result.text[0].length * 5 <= x + w - 6);
}

test('selected label flips left at the right endpoint and stays right when space allows', () => {
  const right = label({ x: 300, y: 120 }), center = label({ x: 100, y: 120 });
  inside(right); inside(center);
  assert.ok(right.box[0] + right.box[2] < 300);
  assert.equal(center.box[0], 111);
  assert.equal(center.text[0], 'VAN-1');
});

test('label flips below top edge and clamps at all corners including offscreen zoom positions', () => {
  for (const x of [-100, 0, 320, 500]) for (const y of [-100, 0, 240, 500]) inside(label({ x, y }));
  assert.equal(label({ x: 100, y: 5 }).box[1], 16);
});

test('long ID label uses bounded ellipsis without mutating the original identifier', () => {
  const vehicle = Object.freeze({ id: 'vehicle-' + 'a'.repeat(200) });
  const result = label({ x: 300, y: 120 }, vehicle.id);
  inside(result);
  assert.ok(result.text[0].endsWith('…'));
  assert.ok(result.box[2] <= 160);
  assert.equal(vehicle.id, 'vehicle-' + 'a'.repeat(200));
});

test('narrow pane reduces label budget and Unicode truncation never splits surrogate pairs', () => {
  const result = label({ x: 70, y: 50 }, '🚚'.repeat(60), 80, 100);
  inside(result, 80, 100);
  assert.ok(result.text[0].endsWith('…'));
  assert.equal(result.text[0].isWellFormed(), true);
});

test('too-small hidden or collapsing canvases do not paint labels', () => {
  for (const [width, height] of [[0, 0], [1, 100], [320, 20]]) {
    const result = label({ x: 0, y: 0 }, 'van-1', width, height);
    assert.equal(result.box, undefined); assert.equal(result.text, undefined);
  }
});
