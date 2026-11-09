import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { application, deferredFile } from './helpers/application.js';
import { exportReplayBookmark } from '../src/replay-bookmark.js';
const fixture = (name='minimal-experiment.json') => JSON.parse(readFileSync(new URL(`../examples/${name}`,import.meta.url),'utf8'));
async function ready(input=fixture(), options={}, variant='close-at-10') {
 const app=application(options); await app.importExperiment(input); assert.equal(app.state.experiment.id,input.id); app.latestWorker().respond();
 await app.change('variant-select',variant); await app.element('impact-button').click(); return app;
}
const buttons=app=>app.element('impact-rows').querySelectorAll('button');
const action=app=>buttons(app).find(b=>b.dataset.impactReplay==='variant');
const view=app=>({time:app.state.time,vehicle:app.state.selectedVehicle,variant:app.state.selectedVariantId,view:app.state.view,zoom:app.state.zoom});
const visible=app=>app.element('impact-rows').children.map(row=>row.children[0].children[0].textContent);
const savedCallback=app=>app.element('impact-return').listeners.click.at(-1);
const unavailable=app=>{assert.equal(app.element('impact-return').hidden,true);assert.equal(app.element('impact-return').disabled,true);assert.equal(app.element('impact-return').listeners.click?.length??0,0);};
// Application handlers with stand-ins; native focus/scroll is a separate gate.
test('return starts unavailable and a searched ranked later page restores row focus without rewinding replay', async()=>{
 const app=await ready(fixture('meridian-experiment.json'),{},'market-05'); unavailable(app);
 await app.change('impact-filter','all');await app.change('impact-search','job-0','input');await app.change('impact-sort','arrival-desc');await app.element('impact-next').click();
 const ids=visible(app),origin=action(app),job=origin.dataset.jobId,side=origin.dataset.impactReplay;
 const input=app.state.experiment,results=app.state.allResults,workers=app.posted.length,history=app.element('history-status').textContent;
 await origin.click();assert.equal(app.element('impact-return').hidden,false);
 await app.change('timeline','713.25','input');await app.change('vehicle-select','van-02');await app.element('zoom-in').click();const current=view(app);
 await app.element('impact-return').click();
 assert.equal(app.element('impact-dialog').open,true);assert.deepEqual(view(app),current);assert.equal(app.state.playing,false);
 assert.equal(app.element('impact-filter').value,'all');assert.equal(app.element('impact-search').value,'job-0');assert.equal(app.element('impact-sort').value,'arrival-desc');assert.deepEqual(visible(app),ids);
 assert.equal(app.document.activeElement.dataset.jobId,job);assert.equal(app.document.activeElement.dataset.impactReplay,side);
 assert.equal(app.state.experiment,input);assert.equal(app.state.allResults,results);assert.equal(app.posted.length,workers);assert.equal(app.element('history-status').textContent,history);unavailable(app);
});
test('normal Inspect deliveries starts fresh and consumes the previous journey',async()=>{
 const app=await ready();await app.change('impact-filter','all');await app.change('impact-search','job','input');await app.change('impact-sort','arrival-desc');await action(app).click();const old=savedCallback(app);
 await app.element('impact-button').click();assert.equal(app.element('impact-filter').value,'changed');assert.equal(app.element('impact-search').value,'');assert.equal(app.element('impact-sort').value,'input');unavailable(app);
 await app.element('impact-close').click();old();assert.equal(app.element('impact-dialog').open,false);
});
test('return is one-use and an old listener cannot hijack a newer journey',async()=>{
 const app=await ready();await action(app).click();const old=savedCallback(app);await app.element('impact-return').click();unavailable(app);
 old();assert.equal(app.element('impact-dialog').open,true);await action(app).click();const second=savedCallback(app);assert.notEqual(old,second);assert.equal(app.element('impact-return').listeners.click.length,1);
 old();assert.equal(app.element('impact-dialog').open,false);assert.equal(app.element('impact-return').hidden,false);
 second();assert.equal(app.element('impact-dialog').open,true);unavailable(app);
 await app.element('impact-close').click();second();assert.equal(app.element('impact-dialog').open,false);
});
for(const [name,change] of [
 ['variant change and back',async app=>{await app.change('variant-select','close-at-11');await app.change('variant-select','close-at-10')}],
 ['edit',async app=>{await app.change('variant-name','New name');await app.element('rename-variant').click()}],
 ['import',app=>app.importExperiment(fixture())],
 ['rerun',app=>app.element('run-experiment').click()],
 ['cancel',app=>app.element('cancel-run').emit('click')],
 ['reset',app=>app.element('reset-button').click()],
 ['completed new run',async app=>{await app.element('run-experiment').click();app.latestWorker().respond()}],
 ['lesson',async app=>{await app.element('try-example-button').click();await app.element('lesson-start').click()}],
 ])test(`return invalidates after ${name} and retained listener cannot reopen`,async()=>{
 const app=await ready();await action(app).click();const old=savedCallback(app);await change(app);unavailable(app);const before=view(app),workers=app.posted.length;old();assert.equal(app.element('impact-dialog').open,false);assert.deepEqual(view(app),before);assert.equal(app.posted.length,workers);
});
test('same variant selection and ordinary replay navigation preserve the comparison',async()=>{
 const app=await ready();await action(app).click();await app.change('variant-select','close-at-10');await app.change('timeline','10.5','input');await app.element('view-baseline').click();
 assert.equal(app.element('impact-return').hidden,false);const current=view(app);await app.element('impact-return').click();assert.deepEqual(view(app),current);
});
test('invalidation moves focus off the return button before hiding it',async()=>{
 const app=await ready();await action(app).click();app.element('impact-return').focus();await app.change('variant-select','close-at-11');unavailable(app);assert.notEqual(app.document.activeElement,app.element('impact-return'));assert.equal(app.document.activeElement.isConnected,true);
});
test('delayed native close cannot steal focused restored row',async()=>{
 const app=await ready(fixture(),{deferDialogClose:true});await action(app).click();await app.element('impact-return').click();const focused=app.document.activeElement;await app.flushDialogCloseEvents();assert.equal(app.element('impact-dialog').open,true);assert.equal(app.document.activeElement,focused);assert.equal(focused.dataset.jobId,'job-1');
});
test('return supersedes a delayed bookmark read without replacing workspace',async()=>{
 const app=await ready();await action(app).click();const held=deferredFile(),input=app.state.experiment;
 const opening=app.element('replay-input').emit('change',{target:{files:[held.file],value:'file'}});await app.element('impact-return').click();
 held.resolve(new TextEncoder().encode(exportReplayBookmark(fixture(),{variantId:'close-at-11',vehicleId:'van-1',timeS:4.5,view:'baseline',zoom:1})).buffer);await opening;
 assert.equal(app.state.experiment,input);assert.equal(app.element('impact-dialog').open,true);assert.equal(app.state.time,26);
});
test('successful bookmark import invalidates return',async()=>{
 const app=await ready();await action(app).click();const old=savedCallback(app);
 const data=exportReplayBookmark(fixture(),{variantId:'close-at-11',vehicleId:'van-1',timeS:4.5,view:'baseline',zoom:1});
 await app.element('replay-input').emit('change',{target:{files:[new Blob([data])],value:'file'}});unavailable(app);old();assert.equal(app.element('impact-dialog').open,false);
});

test('restored comparison CSV still includes every original-order job',async()=>{
 let exported;
 const app=await ready(fixture('meridian-experiment.json'),{impactCsvBuilder(report){exported=report;return 'synthetic encoder observation';}},'market-05');
 await app.change('impact-filter','all');await app.change('impact-search','job-0','input');await app.change('impact-sort','arrival-desc');await app.element('impact-next').click();await action(app).click();await app.element('impact-return').click();await app.element('impact-download-csv').click();
 assert.deepEqual(exported.jobs.map(job=>job.id),app.state.experiment.baseScenario.jobs.map(job=>job.id));assert.equal(exported.jobs.length,192);
});

test('rejected import leaves completed return context intact',async()=>{
 const app=await ready();await action(app).click();await app.importFile(new Blob(['not json']));
 assert.equal(app.element('impact-return').hidden,false);await app.element('impact-return').click();assert.equal(app.element('impact-dialog').open,true);assert.equal(app.document.activeElement.dataset.jobId,'job-1');
});
