import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { application } from './helpers/application.js';

// Deterministic production-handler tests with DOM stand-ins. These deliberately
// queue close events, but do not claim to test browser layout, native Tab order,
// the accessibility tree or operating-system shortcuts; those need browser QA.
const dialogs = [
  { dialog: 'guide-dialog', trigger: 'guide-button', initial: 'guide-dialog-title', first: 'guide-close', last: 'guide-example-button' },
  { dialog: 'lesson-dialog', trigger: 'try-example-button', initial: 'lesson-cancel', first: 'lesson-cancel', last: 'lesson-start' },
];
async function key(app, dialog, properties = {}) {
  const event = { key: 'Tab', target: app.document.activeElement, ...properties };
  await app.element(dialog).emit('keydown', event);
  return event;
}
async function open(app, fixture) {
  app.element(fixture.trigger).focus();
  await app.element(fixture.trigger).click();
}
function focused(app, id) {
  const actual = app.document.activeElement, name = actual?.getAttribute?.('id') ?? actual?.tagName ?? 'none';
  assert.ok(actual === app.element(id), `Expected focus on ${id}; got ${name}.`);
}

test('native dialogs have existing title references and explicit initial focus', async () => {
  const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const fixture of dialogs) {
    const app = application();
    const dialog = app.element(fixture.dialog), titleId = dialog.getAttribute('aria-labelledby');
    assert.equal(dialog.tagName, 'DIALOG');
    assert.match(markup, new RegExp(`<h2[^>]*id="${titleId}"[^>]*>[^<]+</h2>`, 'u'));
    assert.ok(app.element(fixture.initial).attributes.has('autofocus'));
    await open(app, fixture); focused(app, fixture.initial);
    if (fixture.dialog === 'guide-dialog') {
      assert.equal(dialog.getAttribute('aria-describedby'), null, 'long structured guide is not announced as one description');
      assert.equal(app.element(fixture.initial).tabIndex, -1);
      assert.equal((await key(app, fixture.dialog)).defaultPrevented, true);
      focused(app, fixture.first);
    }
  }
});

test('ordinary Tab wraps last to first and Shift+Tab wraps first to last in both dialogs', async () => {
  for (const fixture of dialogs) {
    const app = application(); await open(app, fixture);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      app.element(fixture.last).focus();
      assert.equal((await key(app, fixture.dialog)).defaultPrevented, true); focused(app, fixture.first);
      assert.equal((await key(app, fixture.dialog, { shiftKey: true })).defaultPrevented, true); focused(app, fixture.last);
    }
    app.element(fixture.first).focus();
    assert.equal((await key(app, fixture.dialog)).defaultPrevented, false, 'interior Tab stays native');
    app.element(fixture.last).focus();
    assert.equal((await key(app, fixture.dialog, { shiftKey: true })).defaultPrevented, false, 'interior Shift+Tab stays native');
  }
});

test('modal Tab filtering is fresh and excludes disabled, hidden, inert and negative-tabindex controls', async () => {
  for (const fixture of dialogs) {
    const app = application(); await open(app, fixture);
    const dialog = app.element(fixture.dialog), first = app.element(fixture.first), last = app.element(fixture.last);
    const hiddenGroup = app.document.createElement('div'), hiddenButton = app.document.createElement('button');
    hiddenGroup.hidden = true; hiddenGroup.append(hiddenButton); dialog.append(hiddenGroup);
    const disabledGroup = app.document.createElement('fieldset'), disabledButton = app.document.createElement('button');
    disabledGroup.disabled = true; disabledGroup.append(disabledButton); dialog.append(disabledGroup);
    const inertGroup = app.document.createElement('div'), inertButton = app.document.createElement('button');
    inertGroup.inert = true; inertGroup.append(inertButton); dialog.append(inertGroup);
    const negative = app.document.createElement('button'); negative.tabIndex = -1; dialog.append(negative);
    for (const change of [
      () => { last.disabled = true; },
      () => { last.hidden = true; },
      () => { last.style.display = 'none'; },
      () => { last.style.visibility = 'hidden'; },
      () => { last.style.visibility = 'collapse'; },
      () => { last.tabIndex = -1; },
    ]) {
      last.disabled = false; last.hidden = false; last.style = {}; last.tabIndex = 0;
      change(); first.focus();
      for (const shiftKey of [false, true]) {
        assert.equal((await key(app, fixture.dialog, { shiftKey })).defaultPrevented, true);
        focused(app, fixture.first);
      }
    }
    last.disabled = false; last.hidden = false; last.style = {}; last.tabIndex = 0;
    assert.equal((await key(app, fixture.dialog)).defaultPrevented, false, 'a newly available last control is back in the native order');
    last.focus(); last.hidden = true; // A focused control can disappear while open.
    assert.equal((await key(app, fixture.dialog)).defaultPrevented, true); focused(app, fixture.first);
    first.disabled = true;
    assert.equal((await key(app, fixture.dialog)).defaultPrevented, true); focused(app, fixture.dialog);
    assert.equal((await key(app, fixture.dialog, { shiftKey: true })).defaultPrevented, true); focused(app, fixture.dialog);
    await dialog.escape(); assert.equal(dialog.open, false, 'empty Tab cycle does not replace native Escape');
  }
});

test('modified shortcuts, handled events and non-Tab keys are not consumed or used to play the simulation', async () => {
  for (const fixture of dialogs) {
    const app = application(); await open(app, fixture); app.element(fixture.last).focus();
    const requests = app.posted.length, time = app.state.time;
    for (const properties of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { ctrlKey: true, shiftKey: true }, { key: 'Escape' }, { key: ' ', code: 'Space' }, { key: 'ArrowRight' }]) {
      assert.equal((await key(app, fixture.dialog, properties)).defaultPrevented, false);
      focused(app, fixture.last);
    }
    assert.equal((await key(app, fixture.dialog, { defaultPrevented: true })).defaultPrevented, true);
    focused(app, fixture.last);
    assert.equal(app.windowEvent('keydown', { code: 'Space' }).defaultPrevented, false);
    assert.equal(app.state.playing, false); assert.equal(app.state.time, time); assert.equal(app.posted.length, requests);
    await app.element(fixture.dialog).close();
    app.element(fixture.last).disabled = true;
    assert.equal((await key(app, fixture.dialog)).defaultPrevented, false, 'closed dialogs do not intercept Tab');
  }
});

test('native Escape and explicit dismissals restore the invoking visible enabled control', async () => {
  for (const [trigger, dialog, close] of [
    ['guide-button', 'guide-dialog', 'guide-close'],
    ['assumptions-button', 'guide-dialog', 'guide-close'],
    ['try-example-button', 'lesson-dialog', 'lesson-cancel'],
    ['quick-example-button', 'lesson-dialog', 'lesson-cancel'],
  ]) {
    const app = application({ deferDialogClose: true });
    const experiment = app.state.experiment, worker = app.latestWorker();
    for (const nativeEscape of [false, true]) {
      app.element(trigger).focus(); await app.element(trigger).click();
      if (nativeEscape) await app.element(dialog).escape(); else await app.element(close).click();
      assert.equal(app.element(dialog).open, false);
      assert.equal(app.pendingDialogCloseEvents(), 1);
      await app.flushDialogCloseEvents(); focused(app, trigger);
      assert.strictEqual(app.state.experiment, experiment); assert.strictEqual(app.latestWorker(), worker);
      assert.equal(worker.terminated, false); assert.equal(app.state.lessonActive, false);
    }
  }
});

test('restoration skips disconnected, disabled and nonvisible triggers, including ancestors', async () => {
  for (const invalidate of [
    trigger => { trigger.remove(); },
    trigger => { trigger.disabled = true; },
    trigger => { trigger.hidden = true; },
    trigger => { trigger.style.display = 'none'; },
    trigger => { trigger.style.visibility = 'hidden'; },
    trigger => { trigger.parentElement.hidden = true; },
    trigger => { trigger.parentElement.inert = true; },
  ]) {
    for (const nativeEscape of [false, true]) {
      const app = application({ deferDialogClose: true });
      const trigger = app.element('guide-button');
      trigger.focus(); await trigger.click(); invalidate(trigger);
      if (nativeEscape) await app.element('guide-dialog').escape(); else await app.element('guide-close').click();
      await app.flushDialogCloseEvents(); focused(app, 'assumptions-button');
    }
    const app = application({ deferDialogClose: true });
    const trigger = app.element('quick-example-button');
    trigger.focus(); await trigger.click(); invalidate(trigger);
    await app.element('lesson-dialog').escape(); await app.flushDialogCloseEvents();
    focused(app, 'try-example-button');
  }
  const app = application();
  await app.element('quick-example-button').click();
  app.element('quick-example-button').disabled = true; app.element('try-example-button').disabled = true;
  await app.element('lesson-cancel').click(); focused(app, 'assumptions-button');
});

test('queued same-dialog close events cannot move focus after either dialog has reopened', async () => {
  for (const fixture of dialogs) {
    for (const nativeEscape of [false, true]) {
      const app = application({ deferDialogClose: true });
      for (let cycle = 0; cycle < 3; cycle += 1) {
        await open(app, fixture);
        if (nativeEscape) await app.element(fixture.dialog).escape(); else await app.element(fixture.first).click();
        await open(app, fixture);
        app.element(fixture.last).focus();
        await app.flushDialogCloseEvents();
        focused(app, fixture.last); assert.equal(app.element(fixture.dialog).open, true);
        await app.element(fixture.dialog).escape(); await app.flushDialogCloseEvents(); focused(app, fixture.trigger);
      }
    }
  }
});

test('queued native close preserves a newer useful page focus without confusing native restoration for intent', async () => {
  for (const fixture of dialogs) {
    const app = application({ deferDialogClose: true });
    for (const newerFocus of ['run-experiment', 'timeline', 'variant-name']) {
      await open(app, fixture); await app.element(fixture.dialog).escape();
      app.element(newerFocus).focus();
      await app.flushDialogCloseEvents(); focused(app, newerFocus);
    }
    // A pointer can activate an opener without focusing it. Native close returns
    // to the pre-dialog page focus, but the application still restores its opener.
    app.element('timeline').focus(); await app.element(fixture.trigger).click();
    await app.element(fixture.dialog).escape(); focused(app, 'timeline');
    await app.flushDialogCloseEvents(); focused(app, fixture.trigger);
    await open(app, fixture); await app.element(fixture.dialog).escape();
    app.element('run-experiment').focus(); app.element('run-experiment').hidden = true;
    await app.flushDialogCloseEvents(); focused(app, fixture.trigger);
    app.element('run-experiment').hidden = false;
    await open(app, fixture); await app.element(fixture.dialog).escape();
    app.element('run-experiment').focus(); app.element('run-experiment').disabled = true;
    await app.flushDialogCloseEvents(); focused(app, fixture.trigger);
    await app.element(fixture.trigger).click();
    await app.element(fixture.dialog).escape();
    app.document.activeElement = app.document.body;
    await app.flushDialogCloseEvents(); focused(app, fixture.trigger);
  }
});

test('guide-to-lesson and confirmed-start transitions consume delayed close restoration', async () => {
  const app = application({ deferDialogClose: true }), original = structuredClone(app.state.experiment);
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await app.element('assumptions-button').click();
    await app.element('guide-example-button').click();
    assert.equal(app.element('guide-dialog').open, false); focused(app, 'lesson-cancel');
    assert.equal(app.pendingDialogCloseEvents(), 1);
    await app.flushDialogCloseEvents(); focused(app, 'lesson-cancel');
    await app.element('lesson-start').click(); focused(app, 'lesson-clear');
    assert.equal(app.element('try-example-button').disabled, true);
    assert.equal(app.pendingDialogCloseEvents(), 1);
    app.element('lesson-close-at-11').focus();
    await app.flushDialogCloseEvents(); focused(app, 'lesson-close-at-11');
    await app.element('return-experiment').click(); focused(app, 'try-example-button');
    assert.deepEqual(app.state.experiment, original);
  }
});

test('confirmed start followed immediately by Return or another dialog is safe before old close events', async () => {
  for (const next of ['return', 'guide', 'lesson']) {
    const app = application({ deferDialogClose: true });
    await app.element('quick-example-button').click(); await app.element('lesson-start').click();
    if (next === 'guide') {
      await app.element('assumptions-button').click();
      await app.flushDialogCloseEvents(); focused(app, 'guide-dialog-title');
      await app.element('guide-dialog').escape(); await app.flushDialogCloseEvents(); focused(app, 'assumptions-button');
      assert.equal(app.state.lessonActive, true);
    } else {
      await app.element('return-experiment').click(); focused(app, 'quick-example-button');
      if (next === 'lesson') await app.element('try-example-button').click();
      await app.flushDialogCloseEvents(); focused(app, next === 'lesson' ? 'lesson-cancel' : 'quick-example-button');
      assert.equal(app.state.lessonActive, false);
    }
  }
});

test('reset lesson focuses the first enabled plan and Return falls back when its original entry disappears', async () => {
  const app = application({ deferDialogClose: true });
  await app.element('quick-example-button').click(); await app.element('lesson-start').click();
  await app.change('variant-name', 'Modified lesson'); await app.element('rename-variant').click();
  assert.equal(app.element('lesson-clear').disabled, true);
  app.element('reset-button').focus(); await app.element('reset-button').click();
  assert.equal(app.element('lesson-clear').disabled, false); focused(app, 'lesson-clear');
  await app.flushDialogCloseEvents(); focused(app, 'lesson-clear');
  app.element('quick-example-button').style.display = 'none';
  await app.element('return-experiment').click(); focused(app, 'try-example-button');
  assert.equal(app.element('lesson-panel').hidden, true);
  app.element('reset-button').focus(); await app.element('reset-button').click();
  focused(app, 'reset-button');
});
