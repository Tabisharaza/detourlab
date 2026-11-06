#!/usr/bin/env node
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir, platform, release, arch } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequestHandler } from '../../scripts/serve.js';
import { launchChromium } from '../browser-check/chromium.js';
import { parseBrowserCheckArguments, finishBrowserEvidence, removeOwnedBrowserDirectory, documentReadyExpression } from '../browser-check/run.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
export const usage = `Optional local Chromium delivery-impact CSV checks
Usage: node tools/impact-csv-check/run.js --browser /absolute/path/to/chromium --out NEW_DIRECTORY
Fresh local profile, loopback source, synthetic inputs only. No installs or user profile.
Native Workers and actual completed downloads compared with independent CLI processes.
Not native-chooser, mobile-device, screen-reader, cross-browser or deployed-site certification.`;

// Deliberately independent of the production CSV encoder: quoted commas, escaped
// quotes and embedded CR/LF must survive an actual downloaded artifact.
export function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') { assert.equal(field, '', 'quote must start a field'); quoted = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  assert.equal(quoted, false, 'unterminated CSV quote');
  if (row.length || field) { row.push(field); rows.push(row); }
  return rows;
}

const observation = `(() => {
  const state = window.__csvCheck = { requests: [], workers: 0, errors: [], callbacks: [], blobs: [], trusted: [] };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) { super(...args); state.workers++; this.addEventListener('message', e => { state.result = e.data; }); }
    postMessage(value, ...rest) { state.requests.push(value); return super.postMessage(value, ...rest); }
  };
  const nativeAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, callback, ...rest) {
    if (this.id === 'impact-download-csv' && type === 'click') state.callbacks.push(callback);
    return nativeAdd.call(this, type, callback, ...rest);
  };
  const nativeUrl = URL.createObjectURL;
  URL.createObjectURL = function(blob) { state.blobs.push({ type: blob.type, size: blob.size }); return nativeUrl.call(this, blob); };
  document.addEventListener('click', e => { if (e.target.id === 'impact-download-csv') state.trusted.push(e.isTrusted); }, true);
  window.addEventListener('error', e => state.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', e => state.errors.push(String(e.reason)));
})();`;

export async function runImpactCsvCheck({ executable, output }) {
  await mkdir(output); // No overwrite, including failure evidence.
  const evidence = { format: 'detourlab-impact-csv-check', version: 1, status: 'running', startedAt: new Date().toISOString(),
    runtime: { node: process.version, os: platform(), release: release(), arch: arch() }, checks: [], downloads: [], screenshots: [],
    limitations: ['Local headless Chromium and synthetic fixtures only; not deployed, cross-browser, native chooser, mobile-device or assistive-technology certification.',
      'Native Worker, object-URL and listener wrappers observe unchanged implementations. Retained callbacks are directly invoked only for explicit stale-state negative tests.',
      'CDP keyboard events are bounded integration evidence, not human usability testing. Screenshots are raw captures; hashes are not visual review.'] };
  let browser, server, temporary;
  try {
    const files = ['index.html', ...((await readdir(path.join(root, 'src'))).filter(f => /\.(js|css)$/u.test(f)).map(f => `src/${f}`)),
      ...((await readdir(path.join(root, 'scripts'))).filter(f => /\.js$/u.test(f)).map(f => `scripts/${f}`)),
      'tools/impact-csv-check/run.js', 'tools/browser-check/run.js', 'tools/browser-check/chromium.js'].sort();
    evidence.sourceFiles = await Promise.all(files.map(async file => ({ path: file, sha256: hash(await readFile(path.join(root, file))) })));
    evidence.sourceSha256 = hash(JSON.stringify(evidence.sourceFiles));
    temporary = await mkdtemp(path.join(tmpdir(), 'detourlab-impact-csv-'));
    const profile = path.join(temporary, 'profile'); await mkdir(profile);
    server = http.createServer(createRequestHandler(root)); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    browser = await launchChromium(executable, profile); evidence.browser = browser.version;
    evidence.runtime.nodeExecutableSha256 = hash(await readFile(process.execPath));
    evidence.runtime.browserLauncherSha256 = hash(await readFile(executable));
    const downloads = path.join(output, 'downloads'); await mkdir(downloads);
    await browser.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloads, eventsEnabled: true });
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params = {}) => browser.send(method, params, sessionId);
    const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    const until = async (expression, description) => { const end = Date.now() + 35000; do { if (await evaluate(expression)) return; await delay(25); } while (Date.now() < end); throw new Error(`Timed out: ${description}`); };
    const check = (name, detail = {}) => { evidence.checks.push({ name, status: 'passed', ...detail }); console.log(`PASS ${name}`); };
    const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
    const change = (id, value) => evaluate(`(() => {const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const frames = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const ready = () => until("document.documentElement.dataset.revision === String(window.__csvCheck.requests.at(-1)?.id) && document.getElementById('cancel-run').hidden", 'native Worker completion');
    const workers = () => evaluate('({workers:window.__csvCheck.workers, requests:window.__csvCheck.requests.length})');
    const cli = (file, variant, mode) => { const r = spawnSync(process.execPath, ['scripts/explain-experiment.js', file, '--variant', variant, mode], { cwd: root, maxBuffer: 8 * 1024 * 1024 }); assert.equal(r.status, 0, String(r.stderr)); return r.stdout; };
    const load = async file => {
      const previous = (await workers()).requests;
      const { root: doc } = await send('DOM.getDocument');
      const { nodeId } = await send('DOM.querySelector', { nodeId: doc.nodeId, selector: '#import-input' });
      assert.ok(nodeId); await send('DOM.setFileInputFiles', { nodeId, files: [file] });
      await until(`window.__csvCheck.requests.length > ${previous}`, 'import Worker request'); await ready(); await frames();
      await click('impact-button'); await until("document.getElementById('impact-dialog').open", 'impact dialog');
    };
    const download = async (label, trigger = () => click('impact-download-csv')) => {
      let started, done = false, failure;
      const before = await workers();
      const offStart = browser.on('Browser.downloadWillBegin', e => { assert.equal(started, undefined, 'one activation creates one download'); started = e; });
      const offProgress = browser.on('Browser.downloadProgress', e => { if (started && e.guid === started.guid && e.state === 'completed') done = true; if (e.state === 'canceled') failure = new Error('Download canceled'); });
      try {
        await trigger(); const end = Date.now() + 15000;
        while (!done && !failure && Date.now() < end) await delay(25);
        if (failure) throw failure;
        assert.ok(done && started, 'real completed browser download required');
        assert.equal(started.suggestedFilename, 'detourlab-delivery-impact.csv');
        assert.match(started.guid, /^[a-zA-Z0-9-]+$/u);
        const bytes = await readFile(path.join(downloads, started.guid));
        assert.deepEqual(await workers(), before, 'export must not create or request a Worker');
        assert.equal(await evaluate('window.__csvCheck.blobs.at(-1).type'), 'text/csv;charset=utf-8');
        assert.ok(await evaluate("document.getElementById('impact-export-status').textContent.length > 0"));
        evidence.downloads.push({ label, file: `downloads/${started.guid}`, suggestedFilename: started.suggestedFilename, sha256: hash(bytes), bytes: bytes.length, completed: true });
        return bytes;
      } finally { offStart(); offProgress(); }
    };
    const verify = async (file, variant, label, trigger) => {
      const bytes = await download(label, trigger), expected = cli(file, variant, '--csv');
      assert.deepEqual(bytes, expected, 'actual downloaded bytes match separate Node CLI');
      const report = JSON.parse(cli(file, variant, '--json')), rows = parseCsv(bytes.toString('utf8'));
      assert.equal(rows.length, report.jobs.length + 1, 'all jobs, not just visible or changed jobs');
      assert.ok(rows.every(row => row.length === rows[0].length), 'rectangular CSV');
      verifyRows(rows, report);
      check(label, { rowCount: report.jobs.length, cliSha256: hash(expected) }); return bytes;
    };
    const capture = async (name, viewport) => {
      await frames();
      const geometry = await evaluate(`(() => { const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};return {button:rect('impact-download-csv'),status:rect('impact-export-status'),dialog:rect('impact-dialog'),viewport:{width:innerWidth,height:innerHeight},overflow:document.documentElement.scrollWidth>innerWidth};})()`);
      assert.equal(geometry.overflow, false); assert.ok(geometry.button.x >= 0 && geometry.button.right <= viewport.width && geometry.button.width > 0 && geometry.button.y >= 0 && geometry.button.bottom <= viewport.height);
      const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 65, captureBeyondViewport: false }); const bytes = Buffer.from(data, 'base64');
      assert.ok(bytes.length <= 1024 * 1024); await writeFile(path.join(output, name), bytes, { flag: 'wx' });
      evidence.screenshots.push({ file: name, sha256: hash(bytes), bytes: bytes.length, viewport, geometry, meaning: 'Raw export controls capture. Visual review remains separate.' });
    };
    await send('Page.enable'); await send('Runtime.enable');
    const desktop = { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false }, narrow = { ...desktop, width: 390 };
    await send('Emulation.setDeviceMetricsOverride', desktop);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: observation });
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` }); await until(documentReadyExpression, 'initial render'); await ready();
    const meridian = path.join(root, 'examples/meridian-experiment.json');
    await load(meridian); await change('impact-variant', 'market-05'); await change('impact-filter', 'all');
    assert.equal(await evaluate("document.getElementById('impact-rows').children.length"), 20);
    const full = await verify(meridian, 'market-05', '192-row Meridian export from 20-row page'); assert.equal(parseCsv(full.toString()).length, 193);
    await click('impact-next'); assert.deepEqual(await verify(meridian, 'market-05', 'Page two exports the same complete ledger'), full);
    await change('impact-filter', 'timing'); assert.equal(await evaluate("document.getElementById('impact-rows').children.length"), 7);
    assert.deepEqual(await verify(meridian, 'market-05', 'Seven same-status timing changes still export all 192 deliveries'), full);
    assert.deepEqual(await verify(meridian, 'market-05', 'Repeated download is byte-identical'), full);
    await capture('impact-csv-desktop.jpg', desktop); await send('Emulation.setDeviceMetricsOverride', narrow); await capture('impact-csv-narrow.jpg', narrow); await send('Emulation.setDeviceMetricsOverride', desktop);
    for (const id of ['all-bridges-05', 'clear-roads', 'market-10']) { await change('impact-variant', id); await verify(meridian, id, `Variant switch exports ${id}`); }
    await change('impact-variant', 'market-05');
    for (const [key, code, keyCode] of [['Enter', 'Enter', 13], [' ', 'Space', 32]]) {
      await verify(meridian, 'market-05', `Trusted ${code} activation downloads CSV`, async () => {
        await evaluate("document.getElementById('impact-download-csv').focus()");
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
      });
      assert.equal(await evaluate('window.__csvCheck.trusted.at(-1)'), true);
    }
    const rejectForced = async label => {
      const before = await workers(), blobs = await evaluate('window.__csvCheck.blobs.length'); let starts = 0;
      const off = browser.on('Browser.downloadWillBegin', () => { starts++; });
      try {
        assert.equal(await evaluate("document.getElementById('impact-download-csv').disabled"), true);
        await evaluate(`(() => {const s=window.__csvCheck, button=document.getElementById('impact-download-csv'); if(!s.callbacks.length)throw new Error('No native export callback captured');for(const cb of s.callbacks) cb.call(button,new MouseEvent('click'));})()`);
        await delay(150); assert.equal(starts, 0); assert.equal(await evaluate('window.__csvCheck.blobs.length'), blobs); assert.deepEqual(await workers(), before);
        check(label);
      } finally { off(); }
    };
    await click('impact-close'); await rejectForced('Closed dialog rejects forced native export callback');
    await click('impact-button'); await verify(meridian, 'market-05', 'Reopened comparison exports current ledger');
    // Observe invalidation synchronously in the same renderer task as recompute:
    // the real Worker runs normally and no delivery/result is simulated or held.
    await evaluate(`(() => {document.getElementById('run-experiment').click();window.__csvCheck.pendingDisabled=document.getElementById('impact-download-csv').disabled;const before=window.__csvCheck.blobs.length;for(const cb of window.__csvCheck.callbacks)cb.call(document.getElementById('impact-download-csv'),new MouseEvent('click'));window.__csvCheck.pendingRejected=before===window.__csvCheck.blobs.length;})()`);
    assert.equal(await evaluate('window.__csvCheck.pendingDisabled && window.__csvCheck.pendingRejected'), true);
    await ready(); await rejectForced('Stale comparison rejects forced callback after recompute'); await click('impact-close'); await click('impact-button'); await verify(meridian, 'market-05', 'Close and reopen after recompute restores export'); await click('impact-close');
    const tiny = JSON.parse(await readFile(path.join(root, 'examples/minimal-experiment.json'), 'utf8'));
    tiny.variants[1].name = '=SUM(1,2) "quoted"\r\n<img src=x onerror=alert(1)> café';
    tiny.variants.push({ id: 'unreachable', name: '@unreachable', closures: [{ id: 'block', edgeIds: ['ab'], atS: 0 }] });
    const fixture = async (name, value) => { const file = path.join(output, name); await writeFile(file, JSON.stringify(value), { flag: 'wx' }); return file; };
    const tinyFile = await fixture('hostile-tiny.json', tiny); await load(tinyFile);
    for (const id of ['close-at-10', 'unreachable']) { await change('impact-variant', id); await verify(tinyFile, id, `Tiny literal labels and nullable timing: ${id}`); }
    assert.equal(await evaluate('document.querySelectorAll("img[onerror]").length'), 0); await click('impact-close');
    tiny.baseScenario.jobs = []; const empty = await fixture('zero-jobs.json', tiny); await load(empty); await change('impact-variant', 'close-at-10');
    await verify(empty, 'close-at-10', 'Zero-job experiment exports header only');
    assert.deepEqual(await evaluate('window.__csvCheck.errors'), []);
    evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error.stack || error); throw error; }
  finally { await finishBrowserEvidence(output, evidence, [async () => { if (browser) await browser.close(); }, async () => { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }, async () => { if (temporary) await removeOwnedBrowserDirectory(temporary); }]); }
  console.log(`Verified ${evidence.checks.length} impact CSV checkpoints. Evidence: ${path.join(output, 'evidence.json')}`);
}

// Compare to independently computed JSON fields as well as exact CLI CSV bytes.
export function verifyRows(rows, report) {
  const columns = ['experimentId', 'variantId', 'variantName', 'jobId', 'vehicleId', 'nodeId', 'dueTimeS',
    'baselineStatus', 'baselineArrivalS', 'baselineCompletedS', 'baselineDelayS',
    'variantStatus', 'variantArrivalS', 'variantCompletedS', 'variantDelayS',
    'arrivalDeltaS', 'completedDeltaS', 'delayDeltaS', 'changed', 'statusChanged'];
  assert.deepEqual(rows[0], columns);
  assert.equal(rows.length, report.jobs.length + 1);
  // Synthetic fixtures use ordinary IDs and either ordinary or formula-leading
  // names. Expected labels are independent literals, never production encoder output.
  const expectedName = /^[=@]/u.test(report.variant.name) ? "'" + report.variant.name : report.variant.name;
  const numeric = value => value === null ? '' : Object.is(value, -0) ? '-0' : String(value);
  for (const [i, job] of report.jobs.entries()) {
    const outcome = value => [value.status, numeric(value.arrivalS), numeric(value.completedS), numeric(value.delayS)];
    assert.deepEqual(rows[i + 1], [report.experimentId, report.variant.id, expectedName, job.id, job.vehicleId, job.nodeId,
      numeric(job.dueTimeS), ...outcome(job.baseline), ...outcome(job.variant),
      numeric(job.arrivalDeltaS), numeric(job.completedDeltaS), numeric(job.delayDeltaS), String(job.changed), String(job.statusChanged)]);
  }
}

if (import.meta.main) {
  try { const options = parseBrowserCheckArguments(process.argv.slice(2)); if (options) await runImpactCsvCheck(options); else console.log(usage); }
  catch (error) { console.error(`DetourLab impact CSV check: ${error.message}`); process.exitCode = 1; }
}
