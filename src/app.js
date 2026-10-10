import { createDemoScenario, createPresets, validateScenario, LIMITS } from './scenario.js';
import { experimentFromScenario, validateExperiment, parseExperiment, scenarioForVariant, exportExperiment, EXPERIMENT_LIMITS } from './experiment.js';
import { NetworkMap } from './map.js';
import { createTutorialExperiment } from './tutorial.js';

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
let lessonDialogFocus = null;
const lessonSteps = [
  { id: 'clear', time: 0, story: 'With clear roads, the van takes A → B → C: 200 m and arrival at 20 s, before the 22 s deadline. Its run finishes at 23 s because delivery service takes 3 more seconds.' },
  { id: 'close-at-10', time: 10, story: 'At 10 s the van reaches B. B → C closes at that exact instant, so entry is blocked. It takes A → B → D → C instead: 260 m, arrival at 26 s, and 4 s late. The run finishes at 29 s, including 3 s of service.' },
  { id: 'close-at-11', time: 11, story: 'At 11 s the van is already on B → C: it entered at 10 s. It finishes that edge even though it closes. A → B → C stays 200 m, with arrival at 20 s and no late delivery. The run finishes at 23 s, including 3 s of service.' },
];
let roads = [];
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
function activeVariant() { return state.experiment.variants.find(variant => variant.id === state.selectedVariantId); }
function changedExperiment(experiment, selectedId = state.selectedVariantId) {
  const validated = validateExperiment(experiment);
  importRevision += 1;
  state.experiment = validated;
  if (state.lessonActive) state.lessonModified = true;
  state.selectedVariantId = selectedId;
  state.scenario = scenarioForVariant(state.experiment, selectedId);
  updateControls(); compute();
}
function replaceClosures(closures) {
  changedExperiment({ ...state.experiment, variants: state.experiment.variants.map(variant => variant.id === state.selectedVariantId ? { ...variant, closures } : variant) });
}
function setClosures(ids, atS = closureAt()) {
  const edgeIds = [...new Set(ids)].sort();
  replaceClosures(edgeIds.length ? [{ id: 'interactive-closure', edgeIds, atS }] : []);
}
function toggleRoad(id, forceReopen = false) {
  if (!id) return;
  const closed = closedIds();
  const edge = edgesById.get(id);
  const direction = $('road-direction').value || 'both';
  const pairs = forceReopen || direction === 'both' ? pairsFor(id) : direction === 'forward' ? [id] : pairsFor(id).filter(edgeId => { const item = edgesById.get(edgeId); return item.from === edge.to && item.to === edge.from; });
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
function updateVariants(preserveName = false) {
  $('experiment-name').textContent = state.experiment.name;
  $('variant-select').replaceChildren(...state.experiment.variants.map(variant => { const option = node('option', variant.name); option.value = variant.id; return option; }));
  $('variant-select').value = state.selectedVariantId;
  if (!preserveName) $('variant-name').value = activeVariant().name;
  $('variant-limit').textContent = `${state.experiment.variants.length} / ${EXPERIMENT_LIMITS.maxVariants} variants · edits stay independent`;
  $('duplicate-variant').disabled = state.experiment.variants.length >= EXPERIMENT_LIMITS.maxVariants;
  $('delete-variant').disabled = state.experiment.variants.length <= EXPERIMENT_LIMITS.minVariants;
  $('variant-results').replaceChildren(...state.experiment.variants.map(variant => {
    const result = state.allResults?.variants.find(item => item.id === variant.id);
    const button = node('button', undefined, 'variant-result');
    button.dataset.variant = variant.id; button.classList.toggle('active', variant.id === state.selectedVariantId); button.setAttribute('aria-pressed', String(variant.id === state.selectedVariantId));
    button.append(node('strong', variant.name));
    const numbers = node('div');
    if (result) {
      const metrics = result.result.metrics;
      numbers.append(node('span', distanceText(metrics.distanceM)), node('span', `${metrics.lateJobs} late`), node('span', `${metrics.unreachableJobs} unreachable`));
      const skipped = metrics.unreachableJobs > state.allResults.baseline.metrics.unreachableJobs;
      button.classList.toggle('has-skips', skipped);
      button.append(numbers, node('small', skipped ? `${metrics.completedJobs}/${metrics.totalJobs} completed · skipped work reduces distance` : `${result.delta.extraDistancePct > 0 ? '+' : ''}${result.delta.extraDistancePct.toFixed(1)}% distance · ${metrics.completedJobs}/${metrics.totalJobs} completed`));
    } else { numbers.append(node('span', state.pending ? 'Calculating…' : 'Run to compare')); button.append(numbers); }
    button.addEventListener('click', () => selectVariant(variant.id)); return button;
  }));
}
function updateEvents() {
  const edgeMap = new Map(state.scenario.edges.map(edge => [edge.id, edge]));
  $('event-list').replaceChildren(...state.scenario.closures.map(closure => {
    const row = node('div', undefined, 'event-row');
    const roads = [...new Set(closure.edgeIds.map(id => edgeMap.get(id).roadName))];
    row.append(node('strong', roads.join(', ')), node('small', `${closure.edgeIds.length} directed edges · ${closure.id}`));
    const controls = node('div', undefined, 'event-edit'), label = node('label', 'Start (sec)'), input = node('input');
    input.type = 'number'; input.min = '0'; input.max = String(LIMITS.maxTimeS); input.step = 'any'; input.value = String(closure.atS); input.setAttribute('aria-label', `Start time in seconds for ${closure.id}`);
    input.addEventListener('change', () => { const atS = Number(input.value); if (input.value.trim() === '' || !Number.isFinite(atS) || atS < 0 || atS > LIMITS.maxTimeS) { input.value = String(closure.atS); toast('Enter a closure time from 0 to 604800 seconds.', true); return; } replaceClosures(state.scenario.closures.map(item => item.id === closure.id ? { ...item, atS } : item)); });
    const remove = node('button', 'Remove'); remove.setAttribute('aria-label', `Remove closure event ${closure.id}`); remove.addEventListener('click', () => replaceClosures(state.scenario.closures.filter(item => item.id !== closure.id)));
    controls.append(label, input, remove); row.append(controls); return row;
  }));
}

function makeRoads() {
  const seen = new Set(); roads = []; edgesById = new Map(state.scenario.edges.map(edge => [edge.id, edge])); roadPairs = new Map();
  for (const edge of state.scenario.edges) { const key = [edge.from, edge.to].sort().join('|'); if (!roadPairs.has(key)) roadPairs.set(key, []); roadPairs.get(key).push(edge.id); }
  for (const edge of state.scenario.edges) { const key = [edge.from, edge.to].sort().join('|'); if (seen.has(key)) continue; seen.add(key); roads.push(edge); }
  roads.sort((a, b) => Number(b.id.startsWith('bridge')) - Number(a.id.startsWith('bridge')) || a.roadName.localeCompare(b.roadName) || a.id.localeCompare(b.id));
  $('road-select').replaceChildren(...roads.map(edge => { const option = node('option', `${edge.roadName} · ${edge.from.replace('node-', '')} → ${edge.to.replace('node-', '')}`); option.value = edge.id; return option; }));
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
  $('preset-list').replaceChildren(...presets.map((preset, index) => {
    const button = node('button', undefined, 'preset'); const active = preset.edgeIds.length === closed.size && preset.edgeIds.every(id => closed.has(id)); button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); button.dataset.preset = preset.id;
    const names = { central: ['Bridge works', 'A busy crossing goes offline'], 'all-bridges': ['River cut', 'Three crossings. One hard limit.'], clear: ['Clear roads', 'The unchanged control run'] };
    const [name, detail] = names[preset.id] ?? [preset.name, preset.description];
    const text = node('div'); text.append(node('strong', name), node('small', detail)); button.append(node('span', ['⌁','⊘','↗'][index] ?? '◇', 'preset-icon'), text); button.title = preset.description; button.addEventListener('click', () => { setClosures(preset.edgeIds); }); return button;
  }));
  const closedRoads = roads.filter(edge => pairsFor(edge.id).some(id => closed.has(id)));
  $('closed-roads').replaceChildren(...closedRoads.map(edge => { const button = node('button', `${edge.roadName} ×`, 'closure-chip'); button.title = `Reopen ${edge.roadName}, ${edge.from} to ${edge.to}`; button.setAttribute('aria-label', button.title); button.addEventListener('click', () => toggleRoad(edge.id, true)); return button; }));
  updateVariants(); updateEvents(); updateLesson(); map.invalidate();
}
function clearResults() {
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
function cancelComputation(message = 'Run canceled. Your variants are preserved.') {
  revision += 1; clearTimeout(workerTimeout); worker?.terminate(); worker = null; state.pending = false; setPlaying(false);
  state.allResults = null; state.baseline = null; state.disrupted = null; clearResults(); computationFailed(message);
  $('status-line').textContent = message; $('comparison-status').textContent = message; $('cancel-run').hidden = true; updateVariants(true); map.invalidateFrame();
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
  updateMetrics(); updateInspector(); updateVariants(true); map.invalidateFrame();
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
    clearTimeout(workerTimeout); state.pending = false; $('status-line').parentElement.setAttribute('aria-busy', 'false'); $('cancel-run').hidden = true;
    currentWorker.terminate(); if (worker === currentWorker) worker = null;
    if (data.error) { computationFailed(data.error); toast(`The experiment could not run: ${data.error}`, true); $('status-line').textContent = 'Experiment failed. Edit or import a smaller experiment.'; $('comparison-status').textContent = 'No partial results shown. ' + data.error; updateVariants(true); return; }
    state.allResults = { baseline: data.baseline, variants: data.variants }; showSelectedResult();
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
  setTime(state.time); map.invalidate(); makeRoads(); updateControls();
  if (roads.some(road => road.id === workspace.roadId)) $('road-select').value = workspace.roadId;
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
function showLessonConfirmation(source) {
  if (state.lessonActive || $('lesson-dialog').open) return;
  setPlaying(false);
  lessonDialogFocus = source === $('guide-example-button') ? $('try-example-button') : source;
  if ($('guide-dialog').open) $('guide-dialog').close();
  $('lesson-dialog').showModal(); $('lesson-cancel').focus();
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
    experiment: validateExperiment(state.experiment),
    workspace: { selectedVariantId: state.selectedVariantId, time: state.time, speed: state.speed, view: state.view, zoom: state.zoom, selectedVehicle: state.selectedVehicle, editing: state.editing, closureTime: $('closure-time').value, roadDirection: $('road-direction').value, roadId: $('road-select').value, variantName: $('variant-name').value, timelineMax: $('timeline').max },
  };
  state.lessonActive = true;
  resetLesson();
  lessonDialogFocus = $('lesson-clear'); $('lesson-dialog').close();
  toast('Tiny example ready. Your previous experiment is kept in memory until you return.');
}
function returnToExperiment() {
  if (!state.lessonActive || !lessonBackup) return;
  const backup = lessonBackup;
  state.lessonActive = false; state.lessonModified = false;
  loadExperiment(backup.experiment, backup.workspace);
  lessonBackup = null;
  $('try-example-button').focus();
  toast('Your experiment and view are restored. Playback is paused; results are being recomputed.');
}

$('closure-time').addEventListener('input', (event) => { $('closure-time-label').textContent = clock(event.target.value); });
$('closure-time').addEventListener('change', (event) => { $('closure-time-label').textContent = clock(event.target.value); });
$('toggle-road').addEventListener('click', () => toggleRoad($('road-select').value));
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
$('reset-button').addEventListener('click', () => { if (state.lessonActive) { resetLesson(); toast('Lesson reset. Your previous experiment is still kept in memory.'); return; } setEditing(false); setView('disruption'); $('closure-time').value = '300'; loadExperiment(createInitialExperiment()); toast('Original experiment restored: seed 42, Market Bridge closure.'); });
$('export-button').addEventListener('click', () => { const serialized = exportExperiment(state.experiment); const blob = new Blob([serialized], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = node('a'); link.href = url; link.download = `detourlab-experiment-${state.experiment.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('All variants exported. Reproduce them with the experiment CLI.'); });
$('import-button').addEventListener('click', () => { if (!state.lessonActive) $('import-input').click(); });
$('import-input').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file || state.lessonActive) return;
  const id = ++importRevision;
  try {
    if (file.size > LIMITS.maxBytes) throw new Error('File must be at most 2 MiB.');
    const text = await file.text();
    // Newer selections, lesson transitions and Reset supersede asynchronous file reads.
    if (id !== importRevision || state.lessonActive) return;
    const experiment = parseExperiment(text); loadExperiment(experiment);
    toast(`Loaded “${experiment.name}”. Comparing ${experiment.variants.length} independent variants.`);
  } catch (error) {
    if (id === importRevision) toast(`Import rejected. ${error.message}`, true);
  }
});
$('variant-select').addEventListener('change', event => selectVariant(event.target.value));
$('rename-variant').addEventListener('click', () => {
  const name = $('variant-name').value.trim();
  if (!name || name.length > EXPERIMENT_LIMITS.nameLength) { toast('Give the variant a short nonempty name.', true); return; }
  try { changedExperiment({ ...state.experiment, variants: state.experiment.variants.map(variant => variant.id === state.selectedVariantId ? { ...variant, name } : variant) }); } catch (error) { toast(error.message, true); }
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
$('lesson-cancel').addEventListener('click', () => $('lesson-dialog').close());
$('lesson-dialog').addEventListener('close', () => {
  const target = lessonDialogFocus;
  lessonDialogFocus = null;
  // A responsive entry can disappear while the dialog is open. Never restore
  // focus to that hidden trigger; the scene entry remains available at all sizes.
  (target?.getClientRects().length ? target : $('try-example-button')).focus();
});
$('return-experiment').addEventListener('click', returnToExperiment);
for (const step of lessonSteps) $('lesson-' + step.id).addEventListener('click', () => {
  if (!state.lessonActive || state.lessonModified || !state.experiment.variants.some(variant => variant.id === step.id)) return;
  setPlaying(false); selectVariant(step.id); setView('compare'); setTime(step.time);
});
for (const id of ['guide-button', 'assumptions-button']) $(id).addEventListener('click', () => { setPlaying(false); $('guide-dialog').showModal(); });
$('guide-dialog').addEventListener('click', (event) => { if (event.target === $('guide-dialog')) { const bounds = event.target.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.target.close(); } });
window.addEventListener('keydown', (event) => { if (event.code === 'Space' && !['INPUT','BUTTON','SELECT','TEXTAREA'].includes(document.activeElement.tagName) && !$('guide-dialog').open && !$('lesson-dialog').open) { event.preventDefault(); $('play-button').click(); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) setPlaying(false); });
let previous = performance.now();
function frame(now) { const delta = Math.min((now - previous) / 1000, .1); previous = now; if (state.playing && !state.pending) { setTime(state.time + delta * state.speed); if (state.time >= Number($('timeline').max)) setPlaying(false); } map.render(now); requestAnimationFrame(frame); }
makeRoads(); updateControls(); compute(); requestAnimationFrame(frame);
