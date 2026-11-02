import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runReplayBookmarkCheck, usage } from '../tools/replay-bookmark-check/run.js';

test('replay-bookmark harness help describes local observation and explicit verification limits', () => {
  const result=spawnSync(process.execPath,['tools/replay-bookmark-check/run.js','--help'],{encoding:'utf8'});
  assert.equal(result.status,0); assert.equal(result.stdout.trim(),usage);
  assert.match(result.stdout,/Fresh local profile/); assert.match(result.stdout,/Not native-chooser/);
});
test('replay-bookmark harness rejects arguments before creating evidence', () => {
  const result=spawnSync(process.execPath,['tools/replay-bookmark-check/run.js','--browser','relative','--out','unused'],{encoding:'utf8'});
  assert.equal(result.status,1); assert.match(result.stderr,/absolute browser executable/);
});
test('replay-bookmark harness refuses to overwrite existing evidence output', async t => {
  const root=await mkdtemp(path.join(tmpdir(),'replay-check-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const output=path.join(root,'evidence');await mkdir(output);
  await assert.rejects(runReplayBookmarkCheck({executable:'/does/not/exist',output}),{code:'EEXIST'});
});
test('replay-bookmark harness retains failed evidence and cleans owned resources when launch fails', async t => {
  const root=await mkdtemp(path.join(tmpdir(),'replay-check-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const output=path.join(root,'evidence');
  await assert.rejects(runReplayBookmarkCheck({executable:'/does/not/exist',output}),/ENOENT/);
  const evidence=JSON.parse(await readFile(path.join(output,'evidence.json'),'utf8'));
  assert.equal(evidence.status,'failed');assert.match(evidence.error,/ENOENT/);assert.deepEqual(evidence.checks,[]);
  assert.ok(evidence.completedAt);assert.ok(evidence.sourceFiles.some(file=>file.path==='src/app.js'));
});
