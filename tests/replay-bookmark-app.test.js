import test from 'node:test';
import assert from 'node:assert/strict';
import { application, deferredFile } from './helpers/application.js';
import { createTutorialExperiment } from '../src/tutorial.js';
import { exportReplayBookmark } from '../src/replay-bookmark.js';
const perspective = { variantId: 'close-at-10', vehicleId: 'van-1', timeS: 20.5, view: 'split', zoom: 1.2 };
const file = (changes = {}) => new Blob([exportReplayBookmark(createTutorialExperiment(), { ...perspective, ...changes })]);
const open = (app, value = file()) => app.element('replay-input').emit('change', { target: { files: [value], value: 'file' } });
test('bookmark recomputes then restores exact paused perspective, without another Worker', async () => {
 const app=application();app.latestWorker().respond();await open(app);
 assert.equal(app.state.pending,true);assert.equal(app.state.time,0);assert.equal(app.element('save-replay').disabled,true);
 const count=app.posted.length;app.latestWorker().respond();
 assert.equal(app.posted.length,count);assert.equal(app.state.time,20.5);assert.equal(app.state.zoom,1.2);assert.equal(app.state.view,'split');assert.equal(app.state.selectedVehicle,'van-1');assert.equal(app.state.playing,false);assert.equal(app.element('save-replay').disabled,false);assert.match(app.element('replay-status').textContent,/paused at 20.5/);
});
test('bookmark time is clamped after computing with explicit notice and null selection', async()=>{
 const app=application();await open(app,file({timeS:999999,vehicleId:null}));app.latestWorker().respond();
 assert.equal(app.state.time,Number(app.element('timeline').max));assert.equal(app.state.selectedVehicle,null);assert.match(app.element('replay-status').textContent,/clamped/);assert.equal(app.element('job-list').children.length,0);
});
test('invalid bookmark preserves current experiment and results',async()=>{
 const app=application();app.latestWorker().respond();const experiment=app.state.experiment,results=app.state.allResults;
 await open(app,new Blob(['{"format":"wrong"}']));assert.equal(app.state.experiment,experiment);assert.equal(app.state.allResults,results);assert.match(app.element('replay-status').textContent,/rejected/);
});
for(const control of ['view-baseline','zoom-in','replay-button']) test(`newer ${control} navigation cancels pending restore`,async()=>{
 const app=application();await open(app);app.element(control).click();const view=app.state.view,zoom=app.state.zoom;app.latestWorker().respond();assert.equal(app.state.view,view);assert.equal(app.state.zoom,zoom);assert.notEqual(app.state.time,20.5);
});
test('canceled bookmark worker cannot restore even if it replies late',async()=>{
 const app=application();await open(app);const worker=app.latestWorker();app.element('cancel-run').click();worker.respond();assert.equal(app.state.allResults,null);assert.equal(app.state.time,0);assert.equal(app.state.playing,false);
});
test('older bookmark read cannot replace newer experiment import',async()=>{
 const app=application(),held=deferredFile();const waiting=open(app,held.file);await app.importExperiment(createTutorialExperiment());const experiment=app.state.experiment;held.resolve(await file().arrayBuffer());await waiting;assert.equal(app.state.experiment,experiment);app.latestWorker().respond();assert.notEqual(app.state.time,20.5);
});
test('navigation during file read preserves workspace',async()=>{
 const app=application(),held=deferredFile(),original=app.state.experiment;const waiting=open(app,held.file);app.element('view-baseline').click();held.resolve(await file().arrayBuffer());await waiting;assert.equal(app.state.experiment,original);assert.match(app.element('replay-status').textContent,/canceled/);
});
test('repeated bookmark imports restore only the latest perspective',async()=>{
 const app=application();await open(app);const old=app.latestWorker();await open(app,file({timeS:11,view:'compare'}));old.respond();app.latestWorker().respond();assert.equal(app.state.time,11);assert.equal(app.state.view,'compare');
});
test('saving serializes input plus exact perspective, never Worker results',async t=>{
 const app=application();await open(app);app.latestWorker().respond();let blob;
 t.mock.method(URL,'createObjectURL',value=>{blob=value;return 'blob:synthetic';});
 app.element('save-replay').click();const saved=JSON.parse(await blob.text());
 assert.deepEqual(saved.perspective,perspective);assert.deepEqual(Object.keys(saved).sort(),['experiment','format','perspective','version']);assert.match(app.element('replay-status').textContent,/download requested/);
});
test('worker error cannot report a restored replay',async()=>{
 const app=application();await open(app);app.latestWorker().respond({error:'Synthetic failure'});
 assert.equal(app.state.allResults,null);assert.equal(app.element('save-replay').disabled,true);assert.match(app.element('replay-status').textContent,/failed/);assert.equal(app.state.time,0);
});
test('bookmark controls are disabled in lesson and recover on return',()=>{
 const app=application();app.latestWorker().respond();app.element('try-example-button').click();app.element('lesson-start').click();app.latestWorker().respond();assert.equal(app.element('save-replay').disabled,true);assert.equal(app.element('open-replay').disabled,true);app.element('return-experiment').click();app.latestWorker().respond();assert.equal(app.element('save-replay').disabled,false);assert.equal(app.element('open-replay').disabled,false);
});
test('reset supersedes a pending bookmark restoration',async()=>{
 const app=application();await open(app);const old=app.latestWorker();app.element('reset-button').click();old.respond();app.latestWorker().respond();assert.equal(app.state.view,'disruption');assert.equal(app.state.time,0);assert.notEqual(app.state.experiment.id,createTutorialExperiment().id);
});

test('road editing mode chosen during pending restore preserves newer workspace perspective',async()=>{
 const app=application();await open(app);app.element('edit-roads').click();assert.equal(app.state.editing,true);const view=app.state.view,zoom=app.state.zoom;app.latestWorker().respond();assert.equal(app.state.editing,true);assert.equal(app.state.view,view);assert.equal(app.state.zoom,zoom);assert.notEqual(app.state.time,20.5);assert.match(app.element('replay-status').textContent,/newer navigation/);
});

test('variant result card cancels pending perspective and updates replay status',async()=>{
 const app=application();await open(app);app.element('variant-results').children.find(card=>card.dataset.variant==='clear').click();app.latestWorker().respond();assert.equal(app.state.selectedVariantId,'clear');assert.notEqual(app.state.time,20.5);assert.match(app.element('replay-status').textContent,/newer navigation/);
});
test('variant result card supersedes a delayed bookmark read',async()=>{
 const app=application();await app.importExperiment(createTutorialExperiment());app.latestWorker().respond();const held=deferredFile(),original=app.state.experiment;const waiting=open(app,held.file);app.element('variant-results').children.find(card=>card.dataset.variant==='close-at-11').click();held.resolve(await file().arrayBuffer());await waiting;assert.equal(app.state.experiment,original);assert.equal(app.state.selectedVariantId,'close-at-11');
});
