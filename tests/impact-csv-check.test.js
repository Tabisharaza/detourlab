import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runImpactCsvCheck, usage, parseCsv, verifyRows, dispatchImpactExportKey } from '../tools/impact-csv-check/run.js';

test('impact-csv harness help describes local observation and explicit verification limits', () => {
  const result=spawnSync(process.execPath,['tools/impact-csv-check/run.js','--help'],{encoding:'utf8'});
  assert.equal(result.status,0); assert.equal(result.stdout.trim(),usage);
  assert.match(result.stdout,/Fresh local profile/); assert.match(result.stdout,/Not native-chooser/);
});
test('impact-csv harness rejects arguments before creating evidence', () => {
  const result=spawnSync(process.execPath,['tools/impact-csv-check/run.js','--browser','relative','--out','unused'],{encoding:'utf8'});
  assert.equal(result.status,1); assert.match(result.stderr,/absolute browser executable/);
});
test('impact-csv harness refuses to overwrite existing evidence output', async t => {
  const root=await mkdtemp(path.join(tmpdir(),'impact-csv-check-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const output=path.join(root,'evidence');await mkdir(output);
  await writeFile(path.join(output,'evidence.json'),'existing evidence');
  await assert.rejects(runImpactCsvCheck({executable:'/does/not/exist',output}),{code:'EEXIST'});
  assert.equal(await readFile(path.join(output,'evidence.json'),'utf8'),'existing evidence');
  assert.deepEqual(await readdir(output),['evidence.json']);
});
test('impact-csv harness retains failed evidence and cleans owned resources when launch fails', async t => {
  const root=await mkdtemp(path.join(tmpdir(),'impact-csv-check-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const output=path.join(root,'evidence');
  await assert.rejects(runImpactCsvCheck({executable:'/does/not/exist',output}),/ENOENT/);
  const evidence=JSON.parse(await readFile(path.join(output,'evidence.json'),'utf8'));
  assert.equal(evidence.status,'failed');assert.match(evidence.error,/ENOENT/);assert.deepEqual(evidence.checks,[]);
  assert.ok(evidence.sourceFiles.some(file=>file.path==='tools/replay-events-check/run.js' && /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.ok(evidence.completedAt);assert.ok(evidence.sourceFiles.some(file=>file.path==='src/app.js'));
});

test('independent CSV parser preserves quoted commas, quotes, multiline cells and blank nulls', () => {
  assert.deepEqual(parseCsv('id,name,time\r\na,"=SUM(1,2) ""quoted""\r\ncafé",\r\n'), [
    ['id','name','time'], ['a','=SUM(1,2) "quoted"\r\ncafé',''],
  ]);
  assert.deepEqual(parseCsv('id,name\r\n'), [['id','name']]);
  assert.throws(() => parseCsv('"unfinished'), /unterminated/);
});

test('independent JSON row verification checks every field and unreachable blanks, not just row counts', () => {
  const header = 'experimentId,variantId,variantName,jobId,vehicleId,nodeId,dueTimeS,baselineStatus,baselineArrivalS,baselineCompletedS,baselineDelayS,variantStatus,variantArrivalS,variantCompletedS,variantDelayS,arrivalDeltaS,completedDeltaS,delayDeltaS,changed,statusChanged';
  const report = { experimentId:'tiny',variant:{id:'blocked',name:'@blocked'},jobs:[{
    id:'job-1',vehicleId:'van-1',nodeId:'C',dueTimeS:22,
    baseline:{status:'on-time',arrivalS:20,completedS:23,delayS:0},
    variant:{status:'unreachable',arrivalS:null,completedS:null,delayS:null},
    arrivalDeltaS:null,completedDeltaS:null,delayDeltaS:null,changed:true,statusChanged:true,
  }] };
  const rows = parseCsv(`${header}\r\ntiny,blocked,'@blocked,job-1,van-1,C,22,on-time,20,23,0,unreachable,,,,,,,true,true\r\n`);
  verifyRows(rows,report);
  rows[1][12] = '0'; assert.throws(() => verifyRows(rows,report));
  verifyRows([header.split(',')],{...report,jobs:[]});
});


test('impact export keyboard uses text-bearing native Enter and Space sequences after focus', async () => {
  for (const [key, character, codepoint] of [['Enter', '\r', 13], ['Space', ' ', 32]]) {
    const calls = [];
    await dispatchImpactExportKey(async (method, event) => calls.push({method,event}), async expression => calls.push({expression}), key);
    assert.deepEqual(calls, [
      {expression: "document.getElementById('impact-download-csv').focus()"},
      {method:'Input.dispatchKeyEvent',event:{type:'keyDown',key:key==='Space'?' ':key,code:key,windowsVirtualKeyCode:codepoint,text:character,unmodifiedText:character}},
      {method:'Input.dispatchKeyEvent',event:{type:'keyUp',key:key==='Space'?' ':key,code:key,windowsVirtualKeyCode:codepoint}},
    ]);
  }
});
