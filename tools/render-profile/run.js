#!/usr/bin/env node
import http from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { arch, cpus, platform, release, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';
import { createRequestHandler } from '../../scripts/serve.js';
import { renderFixtures, renderState } from '../../tests/helpers/render-fixtures.js';
import { launchChromium } from '../browser-check/chromium.js';
import { parseBrowserCheckArguments, finishBrowserEvidence } from '../browser-check/run.js';
import { PROFILE, summarizeSamples, assertParity, preparePage, measureBatch, comparePixels } from './measurement.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
export const usage = `DetourLab optional native Canvas render-call profile
Usage: node tools/render-profile/run.js --browser /absolute/path/to/chromium --out NEW_DIRECTORY

Uses a fresh isolated local headless browser and two fixed synthetic fixtures.
Compares current guarded rendering with forced frame invalidation, NOT an older
renderer. Reports synchronous call durations, not GPU/raster time or FPS.
No speed threshold; repaint counts and final pixel/hit-point parity must pass.
No browser installation, security changes, user profile or external URL.
Output must not exist; failures retain evidence when writable. Exit 1 on failure.`;

export function profileHandler(fallback) {
  return (req, res) => {
    if (req.url !== '/render-profile.html') return fallback(req, res);
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; connect-src 'none'", 'Referrer-Policy': 'no-referrer' });
    res.end(req.method === 'HEAD' ? undefined : '<!doctype html><meta charset="utf-8"><title>DetourLab isolated render profile</title><body style="margin:0"></body>');
  };
}

export async function runProfile({ executable, output }) {
  await mkdir(output); // Exclusive: never overwrite or adopt an existing directory.
  const cpu = cpus();
  const evidence = { format: 'detourlab-render-profile', version: 1, status: 'running', startedAt: new Date().toISOString(),
    runtime: { node: process.version, os: platform(), release: release(), arch: arch(), cpuModel: cpu[0]?.model ?? null, logicalCpuCount: cpu.length },
    viewport: { width: 1280, height: 1600, deviceScaleFactor: 1 }, settings: PROFILE,
    method: 'Current renderer guarded versus forced invalidateFrame ablation; synchronous performance.now render-loop durations, not historical before/after or GPU/FPS measurements.',
    limitations: ['Headless hosted environment is not a representative end-user device.', 'No app RAF, full-application CPU, native resize/context-loss, historical renderer, cross-browser or deployed-site certification.', 'Pixel readback and hit-point equality check only the final state of each mode, outside all timed batches.', 'Timing is descriptive and noisy; correctness has gates but speed does not. Source hashes are identity, not signed provenance.'], results: [] };
  let browser, server, temporary;
  try {
    const sources = ['src/map.js', 'src/scenario.js', 'src/engine.js', 'tests/helpers/render-fixtures.js', 'tools/render-profile/measurement.js', 'tools/render-profile/run.js', 'tools/browser-check/chromium.js', 'tools/browser-check/run.js', 'scripts/serve.js'];
    evidence.sourceFiles = await Promise.all(sources.map(async file => ({ path: file, sha256: digest(await readFile(path.join(root, file))) })));
    evidence.sourceSha256 = digest(JSON.stringify(evidence.sourceFiles));
    const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 5000 });
    evidence.checkoutRevision = revision.status === 0 && /^[a-f0-9]{40}\s*$/u.test(revision.stdout) ? revision.stdout.trim() : null;
    temporary = await mkdtemp(path.join(tmpdir(), 'detourlab-render-'));
    const profile = path.join(temporary, 'profile'); await mkdir(profile);
    server = http.createServer(profileHandler(createRequestHandler(root)));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    browser = await launchChromium(executable, profile); evidence.browser = browser.version;
    for (const scenario of renderFixtures()) {
      const state = renderState(scenario);
      for (const mode of ['paused', 'playing']) {
        const row = { fixture: scenario.id, nodes: scenario.nodes.length, directedEdges: scenario.edges.length, vehicles: scenario.vehicles.length, jobs: scenario.jobs.length, stateSha256: digest(JSON.stringify(state)), mode, order: [], samples: { guarded: [], forced: [] } };
        evidence.results.push(row);
        const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
        const send = (method, params = {}) => browser.send(method, params, sessionId);
        const evaluate = async expression => {
          const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
          if (result.exceptionDetails) throw new Error(`Profile evaluation failed: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
          return result.result.value;
        };
        await send('Page.enable'); await send('Runtime.enable');
        await send('Emulation.setDeviceMetricsOverride', { ...evidence.viewport, mobile: false });
        await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/render-profile.html` });
        // Await the committed document, not an arbitrary delay after navigation.
        const deadline = Date.now() + 10000;
        while (!await evaluate("location.pathname === '/render-profile.html' && document.readyState === 'complete'")) {
          if (Date.now() >= deadline) throw new Error('Profile document did not load.');
          await delay(25);
        }
        await evaluate(`(${preparePage.toString()})(${JSON.stringify(state)},${JSON.stringify(PROFILE)})`);
        for (let batch = 0; batch < PROFILE.batches; batch++) {
          const order = batch % 2 ? ['forced', 'guarded'] : ['guarded', 'forced']; row.order.push(order);
          for (const treatment of order) row.samples[treatment].push(await evaluate(`(${measureBatch.toString()})(${JSON.stringify(mode)},${JSON.stringify(treatment)},${batch})`));
        }
        row.parity = await evaluate(`(${comparePixels.toString()})()`); assertParity(row.parity);
        row.summary = Object.fromEntries(['guarded', 'forced'].map(treatment => [treatment, summarizeSamples(row.samples[treatment], mode, treatment)]));
        await browser.send('Target.closeTarget', { targetId });
        console.log(`PASS ${scenario.id} ${mode}: counts, final pixels and hit points; durations recorded without speed gate`);
      }
    }
    evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error.stack || error); throw error; }
  finally {
    await finishBrowserEvidence(output, evidence, [
      async () => { if (browser) await browser.close(); },
      async () => { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } },
      async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); },
    ]);
  }
  console.log(`Render profile evidence: ${path.join(output, 'evidence.json')}`);
}

if (import.meta.main) {
  try { const options = parseBrowserCheckArguments(process.argv.slice(2)); if (options) await runProfile(options); else console.log(usage); }
  catch (error) { console.error(`DetourLab render profile: ${error.message}`); process.exitCode = 1; }
}
