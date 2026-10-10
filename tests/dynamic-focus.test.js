import test from 'node:test';
import assert from 'node:assert/strict';
import { application, minimalScenario } from './helpers/application.js';
import { experimentFromScenario } from '../src/experiment.js';

// Production-handler checks with a DOM stand-in that drops focus to body when
// a focused descendant is removed. Native Tab/blur ordering still needs browser QA.
const eventInput = (app, index) => app.element('event-list').children[index].children[2].children[1];
const eventRemove = (app, index) => app.element('event-list').children[index].children[2].children[2];
const card = (app, id) => app.element('variant-results').children.find(item => item.dataset.variant === id);
const preset = (app, id) => app.element('preset-list').children.find(item => item.dataset.preset === id);
const focus = (app, target) => {
  assert.ok(target, 'expected focus target exists');
  assert.ok(app.document.activeElement === target, `Expected focus on ${target.getAttribute('id') ?? target.getAttribute('aria-label') ?? target.dataset.variant ?? target.tagName}; got ${app.document.activeElement.tagName}.`);
  assert.equal(target.isConnected, true, 'focus must belong to a connected node');
  assert.equal(target.disabled, false, 'focus must remain usable');
  assert.ok(target.getClientRects().length, 'focus must remain visible');
};
function experiment(count = 3, events = 3) {
  const value = experimentFromScenario(minimalScenario());
  value.variants = Array.from({ length: count }, (_, index) => ({
    id: `plan-${index}`, name: `Plan ${index}`,
    closures: Array.from({ length: events }, (_, event) => ({ id: `event-${event}`, edgeIds: [['ab', 'bc', 'bd'][event]], atS: 10 + event + index })),
  }));
  return value;
}
async function loaded(count = 3, events = 3) {
  const app = application(); await app.importExperiment(experiment(count, events)); return app;
}

test('harness removal drops focused descendants to body, while replacing button text retains the button focus', () => {
  const app = application(), region = app.element('variant-results'), button = region.children[0];
  button.focus(); button.replaceChildren(app.document.createElement('span')); focus(app, button);
  region.replaceChildren(); assert.strictEqual(app.document.activeElement, app.document.body); assert.equal(button.isConnected, false);
  const group = app.document.createElement('div'), input = app.document.createElement('input');
  group.append(input); region.append(group); input.focus(); group.remove();
  assert.strictEqual(app.document.activeElement, app.document.body); assert.equal(input.isConnected, false);
});

test('comparison selection retains native card identity and focus through repeated selections and completion', async () => {
  const app = await loaded();
  for (const id of ['plan-1', 'plan-2', 'plan-0', 'plan-1']) {
    const target = card(app, id); target.focus(); await target.click();
    focus(app, card(app, id)); assert.strictEqual(card(app, id), target);
    assert.equal(app.state.selectedVariantId, id); assert.equal(target.getAttribute('aria-pressed'), 'true');
  }
  const target = app.document.activeElement; app.latestWorker().respond();
  focus(app, target); assert.strictEqual(card(app, 'plan-1'), target);
  await target.click(); focus(app, target);
});

test('repeated event-time edits retain the input and following Remove control, and invalid values reset to the latest commit', async () => {
  const app = await loaded(), input = eventInput(app, 1), remove = eventRemove(app, 1);
  input.focus();
  let focusCalls = 0;
  const nativeFocus = input.focus.bind(input); input.focus = () => { focusCalls += 1; nativeFocus(); };
  for (const value of ['20', '30.5', '0', '604800']) {
    input.value = value; await input.emit('change');
    focus(app, eventInput(app, 1)); assert.strictEqual(eventInput(app, 1), input); assert.strictEqual(eventRemove(app, 1), remove);
    assert.equal(app.state.scenario.closures[1].atS, Number(value));
  }
  for (const value of ['', '-1', '604801', 'not-a-number']) {
    const requests = app.posted.length; input.value = value; await input.emit('change');
    focus(app, input); assert.equal(input.value, '604800'); assert.equal(app.posted.length, requests);
  }
  assert.equal(focusCalls, 0, 'ordinary edits preserve the connected native input without calling focus');
});

test('a time change after focus has moved preserves the new row control or static destination', async () => {
  for (const destination of [app => eventRemove(app, 1), app => eventInput(app, 2), app => app.element('timeline')]) {
    const app = await loaded(), input = eventInput(app, 1), next = destination(app);
    input.focus(); input.value = '40'; next.focus(); await input.emit('change');
    focus(app, next); assert.strictEqual(eventInput(app, 1), input); assert.equal(app.state.scenario.closures[1].atS, 40);
  }
  const app = await loaded(), input = eventInput(app, 1), next = eventRemove(app, 1);
  input.focus(); input.value = '40'; app.document.activeElement = app.document.body;
  await input.emit('change');
  assert.ok(app.document.activeElement === app.document.body, 'a blur-time body focus is not reclaimed');
  assert.ok(eventInput(app, 1) === input && eventRemove(app, 1) === next, 'the pending native Tab destination stays connected');
});

test('event removal focuses the next same action, previous if last, or static road picker if empty', async () => {
  for (const [count, index, expected] of [[3, 0, 0], [3, 1, 1], [3, 2, 1], [1, 0, null]]) {
    const app = await loaded(3, count), remove = eventRemove(app, index);
    remove.focus(); await remove.click();
    assert.equal(remove.isConnected, false); assert.equal(app.state.scenario.closures.length, count - 1);
    focus(app, expected === null ? app.element('road-select') : eventRemove(app, expected));
  }
  const app = await loaded(); eventRemove(app, 0).focus();
  while (app.state.scenario.closures.length) await app.document.activeElement.click();
  focus(app, app.element('road-select'));
});

test('unfocused event removal preserves the surviving focused event identity and action', async () => {
  for (const getter of [eventInput, eventRemove]) {
    const app = await loaded(), survivor = getter(app, 2);
    survivor.focus(); await eventRemove(app, 0).click();
    focus(app, survivor); assert.strictEqual(getter(app, 1), survivor);
  }
});

test('comparison and event identity survives reordered records and removal uses a same-action neighbor', async () => {
  const app = await loaded(), input = eventInput(app, 1); input.focus();
  const reordered = experiment(), closures = reordered.variants[0].closures;
  reordered.variants[0].closures = [closures[1], closures[2], closures[0]];
  await app.importExperiment(reordered); focus(app, eventInput(app, 0));
  assert.ok(eventInput(app, 0) === input, 'semantic identity takes priority over the old row index');
  assert.equal(app.document.activeElement.getAttribute('aria-label'), 'Start time in seconds for event-1');
  const target = card(app, 'plan-1'); target.focus();
  reordered.variants = [reordered.variants[1], reordered.variants[2], reordered.variants[0]];
  await app.importExperiment(reordered); focus(app, card(app, 'plan-1'));
  assert.ok(card(app, 'plan-1') === target, 'the reordered card keeps its native identity');
  reordered.variants = reordered.variants.filter(item => item.id !== 'plan-1'); await app.importExperiment(reordered);
  focus(app, card(app, 'plan-2')); assert.equal(target.isConnected, false);
});

test('event handlers use the current variant even when closure IDs repeat', async () => {
  const app = await loaded(); const original = structuredClone(app.state.experiment.variants[0].closures), oldInput = eventInput(app, 0), oldRemove = eventRemove(app, 0);
  await card(app, 'plan-1').click();
  assert.equal(oldInput.isConnected, false, 'row identity is scoped to its variant as well as closure ID');
  const requests = app.posted.length; oldInput.value = '99'; await oldInput.emit('change'); await oldRemove.emit('click');
  assert.equal(app.posted.length, requests, 'detached controls from another variant cannot change the current variant');
  const input = eventInput(app, 0); input.focus(); input.value = '42'; await input.emit('change'); focus(app, input);
  assert.equal(app.state.experiment.variants[1].closures[0].atS, 42);
  assert.deepEqual(app.state.experiment.variants[0].closures, original);
  input.value = ''; await input.emit('change'); assert.equal(input.value, '42');
  eventRemove(app, 0).focus(); await eventRemove(app, 0).click();
  assert.equal(app.state.experiment.variants[1].closures.length, 2); assert.deepEqual(app.state.experiment.variants[0].closures, original);
});

test('deletion fallback skips unavailable controls and respects a newer synchronous focus choice', async () => {
  const app = await loaded(), remove = eventRemove(app, 0);
  eventRemove(app, 1).disabled = true; eventRemove(app, 2).parentElement.hidden = true;
  remove.focus(); await remove.click(); focus(app, app.element('road-select'));
  for (const destination of ['timeline', 'guide-dialog-title']) {
    const app = await loaded(), row = app.element('event-list').children[0], remove = eventRemove(app, 0);
    const nativeRemove = row.remove.bind(row);
    row.remove = () => { nativeRemove(); if (destination === 'timeline') app.element('timeline').focus(); else app.element('guide-button').click(); };
    remove.focus(); await remove.click(); focus(app, app.element(destination));
  }
});

test('preset clicks retain their native identity and focus across repeated rebuilds', async () => {
  const app = application();
  for (const id of ['clear', 'central', 'all-bridges', 'clear']) {
    const target = preset(app, id); target.focus(); await target.click();
    focus(app, preset(app, id)); assert.strictEqual(preset(app, id), target); assert.equal(target.getAttribute('aria-pressed'), 'true');
  }
});

test('reopen chips keep same-road focus or use the next, previous and empty-list fallback', async () => {
  for (const index of [0, 1, 2]) {
    const app = await loaded(), chips = app.element('closed-roads'), removed = chips.children[index];
    assert.equal(chips.children.length, 3); removed.focus(); await removed.click();
    focus(app, chips.children[Math.min(index, chips.children.length - 1)]); assert.equal(removed.isConnected, false);
  }
  const app = await loaded(), chips = app.element('closed-roads'), survivor = chips.children[2];
  survivor.focus(); await chips.children[0].click(); focus(app, survivor);
  while (chips.children.length) await app.document.activeElement.click();
  focus(app, app.element('road-select'));
});

test('worker completion, failure, error, timeout and cancellation preserve current card focus', async () => {
  for (const finish of [
    app => app.latestWorker().respond(),
    app => app.latestWorker().respond({ error: 'Budget exceeded' }),
    app => app.latestWorker().fail(),
    app => [...app.timers.values()].find(timer => timer.delay === 30000).callback(),
    app => app.element('cancel-run').click(),
  ]) {
    const app = await loaded(), target = card(app, 'plan-1'); target.focus(); await finish(app);
    focus(app, target); assert.strictEqual(card(app, 'plan-1'), target);
  }
});

test('async terminal updates never reclaim focus from another control or a newer modal', async () => {
  for (const finish of [app => app.latestWorker().respond(), app => app.latestWorker().respond({ error: 'Budget exceeded' }), app => app.latestWorker().fail(), app => app.element('cancel-run').click()]) {
    for (const destination of ['timeline', 'variant-name', 'guide-dialog-title', 'lesson-cancel']) {
      const app = await loaded(); card(app, 'plan-1').focus();
      if (destination === 'guide-dialog-title') await app.element('guide-button').click();
      else if (destination === 'lesson-cancel') await app.element('try-example-button').click();
      else app.element(destination).focus();
      const target = app.document.activeElement; await finish(app); focus(app, target);
    }
  }
});

test('stale completion and errors after cancel and rerun never restore obsolete focus', async () => {
  const app = await loaded(), stale = app.latestWorker(); card(app, 'plan-1').focus();
  await app.element('cancel-run').click(); await app.element('run-experiment').click();
  await app.element('guide-button').click(); const current = app.document.activeElement;
  stale.respond(); stale.fail(); focus(app, current); assert.equal(app.state.pending, true);
  app.latestWorker().respond(); focus(app, current);
});

test('rebuilds initiated outside the dynamic regions do not move focus', async () => {
  for (const id of ['timeline', 'variant-select', 'variant-name', 'road-select', 'toggle-road', 'run-experiment']) {
    const app = await loaded(), target = app.element(id); target.focus();
    await preset(app, 'clear').click(); focus(app, target);
    await card(app, 'plan-1').click(); focus(app, target);
    await eventRemove(app, 0).click(); focus(app, target);
    app.latestWorker().respond(); focus(app, target);
  }
});

test('Duplicate and Remove boundaries move focus only from the button that becomes disabled', async () => {
  for (const [count, id] of [[5, 'duplicate-variant'], [3, 'delete-variant']]) {
    const app = await loaded(count), button = app.element(id); button.focus(); await button.click();
    assert.equal(button.disabled, true); focus(app, app.element('variant-select'));
    const other = await loaded(count); other.element('timeline').focus(); await other.element(id).click();
    assert.equal(other.element(id).disabled, true); focus(other, other.element('timeline'));
  }
  const app = await loaded(3), button = app.element('duplicate-variant'); button.focus(); await button.click();
  assert.equal(button.disabled, false); focus(app, button);
});
