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
import { simulateExperiment } from '../../src/experiment.js';
import { launchChromium } from '../browser-check/chromium.js';
import { parseBrowserCheckArguments, finishBrowserEvidence, removeOwnedBrowserDirectory, documentReadyExpression } from '../browser-check/run.js';

import { exportReplayBookmark, parseReplayBookmark } from '../../src/replay-bookmark.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
export const usage = `Optional local Chromium replay-bookmark checks
Usage: node tools/replay-bookmark-check/run.js --browser /absolute/path/to/chromium --out NEW_DIRECTORY
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

export async function runReplayBookmarkCheck({ executable, output }) {
  await mkdir(output);
  const evidence = { format: 'detourlab-replay-bookmark-check', version: 1, status: 'running', startedAt: new Date().toISOString(),
    runtime: { node: process.version, os: platform(), release: release(), arch: arch() }, checks: [], screenshots: [],
    limitations: ['Local headless Chromium and synthetic fixtures only; not deployed, cross-browser, native chooser, mobile-device or assistive-technology certification.',
      'Worker wrapper records native requests/results. NetworkMap.render wrapper calls the unchanged renderer and retains instance references for read-only observations.',
      'CDP focus/key/pointer events are bounded integration evidence, not human usability testing.', 'Screenshots are unmodified captures; image existence/hash is not visual inspection.'] };
  let browser, server, temporary;
  try {
    const files = ['index.html', ...((await readdir(path.join(root, 'src'))).filter(f => /\.(js|css)$/u.test(f)).map(f => `src/${f}`)), 'tools/replay-bookmark-check/run.js'].sort();
    evidence.sourceFiles = await Promise.all(files.map(async file => ({ path: file, sha256: hash(await readFile(path.join(root, file))) })));
    evidence.sourceSha256 = hash(JSON.stringify(evidence.sourceFiles));
    temporary = await mkdtemp(path.join(tmpdir(), 'detourlab-replay-')); const profile = path.join(temporary, 'profile'); await mkdir(profile);
    server = http.createServer(createRequestHandler(root)); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    browser = await launchChromium(executable, profile); evidence.browser = browser.version;
    const downloads = path.join(output, 'downloads'); await mkdir(downloads);
    await browser.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloads, eventsEnabled: true });
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
      maps:Object.fromEntries(Object.entries(x.maps).map(([id,m])=>[id,{view:m.state.view,time:m.state.time,zoom:m.state.zoom,selectedVehicle:m.state.selectedVehicle,editing:m.state.editing,playing:m.state.playing,variantId:m.state.selectedVariantId,scenarioId:m.state.scenario.id,baseline:!!m.state.baseline,disrupted:!!m.state.disrupted,points:m.vehiclePoints,scale:m.scale,width:m.width,height:m.height}])),
      calls:{...x.renderCalls},label:document.getElementById('variant-pane-label').textContent,hidden:document.getElementById('baseline-pane').hidden};})()`);
    const geometry = () => evaluate(`(() => {const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};return {primary:rect('network-map'),baseline:rect('baseline-map'),overflow:document.documentElement.scrollWidth>innerWidth};})()`);
    const capture = async (name, viewport) => { await until("document.getElementById('toast').hidden", 'transient toast dismissal before raw capture'); await evaluate("document.getElementById('open-replay').closest('section').scrollIntoView({block:'start'})"); await frames(); const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 65, captureBeyondViewport: false }); const bytes = Buffer.from(data, 'base64'); assert.ok(bytes.length <= 1024 * 1024, 'bounded screenshot must fit 1 MiB'); await writeFile(path.join(output, name), bytes, { flag: 'wx' }); evidence.screenshots.push({ file: name, sha256: hash(bytes), bytes: bytes.length, viewport, meaning: 'Unmodified screenshot of local synthetic split-map workbench; visual inspection separate.' }); };
    await send('Page.enable'); await send('Runtime.enable');
    const desktop = { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false };
    await send('Emulation.setDeviceMetricsOverride', desktop);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: observeWorkers });
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
    await until(documentReadyExpression, 'initial render'); await evaluate(observeRenderers); await frames();
    const setFile = async (file, selector = '#replay-input') => {
      const { root: doc } = await send('DOM.getDocument');
      const { nodeId } = await send('DOM.querySelector', { nodeId: doc.nodeId, selector });
      assert.ok(nodeId); await send('DOM.setFileInputFiles', { nodeId, files: [file] });
    };
    const writeFixture = async (name, value) => { const file=path.join(output,name); await writeFile(file,value,{flag:'wx'}); return file; };
    const load = async file => { const before=(await snapshot()).requests; await setFile(file); await until(`window.__splitCheck.requests.length > ${before}`,'bookmark requested'); await ready(); await frames(); return snapshot(); };
    const tiny=JSON.parse(await readFile(path.join(root,'examples/minimal-experiment.json'),'utf8'));
    tiny.name='<img src=x onerror=alert(1)> Replay handoff';
    const perspective={variantId:'close-at-10',vehicleId:'van-1',timeS:15.25,view:'split',zoom:1.2};
    const bookmarkFile=await writeFixture('tiny.replay.json',exportReplayBookmark(tiny,perspective));
    let s=await load(bookmarkFile);
    const verifyPerspective=(state,p)=>{const m=state.maps['network-map'];assert.equal(m.variantId,p.variantId);assert.equal(m.selectedVehicle,p.vehicleId);assert.equal(m.time,p.timeS);assert.equal(m.view,p.view);assert.equal(m.zoom,p.zoom);assert.equal(m.playing,false);};
    verifyPerspective(s,perspective);const{id,...actual}=s.result;assert.equal(id,s.request.id);assert.deepEqual(actual,simulateExperiment(tiny));
    assert.equal(s.maps['baseline-map'].time,perspective.timeS);assert.equal(s.maps['baseline-map'].zoom,perspective.zoom);
    check('Bookmark recomputes complete native Worker ledger then restores paused fractional-time split perspective');
    assert.equal(await evaluate('document.querySelectorAll("img[onerror]").length'),0);check('Imported HTML-like labels remain literal text');
    const download=async()=>{let started,done=false,failure;const offStart=browser.on('Browser.downloadWillBegin',e=>{started=e;});const offProgress=browser.on('Browser.downloadProgress',e=>{if(started&&e.guid===started.guid&&e.state==='completed')done=true;if(e.state==='canceled')failure=new Error('Download canceled');});try{await click('save-replay');const end=Date.now()+15000;while(!done&&!failure&&Date.now()<end)await delay(25);if(failure)throw failure;assert.ok(done&&started);assert.match(started.guid,/^[a-zA-Z0-9-]+$/u);const file=path.join(downloads,started.guid);return{file,bytes:await readFile(file)};}finally{offStart();offProgress();}};
    const first=await download();const saved=parseReplayBookmark(first.bytes.toString('utf8'));assert.deepEqual(saved.perspective,perspective);assert.deepEqual(simulateExperiment(saved.experiment),simulateExperiment(tiny));
    check('Actual app download contains validated inputs and perspective, not trusted results',{downloadSha256:hash(first.bytes)});
    await click('reset-button');await ready();s=await load(first.file);verifyPerspective(s,perspective);
    const second=await download();assert.deepEqual(second.bytes,first.bytes);check('Downloaded bookmark reimports and exports byte-identically');
    s=await load(first.file);verifyPerspective(s,perspective);check('Same bookmark can be selected repeatedly');
    await evaluate("document.getElementById('open-replay').focus()");assert.equal(await evaluate('document.activeElement.id'),'open-replay');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});assert.notEqual(await evaluate('document.activeElement.id'),'replay-input');check('Native replay controls focus without exposing hidden file input');
    await capture('replay-desktop.jpg',desktop);
    const narrow={width:390,height:1100,deviceScaleFactor:1,mobile:false};await send('Emulation.setDeviceMetricsOverride',narrow);await frames();assert.equal((await geometry()).overflow,false);await capture('replay-narrow.jpg',narrow);check('Narrow replay controls remain within viewport');await send('Emulation.setDeviceMetricsOverride',desktop);await frames();
    const badFile=await writeFixture('invalid.replay.json',JSON.stringify({...saved,perspective:{...perspective,vehicleId:'missing'}}));const beforeBad=await snapshot();const beforeStatus=await evaluate("document.getElementById('replay-status').textContent");await setFile(badFile);await until(`document.getElementById('replay-status').textContent !== ${JSON.stringify(beforeStatus)}`,'invalid bookmark status');s=await snapshot();assert.equal(s.requests,beforeBad.requests);verifyPerspective(s,perspective);check('Invalid selection references preserve workspace and do not request a Worker');
    const beyond={...perspective,timeS:Number.MAX_SAFE_INTEGER};s=await load(await writeFixture('beyond.replay.json',exportReplayBookmark(tiny,beyond)));assert.equal(s.maps['network-map'].time,Number(await evaluate("document.getElementById('timeline').max")));assert.match(await evaluate("document.getElementById('replay-status').textContent"),/clamp|range|maximum|end/i);check('Beyond-duration bookmarks clamp explicitly to recomputed replay range');
    await evaluate(`(()=>{const native=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(...args){File.prototype.arrayBuffer=native;const p=native.apply(this,args);window.__splitCheck.held=true;return new Promise((resolve,reject)=>{window.__splitCheck.releaseRead=()=>p.then(resolve,reject)});};})()`);
    await setFile(first.file);await until('window.__splitCheck.held===true','held native file read');await click('reset-button');await ready();const afterReset=await snapshot();await evaluate('window.__splitCheck.releaseRead()');await evaluate('new Promise(resolve=>setTimeout(resolve,0))');await frames();s=await snapshot();assert.equal(s.requests,afterReset.requests);assert.equal(s.request.experiment.id,afterReset.request.experiment.id);assert.equal(s.maps['network-map'].view,'disruption');check('Reset supersedes delayed bookmark read without restoring stale perspective');
    await evaluate(`(()=>{const native=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(...args){File.prototype.arrayBuffer=native;const p=native.apply(this,args);window.__splitCheck.heldNavigation=true;return new Promise((resolve,reject)=>{window.__splitCheck.releaseNavigationRead=()=>p.then(resolve,reject)});};})()`);
    const beforeNavigation=await snapshot();await setFile(first.file);await until('window.__splitCheck.heldNavigation===true','held read before navigation');await click('view-baseline');await evaluate('window.__splitCheck.releaseNavigationRead()');await evaluate('new Promise(resolve=>setTimeout(resolve,0))');await frames();s=await snapshot();assert.equal(s.requests,beforeNavigation.requests);assert.equal(s.maps['network-map'].view,'baseline');check('New user view navigation supersedes delayed bookmark read');
    assert.deepEqual(s.errors,[]); evidence.status='passed';
  } catch(error) { evidence.status='failed';evidence.error=String(error.stack||error);throw error; }
  finally { await finishBrowserEvidence(output,evidence,[async()=>{if(browser)await browser.close();},async()=>{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}},async()=>{if(temporary)await removeOwnedBrowserDirectory(temporary);}]); }
  console.log(`Verified ${evidence.checks.length} replay-bookmark checkpoints. Evidence: ${path.join(output,'evidence.json')}`);
}
if(import.meta.main){try{const options=parseBrowserCheckArguments(process.argv.slice(2));if(options)await runReplayBookmarkCheck(options);else console.log(usage);}catch(error){console.error(`DetourLab replay-bookmark check: ${error.message}`);process.exitCode=1;}}
