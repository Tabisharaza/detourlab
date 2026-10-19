import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { application, deferredFile, minimalScenario } from './helpers/application.js';
import { experimentFromScenario, validateExperiment } from '../src/experiment.js';

// Production app handlers with the existing DOM/Worker stand-ins. These do not
// establish native dropdown, keyboard, focus timing, screen-reader or layout QA.
const options = app => app.element('road-select').children;
const ids = app => options(app).map(option => option.value);
const query = (app, value) => app.change('road-search', value, 'input');
const detail = app => app.element('road-selection-detail').textContent;
const selected = app => app.element('road-select').value;
const variant = app => app.state.experiment.variants.find(item => item.id === app.state.selectedVariantId);
const eventInput = (app, index = 0) => app.element('event-list').children[index].children[2].children[1];
const eventRemove = (app, index = 0) => app.element('event-list').children[index].children[2].children[2];
const card = (app, id) => app.element('variant-results').children.find(item => item.dataset.variant === id);
const snapshot = app => ({ query: app.element('road-search').value, selected: selected(app), options: ids(app), count: app.element('road-results-count').textContent, detail: detail(app) });
function fixture({ parallel = false } = {}) {
  const scenario = minimalScenario('road-picker-fixture');
  for (const edge of scenario.edges) if (['ab', 'bc'].includes(edge.id)) edge.roadName = 'Shared Road';
  scenario.edges.push({ ...scenario.edges[1], id: 'cb', from: 'C', to: 'B', roadName: 'Return Road' });
  if (parallel) scenario.edges.push({ ...scenario.edges[1], id: 'bc-extra', roadName: 'Parallel Road' });
  const experiment = experimentFromScenario(scenario);
  experiment.variants = [
    { id: 'scheduled', name: 'Scheduled plan', closures: [{ id: 'bc-cutoff', edgeIds: ['bc'], atS: 10.5 }] },
    { id: 'control', name: 'Clear roads', closures: [] },
    { id: 'later', name: 'Later plan', closures: [{ id: 'reverse-cutoff', edgeIds: ['cb'], atS: 20 }] },
  ];
  return experiment;
}
async function loaded(experiment = fixture()) { const app = application(); await app.importExperiment(experiment); return app; }

test('road search retains native controls with visible labels and text status relationships', () => {
  const app = application(), markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['road-search', 'road-select', 'road-direction']) {
    const label = app.document.documentElement.querySelectorAll('label').find(item => item.getAttribute('for') === id);
    assert.ok(label, `visible label exists for ${id}`); assert.equal(label.classList.contains('sr-only'), false);
  }
  assert.equal(app.element('road-search').tagName, 'INPUT'); assert.equal(app.element('road-search').type, 'search');
  assert.equal(app.element('road-select').tagName, 'SELECT'); assert.equal(app.element('road-select').getAttribute('role'), null);
  assert.equal(app.element('road-search').getAttribute('role'), null);
  assert.equal(app.element('road-search').getAttribute('aria-describedby'), 'road-search-help road-results-count');
  for (const id of ['road-select', 'road-direction', 'toggle-road']) assert.equal(app.element(id).getAttribute('aria-describedby'), 'road-selection-detail');
  const status = app.element('road-results-count');
  assert.equal(status.getAttribute('role'), 'status'); assert.equal(status.getAttribute('aria-live'), 'polite'); assert.equal(status.getAttribute('aria-atomic'), 'true');
  assert.equal(app.element('road-selection-detail').getAttribute('aria-live'), null); assert.equal(app.element('road-selection-detail').parentElement.getAttribute('role'), null);
  assert.match(markup, /id="clear-road-search"[^>]*>Clear search<\/button>/u);
  assert.match(markup, /id="toggle-road"[^>]*>Toggle<\/button>/u);
});

test('seed 42 exposes the same 807 representative road choices with full endpoint and edge IDs', () => {
  const app = application(), representatives = [], seen = new Set();
  for (const edge of app.state.scenario.edges) { const key = [edge.from, edge.to].sort().join('|'); if (!seen.has(key)) { seen.add(key); representatives.push(edge); } }
  representatives.sort((a, b) => Number(b.id.startsWith('bridge')) - Number(a.id.startsWith('bridge')) || a.roadName.localeCompare(b.roadName) || a.id.localeCompare(b.id));
  assert.equal(ids(app).length, 807); assert.deepEqual(ids(app), representatives.map(edge => edge.id));
  assert.equal(app.element('road-results-count').textContent, '807 of 807 road segments shown.');
  assert.equal(selected(app), representatives[0].id);
  representatives.forEach((edge, i) => assert.equal(options(app)[i].textContent, `${edge.roadName} · ${edge.from} → ${edge.to} · ${edge.id}`));
});

for (const field of ['roadName', 'from', 'to', 'id']) test(`case-insensitive search matches the representative ${field} without editing or computing`, async () => {
  const app = application(), edge = app.state.scenario.edges.find(item => item.id === 'bridge-central-east');
  const before = app.state.experiment, requests = app.posted.length, worker = app.latestWorker();
  app.element('road-search').focus(); await query(app, `  ${edge[field].toUpperCase()}  `);
  assert.ok(ids(app).includes(edge.id)); assert.ok(ids(app).length < 807);
  assert.strictEqual(app.state.experiment, before); assert.equal(app.posted.length, requests); assert.equal(worker.terminated, false);
  assert.strictEqual(app.document.activeElement, app.element('road-search'));
  for (const id of ids(app)) { const match = before.baseScenario.edges.find(item => item.id === id); assert.ok([match.roadName, match.from, match.to, match.id].some(value => value.toLowerCase().includes(edge[field].toLowerCase()))); }
});

test('duplicate names stay distinct and search has deterministic visible-first and retained-selection behavior', async () => {
  const app = await loaded();
  await query(app, 'SHARED ROAD'); assert.deepEqual(ids(app), ['ab', 'bc']); assert.equal(selected(app), 'ab');
  await app.change('road-select', 'bc'); await query(app, ' shared '); assert.equal(selected(app), 'bc');
  await query(app, 'CANAL'); assert.deepEqual(ids(app), ['dc']); assert.equal(selected(app), 'dc');
  await query(app, 'SHARED'); assert.equal(selected(app), 'ab', 'a hidden prior selection is not restored');
  assert.notEqual(options(app)[0].textContent, options(app)[1].textContent);
  assert.match(options(app)[0].textContent, /A → B · ab/u); assert.match(options(app)[1].textContent, /B → C · bc/u);
});

test('zero matches keep search focus, clear selection and guard dispatched or stale off-filter toggles', async () => {
  const app = await loaded(), before = app.state.experiment, requests = app.posted.length;
  await app.change('road-select', 'bc'); app.element('road-search').focus(); await query(app, 'no-such-road');
  assert.deepEqual(ids(app), []); assert.equal(selected(app), '');
  assert.equal(app.element('road-select').disabled, true); assert.equal(app.element('toggle-road').disabled, true);
  assert.strictEqual(app.document.activeElement, app.element('road-search')); assert.match(app.element('road-results-count').textContent, /No matching roads.*0 of 4/u);
  assert.match(detail(app), /No road selected.*Scheduled plan.*unavailable/u);
  app.element('road-select').value = 'bc'; await app.element('toggle-road').emit('click');
  await query(app, 'Canal'); app.element('road-select').value = 'bc'; await app.element('toggle-road').emit('click');
  assert.strictEqual(app.state.experiment, before); assert.equal(app.posted.length, requests);
});

test('Clear search recovers all choices and keeps button focus, even on repeated clears', async () => {
  const app = await loaded(), full = ids(app), requests = app.posted.length;
  await query(app, 'no-such-road'); const clear = app.element('clear-road-search'); clear.focus(); await clear.click();
  assert.deepEqual(ids(app), full); assert.equal(selected(app), full[0]); assert.equal(app.element('road-search').value, '');
  assert.equal(app.element('road-select').disabled, false); assert.equal(app.element('toggle-road').disabled, false);
  assert.strictEqual(app.document.activeElement, clear);
  await app.change('road-select', 'bc'); clear.focus(); await clear.click(); assert.equal(selected(app), 'bc');
  await query(app, '   '); assert.deepEqual(ids(app), full); assert.equal(selected(app), 'bc');
  assert.equal(app.posted.length, requests);
});

test('equivalent filters, edits, variant changes and Worker results retain native option nodes', async () => {
  const app = await loaded(); await query(app, 'shared'); await app.change('road-select', 'bc');
  const optionNodes = [...options(app)]; await query(app, 'SHARED');
  optionNodes.forEach((option, i) => assert.strictEqual(options(app)[i], option));
  await app.change('road-direction', 'forward'); app.element('toggle-road').focus(); await app.element('toggle-road').click();
  assert.strictEqual(app.document.activeElement, app.element('toggle-road'));
  app.element('variant-select').focus(); await app.change('variant-select', 'control');
  app.latestWorker().respond();
  optionNodes.forEach((option, i) => assert.strictEqual(options(app)[i], option));
  assert.equal(app.element('road-search').value, 'SHARED'); assert.equal(selected(app), 'bc');
  assert.strictEqual(app.document.activeElement, app.element('variant-select'));
});

test('equivalent filters leave the live count untouched instead of repeating its text mutation', async () => {
  const app = await loaded(); await query(app, 'shared');
  const count = app.element('road-results-count');
  const text = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(count), 'textContent'); let writes = 0;
  Object.defineProperty(count, 'textContent', { get() { return text.get.call(this); }, set(value) { writes += 1; text.set.call(this, value); } });
  await query(app, ' SHARED '); await query(app, 'shared road'); assert.equal(writes, 0);
  await query(app, 'canal'); assert.equal(writes, 1); await query(app, 'CANAL'); assert.equal(writes, 1);
  await query(app, 'missing'); assert.equal(writes, 2); await query(app, 'also missing'); assert.equal(writes, 2);
});

test('detail identifies the selected road, exact fractional scheduled cutoff, direction, variant and future action', async () => {
  const app = await loaded(), before = app.state.experiment, requests = app.posted.length;
  await query(app, 'shared'); await app.change('road-select', 'bc'); await app.change('road-direction', 'forward');
  assert.match(detail(app), /Selected: Shared Road\..*Listed B → C \(bc\): scheduled cutoff 10.5 s/u);
  assert.match(detail(app), /Reverse C → B: 1 edge, no scheduled closures/u);
  assert.match(detail(app), /Variant: Scheduled plan \(scheduled\).*Listed direction only \(representative edge\).*removes scheduled closures from 1 directed edge/u);
  assert.match(detail(app), /Schedule status is independent of replay time/u);
  await app.change('closure-time', 720, 'input'); assert.match(detail(app), /New-closure cutoff: 720 s/u);
  await app.change('timeline', 0, 'input'); const atZero = detail(app); await app.change('timeline', 600, 'input'); assert.equal(detail(app), atZero);
  assert.strictEqual(app.state.experiment, before); assert.equal(app.posted.length, requests);
});

test('one-way reverse retains its no-op toast and both-direction applies the sole available edge', async () => {
  const app = await loaded(); await query(app, 'ab'); await app.change('road-direction', 'reverse');
  const before = app.state.experiment, requests = app.posted.length;
  assert.match(detail(app), /Reverse B → A: no reverse edge \(one-way\)/u);
  assert.match(detail(app), /No reverse edge; toggle changes nothing/u);
  app.element('toggle-road').focus(); await app.element('toggle-road').click();
  assert.equal(app.posted.length, requests); assert.strictEqual(app.state.experiment, before); assert.match(app.element('toast').textContent, /no reverse edge/u);
  assert.strictEqual(app.document.activeElement, app.element('toggle-road'));
  await app.change('road-direction', 'both'); await app.change('closure-time', 60); await app.element('toggle-road').click();
  assert.deepEqual(variant(app).closures.at(-1), { id: 'road-edit', edgeIds: ['ab'], atS: 60 });
});

test('partial pair toggling replaces target cutoffs and complete pair toggling reopens, preserving other variants', async () => {
  const app = await loaded(), other = structuredClone(app.state.experiment.variants.slice(1));
  await query(app, 'bc'); await app.change('closure-time', 180); await app.change('road-direction', 'both');
  assert.match(detail(app), /closes all 2 directed edges at 180 s, replacing their cutoffs/u);
  app.element('toggle-road').focus(); await app.element('toggle-road').click();
  assert.deepEqual(variant(app).closures, [{ id: 'road-edit', edgeIds: ['bc', 'cb'], atS: 180 }]);
  assert.match(detail(app), /removes scheduled closures from 2 directed edges/u);
  await app.element('toggle-road').click(); assert.deepEqual(variant(app).closures, []);
  assert.deepEqual(app.state.experiment.variants.slice(1), other); assert.equal(app.element('road-search').value, 'bc'); assert.equal(selected(app), 'bc');
});

test('parallel edges preserve representative-forward, all-reverse and all-pair toggle semantics', async () => {
  const app = await loaded(fixture({ parallel: true })); await query(app, 'bc'); assert.deepEqual(ids(app), ['bc']);
  assert.match(detail(app), /Other listed-direction edges: 1 edge, no scheduled closures/u);
  await app.change('road-direction', 'forward'); await app.element('toggle-road').click(); assert.deepEqual(variant(app).closures, []);
  await app.element('toggle-road').click(); assert.deepEqual(variant(app).closures[0].edgeIds, ['bc']);
  await app.change('road-direction', 'reverse'); await app.element('toggle-road').click(); assert.deepEqual(variant(app).closures.at(-1).edgeIds, ['cb']);
  await app.change('road-direction', 'both'); await app.element('toggle-road').click(); assert.deepEqual(variant(app).closures[0].edgeIds, ['bc', 'cb', 'bc-extra']);
  await app.change('road-direction', 'forward'); await app.element('closed-roads').children[0].click(); assert.deepEqual(variant(app).closures, [], 'reopen chip ignores the selected direction');
});

test('event cutoff edits and removal preserve search, selection and surviving initiating controls', async () => {
  const app = await loaded(); await query(app, 'shared'); await app.change('road-select', 'bc');
  const input = eventInput(app); input.focus(); input.value = '17.25'; await input.emit('change');
  assert.strictEqual(app.document.activeElement, input); assert.strictEqual(eventInput(app), input);
  assert.match(detail(app), /scheduled cutoff 17.25 s/u); assert.equal(selected(app), 'bc'); assert.equal(app.element('road-search').value, 'shared');
  const remove = eventRemove(app); remove.focus(); await remove.click();
  assert.strictEqual(app.document.activeElement, app.element('road-select')); assert.equal(selected(app), 'bc');
  assert.equal(app.element('road-search').value, 'shared'); assert.match(detail(app), /Listed B → C \(bc\): no scheduled closure/u);
});

for (const kind of ['event', 'chip']) test(`removing the last ${kind} with no matches falls back to enabled search`, async () => {
  const app = await loaded(); await query(app, 'no-such-road');
  const target = kind === 'event' ? eventRemove(app) : app.element('closed-roads').children[0]; target.focus(); await target.click();
  assert.strictEqual(app.document.activeElement, app.element('road-search'));
  assert.equal(app.element('road-search').value, 'no-such-road'); assert.equal(app.element('toggle-road').disabled, true);
});

test('variant selection, rename, duplication and removal preserve query and selected road with current variant details', async () => {
  const app = await loaded(); app.latestWorker().respond(); await query(app, 'shared'); await app.change('road-select', 'bc');
  const requests = app.posted.length, target = card(app, 'later'); target.focus(); await target.click();
  assert.strictEqual(app.document.activeElement, target); assert.equal(app.posted.length, requests);
  assert.match(detail(app), /Variant: Later plan \(later\)/u); assert.match(detail(app), /Reverse C → B: 1 edge, 1 scheduled; cutoff 20 s/u);
  for (const action of ['rename-variant', 'duplicate-variant', 'delete-variant']) {
    if (action === 'rename-variant') await app.change('variant-name', 'Fresh name');
    app.element(action).focus(); await app.element(action).click();
    assert.equal(app.element('road-search').value, 'shared'); assert.equal(selected(app), 'bc'); assert.ok(detail(app).includes(`Variant: ${variant(app).name} (${variant(app).id})`));
    assert.strictEqual(app.document.activeElement, app.element(action));
  }
});

test('hostile imported labels remain plain text in options and selected-road status', async () => {
  const experiment = fixture(), hostile = '<img src=x onerror=alert(1)> & "quoted"';
  experiment.baseScenario.edges.find(edge => edge.id === 'bc').roadName = hostile; experiment.variants[0].name = hostile;
  const app = await loaded(experiment); await query(app, '<IMG');
  assert.deepEqual(ids(app), ['bc']); assert.equal(options(app)[0].textContent, `${hostile} · B → C · bc`);
  assert.ok(detail(app).includes(`Selected: ${hostile}.`)); assert.ok(detail(app).includes(`Variant: ${hostile} (scheduled)`));
  assert.equal(options(app)[0].children.length, 0); assert.equal(app.element('road-selection-detail').children.length, 0);
  assert.equal(app.created.filter(element => ['IMG', 'SCRIPT'].includes(element.tagName)).length, 0);
});

test('empty-edge graphs remove old choices, disable edits and recover after a later import', async () => {
  const app = await loaded(), empty = fixture(); empty.baseScenario.edges = []; empty.variants.forEach(item => { item.closures = []; });
  await query(app, 'shared'); app.element('import-button').focus(); await app.importExperiment(empty);
  assert.deepEqual(ids(app), []); assert.equal(selected(app), ''); assert.equal(app.element('road-search').value, '');
  assert.equal(app.element('road-results-count').textContent, 'No road segments in this graph.');
  assert.equal(app.element('road-select').disabled, true); assert.equal(app.element('toggle-road').disabled, true);
  const requests = app.posted.length; await app.element('toggle-road').emit('click'); await query(app, 'anything'); await app.element('clear-road-search').click();
  assert.equal(app.posted.length, requests); assert.deepEqual(ids(app), []); assert.strictEqual(app.document.activeElement, app.element('import-button'));
  await app.importExperiment(fixture()); assert.equal(ids(app).length, 4); assert.equal(app.element('toggle-road').disabled, false);
});

test('successful imports reset query and selection even for matching IDs; rejected and canceled imports preserve them', async () => {
  const app = await loaded(); await query(app, 'shared'); await app.change('road-select', 'bc'); const before = snapshot(app);
  await app.importFile(null); assert.deepEqual(snapshot(app), before);
  await app.importFile(new Blob(['{bad json'])); assert.deepEqual(snapshot(app), before);
  const next = fixture(); next.baseScenario.edges.find(edge => edge.id === 'ab').roadName = 'A new graph label';
  app.element('import-button').focus(); await app.importExperiment(next);
  assert.equal(app.element('road-search').value, ''); assert.equal(selected(app), ids(app)[0]); assert.match(options(app)[0].textContent, /A new graph label/u);
  assert.strictEqual(app.document.activeElement, app.element('import-button'));
});

test('Reset clears search and restores all default choices without reclaiming focus', async () => {
  const app = await loaded(); await query(app, 'no-such-road'); app.element('reset-button').focus(); await app.element('reset-button').click();
  assert.equal(app.element('road-search').value, ''); assert.equal(ids(app).length, 807); assert.equal(selected(app), ids(app)[0]);
  assert.equal(app.element('toggle-road').disabled, false); assert.strictEqual(app.document.activeElement, app.element('reset-button'));
});

test('lesson confirmation cancellation preserves picker; entry and reset clear it; return restores query and selected option', async () => {
  const app = await loaded(); await query(app, '  SHARED  '); await app.change('road-select', 'bc'); await app.change('road-direction', 'reverse');
  const before = snapshot(app); await app.element('try-example-button').click(); await app.element('lesson-cancel').click(); assert.deepEqual(snapshot(app), before);
  await app.element('try-example-button').click(); await app.element('lesson-start').click();
  assert.equal(app.element('road-search').value, ''); assert.equal(ids(app).length, 4); assert.equal(selected(app), ids(app)[0]);
  await query(app, 'Second Street'); await app.element('lesson-close-at-10').click(); assert.equal(app.element('road-search').value, 'Second Street'); assert.equal(selected(app), 'bc');
  await app.element('reset-button').click(); assert.equal(app.element('road-search').value, ''); assert.equal(selected(app), ids(app)[0]);
  await query(app, 'missing'); await app.element('return-experiment').click(); assert.deepEqual(snapshot(app), before);
  assert.equal(app.element('road-direction').value, 'reverse'); assert.strictEqual(app.document.activeElement, app.element('try-example-button'));
  app.latestWorker().respond(); assert.deepEqual(snapshot(app), before);
});

test('lesson return restores a no-match query without silently selecting or editing a road', async () => {
  const app = await loaded(); await query(app, 'no-such-road'); const before = snapshot(app);
  await app.element('try-example-button').click(); await app.element('lesson-start').click(); await app.element('return-experiment').click();
  assert.deepEqual(snapshot(app), before); assert.equal(app.element('toggle-road').disabled, true);
});

test('superseded async import and stale Worker callbacks cannot rewind newer picker state', async () => {
  const app = await loaded(), oldWorker = app.latestWorker(), pending = deferredFile(), pendingImport = app.importFile(pending.file);
  await app.importExperiment(fixture({ parallel: true })); await query(app, 'shared'); await app.change('road-select', 'bc');
  const before = snapshot(app), latest = app.latestWorker();
  pending.resolve(new TextEncoder().encode(JSON.stringify(experimentFromScenario(minimalScenario('stale'))))); await pendingImport;
  oldWorker.respond(); oldWorker.fail(); assert.deepEqual(snapshot(app), before); assert.equal(app.state.pending, true);
  app.element('road-search').focus(); latest.respond(); assert.deepEqual(snapshot(app), before); assert.strictEqual(app.document.activeElement, app.element('road-search'));
  latest.respond(); latest.fail(); assert.deepEqual(snapshot(app), before);
});

test('Cancel, rerun and Worker failure preserve search and selection across computation lifecycle', async () => {
  const app = await loaded(); await query(app, 'shared'); await app.change('road-select', 'bc'); const before = snapshot(app), old = app.latestWorker();
  app.element('cancel-run').focus(); await app.element('cancel-run').click(); old.respond(); assert.deepEqual(snapshot(app), before);
  app.element('run-experiment').focus(); await app.element('run-experiment').click(); assert.deepEqual(snapshot(app), before); app.latestWorker().fail(); assert.deepEqual(snapshot(app), before);
  await app.element('run-experiment').click(); app.latestWorker().respond(); assert.deepEqual(snapshot(app), before); assert.strictEqual(app.document.activeElement, app.element('run-experiment'));
});

test('search and native road controls keep their own keyboard keys, including Space and Escape', () => {
  const app = application(); const before = app.state.playing;
  for (const id of ['road-search', 'road-select', 'road-direction', 'clear-road-search', 'toggle-road']) {
    app.element(id).focus();
    for (const [key, code] of [[' ', 'Space'], ['ArrowDown', 'ArrowDown'], ['Escape', 'Escape'], ['Home', 'Home'], ['End', 'End']]) {
      assert.equal(app.windowEvent('keydown', { key, code }).defaultPrevented, false);
      assert.strictEqual(app.document.activeElement, app.element(id)); assert.equal(app.state.playing, before);
    }
  }
});

test('overlapping closure events use earliest effective cutoffs and bounded summaries', async () => {
  const experiment = fixture({ parallel: true });
  experiment.variants[0].closures = Array.from({ length: 8000 }, (_, i) => ({ id: `repeat-${i}`, edgeIds: [i % 2 ? 'bc' : 'cb'], atS: 1000 - i / 10 }));
  experiment.variants[2].closures = [];
  validateExperiment(experiment); const app = await loaded(experiment); await query(app, 'bc');
  assert.match(detail(app), /Listed B → C \(bc\): scheduled cutoff 200.10000000000002 s/u);
  assert.match(detail(app), /Reverse C → B: 1 edge, 1 scheduled; cutoff 200.20000000000005 s/u);
  assert.ok(detail(app).length < 850, 'summary size does not grow with the event count');
  assert.equal(detail(app).includes('repeat-'), false);
});
