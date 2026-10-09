import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { parseExperiment, simulateExperiment } from '../src/experiment.js';

async function workerRequest(experiment, id) {
  const script = `const {parentPort} = require('node:worker_threads'); globalThis.self = { postMessage: data => parentPort.postMessage(data) }; import(${JSON.stringify(new URL('../src/simulation-worker.js', import.meta.url).href)}).then(() => parentPort.on('message', data => self.onmessage({data})));`;
  const worker = new Worker(script, {eval:true});
  try { const result = once(worker, 'message'); worker.postMessage({id,experiment}); return (await result)[0]; }
  finally { await worker.terminate(); }
}
test('actual worker protocol returns identical baseline and all variant ledgers', async () => {
  const experiment = parseExperiment(await readFile(new URL('../examples/minimal-directed.json', import.meta.url), 'utf8'));
  assert.deepEqual(await workerRequest(experiment, 41), {id:41,...simulateExperiment(experiment)});
});
test('actual worker protocol returns a bounded failure and no partial results', async () => {
  const result = await workerRequest({format:'detourlab-experiment', version:1}, 42);
  assert.equal(result.id,42);assert.equal(typeof result.error,'string');assert.equal(result.baseline,undefined);assert.equal(result.variants,undefined);
});
