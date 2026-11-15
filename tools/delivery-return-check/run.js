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
export const usage = `Optional local Chromium delivery-return checks
Usage: node tools/delivery-return-check/run.js --browser /absolute/path/to/chromium --out NEW_DIRECTORY
Fresh profile, loopback source, synthetic fixtures and unchanged native Workers/renderers.
No installation, user profile, deployment or security-flag changes. Output must not exist.
Not native chooser, screen-reader, physical mobile-device or cross-browser certification.`;
const observation = `(() => {
 const s=window.__deliveryReturn={requests:[],errors:[],callbacks:[],trusted:[],maps:{}};
 const NativeWorker=window.Worker;
 window.Worker=class extends NativeWorker {
  constructor(...a){super(...a);this.addEventListener('message',e=>{s.result=e.data})}
  postMessage(v,...a){s.requests.push(v);return super.postMessage(v,...a)}
 };
 const add=EventTarget.prototype.addEventListener;
 EventTarget.prototype.addEventListener=function(type,callback,...args){
  if(type==='click' && (this.dataset?.impactReplay || this.id==='impact-return')) s.callbacks.push({element:this,callback});
  return add.call(this,type,callback,...args);
 };
 document.addEventListener('click',e=>{if(e.target.closest?.('[data-impact-replay], #impact-return'))s.trusted.push({id:e.target.id, trusted:e.isTrusted,...(e.target.dataset.impactReplay&&{side:e.target.dataset.impactReplay})})},true);
 window.addEventListener('error',e=>s.errors.push(String(e.message)));
 window.addEventListener('unhandledrejection',e=>s.errors.push(String(e.reason)));
})();`;
const rendererObservation = `(async()=>{
 const {NetworkMap}=await import('/src/map.js'), render=NetworkMap.prototype.render;
 NetworkMap.prototype.render=function(...args){const r=render.apply(this,args);window.__deliveryReturn.maps[this.canvas.id]=this;return r};
})()`;

export async function runDeliveryReturnCheck({ executable, output }) {
 await mkdir(output);
 const evidence={format:'detourlab-delivery-return-check',version:1,status:'running',startedAt:new Date().toISOString(),runtime:{node:process.version,os:platform(),release:release(),arch:arch()},checks:[],screenshots:[],fixtures:[],limitations:[
  'Headless Chromium and synthetic data only; not a deployment, native file chooser, screen-reader, physical mobile-device or cross-browser pass.',
  'Worker and renderer observers forward unchanged behavior. Retained callbacks are invoked only in explicit stale-state negative tests.',
  'Import uses CDP file injection. Ordinary control changes use DOM events; Enter and Space activations use native CDP input and require trusted clicks.',
  'Raw screenshots and hashes are not by themselves visual review or signed provenance.'
 ]};
 let browser, server, temporary;
 try {
  const files=['index.html','examples/minimal-experiment.json','examples/meridian-experiment.json',
   ...((await readdir(path.join(root,'src'))).filter(f=>/\.(js|css)$/u.test(f)).map(f=>`src/${f}`)),
   ...((await readdir(path.join(root,'scripts'))).filter(f=>/\.js$/u.test(f)).map(f=>`scripts/${f}`)),
   'tools/delivery-return-check/run.js','tools/replay-events-check/run.js','tools/browser-check/run.js','tools/browser-check/chromium.js'].sort();
  evidence.sourceFiles=await Promise.all(files.map(async file=>({path:file,sha256:hash(await readFile(path.join(root,file)))})));
  evidence.sourceSha256=hash(JSON.stringify(evidence.sourceFiles));
  temporary=await mkdtemp(path.join(tmpdir(),'detourlab-delivery-return-'));const profile=path.join(temporary,'profile');await mkdir(profile);
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
  const ready=()=>until("document.documentElement.dataset.revision===String(window.__deliveryReturn.requests.at(-1)?.id)&&document.getElementById('cancel-run').hidden",'native Worker completion');
  const check=(name,detail={})=>{evidence.checks.push({name,status:'passed',...detail});console.log(`PASS ${name}`)};
  const snapshot=()=>evaluate(`(()=>{const s=window.__deliveryReturn,a=document.activeElement,r=document.getElementById('impact-return');return {requests:s.requests.length,errors:s.errors,dialog:document.getElementById('impact-dialog').open,focus:{id:a.id,job:a.dataset.jobId||null,side:a.dataset.impactReplay||null},returnState:{hidden:r.hidden,disabled:r.disabled},reference:document.getElementById('impact-reference').value,candidate:document.getElementById('impact-variant').value,query:document.getElementById('impact-search').value,filter:document.getElementById('impact-filter').value,sort:document.getElementById('impact-sort').value,status:document.getElementById('impact-status').textContent,rows:Array.from(document.querySelectorAll('#impact-rows th strong'),e=>e.textContent),maps:Object.fromEntries(Object.entries(s.maps).map(([id,m])=>[id,{time:m.state.time,vehicle:m.state.selectedVehicle,variant:m.state.selectedVariantId,view:m.state.view,playing:m.state.playing,paintedPlan:m.state.allResults?.variants.find(plan=>plan.result===m.renderedFrame?.disrupted)?.id ?? null,closures:m.state.view==='baseline'?[]:Array.from(m.closureGeometries?.values()??[]).flatMap(records=>records.map(record=>({edge:record.edge.id,at:record.atS}))),paintedEdges:m.renderedFrame?.disrupted?.vehicles.find(v=>v.id===m.state.selectedVehicle)?.segments.map(segment=>segment.edgeId) ?? []}]))}})()`);
  const load=async file=>{const n=(await snapshot()).requests;const {root:doc}=await send('DOM.getDocument');const {nodeId}=await send('DOM.querySelector',{nodeId:doc.nodeId,selector:'#import-input'});assert.ok(nodeId);await send('DOM.setFileInputFiles',{nodeId,files:[file]});await until(`window.__deliveryReturn.requests.length>${n}`,'import request');await ready();await frames()};
  const report=(file,variant)=>{const r=spawnSync(process.execPath,['scripts/explain-experiment.js',file,'--variant',variant,'--json'],{cwd:root,maxBuffer:8*1024*1024});assert.equal(r.status,0,String(r.stderr));return JSON.parse(r.stdout)};
  const open=async variant=>{if(variant)await change('variant-select',variant);await click('impact-button');await until("document.getElementById('impact-dialog').open",'inspector open');await change('impact-filter','all')};
  const selector=(job,run)=>`[data-impact-replay="${run}"][data-job-id=${JSON.stringify(job)}]`;
  const native=async(selector,key)=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);for(const e of nativeKeySequence(key))await send('Input.dispatchKeyEvent',e);await frames()};
  const jump=async(job,side,key)=>{const requests=(await snapshot()).requests;if(key){await native(selector(job.id,side),key);assert.deepEqual(await evaluate('window.__deliveryReturn.trusted.at(-1)'),{id:'',trusted:true,side})}else await evaluate(`document.querySelector(${JSON.stringify(selector(job.id,side))}).click()`);await frames();const s=await snapshot();assert.equal(s.requests,requests);assert.equal(s.dialog,false);assert.deepEqual(s.returnState,{hidden:false,disabled:false});for(const id of ['network-map','baseline-map']){assert.equal(s.maps[id].time,job[side].arrivalS);assert.equal(s.maps[id].vehicle,job.vehicleId);assert.equal(s.maps[id].playing,false)}return s};
  const retain=()=>evaluate("window.__deliveryReturn.retained=window.__deliveryReturn.callbacks.findLast(x=>x.element.id==='impact-return')");
  const invokeRetained=()=>evaluate("window.__deliveryReturn.retained.callback.call(window.__deliveryReturn.retained.element,new Event('click'))");
  const assertStale=async label=>{const before=await snapshot();await invokeRetained();await frames();assert.deepEqual(await snapshot(),before);check(label)};
  const restored=async(saved,job,side,before)=>{await frames();const s=await snapshot();assert.equal(s.dialog,true);assert.deepEqual(s.returnState,{hidden:true,disabled:true});for(const key of ['reference','candidate','query','filter','sort','rows','status'])assert.deepEqual(s[key],saved[key],key);assert.equal(s.focus.job,job.id);assert.equal(s.focus.side,side);assert.equal(s.requests,before.requests);assert.deepEqual(s.maps,before.maps);assert.deepEqual(s.errors,[]);return s};
  const capture=async(name,viewport)=>{
   await until("document.getElementById('toast').hidden",'transient import toast naturally clears');
   // At the original desktop viewport verify the app's own restored-focus
   // scrolling before any harness adjustment. Narrow capture follows an explicit
   // viewport resize, so recenter there only; it is not restoration-scroll proof.
   if(viewport.width===1600){
    const visible=await evaluate("(()=>{const a=document.activeElement.getBoundingClientRect(),d=document.getElementById('impact-dialog').getBoundingClientRect(),t=document.getElementById('impact-table-region').getBoundingClientRect();return a.width>0&&a.height>0&&a.left>=Math.max(0,d.left,t.left)&&a.right<=Math.min(innerWidth,d.right,t.right)&&a.top>=Math.max(0,d.top,t.top)&&a.bottom<=Math.min(innerHeight,d.bottom,t.bottom)})()");
    assert.equal(visible,true,'app-restored action is fully visible before harness scrolling');
   } else await evaluate("document.activeElement.scrollIntoView({block:'center',inline:'center'})");
   await frames();
   const geometry=await evaluate("(()=>{const a=document.activeElement,r=a.getBoundingClientRect(),d=document.getElementById('impact-dialog').getBoundingClientRect(),t=document.getElementById('impact-table-region').getBoundingClientRect();return {focus:{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height},dialog:{left:d.left,right:d.right,top:d.top,bottom:d.bottom},table:{left:t.left,right:t.right,top:t.top,bottom:t.bottom},overflow:document.documentElement.scrollWidth>innerWidth}})()");
   assert.equal(geometry.overflow,false);const f=geometry.focus;assert.ok(f.width>0&&f.height>0&&f.left>=0&&f.right<=viewport.width&&f.top>=0&&f.bottom<=viewport.height,'restored focused button stays in viewport');assert.ok(f.left>=geometry.table.left&&f.right<=geometry.table.right&&f.top>=geometry.table.top&&f.bottom<=geometry.table.bottom,'focused button is not clipped by table scroller');
   const {data}=await send('Page.captureScreenshot',{format:'jpeg',quality:65,captureBeyondViewport:false});const bytes=Buffer.from(data,'base64');assert.ok(bytes.length<=1048576);await writeFile(path.join(output,name),bytes,{flag:'wx'});
   evidence.screenshots.push({file:name,sha256:hash(bytes),bytes:bytes.length,viewport,geometry,meaning:viewport.width===1600?'Unaltered restored comparison; app-restored focus visibility checked without harness scrolling. Visual review remains separate.':'Unaltered narrow capture after viewport resize and explicit harness recentering of the focused action; not proof of automatic resize scrolling. Visual review remains separate.'});
  };
  const captureNamed=async(name,viewport)=>{
   await until("document.getElementById('toast').hidden",'transient import toast naturally clears');
   await evaluate("document.getElementById('map-shell').scrollIntoView({block:'center'})");await frames();
   const geometry=await evaluate(`(()=>{const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};return {reference:rect('baseline-map'),candidate:rect('network-map'),controls:rect('named-replay-controls'),overflow:document.documentElement.scrollWidth>innerWidth}})()`);
   assert.equal(geometry.overflow,false);assert.ok(geometry.controls.top>=0,'comparison controls are visible');
   for(const pane of [geometry.reference,geometry.candidate])assert.ok(pane.width>0&&pane.height>0&&pane.left>=0&&pane.right<=viewport.width&&pane.top>=0&&pane.bottom<=viewport.height,'both painted maps are fully in view');
   const {data}=await send('Page.captureScreenshot',{format:'jpeg',quality:65,captureBeyondViewport:false});const bytes=Buffer.from(data,'base64');assert.ok(bytes.length<=1048576);await writeFile(path.join(output,name),bytes,{flag:'wx'});
   evidence.screenshots.push({file:name,sha256:hash(bytes),bytes:bytes.length,viewport,geometry,meaning:'Unaltered named replay at 15 seconds after harness scroll. Both rendered routes and both named controls are in view. Visual review is separate.'});
  };
  await send('Page.enable');await send('Runtime.enable');
  const desktop={width:1600,height:1100,deviceScaleFactor:1,mobile:false},narrow={...desktop,width:390};
  await send('Emulation.setDeviceMetricsOverride',desktop);await send('Page.addScriptToEvaluateOnNewDocument',{source:observation});
  await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});await until(documentReadyExpression,'initial render');await ready();await evaluate(rendererObservation);await frames();
  assert.deepEqual((await snapshot()).returnState,{hidden:true,disabled:true});check('Return action starts unavailable without a delivery journey');
  const meridian=path.join(root,'examples/meridian-experiment.json');await load(meridian);const r=report(meridian,'market-05');await open('market-05');
  await change('impact-search','job-0','input');await change('impact-sort','arrival-desc');await click('impact-next');
  const ranked=r.jobs.filter(j=>[j.id,j.vehicleId,j.nodeId].some(v=>v.toLowerCase().includes('job-0'))).sort((a,b)=>a.arrivalDeltaS===null?(b.arrivalDeltaS===null?0:1):b.arrivalDeltaS===null?-1:b.arrivalDeltaS-a.arrivalDeltaS);
  assert.ok(ranked.length>40);let saved=await snapshot();assert.deepEqual(saved.rows,ranked.slice(20,40).map(j=>j.id));assert.match(saved.status,/page 2 of/);
  let job=ranked[23];await jump(job,'variant');check('Searched ranked later-page delivery creates one return context without recomputation');
  await retain();await change('timeline','123','input');await change('vehicle-select','van-02');await frames();let before=await snapshot();assert.equal(before.maps['network-map'].time,123);assert.equal(before.maps['network-map'].vehicle,'van-02');
  await native('#impact-return','Enter');await restored(saved,job,'variant',before);assert.deepEqual(await evaluate('window.__deliveryReturn.trusted.at(-1)'),{id:'impact-return',trusted:true});check('Native Enter restores exact query, order, page and row focus while retaining newer replay perspective');
  await assertStale('Consumed return callback cannot reopen or change the restored comparison');
  await capture('delivery-return-desktop.jpg',desktop);await send('Emulation.setDeviceMetricsOverride',narrow);await capture('delivery-return-narrow.jpg',narrow);await send('Emulation.setDeviceMetricsOverride',desktop);check('Restored focused arrival action stays visible in desktop and narrow scroll regions');
  await jump(job,'baseline');await assertStale('Older return callback cannot consume or navigate a newer journey');await retain();before=await snapshot();await native('#impact-return','Space');await restored(saved,job,'baseline',before);assert.deepEqual(await evaluate('window.__deliveryReturn.trusted.at(-1)'),{id:'impact-return',trusted:true});check('A second journey returns to its own baseline action via trusted Space');
  await jump(job,'variant');await retain();await change('variant-select','clear-roads');await change('variant-select','market-05');await frames();assert.deepEqual((await snapshot()).returnState,{hidden:true,disabled:true});await assertStale('Switching variant away and back cannot revive discarded comparison context');
  await open();await change('impact-search','job-01-4','input');job=r.jobs.find(j=>j.id==='job-01-4');await jump(job,'variant');await retain();await click('impact-button');await frames();let fresh=await snapshot();assert.equal(fresh.query,'');assert.equal(fresh.sort,'input');assert.equal(fresh.filter,'changed');assert.deepEqual(fresh.returnState,{hidden:true,disabled:true});await assertStale('Ordinary inspector opening starts fresh and discards the saved return');
  await change('impact-filter','all');await change('impact-search','job-01-4','input');await jump(job,'baseline');await retain();await click('run-experiment');assert.deepEqual((await snapshot()).returnState,{hidden:true,disabled:true});await ready();await frames();await assertStale('Real Worker rerun permanently invalidates retained return callbacks');
  await open('market-10');await change('impact-reference','market-05');await change('impact-search','job-01-4','input');
  saved=await snapshot();assert.equal(saved.reference,'market-05');assert.equal(saved.candidate,'market-10');
  assert.equal(await evaluate("document.querySelectorAll('#impact-rows [data-impact-replay=baseline]').length"),1);
  const candidateJob=report(meridian,'market-10').jobs.find(j=>j.id==='job-01-4');
  const referenceJob=report(meridian,'market-05').jobs.find(j=>j.id===candidateJob.id);
  job={...candidateJob,baseline:referenceJob.variant};
  let named=await jump(job,'baseline','Enter');
  assert.equal(named.maps['baseline-map'].paintedPlan,'market-05');
  assert.equal(named.maps['network-map'].paintedPlan,'market-10');
  await change('timeline','123','input');await frames();before=await snapshot();
  await native('#impact-return','Enter');await restored(saved,job,'baseline',before);
  named=await jump(job,'variant','Space');
  assert.equal(named.maps['baseline-map'].paintedPlan,'market-05');
  assert.equal(named.maps['network-map'].paintedPlan,'market-10');
  before=await snapshot();await native('#impact-return','Enter');await restored(saved,job,'variant',before);
  check('Named reference and candidate arrivals use their own completed ledgers and restore exact row focus and later replay perspective');

  await click('impact-close');
  const tiny=path.join(root,'examples/minimal-experiment.json');
  await load(tiny);await open('close-at-11');await change('impact-reference','close-at-10');
  const tinyCandidate=report(tiny,'close-at-11').jobs[0],tinyRef=report(tiny,'close-at-10').jobs[0];
  assert.equal(tinyRef.variant.arrivalS,26);assert.equal(tinyCandidate.variant.arrivalS,20);
  named=await jump({...tinyCandidate,baseline:tinyRef.variant},'baseline','Enter');
  assert.equal(named.maps['baseline-map'].paintedPlan,'close-at-10');
  assert.equal(named.maps['network-map'].paintedPlan,'close-at-11');
  assert.deepEqual(named.maps['baseline-map'].closures,[{edge:'bc',at:10}]);
  assert.deepEqual(named.maps['network-map'].closures,[{edge:'bc',at:11}]);
  assert.deepEqual(named.maps['baseline-map'].paintedEdges,['ab','bd','dc']);
  assert.deepEqual(named.maps['network-map'].paintedEdges,['ab','bc']);
  assert.equal(await evaluate("document.getElementById('save-replay').disabled"),true);
  await change('replay-events-filter','closures');
  const schedule=await evaluate("Array.from(document.querySelectorAll('#replay-events-list button'),e=>[e.dataset.run,e.dataset.time])");
  assert.deepEqual(schedule,[['reference-schedule','10'],['candidate-schedule','11']]);
  await native('#replay-events-list button[data-run=reference-schedule]','Enter');
  assert.equal((await snapshot()).maps['network-map'].time,10);
  await change('timeline','15','input');await frames();named=await snapshot();
  assert.equal(named.maps['baseline-map'].time,15);assert.equal(named.maps['network-map'].time,15);
  const positions=await evaluate("Object.values(window.__deliveryReturn.maps).map(map=>map.vehiclePoints.find(v=>v.id==='van-1'))");
  assert.equal(positions.length,2);assert.ok(Math.abs(positions[0].y-positions[1].y)>5,'painted vehicle positions diverge');
  check('Both native maps paint their own closures and routes; both event sources seek the shared clock');
  await captureNamed('named-replay-desktop.jpg',desktop);
  await send('Emulation.setDeviceMetricsOverride',narrow);
  await captureNamed('named-replay-narrow.jpg',narrow);
  await send('Emulation.setDeviceMetricsOverride',desktop);
  check('Named controls and both painted maps fit desktop and narrow viewport captures');
  await native('#exit-named-replay','Enter');named=await snapshot();
  assert.equal(named.focus.id,'view-split');assert.equal(named.maps['baseline-map'].view,'baseline');
  assert.equal(named.maps['baseline-map'].time,15);assert.equal(named.maps['network-map'].time,15);
  assert.equal(named.returnState.hidden,false);
  assert.equal(await evaluate("document.getElementById('save-replay').disabled"),false);
  check('Restore clear-road replay retains the clock and return context and re-enables ordinary bookmarks');
  assert.deepEqual((await snapshot()).errors,[]);evidence.status='passed';
 }catch(error){evidence.status='failed';evidence.error=String(error.stack||error);throw error}
 finally{await finishBrowserEvidence(output,evidence,[async()=>{if(browser)await browser.close()},async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}},async()=>{if(temporary)await removeOwnedBrowserDirectory(temporary)}])}
 console.log(`Verified ${evidence.checks.length} delivery return checkpoints. Evidence: ${path.join(output,'evidence.json')}`);
}
if(import.meta.main){try{const options=parseBrowserCheckArguments(process.argv.slice(2));if(options)await runDeliveryReturnCheck(options);else console.log(usage)}catch(error){console.error(`DetourLab delivery return check: ${error.message}`);process.exitCode=1}}
