import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
function run(...args){return spawnSync(process.execPath,['scripts/run-scenario.js',...args],{cwd:root,encoding:'utf8'});}
test('CLI reports deterministic paired metrics and scenario hash',()=>{const a=run('examples/meridian-default.json','--json'),b=run('examples/meridian-default.json','--json');assert.equal(a.status,0,a.stderr);assert.equal(a.stdout,b.stdout);const result=JSON.parse(a.stdout);assert.equal(result.baseline.distanceM,311800);assert.equal(result.disrupted.distanceM,377080);assert.equal(result.disrupted.lateJobs,118);assert.match(result.scenarioSha256,/^[a-f0-9]{64}$/);});
test('CLI fails regression thresholds without hiding output',()=>{const result=run('examples/meridian-default.json','--json','--max-extra-late','0');assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).passed,false);});
test('CLI passes acceptable bounded regression thresholds',()=>{const result=run('examples/meridian-default.json','--json','--max-extra-distance-pct','25','--max-extra-late','120','--max-unreachable','0');assert.equal(result.status,0,result.stderr);});
test('CLI rejects malformed arguments and missing files with exit 2',()=>{for(const args of [['--unknown'],['--max-unreachable','NaN'],['--max-extra-late','-2'],['--max-extra-distance-pct'],['missing.json'],['a.json','b.json']])assert.equal(run(...args).status,2);});
test('CLI runs the included minimal directed scenario',()=>{const result=run('examples/minimal-directed.json','--json');assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).seed,1);});
