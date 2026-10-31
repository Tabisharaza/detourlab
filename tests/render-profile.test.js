import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PROFILE, summarizeSamples, assertParity, measureBatch, comparePixels } from '../tools/render-profile/measurement.js';
import { profileHandler, runProfile } from '../tools/render-profile/run.js';

const samples = (paints = 0) => Array.from({ length: PROFILE.batches }, (_, batch) => ({ batch, calls: PROFILE.callsPerBatch, paints, elapsedMs: batch + 1 }));
for (const mode of ['paused', 'playing']) for (const treatment of ['guarded', 'forced']) test(`profile validates ${mode}/${treatment} paint contract`, () => {
  const paints = mode === 'paused' && treatment === 'guarded' ? 0 : 60;
  const result = summarizeSamples(samples(paints), mode, treatment);
  assert.deepEqual(result, { batches: 6, calls: 360, paints: paints * 6, minBatchMs: 1, medianBatchMs: 3.5, maxBatchMs: 6, meanCallMs: 21 / 360 });
});
for (const field of ['batch', 'calls', 'paints', 'elapsedMs']) test(`profile rejects malformed ${field}`, () => {
  const values = field === 'elapsedMs' ? [-1, NaN, Infinity, '1', undefined] : [-1, NaN, Infinity, '0', undefined, 999];
  for (const value of values) { const rows = samples(); rows[0][field] = value; assert.throws(() => summarizeSamples(rows, 'paused', 'guarded')); }
});
test('incomplete, missing and unknown lanes cannot pass', () => {
  for (const rows of [null, {}, [], samples().slice(1), [...samples(), samples()[0]]]) assert.throws(() => summarizeSamples(rows, 'paused', 'guarded'));
  for (const lane of [['idle', 'guarded'], ['paused', 'historic']]) assert.throws(() => summarizeSamples(samples(), ...lane));
  const rows = samples(); rows[0] = null; assert.throws(() => summarizeSamples(rows, 'paused', 'guarded'));
});
test('zero time resolution is allowed but overflow is not', () => {
  assert.equal(summarizeSamples(samples().map(s => ({ ...s, elapsedMs: 0 })), 'paused', 'guarded').meanCallMs, 0);
  assert.throws(() => summarizeSamples(samples().map(s => ({ ...s, elapsedMs: Number.MAX_VALUE })), 'paused', 'guarded'));
});
test('parity requires nonempty exact pixels, hit points and geometry', () => {
  const good = { pixelsEqual: true, nonemptyPixels: true, hitPointsEqual: true, width: 1000, height: 700 };
  assertParity(good);
  for (const key of Object.keys(good)) for (const value of [false, undefined, 'true', 0]) assert.throws(() => assertParity({ ...good, [key]: value }));
  assert.throws(() => assertParity(null));
});
function response() { return { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } }; }
test('dedicated profile route is exact, does not expose tools or accept mutations', () => {
  const seen = [], handler = profileHandler(req => seen.push(req.url));
  for (const url of ['/tools/render-profile/run.js', '/render-profile.html?x=1', '/other']) handler({ url, method: 'GET' }, response());
  assert.equal(seen.length, 3);
  for (const method of ['GET', 'HEAD', 'POST']) {
    const res = response(); handler({ url: '/render-profile.html', method }, res);
    assert.equal(res.status, method === 'POST' ? 405 : 200);
    if (method === 'GET') { assert.match(res.body, /isolated render profile/); assert.match(res.headers['Content-Security-Policy'], /connect-src 'none'/); }
    else assert.equal(res.body, undefined);
  }
});
test('existing output is never overwritten or treated as a successful profile', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'detourlab-profile-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(runProfile({ executable: '/not-used', output: dir }), /EEXIST/);
  await assert.rejects(readFile(path.join(dir, 'evidence.json')), /ENOENT/);
});
test('invalid output parent fails before any browser or server is started', async t => {
  // This test deliberately does not launch a browser or bind a server: an output
  // child beneath a missing parent must fail before resources are allocated.
  const dir = await mkdtemp(path.join(tmpdir(), 'detourlab-profile-parent-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(runProfile({ executable: '/not-used', output: path.join(dir, 'missing', 'output') }), /ENOENT/);
});
for (const mode of ['paused', 'playing']) for (const treatment of ['guarded', 'forced']) test(`browser batch resets/warmups and samples ${mode}/${treatment}`, t => {
  const previous = globalThis.window; t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  const state = { time: -99 }, rendered = []; let last, dirty = true;
  const map = { invalidateFrame() { dirty = true; }, render() { const paint = dirty || state.time !== last; last = state.time; dirty = false; rendered.push({ time: state.time, paint }); return paint; } };
  globalThis.window = { __profile: { settings: PROFILE, maps: { [treatment]: { map, state } } } };
  const sample = measureBatch(mode, treatment, 3);
  assert.equal(sample.batch, 3); assert.equal(sample.calls, 60);
  assert.equal(sample.paints, mode === 'paused' && treatment === 'guarded' ? 0 : 60);
  assert.equal(rendered.length, 12 + 1 + 60); assert.equal(rendered[12].time, 360);
  assert.equal(rendered.at(-1).time, mode === 'playing' ? 420 : 360);
  assert.ok(Number.isFinite(sample.elapsedMs) && sample.elapsedMs >= 0);
});
test('pixel comparator detects mismatches, empty buffers and different hit points', t => {
  const previous = globalThis.window; t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  const a = new Uint8Array([1, 2, 3, 255]), b = new Uint8Array(a);
  const lane = data => ({ map: { ctx: { getImageData() { return { data }; } }, vehiclePoints: [{ id: 'van', x: 1, y: 2 }] } });
  globalThis.window = { __profile: { settings: PROFILE, maps: { guarded: lane(a), forced: lane(b) } } };
  assertParity(comparePixels()); b[0] = 9; assert.equal(comparePixels().pixelsEqual, false); b[0] = 1;
  globalThis.window.__profile.maps.forced.map.vehiclePoints[0].x = 99; assert.equal(comparePixels().hitPointsEqual, false);
  a.fill(0); b.fill(0); assert.equal(comparePixels().nonemptyPixels, false);
});
