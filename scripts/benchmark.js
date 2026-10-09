import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { createDemoScenario } from '../src/scenario.js';
import { simulate } from '../src/engine.js';
const scenario=createDemoScenario(42);const samples=[];
for(let i=0;i<7;i++){const start=performance.now();simulate(scenario,{closures:[]});simulate(scenario);if(i>1)samples.push(performance.now()-start);}
samples.sort((a,b)=>a-b);
console.log(JSON.stringify({fixture:scenario.id,nodes:scenario.nodes.length,directedEdges:scenario.edges.length,vehicles:scenario.vehicles.length,jobs:scenario.jobs.length,node:process.version,platform:`${os.platform()} ${os.arch()}`,cpu:os.cpus()[0]?.model??'unknown',logicalCpus:os.cpus().length,warmupPairs:2,measuredPairs:samples.length,pairedRunMilliseconds:{min:+samples[0].toFixed(2),median:+samples[2].toFixed(2),max:+samples[4].toFixed(2)},note:'Two full simulations per pair. Shared cloud host; not a browser or universal performance promise.'},null,2));
