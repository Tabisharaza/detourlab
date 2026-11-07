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
import { parseCsv, verifyRows } from '../impact-csv-check/run.js';
import { launchChromium } from '../browser-check/chromium.js';
import { parseBrowserCheckArguments, finishBrowserEvidence, removeOwnedBrowserDirectory, documentReadyExpression } from '../browser-check/run.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
export const usage = `Optional local Chromium delivery search and ordering checks
Usage: node tools/impact-query-check/run.js --browser /absolute/path/to/chromium --out NEW_DIRECTORY
Fresh local profile, loopback source, synthetic inputs only. No installs or user profile.
Native Workers and actual completed downloads compared with independent CLI processes.
Not native-chooser, mobile-device, screen-reader, cross-browser or deployed-site certification.`;

const observation = `(() => {
  const state = window.__csvCheck = { requests: [], workers: 0, errors: [], blobs: [], trusted: [] };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) { super(...args); state.workers++; this.addEventListener('message', e => { state.result = e.data; }); }
    postMessage(value, ...rest) { state.requests.push(value); return super.postMessage(value, ...rest); }
  };
  const nativeUrl = URL.createObjectURL;
  URL.createObjectURL = function(blob) { state.blobs.push({ type: blob.type, size: blob.size }); return nativeUrl.call(this, blob); };
  document.addEventListener('click', e => { if (e.target.id === 'impact-download-csv') state.trusted.push(e.isTrusted); }, true);
  for (const type of ['keydown', 'keyup', 'click']) document.addEventListener(type, e => {
    if (e.isTrusted) state.lastTrustedEvent = { type: e.type, key: e.key || null, code: e.code || null, targetId: e.target.id || null, isTrusted: true };
  }, true);
  window.addEventListener('error', e => state.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', e => state.errors.push(String(e.reason)));
})();`;

export async function runImpactQueryCheck({ executable, output }) {
  await mkdir(output); // No overwrite, including failure evidence.
  const evidence = { format: 'detourlab-impact-query-check', version: 1, status: 'running', startedAt: new Date().toISOString(),
    runtime: { node: process.version, os: platform(), release: release(), arch: arch() }, checks: [], downloads: [], screenshots: [],
    limitations: ['Local headless Chromium and synthetic fixtures only; not deployed, cross-browser, native chooser, mobile-device or assistive-technology certification.',
      'Native Worker and object-URL wrappers observe unchanged implementations. Search text uses native CDP input; select changes and button clicks use DOM events, not human interaction.',
      'CDP keyboard events are bounded integration evidence, not human usability testing. Screenshots are raw captures; hashes are not visual review.'] };
  let browser, server, temporary;
  try {
    const files = ['index.html', ...((await readdir(path.join(root, 'src'))).filter(f => /\.(js|css)$/u.test(f)).map(f => `src/${f}`)),
      ...((await readdir(path.join(root, 'scripts'))).filter(f => /\.js$/u.test(f)).map(f => `scripts/${f}`)),
      'tools/impact-query-check/run.js', 'tools/impact-csv-check/run.js', 'tools/replay-events-check/run.js', 'tools/browser-check/run.js', 'tools/browser-check/chromium.js'].sort();
    evidence.sourceFiles = await Promise.all(files.map(async file => ({ path: file, sha256: hash(await readFile(path.join(root, file))) })));
    evidence.sourceSha256 = hash(JSON.stringify(evidence.sourceFiles));
    temporary = await mkdtemp(path.join(tmpdir(), 'detourlab-impact-query-'));
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
      } catch (error) {
        evidence.downloadFailure = { label, started: !!started, completed: done };
        try {
          evidence.downloadFailure.renderer = await evaluate(`(() => {
            const button = document.getElementById('impact-download-csv');
            const dialog = document.getElementById('impact-dialog');
            const active = document.activeElement;
            return { activeElement: { id: active?.id || null, tagName: active?.tagName || null },
              disabled: button?.disabled ?? null, dialogOpen: dialog?.open ?? null,
              revision: document.documentElement.dataset.revision || null,
              lastRequestId: window.__csvCheck.requests.at(-1)?.id ?? null,
              lastTrustedEvent: window.__csvCheck.lastTrustedEvent || null,
              lastExportClickTrusted: window.__csvCheck.trusted.at(-1) ?? null,
              exportStatus: document.getElementById('impact-export-status')?.textContent.slice(0, 500) || null };
          })()`);
        } catch (diagnosticError) { evidence.downloadFailure.diagnosticError = String(diagnosticError.message || diagnosticError).slice(0, 500); }
        throw error;
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
      const geometry = await evaluate(`(() => { const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};return {button:rect('impact-search'),sort:rect('impact-sort'),status:rect('impact-status'),dialog:rect('impact-dialog'),viewport:{width:innerWidth,height:innerHeight},overflow:document.documentElement.scrollWidth>innerWidth};})()`);
      assert.equal(geometry.overflow, false); assert.ok(geometry.sort.x >= 0 && geometry.sort.right <= viewport.width && geometry.sort.width > 0); assert.ok(geometry.button.x >= 0 && geometry.button.right <= viewport.width && geometry.button.width > 0 && geometry.button.y >= 0 && geometry.button.bottom <= viewport.height);
      const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 65, captureBeyondViewport: false }); const bytes = Buffer.from(data, 'base64');
      assert.ok(bytes.length <= 1024 * 1024); await writeFile(path.join(output, name), bytes, { flag: 'wx' });
      evidence.screenshots.push({ file: name, sha256: hash(bytes), bytes: bytes.length, viewport, geometry, meaning: 'Raw query and ordering controls capture. Visual review remains separate.' });
    };
    await send('Page.enable'); await send('Runtime.enable');
    const desktop = { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false }, narrow = { ...desktop, width: 390 };
    await send('Emulation.setDeviceMetricsOverride', desktop);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: observation });
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` }); await until(documentReadyExpression, 'initial render'); await ready();
    const meridian = path.join(root, 'examples/meridian-experiment.json');
    await load(meridian); await change('impact-variant', 'market-05'); await change('impact-filter', 'all');
    const beforeQueries = await workers();
    let report = JSON.parse(cli(meridian, 'market-05', '--json'));
    const visible = () => evaluate("Array.from(document.querySelectorAll('#impact-rows th strong'), e => e.textContent)");
    const query = async value => {
      await evaluate("document.getElementById('impact-search').focus();document.getElementById('impact-search').select()");
      // Native CDP text insertion dispatches the real input event, including empty replacement.
      if (value) await send('Input.insertText', { text: value });
      else {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      }
      await frames();
      assert.equal(await evaluate("document.getElementById('impact-search').value"), value);
    };
    const expected = (q = '', filter = 'all', sorted = false) => {
      const needle = q.trim().toLowerCase();
      const rows = report.jobs.filter(j => (filter === 'all' || (filter === 'changed' ? j.changed : filter === 'status' ? j.statusChanged : !j.statusChanged && j.baseline.arrivalS !== j.variant.arrivalS)) && [j.id,j.vehicleId,j.nodeId].some(v => v.toLowerCase().includes(needle)));
      if (sorted) rows.sort((a,b) => a.arrivalDeltaS === null ? b.arrivalDeltaS === null ? 0 : 1 : b.arrivalDeltaS === null ? -1 : b.arrivalDeltaS - a.arrivalDeltaS);
      return rows.map(j => j.id);
    };
    assert.deepEqual(await visible(), expected().slice(0,20)); check('Default input order remains unchanged');
    await click('impact-next'); assert.deepEqual(await visible(), expected().slice(20,40));
    const jobQuery = report.jobs[31].id.toUpperCase(); await query(jobQuery);
    assert.deepEqual(await visible(), expected(jobQuery).slice(0,20));
    assert.match(await evaluate("document.getElementById('impact-status').textContent"), /page 1 of/);
    check('Native case-insensitive job search resets pagination');
    for (const field of ['vehicleId','nodeId']) {
      const q = report.jobs[0][field].toUpperCase(); await query(q); assert.deepEqual(await visible(), expected(q).slice(0,20));
      check(`Native case-insensitive ${field} search`);
    }
    await query('.*'); assert.deepEqual(await visible(), []); check('Search punctuation is literal, not a regular expression');
    await query('not-a-real-delivery'); assert.deepEqual(await visible(), []);
    const full = await verify(meridian, 'market-05', 'Empty search result exports all 192 deliveries');
    assert.equal(parseCsv(full.toString()).length,193);
    await query('  ' + report.jobs[0].vehicleId.toUpperCase() + '  ');
    await change('impact-filter','changed');
    assert.deepEqual(await visible(), expected('  ' + report.jobs[0].vehicleId.toUpperCase() + '  ','changed').slice(0,20));
    check('Trimmed search intersects the chosen outcome filter');
    await query(''); await change('impact-filter','all'); await click('impact-next'); await change('impact-sort','arrival-desc');
    assert.deepEqual(await visible(), expected('', 'all', true).slice(0,20));
    check('Largest arrival delay sorts numerically and resets page');
    const allRanked = [];
    for (let i=0;i<Math.ceil(report.jobs.length/20);i++) { allRanked.push(...await visible()); if(i+1<Math.ceil(report.jobs.length/20)) await click('impact-next'); }
    assert.deepEqual(allRanked, expected('', 'all', true));
    check('Every ranked page preserves original input tie order', { rows: allRanked.length });
    await query(report.jobs[0].vehicleId); assert.deepEqual(await verify(meridian,'market-05','Searched and ranked view still exports original full ledger'),full);
    await capture('impact-query-desktop.jpg',desktop); await send('Emulation.setDeviceMetricsOverride',narrow); await capture('impact-query-narrow.jpg',narrow); await send('Emulation.setDeviceMetricsOverride',desktop);
    const retained = report.jobs[0].vehicleId; await change('impact-variant','all-bridges-05'); report = JSON.parse(cli(meridian,'all-bridges-05','--json'));
    assert.equal(await evaluate("document.getElementById('impact-search').value"),retained);
    assert.equal(await evaluate("document.getElementById('impact-sort').value"),'arrival-desc');
    assert.deepEqual(await visible(),expected(retained,'all',true).slice(0,20)); check('Variant switch retains search and ordering against fresh outcomes');
    await query('');
    const nullable = expected('', 'all', true), collected=[];
    for(let i=0;i<Math.ceil(report.jobs.length/20);i++) { collected.push(...await visible()); if(i+1<Math.ceil(report.jobs.length/20)) await click('impact-next'); }
    assert.ok(report.jobs.some(j=>j.arrivalDeltaS===null),'fixture must include incomparable outcomes');
    assert.ok(report.jobs.some(j=>j.arrivalDeltaS !== null && j.arrivalDeltaS < 0),'fixture must include earlier arrivals');
    assert.deepEqual(collected,nullable); check('Incomparable arrivals follow positive, zero and negative deltas across page boundaries');
    assert.deepEqual(await workers(),beforeQueries); check('Searching, ordering and variant inspection do not launch simulation');
    await click('impact-close'); await click('impact-button');
    assert.equal(await evaluate("document.getElementById('impact-search').value"),'');
    assert.equal(await evaluate("document.getElementById('impact-sort').value"),'input');
    assert.equal(await evaluate("document.getElementById('impact-filter').value"),'changed'); check('Reopen restores explicit default query, filter and order');
    await evaluate("document.getElementById('run-experiment').click();window.__csvCheck.queryDisabled=document.getElementById('impact-search').disabled&&document.getElementById('impact-sort').disabled");
    assert.equal(await evaluate('window.__csvCheck.queryDisabled'),true); await ready();
    check('Recomputation immediately disables stale query controls');
    assert.deepEqual(await evaluate('window.__csvCheck.errors'), []);
    evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error.stack || error); throw error; }
  finally { await finishBrowserEvidence(output, evidence, [async () => { if (browser) await browser.close(); }, async () => { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }, async () => { if (temporary) await removeOwnedBrowserDirectory(temporary); }]); }
  console.log(`Verified ${evidence.checks.length} impact query checkpoints. Evidence: ${path.join(output, 'evidence.json')}`);
}

if (import.meta.main) {
  try { const options = parseBrowserCheckArguments(process.argv.slice(2)); if (options) await runImpactQueryCheck(options); else console.log(usage); }
  catch (error) { console.error(`DetourLab impact query check: ${error.message}`); process.exitCode = 1; }
}
