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
import { nativeKeySequence } from '../replay-events-check/run.js';
import { launchChromium } from '../browser-check/chromium.js';
import { parseBrowserCheckArguments, finishBrowserEvidence, removeOwnedBrowserDirectory, documentReadyExpression } from '../browser-check/run.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const usage = `Optional local Chromium delivery-to-replay checks
Usage: node tools/delivery-replay-check/run.js --browser /absolute/path/to/chromium --out NEW_DIRECTORY
Fresh profile, loopback source, synthetic fixtures and unchanged native Workers/renderers.
No installation, user profile, deployment or security-flag changes. Output must not exist.
Not native chooser, screen-reader, physical mobile-device or cross-browser certification.`;
const observation = `(() => {
 const s=window.__deliveryReplay={requests:[],errors:[],callbacks:[],trusted:[],maps:{}};
 const NativeWorker=window.Worker;
 window.Worker=class extends NativeWorker {
  constructor(...a){super(...a);this.addEventListener('message',e=>{s.result=e.data})}
  postMessage(v,...a){s.requests.push(v);return super.postMessage(v,...a)}
 };
 const add=EventTarget.prototype.addEventListener;
 EventTarget.prototype.addEventListener=function(type,callback,...args){
  if(type==='click' && this.dataset?.impactReplay) s.callbacks.push({element:this,callback});
  return add.call(this,type,callback,...args);
 };
 document.addEventListener('click',e=>{if(e.target.closest?.('[data-impact-replay]'))s.trusted.push(e.isTrusted)},true);
 window.addEventListener('error',e=>s.errors.push(String(e.message)));
 window.addEventListener('unhandledrejection',e=>s.errors.push(String(e.reason)));
})();`;
const rendererObservation = `(async()=>{
 const {NetworkMap}=await import('/src/map.js'), render=NetworkMap.prototype.render;
 NetworkMap.prototype.render=function(...args){const r=render.apply(this,args);window.__deliveryReplay.maps[this.canvas.id]=this;return r};
})()`;

export async function runDeliveryReplayCheck({ executable, output }) {
 await mkdir(output);
 const evidence={format:'detourlab-delivery-replay-check',version:1,status:'running',startedAt:new Date().toISOString(),runtime:{node:process.version,os:platform(),release:release(),arch:arch()},checks:[],screenshots:[],fixtures:[],limitations:[
  'Headless Chromium and synthetic data only; not a deployment, native file chooser, screen-reader, physical mobile-device or cross-browser pass.',
  'Worker and renderer observers forward unchanged behavior. Retained callbacks are invoked only in explicit stale-state negative tests.',
  'Import uses CDP file injection. Ordinary control changes use DOM events; one Enter activation uses native CDP input and requires a trusted click.',
  'Raw screenshots and hashes are not by themselves visual review or signed provenance.'
 ]};
 let browser, server, temporary;
 try {
  const files=['index.html','examples/minimal-experiment.json','examples/meridian-experiment.json',
   ...((await readdir(path.join(root,'src'))).filter(f=>/\.(js|css)$/u.test(f)).map(f=>`src/${f}`)),
   ...((await readdir(path.join(root,'scripts'))).filter(f=>/\.js$/u.test(f)).map(f=>`scripts/${f}`)),
   'tools/delivery-replay-check/run.js','tools/replay-events-check/run.js','tools/browser-check/run.js','tools/browser-check/chromium.js'].sort();
  evidence.sourceFiles=await Promise.all(files.map(async file=>({path:file,sha256:hash(await readFile(path.join(root,file)))})));
  evidence.sourceSha256=hash(JSON.stringify(evidence.sourceFiles));
  temporary=await mkdtemp(path.join(tmpdir(),'detourlab-delivery-replay-'));const profile=path.join(temporary,'profile');await mkdir(profile);
  server=http.createServer(createRequestHandler(root));server.listen(0,'127.0.0.1');await once(server,'listening');
  browser=await launchChromium(executable,profile);evidence.browser=browser.version;
  const {targetId}=await browser.send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await browser.send('Target.attachToTarget',{targetId,flatten:true});
  const send=(method,params={})=>browser.send(method,params,sessionId);
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
  const until=async(expression,label)=>{const end=Date.now()+35000;do{if(await evaluate(expression))return;await delay(25)}while(Date.now()<end);throw new Error(`Timed out: ${label}`)};
  const frames=()=>evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const click=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  const change=(id,value,type='change')=>evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(type)},{bubbles:true}))})()`);
  const ready=()=>until("document.documentElement.dataset.revision===String(window.__deliveryReplay.requests.at(-1)?.id)&&document.getElementById('cancel-run').hidden",'native Worker completion');
  const check=(name,detail={})=>{evidence.checks.push({name,status:'passed',...detail});console.log(`PASS ${name}`)};
  const snapshot=()=>evaluate(`(()=>{const s=window.__deliveryReplay;return {requests:s.requests.length,errors:s.errors,dialog:document.getElementById('impact-dialog').open,focus:document.activeElement.id,announcement:document.getElementById('replay-events-announcement').textContent,maps:Object.fromEntries(Object.entries(s.maps).map(([id,m])=>[id,{time:m.state.time,vehicle:m.state.selectedVehicle,variant:m.state.selectedVariantId,view:m.state.view,playing:m.state.playing}]))}})()`);
  const load=async file=>{const n=(await snapshot()).requests;const {root:doc}=await send('DOM.getDocument');const {nodeId}=await send('DOM.querySelector',{nodeId:doc.nodeId,selector:'#import-input'});assert.ok(nodeId);await send('DOM.setFileInputFiles',{nodeId,files:[file]});await until(`window.__deliveryReplay.requests.length>${n}`,'import request');await ready();await frames()};
  const report=(file,variant)=>{const r=spawnSync(process.execPath,['scripts/explain-experiment.js',file,'--variant',variant,'--json'],{cwd:root,maxBuffer:8*1024*1024});assert.equal(r.status,0,String(r.stderr));return JSON.parse(r.stdout)};
  const open=async variant=>{if(variant)await change('variant-select',variant);await click('impact-button');await until("document.getElementById('impact-dialog').open",'inspector open');await change('impact-filter','all')};
  const selector=(job,run)=>`[data-impact-replay="${run}"][data-job-id=${JSON.stringify(job)}]`;
  const verifyJump=(s,job,run,requests)=>{
   const at=job[run].arrivalS;assert.notEqual(at,null);assert.equal(s.requests,requests);assert.equal(s.dialog,false);assert.equal(s.focus,'vehicle-select');
   for(const id of ['network-map','baseline-map']){assert.equal(s.maps[id].time,at);assert.equal(s.maps[id].vehicle,job.vehicleId);assert.equal(s.maps[id].playing,false)}
   assert.equal(s.maps['network-map'].view,'split');assert.ok(s.announcement.includes(job.id));assert.ok(s.announcement.includes(String(at)));assert.deepEqual(s.errors,[]);
  };
  const jump=async(job,run,native=false)=>{
   const n=(await snapshot()).requests,sel=selector(job.id,run);
   assert.equal(await evaluate(`Number(document.querySelector(${JSON.stringify(sel)}).dataset.time)`),job[run].arrivalS);
   if(native){await evaluate(`document.querySelector(${JSON.stringify(sel)}).focus()`);for(const e of nativeKeySequence('Enter'))await send('Input.dispatchKeyEvent',e)}
   else await evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);
   await frames();const s=await snapshot();verifyJump(s,job,run,n);return s;
  };
  const retain=async()=>evaluate("window.__deliveryReplay.retained=window.__deliveryReplay.callbacks.findLast(x=>x.element.isConnected&&!x.element.disabled)");
  const invokeRetained=()=>evaluate("window.__deliveryReplay.retained.callback.call(window.__deliveryReplay.retained.element,new Event('click'))");
  const assertStale=async label=>{const before=await snapshot();await invokeRetained();await frames();const after=await snapshot();assert.deepEqual(after,before);check(label)};
  const capture=async(name,viewport)=>{
   await evaluate("document.getElementById('map-panes').scrollIntoView({block:'start'})");await frames();
   const geometry=await evaluate("(()=>{const e=document.getElementById('map-panes'),r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height,overflow:document.documentElement.scrollWidth>innerWidth}})()");
   assert.equal(geometry.overflow,false);assert.ok(geometry.left>=0&&geometry.right<=viewport.width);
   const {data}=await send('Page.captureScreenshot',{format:'jpeg',quality:65,captureBeyondViewport:false});const bytes=Buffer.from(data,'base64');assert.ok(bytes.length<=1048576);await writeFile(path.join(output,name),bytes,{flag:'wx'});
   evidence.screenshots.push({file:name,sha256:hash(bytes),bytes:bytes.length,viewport,geometry,meaning:'Unaltered source replay after delivery navigation; visual inspection is separate.'});
  };
  await send('Page.enable');await send('Runtime.enable');
  const desktop={width:1600,height:1100,deviceScaleFactor:1,mobile:false},narrow={...desktop,width:390};
  await send('Emulation.setDeviceMetricsOverride',desktop);await send('Page.addScriptToEvaluateOnNewDocument',{source:observation});
  await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});await until(documentReadyExpression,'initial render');await ready();await evaluate(rendererObservation);await frames();
  const tiny=path.join(root,'examples/minimal-experiment.json');await load(tiny);let r=report(tiny,'close-at-10'),job=r.jobs[0];
  assert.equal(job.baseline.arrivalS,20);assert.equal(job.variant.arrivalS,26);
  await open('close-at-10');await jump(job,'baseline');check('Baseline arrival selects the correct vehicle and shares exact 20-second replay without computation');
  await open();await jump(job,'variant',true);assert.equal(await evaluate('window.__deliveryReplay.trusted.at(-1)'),true);check('Native Enter activates variant arrival at 26 seconds, closes inspector and restores useful focus');
  const fixture=JSON.parse(await readFile(tiny,'utf8'));fixture.id='delivery-replay-boundaries';fixture.baseScenario.vehicles[0].startTimeS=.25;
  fixture.baseScenario.vehicles.push({id:'zero-van',startNode:'A',startTimeS:0});fixture.baseScenario.nodes.push({id:'isolated',x:3,y:3});
  fixture.baseScenario.jobs.push({id:'zero-job',vehicleId:'zero-van',nodeId:'A',dueTimeS:10,serviceTimeS:0},{id:'unreachable-job',vehicleId:'van-1',nodeId:'isolated',dueTimeS:50,serviceTimeS:0});
  const bytes=Buffer.from(JSON.stringify(fixture)),file=path.join(output,'boundary-experiment.json');await writeFile(file,bytes,{flag:'wx'});evidence.fixtures.push({file:'boundary-experiment.json',sha256:hash(bytes),bytes:bytes.length});
  await load(file);r=report(file,'close-at-10');job=r.jobs.find(j=>j.id==='job-1');assert.equal(job.variant.arrivalS,26.25);
  await open('close-at-10');await jump(job,'variant');check('Fractional arrival survives exact split replay without timeline rounding',{atS:26.25});
  job=r.jobs.find(j=>j.id==='zero-job');assert.equal(job.variant.arrivalS,0);await open();await jump(job,'variant');check('A genuine zero arrival remains actionable and selects a different vehicle');
  await open();const missing=r.jobs.find(j=>j.id==='unreachable-job');assert.equal(missing.baseline.arrivalS,null);assert.equal(missing.variant.arrivalS,null);
  for(const run of ['baseline','variant'])assert.equal(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector(missing.id,run))});return !!e&&!e.disabled})()`),false);
  check('Unreachable null arrivals have no actionable replay and are never fabricated as zero');
  await retain();await change('impact-search','nothing-matches','input');await assertStale('Retained row callback is inert after search removes its row');
  await change('impact-search','','input');await retain();await change('impact-sort','arrival-desc');await assertStale('Retained row callback is inert after ordering replaces rows');
  await retain();await change('impact-variant','clear');await assertStale('Retained row callback is inert after variant selection changes evidence');
  await retain();await click('impact-close');await open();await assertStale('Closed inspector callbacks cannot navigate after reopening');
  await retain();await click('run-experiment');await ready();await frames();await assertStale('Old delivery callbacks remain inert after real Worker recomputation');await click('impact-close');
  const meridian=path.join(root,'examples/meridian-experiment.json');await load(meridian);r=report(meridian,'market-05');await open('market-05');
  await retain();await click('impact-next');await assertStale('Retained row callback is inert after page navigation');
  await change('impact-search','job-01-4','input');await change('impact-sort','arrival-desc');job=r.jobs.find(j=>j.id==='job-01-4');assert.equal(job.variant.arrivalS,741);
  await jump(job,'variant');check('Searched and ranked Meridian delivery navigates to its exact completed outcome',{jobId:job.id,vehicleId:job.vehicleId,atS:job.variant.arrivalS});
  await capture('delivery-replay-desktop.jpg',desktop);await send('Emulation.setDeviceMetricsOverride',narrow);await capture('delivery-replay-narrow.jpg',narrow);
  check('Desktop and 390px CSS viewport split maps remain contained after delivery navigation; raw captures retained');
  assert.deepEqual((await snapshot()).errors,[]);evidence.status='passed';
 }catch(error){evidence.status='failed';evidence.error=String(error.stack||error);throw error}
 finally{await finishBrowserEvidence(output,evidence,[async()=>{if(browser)await browser.close()},async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}},async()=>{if(temporary)await removeOwnedBrowserDirectory(temporary)}])}
 console.log(`Verified ${evidence.checks.length} delivery replay checkpoints. Evidence: ${path.join(output,'evidence.json')}`);
}
if(import.meta.main){try{const options=parseBrowserCheckArguments(process.argv.slice(2));if(options)await runDeliveryReplayCheck(options);else console.log(usage)}catch(error){console.error(`DetourLab delivery replay check: ${error.message}`);process.exitCode=1}}
