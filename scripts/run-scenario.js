#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { parseScenario, createDemoScenario } from '../src/scenario.js';
import { simulate } from '../src/engine.js';
import { formatInputError } from '../src/file-input.js';
import { readInput } from './read-input.js';

const usage = `DetourLab scenario runner\n\nUsage: node scripts/run-scenario.js [scenario.json] [options]\n\n  --json                         Machine-readable deterministic result\n  --max-extra-distance-pct N      Fail if distance grows more than N percent\n  --max-extra-late N              Fail if additional late jobs exceed N\n  --max-unreachable N             Fail if disrupted unreachable jobs exceed N\n  --help                         Show this help\n\nNo file supplied: original seed-42 demonstration. Threshold failures exit 1;\ninvalid input exits 2. Runs remain fixed-sequence simulations, not VRP solutions.`;
function canonical(value) { if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value); }
try {
  const args=process.argv.slice(2);if(args.includes('--help')){console.log(usage);process.exit(0);}
  let file, json=false;const limits={};
  const supported={'--max-extra-distance-pct':'extraDistancePct','--max-extra-late':'extraLateJobs','--max-unreachable':'unreachableJobs'};
  for(let i=0;i<args.length;i++){const arg=args[i];if(arg==='--json'){json=true;continue;}if(supported[arg]){const raw=args[++i],value=Number(raw);if(raw===undefined||raw.trim()===''||!Number.isFinite(value)||value<0)throw new Error(`${arg} requires a finite nonnegative number`);limits[supported[arg]]=value;continue;}if(arg.startsWith('-'))throw new Error(`Unknown option: ${arg}`);if(file)throw new Error('Only one scenario file is allowed');file=arg;}
  const scenario=file?parseScenario(await readInput(file)):createDemoScenario(42);
  const baseline=simulate(scenario,{closures:[]}),disrupted=simulate(scenario);
  const delta={distanceM:Number((disrupted.metrics.distanceM-baseline.metrics.distanceM).toFixed(6)),extraDistancePct:baseline.metrics.distanceM?Number(((disrupted.metrics.distanceM-baseline.metrics.distanceM)/baseline.metrics.distanceM*100).toFixed(6)):0,extraLateJobs:disrupted.metrics.lateJobs-baseline.metrics.lateJobs,unreachableJobs:disrupted.metrics.unreachableJobs};
  const violations=Object.entries(limits).filter(([key,value])=>delta[key]>value).map(([key,limit])=>({metric:key,actual:delta[key],limit}));
  const result={engineVersion:'0.1.0',scenarioId:scenario.id,scenarioSha256:createHash('sha256').update(canonical(scenario)).digest('hex'),seed:scenario.seed,baseline:baseline.metrics,disrupted:disrupted.metrics,delta,thresholds:limits,passed:violations.length===0,violations};
  if(json)console.log(JSON.stringify(result,null,2));else{console.log(`\nDETOURLAB / ${scenario.name}\nScenario ${scenario.id} · seed ${scenario.seed}\nSHA-256 ${result.scenarioSha256}\n`);console.log(`                        Baseline      Disrupted\nFleet distance          ${(baseline.metrics.distanceM/1000).toFixed(2).padStart(8)} km   ${(disrupted.metrics.distanceM/1000).toFixed(2).padStart(8)} km\nLate jobs               ${String(baseline.metrics.lateJobs).padStart(8)}      ${String(disrupted.metrics.lateJobs).padStart(8)}\nUnreachable jobs        ${String(baseline.metrics.unreachableJobs).padStart(8)}      ${String(disrupted.metrics.unreachableJobs).padStart(8)}\nCompleted jobs          ${String(baseline.metrics.completedJobs).padStart(8)}      ${String(disrupted.metrics.completedJobs).padStart(8)}\n`);console.log(violations.length?`FAIL: ${violations.map(v=>`${v.metric} ${v.actual} > ${v.limit}`).join('; ')}`:'PASS: all requested thresholds met');console.log('Synthetic / fixed travel times / assigned order retained / arrival deadlines.');}
  if(violations.length)process.exitCode=1;
}catch(error){console.error(`DetourLab: ${formatInputError(error)}`);process.exitCode=2;}
