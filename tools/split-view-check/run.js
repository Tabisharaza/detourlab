#!/usr/bin/env node
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir, platform, release, arch } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequestHandler } from '../../scripts/serve.js';
import { exportExperiment, simulateExperiment } from '../../src/experiment.js';
import { launchChromium } from '../browser-check/chromium.js';
import { parseBrowserCheckArguments, finishBrowserEvidence, removeOwnedBrowserDirectory, documentReadyExpression } from '../browser-check/run.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
export const usage = `Optional local Chromium split-map checks
Usage: node tools/split-view-check/run.js --browser /absolute/path/to/chromium --out NEW_DIRECTORY
Fresh local profile, loopback source, synthetic inputs only. No installs or user profile.
Includes renderer observation, not renderer replacement; screenshots are raw captures.
Not native-chooser, mobile-device, screen-reader, cross-browser or deployed-site certification.`;
const observeWorkers = `(() => {
  window.__splitCheck = { requests: [], result: null, errors: [] };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) { super(...args); this.addEventListener('message', e => { window.__splitCheck.result = e.data; }); }
    postMessage(value, ...rest) { window.__splitCheck.requests.push(value); return super.postMessage(value, ...rest); }
  };
  window.addEventListener('error', e => window.__splitCheck.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', e => window.__splitCheck.errors.push(String(e.reason)));
})();`;
const observeRenderers = `(async () => {
  const { NetworkMap } = await import('/src/map.js');
  const nativeRender = NetworkMap.prototype.render;
  window.__splitCheck.maps = {};
  window.__splitCheck.renderCalls = {};
  NetworkMap.prototype.render = function(...args) {
    const result = nativeRender.apply(this, args);
    window.__splitCheck.maps[this.canvas.id] = this;
    window.__splitCheck.renderCalls[this.canvas.id] = (window.__splitCheck.renderCalls[this.canvas.id] || 0) + 1;
    return result;
  };
})();`;

export async function runSplitCheck({ executable, output }) {
  await mkdir(output);
  const evidence = { format: 'detourlab-split-view-check', version: 1, status: 'running', startedAt: new Date().toISOString(),
    runtime: { node: process.version, os: platform(), release: release(), arch: arch() }, checks: [], screenshots: [],
    limitations: ['Local headless Chromium and synthetic fixtures only; not deployed, cross-browser, native chooser, mobile-device or assistive-technology certification.',
      'Worker wrapper records native requests/results. NetworkMap.render wrapper calls the unchanged renderer and retains instance references for read-only observations.',
      'CDP focus/key/pointer events are bounded integration evidence, not human usability testing.', 'Screenshots are unmodified captures; image existence/hash is not visual inspection.'] };
  let browser, server, temporary;
  try {
    const files = ['index.html', ...((await readdir(path.join(root, 'src'))).filter(f => /\.(js|css)$/u.test(f)).map(f => `src/${f}`)), 'tools/split-view-check/run.js'].sort();
    evidence.sourceFiles = await Promise.all(files.map(async file => ({ path: file, sha256: hash(await readFile(path.join(root, file))) })));
    evidence.sourceSha256 = hash(JSON.stringify(evidence.sourceFiles));
    temporary = await mkdtemp(path.join(tmpdir(), 'detourlab-split-')); const profile = path.join(temporary, 'profile'); await mkdir(profile);
    server = http.createServer(createRequestHandler(root)); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    browser = await launchChromium(executable, profile); evidence.browser = browser.version;
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params = {}) => browser.send(method, params, sessionId);
    const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    const until = async (expression, description, timeout = 35000) => { const end = Date.now() + timeout; do { if (await evaluate(expression)) return; await delay(25); } while (Date.now() < end); throw new Error(`Timed out: ${description}`); };
    const check = (name, detail = {}) => { evidence.checks.push({ name, status: 'passed', ...detail }); console.log(`PASS ${name}`); };
    const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
    const change = (id, value, event = 'change') => evaluate(`(() => {const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
    const frames = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const ready = () => until("document.documentElement.dataset.revision === String(window.__splitCheck.requests.at(-1)?.id) && document.getElementById('cancel-run').hidden", 'native Worker completion');
    const snapshot = () => evaluate(`(() => { const x=window.__splitCheck;return {requests:x.requests.length,request:x.requests.at(-1),result:x.result,errors:x.errors,
      maps:Object.fromEntries(Object.entries(x.maps).map(([id,m])=>[id,{view:m.state.view,time:m.state.time,zoom:m.state.zoom,selectedVehicle:m.state.selectedVehicle,editing:m.state.editing,scenarioId:m.state.scenario.id,baseline:!!m.state.baseline,disrupted:!!m.state.disrupted,points:m.vehiclePoints,scale:m.scale,width:m.width,height:m.height}])),
      calls:{...x.renderCalls},label:document.getElementById('variant-pane-label').textContent,hidden:document.getElementById('baseline-pane').hidden};})()`);
    const geometry = () => evaluate(`(() => {const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};return {primary:rect('network-map'),baseline:rect('baseline-map'),overflow:document.documentElement.scrollWidth>innerWidth};})()`);
    const capture = async (name, viewport) => { await until("document.getElementById('toast').hidden", 'transient toast dismissal before raw capture'); await evaluate("document.getElementById('map-shell').scrollIntoView({block:'start'})"); await frames(); const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 65, captureBeyondViewport: false }); const bytes = Buffer.from(data, 'base64'); assert.ok(bytes.length <= 1024 * 1024, 'bounded screenshot must fit 1 MiB'); await writeFile(path.join(output, name), bytes, { flag: 'wx' }); evidence.screenshots.push({ file: name, sha256: hash(bytes), bytes: bytes.length, viewport, meaning: 'Unmodified screenshot of local synthetic split-map workbench; visual inspection separate.' }); };
    await send('Page.enable'); await send('Runtime.enable');
    const desktop = { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false };
    await send('Emulation.setDeviceMetricsOverride', desktop);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: observeWorkers });
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
    await until(documentReadyExpression, 'initial render'); await evaluate(observeRenderers); await frames();
    const initial = await snapshot(); assert.equal(initial.requests, 1); assert.equal(initial.maps['baseline-map'], undefined);
    await click('view-split'); await frames(); const opened = await snapshot();
    assert.equal(opened.requests, initial.requests); assert.deepEqual(opened.result, initial.result); assert.equal(opened.hidden, false);
    assert.equal(opened.maps['baseline-map'].view, 'baseline'); assert.equal(opened.maps['network-map'].view, 'split');
    assert.equal(opened.maps['baseline-map'].editing, false); assert.equal(opened.maps['baseline-map'].time, opened.maps['network-map'].time);
    let g = await geometry(); assert.equal(g.overflow, false); assert.ok(g.baseline.x < g.primary.x); assert.equal(g.baseline.width, g.primary.width); assert.equal(g.baseline.height, g.primary.height);
    check('Opening split reuses completed native results and produces equal desktop panes', { geometry: g });
    await evaluate("document.getElementById('view-split').focus()"); await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    assert.equal(await evaluate('document.activeElement.id'), 'zoom-in'); check('Keyboard leaves split toggle for shared zoom controls without a hidden-canvas stop');
    await click('try-example-button'); await click('lesson-start'); await ready(); await click('lesson-close-at-10'); await click('view-split'); await change('timeline', 20, 'input'); await frames();
    let s = await snapshot(); const tiny = JSON.parse(await readFile(path.join(root, 'examples/minimal-experiment.json'), 'utf8'));
    const { id, ...actual } = s.result; assert.equal(id, s.request.id); assert.deepEqual(actual, simulateExperiment(tiny));
    assert.equal(s.maps['baseline-map'].time, 20); assert.equal(s.maps['network-map'].time, 20);
    const a = s.maps['baseline-map'].points[0], b = s.maps['network-map'].points[0]; assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>10);
    assert.equal(s.maps['baseline-map'].scale, s.maps['network-map'].scale);
    check('Tiny cutoff keeps native Worker/Node parity and shows different positions at shared 20 seconds');
    await capture('split-desktop.jpg', desktop);
    const beforeZoom = s.maps['network-map'].scale; await click('zoom-in'); await frames(); s = await snapshot();
    assert.ok(s.maps['network-map'].scale > beforeZoom); assert.equal(s.maps['network-map'].scale, s.maps['baseline-map'].scale); assert.equal(s.maps['network-map'].zoom, s.maps['baseline-map'].zoom);
    check('Shared zoom updates both projections'); await click('zoom-reset');
    await click('edit-roads'); await frames(); s = await snapshot(); assert.equal(s.maps['network-map'].editing, true); assert.equal(s.maps['baseline-map'].editing, false); check('Global road editing leaves baseline read-only'); await click('edit-roads');
    const n = s.requests; for (let i=0;i<3;i++) { await click('view-compare'); await frames(); assert.equal((await snapshot()).hidden, true); const hiddenCalls=(await snapshot()).calls['baseline-map']; await frames(); assert.equal((await snapshot()).calls['baseline-map'],hiddenCalls); await click('view-split'); await frames(); }
    assert.equal((await snapshot()).requests, n); check('Repeated split/overlay toggles preserve results without Worker reruns');
    const narrow = { width: 390, height: 1100, deviceScaleFactor: 1, mobile: false }; await send('Emulation.setDeviceMetricsOverride', narrow); await frames(); g = await geometry();
    assert.equal(g.overflow, false); assert.ok(g.baseline.y < g.primary.y); assert.equal(g.baseline.width,g.primary.width); assert.equal(g.baseline.height,g.primary.height); assert.ok(g.primary.height >= 300);
    check('Narrow CSS viewport stacks equal usable panes without horizontal overflow', { geometry:g }); await capture('split-narrow.jpg', narrow);
    await send('Emulation.setDeviceMetricsOverride', desktop); await click('return-experiment'); await ready(); await frames(); s=await snapshot(); assert.equal(s.hidden,false); assert.equal(s.maps['network-map'].view,'split'); assert.equal(s.request.experiment.id,initial.request.experiment.id); check('Returning from lesson restores prior split workspace');
    // Import a synthetic two-vehicle, long-label fixture through the real file-input event.
    const fixture=structuredClone(tiny); fixture.id='split-two-vehicle'; fixture.variants[0].name='<img src=x onerror=alert(1)> '+ 'Long literal label '.repeat(3); fixture.baseScenario.vehicles.push({...fixture.baseScenario.vehicles[0],id:'van-2',startNode:'D'}); fixture.baseScenario.jobs.push({...fixture.baseScenario.jobs[0],id:'job-2',vehicleId:'van-2'});
    const fixturePath=path.join(output,'two-vehicle.experiment.json'); await writeFile(fixturePath,exportExperiment(fixture),{flag:'wx'});
    const setFile=async file=>{const{root:doc}=await send('DOM.getDocument');const{nodeId}=await send('DOM.querySelector',{nodeId:doc.nodeId,selector:'#import-input'});await send('DOM.setFileInputFiles',{nodeId,files:[file]});};
    await setFile(fixturePath); await until(`window.__splitCheck.requests.at(-1)?.experiment.id === ${JSON.stringify(fixture.id)}`, 'import requested'); await ready(); await change('timeline',0,'input'); await frames(); s=await snapshot(); assert.equal(s.request.experiment.id,fixture.id); assert.equal(s.label,`Selected variant: ${fixture.variants[0].name}`); assert.equal(await evaluate('document.querySelectorAll("img[onerror]").length'),0);
    g=await geometry(); assert.equal(g.overflow,false); assert.equal(g.baseline.height,g.primary.height); check('Long HTML-like variant label remains inert and keeps pane dimensions aligned');
    const selectPoint=async(canvasId,vehicleId)=>{await evaluate(`document.getElementById(${JSON.stringify(canvasId)}).scrollIntoView({block:'center'})`);await frames();const target=await evaluate(`(()=>{const m=window.__splitCheck.maps[${JSON.stringify(canvasId)}],p=m.vehiclePoints.find(p=>p.id===${JSON.stringify(vehicleId)}),r=m.canvas.getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y};})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...target});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...target});await frames();};
    await selectPoint('baseline-map','van-2'); s=await snapshot(); assert.equal(s.maps['network-map'].selectedVehicle,'van-2'); assert.equal(s.maps['baseline-map'].selectedVehicle,'van-2');
    await selectPoint('network-map','van-1'); s=await snapshot(); assert.equal(s.maps['network-map'].selectedVehicle,'van-1'); assert.equal(s.maps['baseline-map'].selectedVehicle,'van-1'); check('Native pointer selection from either canvas shares one selected vehicle');
    await evaluate("document.getElementById('run-experiment').click();document.getElementById('cancel-run').click()"); await frames(); s=await snapshot(); for(const m of Object.values(s.maps)){assert.equal(m.baseline,false);assert.equal(m.disrupted,false);assert.deepEqual(m.points,[]);} check('Canceled native run clears both panes before any old result can be shown');
    await click('run-experiment'); await ready(); await frames(); s=await snapshot(); const{ id:rid,...rerun}=s.result; assert.equal(rid,s.request.id);assert.deepEqual(rerun,simulateExperiment(fixture));check('Rerun restores both panes with complete ledger parity');
    // Hold one real File read, then cancel. Releasing it must not replace the workspace.
    await evaluate(`(()=>{const native=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(...args){File.prototype.arrayBuffer=native;const p=native.apply(this,args);window.__splitCheck.held=true;return new Promise((resolve,reject)=>{window.__splitCheck.releaseRead=()=>p.then(resolve,reject)});};})()`);
    await setFile(path.join(root,'examples/minimal-experiment.json'));await until('window.__splitCheck.held===true','held file read');await evaluate("document.getElementById('run-experiment').click();document.getElementById('cancel-run').click()"); const afterCancel=(await snapshot()).requests;await evaluate('window.__splitCheck.releaseRead()');await evaluate('new Promise(resolve=>setTimeout(resolve,0))');await frames();s=await snapshot();assert.equal(s.requests,afterCancel);assert.equal(s.request.experiment.id,fixture.id);assert.equal(s.maps['network-map'].scenarioId,fixture.baseScenario.id);check('Canceled pending native File read cannot replace split workspace');
    assert.deepEqual(s.errors,[]); evidence.status='passed';
  } catch(error) { evidence.status='failed';evidence.error=String(error.stack||error);throw error; }
  finally { await finishBrowserEvidence(output,evidence,[async()=>{if(browser)await browser.close();},async()=>{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}},async()=>{if(temporary)await removeOwnedBrowserDirectory(temporary);}]); }
  console.log(`Verified ${evidence.checks.length} split-view checkpoints. Evidence: ${path.join(output,'evidence.json')}`);
}
if(import.meta.main){try{const options=parseBrowserCheckArguments(process.argv.slice(2));if(options)await runSplitCheck(options);else console.log(usage);}catch(error){console.error(`DetourLab split-view check: ${error.message}`);process.exitCode=1;}}
