#!/usr/bin/env node
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir, platform, release, arch } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequestHandler } from '../../scripts/serve.js';
import { createDemoScenario } from '../../src/scenario.js';
import { renderState } from '../../tests/helpers/render-fixtures.js';
import { launchChromium } from '../browser-check/chromium.js';
import { parseBrowserCheckArguments, finishBrowserEvidence, removeOwnedBrowserDirectory } from '../browser-check/run.js';
import { profileHandler } from '../render-profile/run.js';
import { prepareLifecycle, lifecycleSnapshot, initialDelivery, compareFresh, repeatUnchanged } from './page.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
export const usage = `Optional native Chromium Canvas lifecycle checks
Usage: node tools/canvas-lifecycle-check/run.js --browser /absolute/path/to/chromium --out NEW_DIRECTORY
Fresh local profile; synthetic scenes; native ResizeObserver and Canvas.
CSS resize, hide/show, DPR-only and isolated two-pane layout transitions.
Exact pixels and road/vehicle hit points compared with fresh independent maps.
Not native GPU context-loss, full-app split-view, cross-browser or performance certification.
Output must not exist; failures retain bounded evidence and clean owned resources.`;

export function assertFreshParity(rows, hidden = false) {
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.differences, 0, 'fresh Canvas pixels');
    assert.equal(row.vehiclePointsEqual, true, 'fresh vehicle points');
    assert.equal(row.roadPointsEqual, true, 'fresh road points');
    assert.equal(row.roadHitsEqual, true, 'fresh nearest-road hits');
    if (hidden) {
      assert.equal(row.width, 0); assert.equal(row.height, 0);
      assert.equal(row.pixelWidth, 0); assert.equal(row.pixelHeight, 0);
      assert.equal(row.vehicles, 0); assert.equal(row.roads, 0); assert.equal(row.paint, false);
    } else {
      assert.equal(row.nonempty, true); assert.ok(row.comparedBytes > 0);
      assert.ok(row.vehicles > 0); assert.ok(row.roads > 0);
      assert.equal(row.pixelWidth, Math.round(row.width * row.dpr));
      assert.equal(row.pixelHeight, Math.round(row.height * row.dpr));
    }
  }
}

export async function runLifecycleCheck({ executable, output }) {
  await mkdir(output);
  const evidence = { format: 'detourlab-canvas-lifecycle-check', version: 1, status: 'running', startedAt: new Date().toISOString(), runtime: { node: process.version, os: platform(), release: release(), arch: arch() }, checks: [],
    limitations: ['Local headless Chromium with fixed synthetic state, not full-app RAF, cross-browser, performance or deployed-site certification.',
      'DPR is changed through native Chromium device emulation, not physical monitor movement.',
      'Two-pane layout uses isolated real canvases, not application split-view controls.',
      'No native GPU context loss is induced or claimed. Fresh reference maps use the same current renderer, not an independent rendering implementation.',
      'Native ResizeObserver and Canvas are not replaced; instance resize/build wrappers only count calls. Explicit unchanged resize calls are separately labeled.'] };
  let browser, server, temporary;
  try {
    const sources = ['src/map.js', 'src/scenario.js', 'src/engine.js', 'tests/helpers/render-fixtures.js', 'tools/canvas-lifecycle-check/run.js', 'tools/canvas-lifecycle-check/page.js', 'tools/render-profile/run.js', 'tools/browser-check/chromium.js', 'tools/browser-check/run.js', 'scripts/serve.js'];
    evidence.sourceFiles = await Promise.all(sources.map(async file => ({ path: file, sha256: hash(await readFile(path.join(root, file))) })));
    evidence.sourceSha256 = hash(JSON.stringify(evidence.sourceFiles));
    temporary = await mkdtemp(path.join(tmpdir(), 'detourlab-lifecycle-'));
    const profile = path.join(temporary, 'profile'); await mkdir(profile);
    server = http.createServer(profileHandler(createRequestHandler(root))); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    browser = await launchChromium(executable, profile); evidence.browser = browser.version;
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params = {}) => browser.send(method, params, sessionId);
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const call = fn => evaluate(`(${fn.toString()})()`);
    const until = async (expression, label) => {
      const deadline = Date.now() + 10000;
      do { if (await evaluate(expression)) return; await delay(25); } while (Date.now() < deadline);
      throw new Error(`Timed out waiting for ${label}`);
    };
    const checkpoint = async (name, hidden = false) => {
      const parity = await call(compareFresh); assertFreshParity(parity, hidden);
      evidence.checks.push({ name, status: 'passed', parity, geometry: await call(lifecycleSnapshot) }); console.log(`PASS ${name}`);
    };
    const css = async (code, width, height) => {
      const before = await call(lifecycleSnapshot);
      await evaluate(`(() => { ${code} })()`);
      await until(`window.__lifecycle.maps.every((lane,i) => lane.resizeCalls > ${JSON.stringify(before.map(x => x.resizeCalls))}[i] && lane.map.width === ${width} && lane.map.height === ${height})`, 'native ResizeObserver delivery');
    };
    await send('Page.enable'); await send('Runtime.enable');
    const metrics = { width: 1280, height: 1100, mobile: false };
    await send('Emulation.setDeviceMetricsOverride', { ...metrics, deviceScaleFactor: 1 });
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/render-profile.html` });
    await until("location.pathname === '/render-profile.html' && document.readyState === 'complete'", 'local document');
    await evaluate(`(${prepareLifecycle.toString()})(${JSON.stringify(renderState(createDemoScenario(42)))})`);
    await until('window.__lifecycle.maps.every(lane => lane.resizeCalls > 0)', 'initial native ResizeObserver delivery');
    const initial = await call(initialDelivery);
    for (const row of initial) { assert.equal(row.pixelsPreserved, true); assert.equal(row.repaint, false); assert.equal(row.builds, 1); }
    evidence.checks.push({ name: 'Initial native ResizeObserver does not erase an already painted unchanged canvas', status: 'passed', initial });
    await checkpoint('Initial wide canvas');
    const unchanged = await call(repeatUnchanged);
    for (const row of unchanged) { assert.equal(row.paints, 0); assert.equal(row.buildDelta, 0); assert.equal(row.pixelsPreserved, true); }
    evidence.checks.push({ name: 'Twenty explicit unchanged resize/render calls preserve pixels without repaint', status: 'passed', unchanged });
    await css("window.__lifecycle.host.style.width = '320px'", 320, 420); await checkpoint('Native CSS narrow resize');
    await css("window.__lifecycle.host.style.width = '960px'", 960, 420); await checkpoint('Native CSS wide resize');
    for (let cycle = 1; cycle <= 2; cycle++) {
      await css("window.__lifecycle.host.style.display = 'none'", 0, 0); await checkpoint(`Native zero-size hide ${cycle}`, true);
      await css("window.__lifecycle.host.style.display = 'grid'", 960, 420); await checkpoint(`Native show restores fresh pixels ${cycle}`);
    }
    for (const dpr of [1.5, 2, 3, 1]) {
      await send('Emulation.setDeviceMetricsOverride', { ...metrics, deviceScaleFactor: dpr });
      await until(`devicePixelRatio === ${dpr}`, 'native emulated DPR');
      await checkpoint(`DPR-only transition to ${dpr}`);
      for (const row of await call(lifecycleSnapshot)) { assert.equal(row.width, 960); assert.equal(row.height, 420); assert.equal(row.dpr, Math.min(dpr, 2)); }
    }
    await css("window.__lifecycle.host.style.gridTemplateColumns = '1fr 1fr'", 472, 420); await checkpoint('Two equal side-by-side panes');
    await css("window.__lifecycle.host.style.width = '320px'; window.__lifecycle.host.style.gridTemplateColumns = '1fr'", 320, 420); await checkpoint('Narrow stacked panes');
    await css("window.__lifecycle.host.style.width = '960px'; window.__lifecycle.host.style.gridTemplateColumns = '1fr 1fr'", 472, 420); await checkpoint('Restored side-by-side panes');
    evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error.stack || error).slice(0, 12000); throw error; }
  finally {
    await finishBrowserEvidence(output, evidence, [async () => { if (browser) await browser.close(); }, async () => { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }, async () => { if (temporary) await removeOwnedBrowserDirectory(temporary); }]);
  }
  console.log(`Verified ${evidence.checks.length} Canvas lifecycle checkpoints. Evidence: ${path.join(output, 'evidence.json')}`);
}
if (import.meta.main) {
  try { const options = parseBrowserCheckArguments(process.argv.slice(2)); if (options) await runLifecycleCheck(options); else console.log(usage); }
  catch (error) { console.error(`DetourLab Canvas lifecycle check: ${error.message}`); process.exitCode = 1; }
}
