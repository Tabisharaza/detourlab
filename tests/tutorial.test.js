import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTutorialExperiment } from '../src/tutorial.js';
import { validateExperiment, simulateExperiment } from '../src/experiment.js';

const fixture = JSON.parse(readFileSync(new URL('../examples/minimal-experiment.json', import.meta.url), 'utf8'));

test('tutorial factory is byte-equivalent JSON data to the canonical validated fixture', () => {
  const example = createTutorialExperiment();
  assert.equal(JSON.stringify(example), JSON.stringify(fixture));
  assert.deepEqual(validateExperiment(example), validateExperiment(fixture));
  assert.equal(example.id, 'minimal-cutoff-experiment');
  assert.deepEqual(example.variants.map(variant => variant.id), ['clear', 'close-at-10', 'close-at-11']);
});

test('tutorial factory creates independent nested objects and closure schedules', () => {
  const first = createTutorialExperiment(), second = createTutorialExperiment();
  first.baseScenario.nodes[0].x = 999;
  first.baseScenario.vehicles[0].id = 'changed';
  first.baseScenario.jobs[0].dueTimeS = 1;
  first.variants[1].closures[0].edgeIds.push('ab');
  assert.deepEqual(second, fixture);
  assert.deepEqual(first.variants[2].closures[0].edgeIds, ['bc']);
  assert.deepEqual(createTutorialExperiment(), fixture);
});

test('tutorial computed ledgers prove cutoff equality, already-entered travel, and service time', () => {
  const result = simulateExperiment(createTutorialExperiment());
  for (const [id, distance, arrival, finish, late, edges] of [
    ['clear', 200, 20, 23, 0, ['ab', 'bc']],
    ['close-at-10', 260, 26, 29, 1, ['ab', 'bd', 'dc']],
    ['close-at-11', 200, 20, 23, 0, ['ab', 'bc']],
  ]) {
    const outcome = result.variants.find(variant => variant.id === id).result;
    assert.equal(outcome.metrics.distanceM, distance); assert.equal(outcome.metrics.lateJobs, late);
    assert.equal(outcome.metrics.completedJobs, 1); assert.equal(outcome.metrics.unreachableJobs, 0);
    const vehicle = outcome.vehicles[0];
    assert.deepEqual(vehicle.segments.map(segment => segment.edgeId), edges);
    assert.equal(vehicle.jobs[0].arrivalS, arrival); assert.equal(vehicle.finishS, finish);
  }
});
