import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { documentReadyExpression } from '../tools/browser-check/run.js';

test('native harness readiness tolerates the pre-document navigation interval', () => {
  assert.equal(runInNewContext(documentReadyExpression, { document: { documentElement: null } }), false);
});
test('native harness readiness waits for explicit completed application state', () => {
  for (const ready of [undefined, 'false', true]) {
    assert.equal(runInNewContext(documentReadyExpression, { document: { documentElement: { dataset: { ready } } } }), false);
  }
});
test('native harness readiness accepts only the app ready marker', () => {
  assert.equal(runInNewContext(documentReadyExpression, { document: { documentElement: { dataset: { ready: 'true' } } } }), true);
});
