import { createDemoScenario, createPresets, validateScenario, LIMITS } from './scenario.js';
import { experimentFromScenario, validateExperiment, parseExperiment, scenarioForVariant, exportExperiment, EXPERIMENT_LIMITS } from './experiment.js';
import { createBrowserReview } from './browser-review.js';
import { createBrowserImpact, pageDeliveryImpact } from './browser-impact.js';
import { NetworkMap } from './map.js';
import { createTutorialExperiment } from './tutorial.js';
import { decodeFileInput, FILE_INPUT_MAX_BYTES, formatInputError } from './file-input.js';

const $ = (id) => document.getElementById(id);
const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
const clock = (seconds) => { const value = Math.max(0, Math.floor(seconds)); return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; };
const distanceParts = (meters) => meters < 1000 ? [String(Number(meters.toPrecision(6))), 'm'] : [(meters / 1000).toFixed(1), 'km'];
const distanceText = (meters) => distanceParts(meters).join(' ');
const latenessText = (seconds) => seconds < 60 ? `+${Number(seconds.toPrecision(12))} s` : `+${Math.ceil(seconds / 60)} min`;
function createInitialExperiment() { const experiment = experimentFromScenario(createDemoScenario(42)); experiment.variants[0].name = 'Market Bridge closure'; return experiment; }
const initialExperiment = createInitialExperiment();
const initialScenario = scenarioForVariant(initialExperiment, initialExperiment.variants[0].id);
const state = { experiment: initialExperiment, selectedVariantId: initialExperiment.variants[0].id, allResults: null, scenario: initialScenario, baseline: null, disrupted: null, time: 360, playing: false, speed: 60, selectedVehicle: null, view: 'disruption', editing: false, zoom: 1, pending: true, lessonActive: false, lessonModified: false };
let worker;
let revision = 0;
let importRevision = 0;
let workerTimeout;
let toastTimeout;
let initial = true;
let lessonBackup = null;
let dialogFocus = null;
let reviewRevision = 0;
let preparedReview = null;
let inspectedImpact = null;
let impactPage = 0;
const lessonSteps = [
  { id: 'clear', time: 0, story: 'With clear roads, the van takes A → B → C: 200 m and arrival at 20 s, before the 22 s deadline. Its run finishes at 23 s because delivery service takes 3 more seconds.' },
  { id: 'close-at-10', time: 10, story: 'At 10 s the van reaches B. B → C closes at that exact instant, so entry is blocked. It takes A → B → D → C instead: 260 m, arrival at 26 s, and 4 s late. The run finishes at 29 s, including 3 s of service.' },
  { id: 'close-at-11', time: 11, story: 'At 11 s the van is already on B → C: it entered at 10 s. It finishes that edge even though it closes. A → B → C stays 200 m, with arrival at 20 s and no late delivery. The run finishes at 23 s, including 3 s of service.' },
];
let roads = [];
let visibleRoads = [];
let edgesById = new Map();
let roadPairs = new Map();
const map = new NetworkMap($('network-map'), state, {
  onRoad: (edgeId) => { if (state.editing) toggleRoad(edgeId); },
  onVehicle: (id) => { state.selectedVehicle = id; $('vehicle-select').value = id; updateInspector(); },
  onHover: (text, x, y) => { const tip = $('map-tooltip'); tip.hidden = !text; tip.textContent = text; tip.style.left = `${Math.min(x + 12, Math.max(0, map.width - 210))}px`; tip.style.top = `${Math.max(0, y - 38)}px`; },
});

function toast(message, error = false) { const el = $('toast'); el.textContent = message; el.classList.toggle('error', error); el.hidden = false; clearTimeout(toastTimeout); toastTimeout = setTimeout(() => { el.hidden = true; }, error ? 9000 : 4500); }
function setPlaying(value) { state.playing = value; $('play-button').textContent = value ? 'Ⅱ' : '▶'; $('play-button').setAttribute('aria-label', value ? 'Pause simulation' : 'Play simulation'); }
function setTime(value) { state.time = Math.max(0, Math.min(Number($('timeline').max), Number(value))); $('timeline').value = String(Math.floor(state.time)); $('clock-label').textContent = clock(state.time); updateVehicleStatus(); }
function setView(view) { state.view = view; for (const other of ['disruption', 'baseline', 'compare']) { $('view-' + other).classList.toggle('active', other === view); $('view-' + other).setAttribute('aria-pressed', String(other === view)); } map.invalidateFrame(); }
function setEditing(value) { state.editing = value; $('edit-roads').setAttribute('aria-pressed', String(value)); $('map-help').textContent = value ? 'Click a road to edit the selected direction in this variant' : 'Click a vehicle to inspect its route'; }
function closedIds() { return new Set(state.scenario.closures.flatMap(closure => closure.edgeIds)); }
function closureAt() { return Number($('closure-time').value); }
function pairsFor(id) { const edge = edgesById.get(id); return edge ? roadPairs.get([edge.from, edge.to].sort().join('|')) || [] : []; }
function roadEditIds(id, forceReopen = false) {
  const edge = edgesById.get(id); if (!edge) return [];
  const direction = $('road-direction').value || 'both';
  return forceReopen || direction === 'both' ? pairsFor(id) : direction === 'forward' ? [id] : pairsFor(id).filter(edgeId => { const item = edgesById.get(edgeId); return item.from === edge.to && item.to === edge.from; });
}
function activeVariant() { return state.experiment.variants.find(variant => variant.id === state.selectedVariantId); }
function changedExperiment(experiment, selectedId = state.selectedVariantId) {
  let validated;
  try { validated = validateExperiment(experiment); }
  catch (error) { toast(`Change rejected. ${formatInputError(error)}`, true); return false; }
  importRevision += 1;
  state.experiment = validated;
  if (state.lessonActive) state.lessonModified = true;
  state.selectedVariantId = selectedId;
  state.scenario = scenarioForVariant(state.experiment, selectedId);
  updateControls(); compute(); return true;
}
function replaceClosures(closures) {
  return changedExperiment({ ...state.experiment, variants: state.experiment.variants.map(variant => variant.id === state.selectedVariantId ? { ...variant, closures } : variant) });
}
function setClosures(ids, atS = closureAt()) {
  const edgeIds = [...new Set(ids)].sort();
  replaceClosures(edgeIds.length ? [{ id: 'interactive-closure', edgeIds, atS }] : []);
}
function toggleRoad(id, forceReopen = false) {
  if (!id) return;
  const closed = closedIds();
  const pairs = roadEditIds(id, forceReopen);
  if (!pairs.length) { toast('This segment has no reverse edge. Choose its listed direction.'); return; }
  const removing = forceReopen || pairs.every(value => closed.has(value));
  const closures = state.scenario.closures.map(closure => ({ ...closure, edgeIds: closure.edgeIds.filter(edgeId => !pairs.includes(edgeId)) })).filter(closure => closure.edgeIds.length);
  if (!removing) {
    let closureId = 'road-edit', counter = 1;
    while (closures.some(closure => closure.id === closureId)) closureId = `road-edit-${counter++}`;
    closures.push({ id: closureId, edgeIds: pairs, atS: closureAt() });
  }
  replaceClosures(closures);
}
function selectVariant(id) {
  if (!state.experiment.variants.some(variant => variant.id === id)) return;
  importRevision += 1;
  state.selectedVariantId = id; state.scenario = scenarioForVariant(state.experiment, id);
  updateControls(); showSelectedResult();
}
function updateControlList(region, records, render, fallback, keyFor = record => record.id) {
  const active = document.activeElement;
  const controls = () => [...region.querySelectorAll('button, input, select, textarea')].filter(control => control.tagName === active?.tagName);
  const index = controls().indexOf(active);
  const key = [...region.children].find(child => child.contains(active))?.dataset.controlKey;
  const existing = new Map([...region.children].map(child => [child.dataset.controlKey, child]));
  const children = records.map((record, position) => {
    const key = keyFor(record), child = render(record, existing.get(key), position);
    child.dataset.controlKey = key; return child;
  });
  const retained = new Set(children);
  for (const child of [...region.children]) if (!retained.has(child)) child.remove();
  // Keep surviving native controls in place. Replacing even the same input node
  // can interrupt a change event's native Tab/blur destination.
  children.forEach((child, position) => { if (region.children[position] !== child) region.insertBefore(child, region.children[position] ?? null); });
  if (index < 0 || document.activeElement === active && canFocus(active)) return;
  const current = document.activeElement;
  if (current !== active && current !== document.body && current !== document.documentElement && canFocus(current)) return;
  const candidates = controls(), sameRecord = children.find(child => child.dataset.controlKey === key);
  // After deletion, retain the action at the next row, or the previous last row.
  focusFirst([candidates.find(control => sameRecord?.contains(control)), ...candidates.slice(index), ...candidates.slice(0, index).reverse(), fallback]);
}
function updateVariants(preserveName = false) {
  $('experiment-name').textContent = state.experiment.name;
  $('variant-select').replaceChildren(...state.experiment.variants.map(variant => { const option = node('option', variant.name); option.value = variant.id; return option; }));
  $('variant-select').value = state.selectedVariantId;
  if (!preserveName) $('variant-name').value = activeVariant().name;
  $('variant-limit').textContent = `${state.experiment.variants.length} / ${EXPERIMENT_LIMITS.maxVariants} variants · edits stay independent`;
  const focusedAction = document.activeElement;
  $('duplicate-variant').disabled = state.experiment.variants.length >= EXPERIMENT_LIMITS.maxVariants;
  $('delete-variant').disabled = state.experiment.variants.length <= EXPERIMENT_LIMITS.minVariants;
  if ([$('duplicate-variant'), $('delete-variant')].includes(focusedAction) && focusedAction.disabled) focusFirst([$('variant-select')]);
  updateControlList($('variant-results'), state.experiment.variants, (variant, button) => {
    const result = state.allResults?.variants.find(item => item.id === variant.id);
    if (!button) { button = node('button', undefined, 'variant-result'); button.addEventListener('click', () => selectVariant(variant.id)); }
    button.dataset.variant = variant.id; button.classList.toggle('active', variant.id === state.selectedVariantId); button.setAttribute('aria-pressed', String(variant.id === state.selectedVariantId));
    button.classList.remove('has-skips'); button.replaceChildren(node('strong', variant.name));
    const numbers = node('div');
    if (result) {
      const metrics = result.result.metrics;
      numbers.append(node('span', distanceText(metrics.distanceM)), node('span', `${metrics.lateJobs} late`), node('span', `${metrics.unreachableJobs} unreachable`));
      const skipped = metrics.unreachableJobs > state.allResults.baseline.metrics.unreachableJobs;
      button.classList.toggle('has-skips', skipped);
      button.append(numbers, node('small', skipped ? `${metrics.completedJobs}/${metrics.totalJobs} completed · skipped work reduces distance` : `${result.delta.extraDistancePct > 0 ? '+' : ''}${result.delta.extraDistancePct.toFixed(1)}% distance · ${metrics.completedJobs}/${metrics.totalJobs} completed`));
    } else { numbers.append(node('span', state.pending ? 'Calculating…' : 'Run to compare')); button.append(numbers); }
    return button;
  }, $('variant-select'));
}
function updateEvents() {
  const edgeMap = new Map(state.scenario.edges.map(edge => [edge.id, edge]));
  updateControlList($('event-list'), state.scenario.closures, (closure, row) => {
    if (!row) {
      row = node('div', undefined, 'event-row');
      const variantId = state.selectedVariantId, closureId = closure.id;
      const controls = node('div', undefined, 'event-edit'), label = node('label', 'Start (sec)'), input = node('input'), remove = node('button', 'Remove');
      input.type = 'number'; input.min = '0'; input.max = String(LIMITS.maxTimeS); input.step = 'any';
      input.addEventListener('change', () => {
        if (state.selectedVariantId !== variantId) return;
        const current = state.scenario.closures.find(item => item.id === closureId); if (!current) return;
        const atS = Number(input.value);
        if (input.value.trim() === '' || !Number.isFinite(atS) || atS < 0 || atS > LIMITS.maxTimeS) { input.value = String(current.atS); toast('Enter a closure time from 0 to 604800 seconds.', true); return; }
        if (!replaceClosures(state.scenario.closures.map(item => item.id === closureId ? { ...item, atS } : item))) input.value = String(current.atS);
      });
      remove.addEventListener('click', () => { if (state.selectedVariantId === variantId) replaceClosures(state.scenario.closures.filter(item => item.id !== closureId)); });
      controls.append(label, input, remove); row.append(node('strong'), node('small'), controls);
    }
    const roads = [...new Set(closure.edgeIds.map(id => edgeMap.get(id).roadName))];
    const [title, detail, controls] = row.children, [, input, remove] = controls.children;
    title.textContent = roads.join(', '); detail.textContent = `${closure.edgeIds.length} directed edges · ${closure.id}`;
    input.value = String(closure.atS); input.setAttribute('aria-label', `Start time in seconds for ${closure.id}`);
    remove.setAttribute('aria-label', `Remove closure event ${closure.id}`); return row;
  }, roadPickerFocusTarget(), closure => JSON.stringify([state.selectedVariantId, closure.id]));
}

function makeRoads() {
  const seen = new Set(); roads = []; edgesById = new Map(state.scenario.edges.map(edge => [edge.id, edge])); roadPairs = new Map();
  for (const edge of state.scenario.edges) { const key = [edge.from, edge.to].sort().join('|'); if (!roadPairs.has(key)) roadPairs.set(key, []); roadPairs.get(key).push(edge.id); }
  for (const edge of state.scenario.edges) { const key = [edge.from, edge.to].sort().join('|'); if (seen.has(key)) continue; seen.add(key); roads.push(edge); }
  roads.sort((a, b) => Number(b.id.startsWith('bridge')) - Number(a.id.startsWith('bridge')) || a.roadName.localeCompare(b.roadName) || a.id.localeCompare(b.id));
  $('road-select').replaceChildren(); visibleRoads = [];
  filterRoads();
}

function roadPickerFocusTarget() { return $('road-select').disabled ? $('road-search') : $('road-select'); }
function selectedRoad() { return visibleRoads.find(edge => edge.id === $('road-select').value); }
function filterRoads(preferredId = $('road-select').value) {
  const query = $('road-search').value.trim().toLowerCase();
  const matches = roads.filter(edge => [edge.roadName, edge.from, edge.to, edge.id].some(value => value.toLowerCase().includes(query)));
  // Preserve the native select and its options when the visible list is unchanged.
  if (matches.length !== visibleRoads.length || matches.some((edge, index) => edge !== visibleRoads[index])) {
    $('road-select').replaceChildren(...matches.map(edge => { const option = node('option', `${edge.roadName} · ${edge.from} → ${edge.to} · ${edge.id}`); option.value = edge.id; return option; }));
  }
  visibleRoads = matches;
  $('road-select').value = matches.some(edge => edge.id === preferredId) ? preferredId : matches[0]?.id ?? '';
  $('road-select').disabled = !matches.length;
  const countText = !roads.length ? 'No road segments in this graph.' : matches.length ? `${matches.length} of ${roads.length} road segments shown.` : `No matching roads. 0 of ${roads.length} road segments shown. Clear search to show all roads.`;
  if ($('road-results-count').textContent !== countText) $('road-results-count').textContent = countText;
  updateRoadDetails();
}
function updateRoadDetails() {
  const edge = selectedRoad(), variant = activeVariant();
  $('toggle-road').disabled = !edge;
  if (!edge) {
    $('road-selection-detail').textContent = `No road selected. Variant: ${variant.name} (${variant.id}). Road toggle is unavailable.`;
    return;
  }
  // Each edge is governed by its earliest scheduled closure. Keep this summary
  // bounded even when imported events repeat an edge or the pair has parallels.
  const cutoffs = new Map();
  for (const closure of state.scenario.closures) for (const id of closure.edgeIds) cutoffs.set(id, Math.min(cutoffs.get(id) ?? Infinity, closure.atS));
  const time = seconds => `${seconds} s`;
  const status = ids => {
    const times = ids.filter(id => cutoffs.has(id)).map(id => cutoffs.get(id));
    const count = `${ids.length} ${ids.length === 1 ? 'edge' : 'edges'}`;
    if (!times.length) return `${count}, no scheduled closures`;
    const first = Math.min(...times), last = Math.max(...times);
    return `${count}, ${times.length} scheduled; ${first === last ? 'cutoff ' + time(first) : 'earliest cutoff ' + time(first) + ', latest ' + time(last)}`;
  };
  const pair = pairsFor(edge.id), reverse = pair.filter(id => { const other = edgesById.get(id); return other.from === edge.to && other.to === edge.from; });
  const reverseIds = new Set(reverse), parallel = pair.filter(id => id !== edge.id && !reverseIds.has(id));
  const targets = roadEditIds(edge.id), closed = closedIds(), direction = $('road-direction').value || 'both';
  const directionName = direction === 'both' ? 'Both directions' : direction === 'forward' ? 'Listed direction only (representative edge)' : 'Reverse direction only';
  const targetCount = `${targets.length} directed ${targets.length === 1 ? 'edge' : 'edges'}`;
  const action = !targets.length ? 'No reverse edge; toggle changes nothing.' : targets.every(id => closed.has(id)) ? `Next toggle removes scheduled closures from ${targetCount}.` : `Next toggle closes all ${targetCount} at ${time(closureAt())}, replacing their cutoffs.`;
  $('road-selection-detail').textContent = [
    `Selected: ${edge.roadName}. Variant: ${variant.name} (${variant.id}).`,
    `Listed ${edge.from} → ${edge.to} (${edge.id}): ${cutoffs.has(edge.id) ? 'scheduled cutoff ' + time(cutoffs.get(edge.id)) : 'no scheduled closure'}.`,
    ...(parallel.length ? [`Other listed-direction edges: ${status(parallel)}.`] : []),
    `Reverse ${edge.to} → ${edge.from}: ${reverse.length ? status(reverse) : 'no reverse edge (one-way)'}.`,
    `${directionName}. ${action} New-closure cutoff: ${time(closureAt())}.`,
    'Schedule status is independent of replay time.',
  ].join(' ');
}
function updateControls() {
  const scenario = state.scenario;
  $('scene-name').textContent = scenario.name;
  $('map-scene-title').textContent = `${scenario.name.toUpperCase()} / EXPERIMENT VIEW`;
  $('map-watermark-name').textContent = scenario.name.toUpperCase();
  $('seed-label').textContent = `seed ${scenario.seed}`;
  $('scenario-hash').textContent = `Scenario v${scenario.version} · seed ${scenario.seed}`;
  $('network-description').textContent = `${scenario.nodes.length} junctions · ${scenario.vehicles.length} vehicles · ${scenario.jobs.length} deliveries`;
  $('closure-time-label').textContent = clock(closureAt());
  $('closure-time').max = '1800';
  $('event-label').textContent = scenario.closures.length > 1 ? `${scenario.closures.length} scheduled closure events` : scenario.closures.length ? `Closure starts at ${clock(scenario.closures[0].atS)}` : 'Control run · no closures';
  const closed = closedIds();
  $('closure-count').textContent = String(roads.filter(edge => pairsFor(edge.id).some(id => closed.has(id))).length);
  const presets = createPresets(scenario).filter(preset => preset.id === 'clear' || preset.edgeIds.length > 0);
  updateControlList($('preset-list'), presets, (preset, button, index) => {
    if (!button) {
      button = node('button', undefined, 'preset'); button.dataset.preset = preset.id;
      button.addEventListener('click', () => { const current = createPresets(state.scenario).find(item => item.id === button.dataset.preset); if (current) setClosures(current.edgeIds); });
    }
    const active = preset.edgeIds.length === closed.size && preset.edgeIds.every(id => closed.has(id)); button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    const names = { central: ['Bridge works', 'A busy crossing goes offline'], 'all-bridges': ['River cut', 'Three crossings. One hard limit.'], clear: ['Clear roads', 'The unchanged control run'] };
    const [name, detail] = names[preset.id] ?? [preset.name, preset.description];
    const text = node('div'); text.append(node('strong', name), node('small', detail)); button.replaceChildren(node('span', ['⌁','⊘','↗'][index] ?? '◇', 'preset-icon'), text); button.title = preset.description; return button;
  }, roadPickerFocusTarget());
  const closedRoads = roads.filter(edge => pairsFor(edge.id).some(id => closed.has(id)));
  updateControlList($('closed-roads'), closedRoads, (edge, button) => {
    if (!button) { button = node('button', undefined, 'closure-chip'); button.addEventListener('click', () => toggleRoad(edge.id, true)); }
    button.textContent = `${edge.roadName} ×`; button.title = `Reopen ${edge.roadName}, ${edge.from} to ${edge.to}`; button.setAttribute('aria-label', button.title); return button;
  }, roadPickerFocusTarget());
  updateVariants(); updateEvents(); updateLesson(); updateRoadDetails(); map.invalidate();
}
function clearResults() {
  invalidateReview();
  invalidateImpact();
  for (const id of ['distance', 'late', 'unreachable']) { $(id + '-value').textContent = '—'; $(id + '-delta').textContent = 'Calculating…'; $(id + '-baseline').textContent = ''; }
  for (const id of ['route-baseline-distance', 'route-scenario-distance', 'route-baseline-time', 'route-scenario-time']) $(id).textContent = '—';
  $('route-reason').textContent = 'Calculating this experiment. No previous results are shown.';
  $('route-path').textContent = ''; $('route-path').hidden = true;
  $('job-list').replaceChildren(); $('job-count').textContent = ''; $('vehicle-status').textContent = 'Calculating…';
}
function computationFailed(message) {
  state.pending = false;
  for (const id of ['distance', 'late', 'unreachable']) $(id + '-delta').textContent = 'Unavailable';
  $('route-reason').textContent = message; $('status-line').parentElement.setAttribute('aria-busy', 'false');
}
function hideCancelRun() {
  const cancel = $('cancel-run');
  // Hand off before hiding the focused button, without reclaiming newer focus.
  if (document.activeElement === cancel) focusFirst([$('run-experiment')]);
  cancel.hidden = true;
}
function cancelComputation(message = 'Run canceled. Your variants are preserved.') {
  revision += 1; clearTimeout(workerTimeout); worker?.terminate(); worker = null; state.pending = false; setPlaying(false);
  state.allResults = null; state.baseline = null; state.disrupted = null; clearResults(); computationFailed(message);
  $('status-line').textContent = message; $('comparison-status').textContent = message; hideCancelRun(); updateVariants(true); map.invalidateFrame();
}
function showSelectedResult() {
  const selected = state.allResults?.variants.find(variant => variant.id === state.selectedVariantId);
  if (!selected) { state.baseline = null; state.disrupted = null; map.invalidateFrame(); return; }
  state.baseline = state.allResults.baseline; state.disrupted = selected.result;
  if (!state.selectedVehicle || !state.disrupted.vehicles.some(vehicle => vehicle.id === state.selectedVehicle)) state.selectedVehicle = state.disrupted.vehicles[0]?.id ?? null;
  $('vehicle-select').replaceChildren(...state.disrupted.vehicles.map(vehicle => { const option = node('option', `${vehicle.id.toUpperCase()} · ${vehicle.jobs.length} deliveries`); option.value = vehicle.id; return option; }));
  $('vehicle-select').value = state.selectedVehicle;
  const duration = Math.max(state.baseline.durationS, ...state.allResults.variants.map(variant => variant.result.durationS), 1);
  $('timeline').max = String(duration); $('duration-label').textContent = clock(duration); setTime(Math.min(state.time, duration));
  updateMetrics(); updateInspector(); updateVariants(true); updateImpactSelection(); map.invalidateFrame();
}
function compute() {
  const id = ++revision;
  clearTimeout(workerTimeout); worker?.terminate();
  state.pending = true; state.allResults = null; state.baseline = null; state.disrupted = null; clearResults(); updateVariants(true);
  $('status-line').textContent = 'Calculating one baseline and all independent variants…';
  $('comparison-status').textContent = `Running ${state.experiment.variants.length} variants with identical network and demand…`;
  $('status-line').parentElement.setAttribute('aria-busy', 'true'); $('cancel-run').hidden = false;
  let currentWorker;
  try { currentWorker = new Worker(new URL('./simulation-worker.js', import.meta.url), { type: 'module' }); }
  catch (error) { cancelComputation('The simulation worker could not start. Use a modern browser and an HTTP origin.'); toast(error.message || 'Worker unavailable', true); return; }
  worker = currentWorker;
  currentWorker.onmessage = ({ data }) => {
    if (id !== revision || data.id !== revision || worker !== currentWorker) return;
    clearTimeout(workerTimeout); state.pending = false; $('status-line').parentElement.setAttribute('aria-busy', 'false'); hideCancelRun();
    currentWorker.terminate(); if (worker === currentWorker) worker = null;
    if (data.error) { computationFailed(data.error); toast(`The experiment could not run: ${data.error}`, true); $('status-line').textContent = 'Experiment failed. Edit or import a smaller experiment.'; $('comparison-status').textContent = 'No partial results shown. ' + data.error; updateVariants(true); return; }
    state.allResults = { baseline: data.baseline, variants: data.variants }; showSelectedResult(); updateReviewAvailability(); updateImpactAvailability();
    $('status-line').textContent = `${state.scenario.jobs.length} shared orders · ${state.experiment.variants.length} variants · synchronized replay`;
    $('comparison-status').textContent = `Open-network baseline: ${distanceText(data.baseline.metrics.distanceM)}, ${data.baseline.metrics.lateJobs} late, ${data.baseline.metrics.unreachableJobs} unreachable. Cards show final modeled outcomes.`;
    if (initial) { initial = false; document.documentElement.dataset.ready = 'true'; }
    document.documentElement.dataset.revision = String(revision);
  };
  currentWorker.onerror = (event) => { if (id !== revision || worker !== currentWorker) return; cancelComputation('Simulation worker failed. Run again to retry.'); toast(event.message || 'Worker error', true); };
  currentWorker.postMessage({ id, experiment: state.experiment });
  workerTimeout = setTimeout(() => { if (id === revision) { cancelComputation('Calculation stopped after the 30-second safety limit.'); toast('Try fewer variants, smaller networks or fewer closure events.', true); } }, 30000);
}

function metric(id, value, unit, base, delta, suffix) {
  $(id + '-value').replaceChildren(document.createTextNode(String(value)), ...(unit ? [node('small', unit)] : []));
  const element = $(id + '-delta'); element.textContent = delta === 0 ? 'No change' : `${delta > 0 ? '+' : ''}${delta}${suffix}`; element.classList.toggle('good', delta <= 0);
  $(id + '-baseline').textContent = `BASE ${base}`;
}
function updateMetrics() {
  const a = state.baseline.metrics, b = state.disrupted.metrics;
  const percentage = a.distanceM ? Math.round((b.distanceM - a.distanceM) / a.distanceM * 100) : 0;
  const [distance, unit] = distanceParts(b.distanceM);
  metric('distance', distance, unit, distanceText(a.distanceM), percentage, '% vs baseline');
  metric('late', b.lateJobs, `/ ${b.totalJobs}`, a.lateJobs, b.lateJobs - a.lateJobs, ' deliveries');
  metric('unreachable', b.unreachableJobs, 'stops', a.unreachableJobs, b.unreachableJobs - a.unreachableJobs, ' unreachable');
  $('distance-value').closest('.metric-card').title = 'Final traveled fleet distance. With unreachable stops, a shorter distance may reflect skipped work rather than improvement.';
  if (b.unreachableJobs > a.unreachableJobs && percentage < 0) { $('distance-delta').textContent = `${percentage}% · some stops skipped`; $('distance-delta').classList.remove('good'); }
}
function updateVehicleStatus() {
  if (!state.disrupted) return;
  const vehicle = state.disrupted.vehicles.find(v => v.id === state.selectedVehicle); if (!vehicle) return;
  const source = state.scenario.vehicles.find(v => v.id === vehicle.id);
  const completed = vehicle.jobs.filter(job => job.completedS !== null && job.completedS <= state.time).length;
  $('vehicle-status').textContent = state.time < source.startTimeS ? 'Waiting for dispatch' : state.time >= vehicle.finishS ? 'Run finished' : `${completed} / ${vehicle.jobs.length} stops completed`;
}
function updateInspector() {
  if (!state.disrupted || !state.selectedVehicle) return;
  const vehicle = state.disrupted.vehicles.find(v => v.id === state.selectedVehicle);
  const base = state.baseline.vehicles.find(v => v.id === state.selectedVehicle); if (!vehicle || !base) return;
  $('vehicle-name').textContent = vehicle.id.toUpperCase();
  $('route-baseline-distance').textContent = distanceText(base.distanceM); $('route-scenario-distance').textContent = distanceText(vehicle.distanceM);
  const start = state.scenario.vehicles.find(v => v.id === vehicle.id).startTimeS;
  $('route-baseline-time').textContent = `${clock(base.finishS - start)} elapsed`; $('route-scenario-time').textContent = `${clock(vehicle.finishS - start)} elapsed`;
  const unreachable = vehicle.jobs.filter(job => job.status === 'unreachable').length;
  const difference = vehicle.distanceM - base.distanceM;
  const reroutes = vehicle.reroutes ?? [];
  const changed = vehicle.segments.some((seg, i) => seg.edgeId !== base.segments[i]?.edgeId) || vehicle.segments.length !== base.segments.length;
  let reason = 'This vehicle keeps its original route. The selected closure does not change the shortest available path at its arrival times.';
  if (!state.scenario.closures.length) reason = 'All roads remain open. Both runs use identical demand, dispatch times, and delivery order, so their results match.';
  else if (unreachable) reason = `${unreachable} assigned ${unreachable === 1 ? 'stop is' : 'stops are'} disconnected when this vehicle tries to route there. Each is recorded as unreachable; the vehicle stays at its current junction and tries the next stop.`;
  else if (changed) reason = `${reroutes.length} routing ${reroutes.length === 1 ? 'decision' : 'decisions'} changed after a closure. ${difference > 0 ? `${distanceText(difference)} of extra travel` : 'A different path'} connects the same stops in the same order. Roads already entered are completed before rerouting.`;
  $('route-reason').textContent = reason;
  $('route-path').hidden = state.scenario.nodes.length > 12;
  if (!$('route-path').hidden) {
    const segments = vehicle.segments.slice(0, 24);
    const path = segments.length ? [segments[0].from, ...segments.map(segment => segment.to)] : [state.scenario.vehicles.find(item => item.id === vehicle.id).startNode];
    $('route-path').textContent = `Computed path: ${path.join(' → ')}${vehicle.segments.length > segments.length ? ' → …' : ''}`;
  } else $('route-path').textContent = '';
  $('job-count').textContent = `${vehicle.jobs.length} STOPS · FINAL OUTCOMES`;
  $('job-list').replaceChildren(...vehicle.jobs.map((job, index) => {
    const item = node('li', undefined, `job-item ${job.status === 'on-time' ? 'done' : job.status}`);
    const row = node('div'); row.append(node('strong', `Stop ${String(index + 1).padStart(2, '0')}`), node('small', job.status === 'unreachable' ? 'NO PATH' : job.status === 'late' ? latenessText(job.arrivalS - job.dueTimeS) : 'ON TIME'));
    item.append(row, node('p', job.status === 'unreachable' ? `Due ${clock(job.dueTimeS)} · skipped` : `Arrived ${clock(job.arrivalS)} · due ${clock(job.dueTimeS)}`)); return item;
  }));
  updateVehicleStatus(); map.invalidateFrame();
}
function loadExperiment(experiment, workspace = {}) {
  const validated = validateExperiment(experiment);
  importRevision += 1; setPlaying(false); state.experiment = validated;
  state.selectedVariantId = validated.variants.some(variant => variant.id === workspace.selectedVariantId) ? workspace.selectedVariantId : validated.variants[0].id;
  state.scenario = scenarioForVariant(validated, state.selectedVariantId); state.baseline = null; state.disrupted = null; state.allResults = null;
  state.selectedVehicle = workspace.selectedVehicle ?? null; state.time = workspace.time ?? 0; state.zoom = workspace.zoom ?? 1;
  if (workspace.speed !== undefined) state.speed = workspace.speed;
  $('speed').value = String(state.speed);
  setView(workspace.view ?? state.view); setEditing(workspace.editing ?? state.editing);
  $('closure-time').step = state.lessonActive ? '1' : '60';
  if (workspace.closureTime !== undefined) $('closure-time').value = workspace.closureTime;
  if (workspace.roadDirection !== undefined) $('road-direction').value = workspace.roadDirection;
  // Establish the new timeline before setting time; a previous tiny run must not
  // clamp the restored experiment's replay position while its worker is pending.
  $('timeline').max = String(workspace.timelineMax ?? Math.max(state.scenario.durationS ?? 1, state.time, 1));
  // A successful import or reset starts an unfiltered picker; lesson return
  // explicitly restores its prior query and visible selection.
  $('road-search').value = workspace.roadSearch ?? '';
  $('road-select').value = '';
  setTime(state.time); map.invalidate(); makeRoads();
  filterRoads(workspace.roadId); updateControls();
  if (workspace.variantName !== undefined) $('variant-name').value = workspace.variantName;
  compute();
}
function loadScenario(scenario) { loadExperiment(experimentFromScenario(scenario)); }

function updateLesson() {
  $('lesson-panel').hidden = !state.lessonActive;
  $('import-button').disabled = state.lessonActive;
  $('lesson-import-help').hidden = !state.lessonActive;
  $('reset-button').textContent = state.lessonActive ? '↺ Reset lesson' : '↺ Reset experiment';
  $('closure-time').step = state.lessonActive ? '1' : '60';
  for (const id of ['try-example-button', 'quick-example-button', 'guide-example-button']) $(id).disabled = state.lessonActive;
  for (const step of lessonSteps) {
    const button = $('lesson-' + step.id);
    button.disabled = state.lessonModified || !state.experiment.variants.some(variant => variant.id === step.id);
    button.setAttribute('aria-pressed', String(state.lessonActive && !state.lessonModified && state.selectedVariantId === step.id));
  }
  const step = lessonSteps.find(item => item.id === state.selectedVariantId);
  $('lesson-story').textContent = state.lessonModified ? 'Your edits changed the example; reset lesson to repeat.' : step?.story ?? '';
}
function canFocus(element) {
  return element?.isConnected && !element.matches(':disabled') && !element.closest('[hidden], [inert]') && element.getClientRects().length > 0 && !['hidden', 'collapse'].includes(getComputedStyle(element).visibility);
}
function focusFirst(elements) {
  for (const element of elements) {
    if (!canFocus(element)) continue;
    element.focus();
    if (document.activeElement === element) return;
  }
}
function dialogControls(dialog) {
  return [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]')].filter(element => element.tabIndex >= 0 && canFocus(element));
}
function dialogReturnTargets(dialog, source) {
  if (dialog === $('impact-dialog')) return [source, $('impact-button'), $('run-experiment')];
  if (dialog === $('review-dialog')) return [source, $('review-button'), $('run-experiment')];
  return dialog === $('guide-dialog') ? [source, $('guide-button'), $('assumptions-button'), $('try-example-button')] : [source, $('try-example-button'), $('quick-example-button'), $('assumptions-button')];
}
function openDialog(dialog, source, initialFocus) {
  if (dialog.open) return;
  dialogFocus = { dialog, source, previousFocus: document.activeElement };
  dialog.showModal();
  focusFirst([initialFocus, ...dialogControls(dialog), dialog]);
}
function closeDialog(dialog, { restore = true, target = dialogFocus?.source } = {}) {
  if (!dialog.open) return;
  // Native close events are queued. Finish app-driven focus changes now, before
  // another dialog or lesson can take over; the eventual event must do nothing.
  if (dialogFocus?.dialog === dialog) dialogFocus = null;
  dialog.close();
  if (restore) focusFirst(dialogReturnTargets(dialog, target));
}
function restoreDialogFocus(dialog) {
  // Native Escape still closes the dialog normally. Ignore an older close event
  // if this dialog has reopened, or a different dialog now owns focus.
  if (dialog.open || dialogFocus?.dialog !== dialog) return;
  const { source, previousFocus } = dialogFocus;
  dialogFocus = null;
  // Native close may return focus before its queued event arrives. Do not undo
  // a newer focus choice outside the dialog; body is not a useful destination.
  const current = document.activeElement;
  if (current !== previousFocus && current !== document.body && current !== document.documentElement && canFocus(current)) return;
  focusFirst(dialogReturnTargets(dialog, source));
}
function containDialogTab(event, dialog) {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented || !dialog.open) return;
  const controls = dialogControls(dialog), index = controls.indexOf(document.activeElement);
  if (!controls.length || index < 0 || (event.shiftKey ? index === 0 : index === controls.length - 1)) {
    event.preventDefault();
    focusFirst([event.shiftKey ? controls.at(-1) : controls[0], dialog]);
  }
}
function showLessonConfirmation(source) {
  if (state.lessonActive || $('lesson-dialog').open) return;
  setPlaying(false);
  const trigger = source === $('guide-example-button') ? $('try-example-button') : source;
  closeDialog($('guide-dialog'), { restore: false });
  openDialog($('lesson-dialog'), trigger, $('lesson-cancel'));
}
function resetLesson() {
  if (!state.lessonActive || !lessonBackup) return;
  state.lessonModified = false;
  loadExperiment(createTutorialExperiment(), { selectedVariantId: 'clear', time: 0, speed: 1, view: 'compare', zoom: 1, editing: false, closureTime: '10', roadDirection: 'forward' });
}
function startLesson() {
  if (!$('lesson-dialog').open || state.lessonActive || lessonBackup) return;
  // Only the confirmed transition takes an independently validated snapshot.
  // Opening, Cancel and native Escape leave experiments and workers untouched.
  lessonBackup = {
    focus: dialogFocus?.source,
    experiment: validateExperiment(state.experiment),
    workspace: { selectedVariantId: state.selectedVariantId, time: state.time, speed: state.speed, view: state.view, zoom: state.zoom, selectedVehicle: state.selectedVehicle, editing: state.editing, closureTime: $('closure-time').value, roadDirection: $('road-direction').value, roadId: $('road-select').value, roadSearch: $('road-search').value, variantName: $('variant-name').value, timelineMax: $('timeline').max },
  };
  state.lessonActive = true;
  resetLesson();
  closeDialog($('lesson-dialog'), { target: $('lesson-clear') });
  toast('Tiny example ready. Your previous experiment is kept in memory until you return.');
}
function returnToExperiment() {
  if (!state.lessonActive || !lessonBackup) return;
  const backup = lessonBackup;
  state.lessonActive = false; state.lessonModified = false;
  loadExperiment(backup.experiment, backup.workspace);
  lessonBackup = null;
  focusFirst(dialogReturnTargets($('lesson-dialog'), backup.focus));
  toast('Your experiment and view are restored. Playback is paused; results are being recomputed.');
}

function updateReviewAvailability() {
  const button = $('review-button'), disabled = state.pending || !state.allResults;
  if (disabled && document.activeElement === button) focusFirst([$('run-experiment')]);
  button.disabled = disabled;
}
function invalidateReview() {
  reviewRevision += 1; preparedReview = null;
  // A pending import can finish while a download has focus. Move it before
  // disabling that control, without reclaiming a newer focus choice.
  if ($('review-dialog').open && [$('download-review'), $('download-bundle')].includes(document.activeElement)) focusFirst([$('review-close')]);
  for (const id of ['download-review', 'download-bundle']) $(id).disabled = true;
  $('review-status').textContent = 'Results changed. Close this window and finish a new run before exporting.';
  updateReviewAvailability();
}
async function prepareReview() {
  if (state.pending || !state.allResults) return;
  setPlaying(false);
  openDialog($('review-dialog'), $('review-button'), $('review-dialog-title'));
  const id = ++reviewRevision, experiment = state.experiment, results = state.allResults;
  preparedReview = null;
  for (const button of ['download-review', 'download-bundle']) $(button).disabled = true;
  $('review-status').textContent = 'Preparing the complete results from this run…';
  try {
    const files = await createBrowserReview(experiment, results);
    if (id !== reviewRevision || !reviewIsCurrent(experiment, results) || !$('review-dialog').open) return;
    preparedReview = { ...files, experiment, results };
    $('review-status').textContent = `${experiment.name} · ${experiment.variants.length} variants. Both files are ready. Acceptance: not evaluated (no thresholds configured).`;
    for (const button of ['download-review', 'download-bundle']) $(button).disabled = false;
  } catch (error) {
    if (id !== reviewRevision || !$('review-dialog').open) return;
    $('review-status').textContent = `Review could not be prepared. ${formatInputError(error)} Close and try again, or use the experiment export and CLI.`;
  }
}
function reviewIsCurrent(experiment, results) {
  return !state.pending && state.experiment === experiment && state.allResults === results;
}
function downloadReview(kind) {
  const packet = preparedReview;
  if (!packet || !$('review-dialog').open || !reviewIsCurrent(packet.experiment, packet.results)) { invalidateReview(); return; }
  const markdown = kind === 'review';
  const blob = new Blob([markdown ? packet.reviewMarkdown : packet.bundleJson], { type: markdown ? 'text/markdown;charset=utf-8' : 'application/json' });
  const url = URL.createObjectURL(blob), link = node('a');
  link.href = url; link.download = markdown ? 'REVIEW.md' : 'bundle.json';
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`${markdown ? 'Readable review' : 'Complete results bundle'} download requested. Save both files together.`);
}
$('review-button').addEventListener('click', prepareReview);
$('download-review').addEventListener('click', () => downloadReview('review'));
$('download-bundle').addEventListener('click', () => downloadReview('bundle'));
$('review-close').addEventListener('click', () => { invalidateReview(); closeDialog($('review-dialog')); });
$('review-dialog').addEventListener('cancel', invalidateReview);

function updateImpactAvailability() {
  const button = $('impact-button'), disabled = state.pending || !state.allResults;
  if (disabled && document.activeElement === button) focusFirst([$('run-experiment')]);
  button.disabled = disabled;
}
function impactIsCurrent() {
  return inspectedImpact && !state.pending && inspectedImpact.experiment === state.experiment && inspectedImpact.results === state.allResults;
}
function invalidateImpact() {
  inspectedImpact = null; impactPage = 0;
  // Move focus before disabling a control or hiding its scroll region.
  if ($('impact-dialog').open && $('impact-dialog').contains(document.activeElement) && document.activeElement !== $('impact-close')) focusFirst([$('impact-close')]);
  for (const id of ['impact-variant', 'impact-filter', 'impact-previous', 'impact-next']) $(id).disabled = true;
  $('impact-rows').replaceChildren(); $('impact-table-region').hidden = true;
  $('impact-summary').textContent = ''; $('impact-metrics').textContent = '';
  $('impact-status').textContent = 'Results changed. Close this window and finish a new run before inspecting deliveries.';
  updateImpactAvailability();
}
function updateImpactSelection() {
  if (!$('impact-dialog').open || !impactIsCurrent()) return;
  try {
    inspectedImpact.report = createBrowserImpact(state.experiment, state.allResults, state.selectedVariantId);
    $('impact-variant').value = state.selectedVariantId; impactPage = 0; renderImpact();
  } catch (error) { invalidateImpact(); $('impact-status').textContent = `Delivery comparison unavailable. ${formatInputError(error)}`; }
}
function renderImpact() {
  if (!$('impact-dialog').open || !impactIsCurrent() || inspectedImpact.report.variant.id !== state.selectedVariantId) { invalidateImpact(); return; }
  const report = inspectedImpact.report, summary = report.summary;
  const page = pageDeliveryImpact(report, $('impact-filter').value, impactPage);
  impactPage = page.pageIndex;
  $('impact-summary').textContent = `${summary.changedJobs} of ${summary.totalJobs} delivery outcomes changed; ${summary.unchangedJobs} unchanged. Status changes: ${summary.statusChangedJobs}. Arrival changes: ${summary.arrivalChangedJobs}. Same-status arrival changes: ${report.sameStatusArrivalChanges}.`;
  $('impact-metrics').textContent = `Baseline → ${report.variant.name}: ${report.baselineMetrics.completedJobs} → ${report.variantMetrics.completedJobs} completed; ${report.baselineMetrics.unreachableJobs} → ${report.variantMetrics.unreachableJobs} unreachable. Final outcomes, independent of replay time.`;
  const names = { changed: 'Changed outcomes', status: 'Status changes', timing: 'Same-status arrival changes', all: 'All deliveries' };
  $('impact-table-caption').textContent = `${report.variant.name} compared with the clear-road baseline. ${names[page.filter]}.`;
  const timing = (before, after, difference) => {
    const cell = node('td');
    const time = value => value === null ? 'Not reached' : `${value} s`;
    cell.append(node('span', `${time(before)} → ${time(after)}`), node('small', difference === null ? 'Not comparable' : `Change ${difference > 0 ? '+' : ''}${difference} s`));
    return cell;
  };
  const statuses = { 'on-time': 'On time', late: 'Late', unreachable: 'Unreachable' };
  $('impact-rows').replaceChildren(...page.jobs.map(job => {
    const row = node('tr'), identity = node('th'); identity.setAttribute('scope', 'row');
    identity.append(node('strong', job.id), node('small', `${job.vehicleId} · ${job.nodeId}`), node('small', `Arrival deadline ${job.dueTimeS} s`));
    row.append(identity, node('td', `${statuses[job.baseline.status]} → ${statuses[job.variant.status]}`), timing(job.baseline.arrivalS, job.variant.arrivalS, job.arrivalDeltaS), timing(job.baseline.completedS, job.variant.completedS, job.completedDeltaS), timing(job.baseline.delayS, job.variant.delayS, job.delayDeltaS));
    return row;
  }));
  const active = document.activeElement;
  $('impact-table-region').hidden = !page.jobs.length;
  $('impact-previous').disabled = page.pageIndex === 0;
  $('impact-next').disabled = page.pageIndex + 1 >= page.pageCount;
  const counts = `${page.matchingJobs} matching of ${page.totalJobs} total deliveries. ${page.totalJobs - page.matchingJobs} excluded by this filter. Original input order, not severity ranking.`;
  const empty = !page.totalJobs ? 'This experiment has no deliveries.' : `No ${names[page.filter].toLowerCase()}. Choose All deliveries to inspect unchanged outcomes too.`;
  $('impact-status').textContent = page.jobs.length ? `Showing ${page.from}–${page.to}; page ${page.pageIndex + 1} of ${page.pageCount}. ${counts}` : `${empty} ${counts}`;
  if ([ $('impact-previous'), $('impact-next') ].includes(active) && active.disabled || active === $('impact-table-region') && !page.jobs.length) focusFirst([$('impact-previous'), $('impact-next'), $('impact-filter'), $('impact-close')]);
}
function inspectDeliveries() {
  if (state.pending || !state.allResults || $('impact-dialog').open) return;
  try {
    const report = createBrowserImpact(state.experiment, state.allResults, state.selectedVariantId);
    inspectedImpact = { experiment: state.experiment, results: state.allResults, report }; impactPage = 0;
    $('impact-variant').replaceChildren(...state.experiment.variants.map(variant => { const option = node('option', variant.name); option.value = variant.id; return option; }));
    $('impact-variant').value = state.selectedVariantId; $('impact-filter').value = 'changed';
    $('impact-variant').disabled = false; $('impact-filter').disabled = false;
    setPlaying(false); openDialog($('impact-dialog'), $('impact-button'), $('impact-dialog-title')); renderImpact();
  } catch (error) { invalidateImpact(); toast(`Delivery comparison unavailable. ${formatInputError(error)}`, true); }
}
$('impact-button').addEventListener('click', inspectDeliveries);
$('impact-variant').addEventListener('change', () => { if (impactIsCurrent() && $('impact-dialog').open) selectVariant($('impact-variant').value); });
$('impact-filter').addEventListener('change', () => { impactPage = 0; renderImpact(); });
$('impact-previous').addEventListener('click', () => { impactPage -= 1; renderImpact(); });
$('impact-next').addEventListener('click', () => { impactPage += 1; renderImpact(); });
$('impact-close').addEventListener('click', () => { invalidateImpact(); closeDialog($('impact-dialog')); });
$('impact-dialog').addEventListener('cancel', invalidateImpact);

for (const name of ['input', 'change']) $('closure-time').addEventListener(name, (event) => { $('closure-time-label').textContent = clock(event.target.value); updateRoadDetails(); });
$('road-search').addEventListener('input', () => filterRoads());
$('clear-road-search').addEventListener('click', () => { $('road-search').value = ''; filterRoads(); });
$('road-select').addEventListener('change', updateRoadDetails);
$('road-direction').addEventListener('change', updateRoadDetails);
$('toggle-road').addEventListener('click', () => { const edge = selectedRoad(); if (edge) toggleRoad(edge.id); });
$('edit-roads').setAttribute('aria-pressed', 'false');
$('edit-roads').addEventListener('click', () => setEditing(!state.editing));
for (const view of ['disruption', 'baseline', 'compare']) $('view-' + view).addEventListener('click', () => setView(view));
$('vehicle-select').addEventListener('change', (event) => { state.selectedVehicle = event.target.value; updateInspector(); });
$('play-button').addEventListener('click', () => { if (state.time >= Number($('timeline').max)) setTime(0); setPlaying(!state.playing); });
$('timeline').addEventListener('input', (event) => { setPlaying(false); setTime(event.target.value); });
$('speed').addEventListener('change', (event) => { state.speed = Number(event.target.value); });
$('replay-button').addEventListener('click', () => { setPlaying(false); setTime(0); });
$('zoom-in').addEventListener('click', () => { state.zoom = Math.min(2.5, state.zoom * 1.2); map.invalidate(); });
$('zoom-out').addEventListener('click', () => { state.zoom = Math.max(.65, state.zoom / 1.2); map.invalidate(); });
$('zoom-reset').addEventListener('click', () => { state.zoom = 1; map.invalidate(); });
$('reset-button').addEventListener('click', () => { if (state.lessonActive) { resetLesson(); focusFirst([$('lesson-clear'), $('return-experiment')]); toast('Lesson reset. Your previous experiment is still kept in memory.'); return; } setEditing(false); setView('disruption'); $('closure-time').value = '300'; loadExperiment(createInitialExperiment()); toast('Original experiment restored: seed 42, Market Bridge closure.'); });
$('export-button').addEventListener('click', () => { const serialized = exportExperiment(state.experiment); const blob = new Blob([serialized], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = node('a'); link.href = url; link.download = `detourlab-experiment-${state.experiment.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('All variants exported. Reproduce them with the experiment CLI.'); });
$('import-button').addEventListener('click', () => { if (!state.lessonActive) $('import-input').click(); });
$('import-input').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file || state.lessonActive) return;
  const id = ++importRevision;
  try {
    if (file.size > FILE_INPUT_MAX_BYTES) throw new Error('File must be at most 2 MiB.');
    const bytes = await file.arrayBuffer();
    // Newer selections, lesson transitions and Reset supersede asynchronous file reads.
    if (id !== importRevision || state.lessonActive) return;
    const experiment = parseExperiment(decodeFileInput(bytes)); loadExperiment(experiment);
    toast(`Loaded “${experiment.name}”. Comparing ${experiment.variants.length} independent variants.`);
  } catch (error) {
    if (id === importRevision) toast(`Import rejected. ${formatInputError(error)}`, true);
  }
});
$('variant-select').addEventListener('change', event => selectVariant(event.target.value));
$('rename-variant').addEventListener('click', () => {
  const name = $('variant-name').value.trim();
  if (!name || name.length > EXPERIMENT_LIMITS.nameLength) { toast('Give the variant a short nonempty name.', true); return; }
  changedExperiment({ ...state.experiment, variants: state.experiment.variants.map(variant => variant.id === state.selectedVariantId ? { ...variant, name } : variant) });
});
$('duplicate-variant').addEventListener('click', () => {
  if (state.experiment.variants.length >= EXPERIMENT_LIMITS.maxVariants) return;
  let id = 'variant-1', number = 1; while (state.experiment.variants.some(variant => variant.id === id)) id = `variant-${++number}`;
  const source = activeVariant(); const variant = { id, name: `${source.name.slice(0, 70)} copy`, closures: structuredClone(source.closures) };
  changedExperiment({ ...state.experiment, variants: [...state.experiment.variants, variant] }, id);
});
$('delete-variant').addEventListener('click', () => {
  if (state.experiment.variants.length <= EXPERIMENT_LIMITS.minVariants) return;
  const variants = state.experiment.variants.filter(variant => variant.id !== state.selectedVariantId); changedExperiment({ ...state.experiment, variants }, variants[0].id);
});
$('cancel-run').addEventListener('click', () => { importRevision += 1; cancelComputation(); });
$('run-experiment').addEventListener('click', () => { importRevision += 1; compute(); });
for (const id of ['try-example-button', 'quick-example-button', 'guide-example-button']) $(id).addEventListener('click', () => showLessonConfirmation($(id)));
$('lesson-start').addEventListener('click', startLesson);
$('lesson-cancel').addEventListener('click', () => closeDialog($('lesson-dialog')));
for (const id of ['guide-dialog', 'lesson-dialog', 'review-dialog', 'impact-dialog']) {
  const dialog = $(id);
  dialog.addEventListener('keydown', event => containDialogTab(event, dialog));
  dialog.addEventListener('close', () => restoreDialogFocus(dialog));
}
$('return-experiment').addEventListener('click', returnToExperiment);
for (const step of lessonSteps) $('lesson-' + step.id).addEventListener('click', () => {
  if (!state.lessonActive || state.lessonModified || !state.experiment.variants.some(variant => variant.id === step.id)) return;
  setPlaying(false); selectVariant(step.id); setView('compare'); setTime(step.time);
});
for (const id of ['guide-button', 'assumptions-button']) $(id).addEventListener('click', () => { setPlaying(false); openDialog($('guide-dialog'), $(id), $('guide-dialog-title')); });
$('guide-close').addEventListener('click', () => closeDialog($('guide-dialog')));
$('guide-dialog').addEventListener('click', (event) => { if (event.target === $('guide-dialog')) { const bounds = event.target.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog(event.target); } });
window.addEventListener('keydown', (event) => { if (event.code === 'Space' && !['INPUT','BUTTON','SELECT','TEXTAREA'].includes(document.activeElement.tagName) && !$('guide-dialog').open && !$('lesson-dialog').open && !$('review-dialog').open && !$('impact-dialog').open) { event.preventDefault(); $('play-button').click(); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) setPlaying(false); });
let previous = performance.now();
function frame(now) { const delta = Math.min((now - previous) / 1000, .1); previous = now; if (state.playing && !state.pending) { setTime(state.time + delta * state.speed); if (state.time >= Number($('timeline').max)) setPlaying(false); } map.render(now); requestAnimationFrame(frame); }
makeRoads(); updateControls(); compute(); requestAnimationFrame(frame);
