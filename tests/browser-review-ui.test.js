import test from 'node:test';
import assert from 'node:assert/strict';
import { application, deferredFile } from './helpers/application.js';

const files = { bundleJson: '{"complete":true}\n', reviewMarkdown: '# Complete review\n' };
function ready(options = {}) { const app = application(options); app.latestWorker().respond(); return app; }

test('review is unavailable until a complete run and during recomputation', async () => {
  const app = application({ reviewBuilder: async () => files });
  assert.equal(app.element('review-button').disabled, true);
  app.latestWorker().respond();
  assert.equal(app.element('review-button').disabled, false);
  await app.element('run-experiment').click();
  assert.equal(app.element('review-button').disabled, true);
  await app.element('cancel-run').click();
  assert.equal(app.element('review-button').disabled, true);
});

test('review uses exact completed results, describes policy honestly, and downloads separately', async () => {
  let captured;
  const app = ready({ reviewBuilder: async (...args) => { captured = args; return files; } });
  const count = app.workers.length;
  app.element('review-button').focus();
  await app.element('review-button').click();
  assert.equal(captured[0], app.state.experiment);
  assert.equal(captured[1], app.state.allResults);
  assert.equal(app.workers.length, count);
  assert.equal(app.document.activeElement, app.element('review-dialog-title'));
  assert.match(app.element('review-status').textContent, /Acceptance: not evaluated/);
  assert.equal(app.element('download-review').disabled, false);
  assert.equal(app.created.filter(el => el.tagName === 'A').length, 0);
  await app.element('download-review').click();
  await app.element('download-bundle').click();
  const links = app.created.filter(el => el.tagName === 'A');
  assert.deepEqual(links.map(el => el.download), ['REVIEW.md', 'bundle.json']);
  assert.equal(await (await fetch(links[0].href)).text(), files.reviewMarkdown);
  assert.equal(await (await fetch(links[1].href)).text(), files.bundleJson);
  await app.element('review-close').click();
  assert.equal(app.element('review-dialog').open, false);
  assert.equal(app.document.activeElement, app.element('review-button'));
});

test('changed experiment invalidates prepared downloads', async () => {
  const app = ready({ reviewBuilder: async () => files });
  await app.element('review-button').click();
  await app.element('duplicate-variant').click();
  assert.equal(app.element('download-bundle').disabled, true);
  await app.element('download-bundle').click();
  assert.equal(app.created.filter(el => el.tagName === 'A').length, 0);
});

test('late report preparation cannot attach to a new run', async () => {
  let resolve;
  const app = ready({ reviewBuilder: () => new Promise(done => { resolve = done; }) });
  const opening = app.element('review-button').click();
  await app.element('run-experiment').click(); app.latestWorker().respond();
  resolve(files); await opening;
  assert.equal(app.element('download-review').disabled, true);
  assert.match(app.element('review-status').textContent, /Results changed/);
});

test('escape discards a pending review and restores focus', async () => {
  let resolve;
  const app = ready({ reviewBuilder: () => new Promise(done => { resolve = done; }) });
  app.element('review-button').focus();
  const opening = app.element('review-button').click();
  await app.element('review-dialog').escape();
  resolve(files); await opening;
  assert.equal(app.element('download-bundle').disabled, true);
  assert.equal(app.document.activeElement, app.element('review-button'));
});

test('preparation failure offers a bounded fallback without enabling downloads', async () => {
  const app = ready({ reviewBuilder: async () => { throw new Error('Review exceeds size limit.'); } });
  await app.element('review-button').click();
  assert.match(app.element('review-status').textContent, /Review exceeds size limit/);
  assert.match(app.element('review-status').textContent, /CLI/);
  assert.equal(app.element('download-review').disabled, true);
});

test('review modal does not consume the background playback shortcut', async () => {
  const app = ready({ reviewBuilder: async () => files });
  await app.element('review-button').click();
  const event = app.windowEvent('keydown', { code: 'Space' });
  assert.equal(app.state.playing, false);
  assert.equal(event.defaultPrevented, false);
});

test('forced stale download dispatch is rejected even outside native disabled handling', async () => {
  const app = ready({ reviewBuilder: async () => files });
  await app.element('review-button').click();
  await app.element('run-experiment').click();
  await app.element('download-bundle').emit('click');
  assert.equal(app.created.filter(el => el.tagName === 'A').length, 0);
});

test('older completion or rejection cannot replace a reopened review', async () => {
  for (const rejectOld of [false, true]) {
    let resolve, reject, calls = 0;
    const app = ready({ reviewBuilder: () => ++calls === 1 ? new Promise((yes, no) => { resolve = yes; reject = no; }) : Promise.resolve(files) });
    const first = app.element('review-button').click();
    await app.element('review-close').click();
    await app.element('review-button').click();
    const readyMessage = app.element('review-status').textContent;
    if (rejectOld) reject(new Error('Old failure')); else resolve({ bundleJson: 'stale', reviewMarkdown: 'stale' });
    await first;
    assert.equal(app.element('review-status').textContent, readyMessage);
    await app.element('download-review').click();
    const link = app.created.find(el => el.tagName === 'A');
    assert.equal(await (await fetch(link.href)).text(), files.reviewMarkdown);
  }
});

test('review keyboard containment includes only enabled visible controls', async () => {
  let resolve;
  const app = ready({ reviewBuilder: () => new Promise(done => { resolve = done; }) });
  const opening = app.element('review-button').click();
  await app.element('review-dialog').emit('keydown', { key: 'Tab' });
  assert.equal(app.document.activeElement, app.element('review-close'));
  resolve(files); await opening;
  await app.element('review-dialog').emit('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(app.document.activeElement, app.element('download-bundle'));
  await app.element('review-dialog').emit('keydown', { key: 'Tab' });
  assert.equal(app.document.activeElement, app.element('review-close'));
});

test('a delayed valid import invalidates an already prepared review', async () => {
  const app = ready({ reviewBuilder: async () => files });
  const pending = deferredFile();
  const importing = app.importFile(pending.file);
  await app.element('review-button').click();
  pending.resolve(new TextEncoder().encode(JSON.stringify(app.latestExperiment())).buffer);
  await importing;
  assert.equal(app.element('download-review').disabled, true);
  assert.equal(app.element('review-button').disabled, true);
  await app.element('download-review').emit('click');
  assert.equal(app.created.filter(el => el.tagName === 'A').length, 0);
});

test('failed and timed-out workers never enable review', async () => {
  for (const fail of ['message', 'error', 'timeout']) {
    const app = application({ reviewBuilder: async () => files });
    if (fail === 'message') app.latestWorker().respond({ error: 'Failed run' });
    else if (fail === 'error') app.latestWorker().fail();
    else [...app.timers.values()].find(timer => timer.delay === 30000).callback();
    assert.equal(app.element('review-button').disabled, true);
    await app.element('review-button').emit('click');
    assert.equal(Boolean(app.element('review-dialog').open), false);
  }
});
