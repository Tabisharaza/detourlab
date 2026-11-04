#!/usr/bin/env node
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir, platform, release, arch } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequestHandler } from '../../scripts/serve.js';
import { canonicalExperiment, exportExperiment, experimentFromScenario, simulateExperiment, validateExperiment } from '../../src/experiment.js';
import { createDemoScenario } from '../../src/scenario.js';
import { createTutorialExperiment } from '../../src/tutorial.js';
import { exportReplayBookmark } from '../../src/replay-bookmark.js';
import { launchChromium } from '../browser-check/chromium.js';
import { parseBrowserCheckArguments, finishBrowserEvidence, removeOwnedBrowserDirectory, documentReadyExpression } from '../browser-check/run.js';
import { nativeKeySequence } from '../replay-events-check/run.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
export const usage = `Optional local Chromium experiment undo/redo checks
Usage: node tools/experiment-history-check/run.js --browser /absolute/path/to/chromium --out NEW_DIRECTORY
Fresh local profile, loopback source and synthetic inputs only. No installs or user profile.
Native Workers and unchanged app handlers/renderers are observed, never replaced.
Trusted native keyboard activation; raw JPEG captures no larger than 1 MiB each.
Output must not exist. Failed runs retain source-hashed evidence and clean owned resources.
Not native-chooser, mobile-device, screen-reader, cross-browser or deployed-site certification.`;

/** Independent, bounded expected inputs for the real controls below. */
export function historyFixtureSequence(minimal) {
  const base = structuredClone(minimal);
  base.id = 'native-history-workspace'; base.name = 'Edit a plan, undo with confidence';
  base.baseScenario.vehicles[0].startTimeS = 0.25;
  base.baseScenario.vehicles.push({ id: 'van-2', startNode: 'D', startTimeS: 0.5 });
  base.baseScenario.jobs.push({ id: 'second-job', nodeId: 'C', vehicleId: 'van-2', dueTimeS: 22, serviceTimeS: 0.75 });
  const closed = structuredClone(base);
  closed.variants.find(item => item.id === 'clear').closures = [{ id: 'road-edit', edgeIds: ['bc'], atS: 60 }];
  const cutoff = structuredClone(closed); cutoff.variants.find(item => item.id === 'clear').closures[0].atS = 10.25;
  const renamed = structuredClone(cutoff); renamed.variants.find(item => item.id === 'clear').name = 'Morning detour';
  const duplicated = structuredClone(renamed);
  duplicated.variants.push({ id: 'variant-1', name: 'Morning detour copy', closures: structuredClone(renamed.variants[0].closures) });
  const deleted = structuredClone(duplicated); deleted.variants = deleted.variants.filter(item => item.id !== 'variant-1');
  const divergent = structuredClone(cutoff); divergent.variants[0].closures[0].atS = 11.25;
  return Object.fromEntries(Object.entries({ base, closed, cutoff, renamed, duplicated, deleted, divergent }).map(([key, value]) => [key, validateExperiment(value)]));
}

// Observation only. Every constructor, post, delivery and termination delegates
// to native Worker behavior. No synthetic result or app handler is installed.
const observeWorkers = `(() => {
  const NativeWorker = window.Worker, identities = new WeakMap();
  window.__historyCheck = { requests: [], results: [], terminated: [], errors: [], keyboardEvents: [] };
  const x = window.__historyCheck;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', event => x.results.push(event.data));
      this.addEventListener('error', event => x.errors.push(String(event.message)));
    }
    postMessage(value, ...rest) {
      identities.set(this, value.id); x.requests.push(structuredClone(value));
      return super.postMessage(value, ...rest);
    }
    terminate(...args) { x.terminated.push(identities.get(this)); return super.terminate(...args); }
  };
  for (const type of ['keydown', 'keypress', 'keyup', 'click']) document.addEventListener(type, event => {
    if (!['undo-edit', 'redo-edit'].includes(event.target.id)) return;
    x.keyboardEvents.push({ type, key: event.key || null, id: event.target.id, trusted: event.isTrusted });
  }, true);
  window.addEventListener('error', event => x.errors.push(String(event.message)));
  window.addEventListener('unhandledrejection', event => x.errors.push(String(event.reason)));
})();`;
const observeRenderers = `(async () => {
  const { NetworkMap } = await import('/src/map.js');
  const render = NetworkMap.prototype.render; window.__historyCheck.maps = {};
  NetworkMap.prototype.render = function(...args) {
    const result = render.apply(this, args); window.__historyCheck.maps[this.canvas.id] = this; return result;
  };
})();`;

export async function runExperimentHistoryCheck({ executable, output }) {
  await mkdir(output); // Exclusive, including failed runs: never overwrite evidence.
  const evidence = {
    format: 'detourlab-experiment-history-check', version: 1, status: 'running', startedAt: new Date().toISOString(),
    runtime: { node: process.version, os: platform(), release: release(), arch: arch() }, checks: [], screenshots: [], fixtures: [],
    limitations: [
      'Local headless Chromium and synthetic files only; not deployed, cross-browser, native chooser, mobile-device or assistive-technology certification.',
      'Native Worker request/message/termination observers delegate unchanged behavior. NetworkMap.render is called unchanged and its state references are read only.',
      'CDP file injection and DOM changes drive ordinary app handlers. Undo/Redo activation uses CDP keyboard events and requires trusted generated clicks.',
      'Two delayed-file checks hold a real File.arrayBuffer promise. No app handler or Worker delivery is replaced or fabricated.',
      'Canceled native Workers cannot be forced to deliver a stale result. The interrupted-run check verifies actual termination and no overwrite after the replacement completes; adversarial stale callbacks belong to separate source tests.',
      'Screenshots are unmodified captures; hashes and geometry are not visual inspection. Source hashes identify bytes, not signed provenance.',
    ],
  };
  let browser, server, temporary;
  try {
    const files = [
      'index.html', 'examples/minimal-experiment.json', 'scripts/serve.js',
      ...(await readdir(path.join(root, 'src'))).filter(file => /\.(js|css)$/u.test(file)).map(file => `src/${file}`),
      'tools/browser-check/chromium.js', 'tools/browser-check/run.js', 'tools/replay-events-check/run.js', 'tools/experiment-history-check/run.js',
    ].sort();
    evidence.sourceFiles = await Promise.all(files.map(async file => ({ path: file, sha256: hash(await readFile(path.join(root, file))) })));
    evidence.sourceSha256 = hash(JSON.stringify(evidence.sourceFiles));
    // Detect an absent/nonexecutable browser before any listener or subprocess.
    // Node-only failure tests therefore never open sockets or launch Chromium.
    assert.ok(typeof executable === 'string' && path.isAbsolute(executable), 'Choose an absolute browser executable.');
    await access(executable, constants.X_OK);
    temporary = await mkdtemp(path.join(tmpdir(), 'detourlab-history-'));
    const profile = path.join(temporary, 'profile'); await mkdir(profile);
    server = http.createServer(createRequestHandler(root)); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    browser = await launchChromium(executable, profile); evidence.browser = browser.version;
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params = {}) => browser.send(method, params, sessionId);
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const until = async (expression, description, timeout = 35000) => {
      const end = Date.now() + timeout;
      do { if (await evaluate(expression)) return; await delay(25); } while (Date.now() < end);
      throw new Error(`Timed out: ${description}`);
    };
    const check = (name, detail = {}) => { evidence.checks.push({ name, status: 'passed', ...detail }); console.log(`PASS ${name}`); };
    const frames = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
    const change = (id, value, event = 'change') => evaluate(`(() => {
      const element = document.getElementById(${JSON.stringify(id)});
      element.value = ${JSON.stringify(String(value))}; element.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
    })()`);
    const changeCutoff = value => evaluate(`(() => {
      const element = document.querySelector('#event-list input');
      element.value = ${JSON.stringify(String(value))}; element.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const ready = () => until("document.documentElement?.dataset.revision === String(window.__historyCheck.requests.at(-1)?.id) && document.getElementById('cancel-run').hidden", 'current native Worker completion');
    const snapshot = () => evaluate(`(() => {
      const x = window.__historyCheck, state = x.maps['network-map'].state;
      const get = id => document.getElementById(id);
      return {
        requests: x.requests.length, request: x.requests.at(-1), results: x.results, terminated: x.terminated, errors: x.errors,
        input: state.experiment, allResults: state.allResults, pending: state.pending, selectedId: state.selectedVariantId,
        vehicle: state.selectedVehicle, playing: state.playing, time: state.time, view: state.view, zoom: state.zoom,
        roadId: get('road-select').value, roadSearch: get('road-search').value, direction: get('road-direction').value,
        selectedOption: get('variant-select').value, variantName: get('variant-name').value,
        undoDisabled: get('undo-edit').disabled, redoDisabled: get('redo-edit').disabled,
        undoLabel: get('undo-edit').getAttribute('aria-label'), redoLabel: get('redo-edit').getAttribute('aria-label'),
        historyStatus: get('history-status').textContent, lesson: state.lessonActive,
        maps: Object.fromEntries(Object.entries(x.maps).map(([id, m]) => [id, {
          time: m.state.time, playing: m.state.playing, vehicle: m.state.selectedVehicle,
          baseline: !!m.state.baseline, disrupted: !!m.state.disrupted, points: m.vehiclePoints,
        }])), focusId: document.activeElement.id,
      };
    })()`);
    const verify = (state, expected, selectedId = 'clear') => {
      assert.equal(canonicalExperiment(state.input), canonicalExperiment(expected), 'current input is the independent expected experiment');
      assert.equal(canonicalExperiment(state.request.experiment), canonicalExperiment(expected), 'native request uses current restored input');
      const message = state.results.findLast(result => result.id === state.request.id); assert.ok(message, 'current native result was observed');
      const { id, ...ledger } = message; assert.equal(id, state.request.id);
      const node = simulateExperiment(expected); assert.deepEqual(ledger, node, 'complete native Worker result equals Node simulation');
      assert.deepEqual(state.allResults, { baseline: node.baseline, variants: node.variants }, 'rendered state uses only that complete result');
      assert.equal(state.selectedId, selectedId); assert.equal(state.selectedOption, selectedId);
      assert.equal(state.playing, false, 'history restoration stays paused'); assert.equal(state.pending, false);
      assert.deepEqual(state.errors, []);
    };
    const workspace = state => ({ vehicle: state.vehicle, view: state.view, zoom: state.zoom, roadId: state.roadId, roadSearch: state.roadSearch, direction: state.direction });
    const step = async (action, expected, selectedId = 'clear') => {
      const before = (await snapshot()).requests;
      await action(); await ready(); await frames(); const state = await snapshot();
      assert.equal(state.requests, before + 1, 'one successful input/history change requests one computation');
      verify(state, expected, selectedId); return state;
    };
    const press = async key => { for (const event of nativeKeySequence(key)) await send('Input.dispatchKeyEvent', event); await frames(); };
    const keyboard = async (id, key) => { await evaluate(`document.getElementById(${JSON.stringify(id)}).focus()`); await press(key); };
    const fixtureFile = async (name, text) => {
      const bytes = Buffer.from(text), file = path.join(output, name); await writeFile(file, bytes, { flag: 'wx' });
      evidence.fixtures.push({ file: name, sha256: hash(bytes), bytes: bytes.length }); return file;
    };
    const setFile = async (file, selector = '#import-input') => {
      const { root: document } = await send('DOM.getDocument');
      const { nodeId } = await send('DOM.querySelector', { nodeId: document.nodeId, selector });
      assert.ok(nodeId, `File input exists: ${selector}`); await send('DOM.setFileInputFiles', { nodeId, files: [file] });
    };
    const load = async (file, selector = '#import-input') => {
      const before = (await snapshot()).requests; await setFile(file, selector);
      await until(`window.__historyCheck.requests.length > ${before}`, 'file import requested'); await ready(); await frames(); return snapshot();
    };
    const boundary = state => { assert.equal(state.undoDisabled, true); assert.equal(state.redoDisabled, true); assert.match(state.historyStatus, /0 undo · 0 redo/u); };
    const capture = async (name, viewport) => {
      await until("document.getElementById('toast').hidden", 'natural toast dismissal before capture');
      await evaluate("document.querySelector('.edit-history').scrollIntoView({ block: 'center' })"); await frames();
      const geometry = await evaluate(`(() => {
        const panel = document.querySelector('.edit-history'), r = panel.getBoundingClientRect();
        return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth,
          panel: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
          controls: [...panel.querySelectorAll('button')].map(element => { const b = element.getBoundingClientRect();
            return { id: element.id, left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; }) };
      })()`);
      assert.equal(geometry.overflow, false);
      assert.ok(geometry.panel.left >= -1 && geometry.panel.right <= viewport.width + 1, 'history panel fits viewport width');
      for (const control of geometry.controls) assert.ok(control.left >= -1 && control.right <= viewport.width + 1 && control.top >= 0 && control.bottom <= viewport.height && control.height > 0, `history button is visible: ${control.id}`);
      const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 65, captureBeyondViewport: false });
      const bytes = Buffer.from(data, 'base64'); assert.ok(bytes.length <= 1024 * 1024, 'raw JPEG fits 1 MiB');
      await writeFile(path.join(output, name), bytes, { flag: 'wx' });
      evidence.screenshots.push({ file: name, sha256: hash(bytes), bytes: bytes.length, viewport, geometry,
        meaning: 'Unmodified local synthetic experiment-history controls; not a deployed screenshot or visual-inspection claim.' });
    };

    await send('Page.enable'); await send('Runtime.enable');
    const desktop = { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false };
    await send('Emulation.setDeviceMetricsOverride', desktop);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: observeWorkers });
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
    await until(documentReadyExpression, 'initial document and native Worker readiness');
    await evaluate(observeRenderers); await frames();
    await until("Boolean(window.__historyCheck.maps['network-map'])", 'observed unchanged renderer');
    const tiny = JSON.parse(await readFile(path.join(root, 'examples/minimal-experiment.json'), 'utf8'));
    const fixtures = historyFixtureSequence(tiny), { base, closed, cutoff, renamed, duplicated, deleted, divergent } = fixtures;
    const baseFile = await fixtureFile('history.experiment.json', exportExperiment(base));
    const bookmarkFile = await fixtureFile('history.replay.json', exportReplayBookmark(base, { variantId: 'close-at-11', vehicleId: 'van-1', timeS: 59.25, view: 'compare', zoom: 1 }));
    const invalidFile = await fixtureFile('invalid.experiment.json', '{"format":"not-an-experiment"}');
    let state = await load(baseFile); verify(state, base); boundary(state);
    await change('vehicle-select', 'van-2'); await click('view-split'); await click('zoom-in');
    await change('road-search', 'Second', 'input'); await change('road-select', 'bc'); await change('road-direction', 'forward');
    await change('closure-time', 60, 'input'); await change('timeline', 15, 'input'); await frames();
    const originalWorkspace = workspace(await snapshot());
    state = await step(() => click('toggle-road'), closed);
    assert.match(state.undoLabel, /Change road closure/u); assert.match(state.historyStatus, /1 undo · 0 redo/u);
    state = await step(() => changeCutoff(10.25), cutoff);
    assert.match(state.undoLabel, /Change closure time/u); assert.match(state.historyStatus, /2 undo · 0 redo/u);
    check('Directed road edit and exact fractional cutoff each compute once and match complete independent Node ledgers');

    await evaluate('window.__historyCheck.keyboardEvents = []');
    state = await step(() => keyboard('undo-edit', 'Enter'), closed);
    assert.deepEqual(workspace(state), originalWorkspace); assert.match(state.redoLabel, /Change closure time/u);
    await press('Tab'); assert.equal((await snapshot()).focusId, 'redo-edit', 'native Tab reaches Redo after Undo');
    state = await step(() => keyboard('redo-edit', 'Space'), cutoff);
    assert.deepEqual(workspace(state), originalWorkspace);
    const keyboardEvents = await evaluate('window.__historyCheck.keyboardEvents');
    for (const [id, key] of [['undo-edit', 'Enter'], ['redo-edit', ' ']]) {
      assert.ok(keyboardEvents.some(event => event.id === id && event.type === 'keydown' && event.key === key && event.trusted), 'native keydown reaches history control');
      assert.ok(keyboardEvents.some(event => event.id === id && event.type === 'click' && event.trusted), 'native keyboard generates a trusted history click');
    }
    const accessibleStatus = await evaluate("(() => { const e = document.getElementById('history-status'); return [e.getAttribute('role'), e.getAttribute('aria-live'), e.getAttribute('aria-atomic')]; })()");
    assert.deepEqual(accessibleStatus, ['status', 'polite', 'true']);
    check('Native Enter Undo and Space Redo restore input and selection paused, preserving the current workspace', { keyboardEvents });
    await capture('history-desktop.jpg', desktop);
    const narrow = { width: 390, height: 1100, deviceScaleFactor: 1, mobile: false };
    await send('Emulation.setDeviceMetricsOverride', narrow); await frames(); await capture('history-narrow.jpg', narrow);
    await send('Emulation.setDeviceMetricsOverride', desktop); await frames();
    check('Desktop and 390px history controls fit without horizontal overflow; raw JPEG evidence saved');

    await step(() => evaluate("document.getElementById('play-button').click(); document.getElementById('undo-edit').click()"), closed);
    state = await step(() => click('undo-edit'), base);
    assert.equal(state.undoDisabled, true); const atStart = state.requests;
    await click('undo-edit'); assert.equal((await snapshot()).requests, atStart, 'disabled boundary cannot schedule a run');
    await step(() => click('redo-edit'), closed); state = await step(() => click('redo-edit'), cutoff);
    assert.equal(state.redoDisabled, true);
    const beforeNoop = state;
    await change('variant-name', ''); await click('rename-variant');
    await change('variant-name', 'Clear roads'); await click('rename-variant');
    await changeCutoff(-1); await changeCutoff(10.25);
    await change('variant-select', 'close-at-11'); await change('variant-select', 'clear'); await frames();
    state = await snapshot(); verify(state, cutoff);
    assert.equal(state.requests, beforeNoop.requests); assert.equal(state.historyStatus, beforeNoop.historyStatus);
    check('Invalid names/times, unchanged edits, selection-only navigation and disabled boundaries create no history or computation');

    await change('variant-name', 'Morning detour'); state = await step(() => click('rename-variant'), renamed);
    assert.match(state.undoLabel, /Rename variant/u);
    state = await step(() => click('duplicate-variant'), duplicated, 'variant-1'); assert.match(state.undoLabel, /Duplicate variant/u);
    state = await step(() => click('delete-variant'), deleted); assert.match(state.undoLabel, /Remove variant/u);
    await step(() => click('undo-edit'), duplicated, 'variant-1');
    await step(() => click('redo-edit'), deleted);
    await step(() => click('undo-edit'), duplicated, 'variant-1');
    await step(() => click('undo-edit'), renamed);
    state = await step(() => click('undo-edit'), cutoff);
    assert.equal(state.redoDisabled, false);
    check('Variant rename, duplicate and removal restore exact independent inputs and selected variant through Undo/Redo');
    state = await step(() => changeCutoff(11.25), divergent);
    assert.equal(state.redoDisabled, true); assert.match(state.historyStatus, /0 redo/u);
    const afterDivergence = state.requests; await click('redo-edit'); assert.equal((await snapshot()).requests, afterDivergence);
    check('A divergent successful edit clears the redo branch; disabled Redo cannot resurrect removed variants');

    const interrupted = await evaluate(`(() => {
      const x = window.__historyCheck, input = document.querySelector('#event-list input');
      input.value = '12.25'; input.dispatchEvent(new Event('change', { bubbles: true }));
      const canceledId = x.requests.at(-1).id, wasPending = x.maps['network-map'].state.pending;
      document.getElementById('undo-edit').click();
      const state = x.maps['network-map'].state;
      return { canceledId, replacementId: x.requests.at(-1).id, wasPending, pending: state.pending,
        noResults: state.allResults === null && state.baseline === null && state.disrupted === null, terminated: [...x.terminated] };
    })()`);
    assert.equal(interrupted.wasPending, true); assert.equal(interrupted.pending, true); assert.equal(interrupted.noResults, true);
    assert.notEqual(interrupted.canceledId, interrupted.replacementId); assert.ok(interrupted.terminated.includes(interrupted.canceledId));
    await ready(); await frames(); state = await snapshot(); verify(state, divergent);
    assert.equal(state.request.id, interrupted.replacementId);
    await evaluate('new Promise(resolve => setTimeout(resolve, 100))'); await frames(); state = await snapshot();
    verify(state, divergent); assert.equal(state.request.id, interrupted.replacementId);
    check('Undo terminates an actual pending Worker, clears result layers and leaves only the replacement ledger visible', { interrupted });

    const holdRead = () => evaluate(`(() => {
      const native = File.prototype.arrayBuffer, x = window.__historyCheck;
      x.heldRead = false; x.readReleased = false;
      File.prototype.arrayBuffer = function(...args) {
        File.prototype.arrayBuffer = native; const pending = native.apply(this, args); x.heldRead = true;
        return new Promise((resolve, reject) => { x.releaseRead = () => pending.then(value => { x.readReleased = true; resolve(value); }, reject); });
      };
    })()`);
    const releaseRead = async () => {
      await evaluate('window.__historyCheck.releaseRead()');
      await until('window.__historyCheck.readReleased', 'held native file read released');
      await evaluate('new Promise(resolve => setTimeout(resolve, 0))'); await frames();
    };
    await holdRead(); await setFile(baseFile); await until('window.__historyCheck.heldRead', 'held native experiment read');
    state = await step(() => click('undo-edit'), cutoff); const afterImportUndo = state.requests;
    await releaseRead(); state = await snapshot(); verify(state, cutoff); assert.equal(state.requests, afterImportUndo);
    await change('variant-name', 'Morning detour'); await step(() => click('rename-variant'), renamed);
    await holdRead(); await setFile(bookmarkFile, '#replay-input'); await until('window.__historyCheck.heldRead', 'held native bookmark read');
    state = await step(() => click('undo-edit'), cutoff); const afterBookmarkUndo = state.requests, afterBookmarkWorkspace = workspace(state);
    await releaseRead(); state = await snapshot(); verify(state, cutoff); assert.equal(state.requests, afterBookmarkUndo);
    assert.deepEqual(workspace(state), afterBookmarkWorkspace); assert.notEqual(state.time, 59.25);
    check('Undo wins over delayed native experiment and replay-bookmark reads; stale files cannot restore input or perspective');

    const beforeRejected = state;
    await setFile(invalidFile); await until("document.getElementById('toast').textContent.startsWith('Import rejected.')", 'rejected native import');
    state = await snapshot(); verify(state, cutoff); assert.equal(state.requests, beforeRejected.requests); assert.equal(state.historyStatus, beforeRejected.historyStatus);
    await setFile(invalidFile, '#replay-input'); await until("document.getElementById('replay-status').textContent.startsWith('Replay rejected.')", 'rejected bookmark');
    state = await snapshot(); assert.equal(state.requests, beforeRejected.requests); assert.equal(state.historyStatus, beforeRejected.historyStatus);
    check('Rejected experiment and bookmark files preserve current history and completed results');

    state = await load(baseFile); verify(state, base); boundary(state);
    await change('variant-name', 'Boundary edit');
    const boundaryEdit = structuredClone(base); boundaryEdit.variants[0].name = 'Boundary edit';
    state = await step(() => click('rename-variant'), boundaryEdit);
    const beforeLesson = state;
    await click('try-example-button'); await click('lesson-cancel'); await frames(); state = await snapshot();
    assert.equal(state.requests, beforeLesson.requests); assert.equal(state.historyStatus, beforeLesson.historyStatus);
    await click('try-example-button'); state = await step(() => click('lesson-start'), createTutorialExperiment());
    assert.equal(state.lesson, true); assert.equal(state.undoDisabled, true); assert.equal(state.redoDisabled, true); assert.match(state.historyStatus, /paused.*lesson/u);
    await change('variant-name', 'Lesson edit');
    const lessonEdit = createTutorialExperiment(); lessonEdit.variants[0].name = 'Lesson edit';
    state = await step(() => click('rename-variant'), lessonEdit); assert.equal(state.undoDisabled, true);
    state = await step(() => click('reset-button'), createTutorialExperiment()); assert.equal(state.undoDisabled, true);
    state = await step(() => click('return-experiment'), boundaryEdit);
    assert.equal(state.lesson, false); assert.equal(state.undoDisabled, false); assert.equal(state.historyStatus, beforeLesson.historyStatus);
    state = await step(() => click('undo-edit'), base);
    check('Lesson Cancel keeps history; confirmed lesson isolates edits and reset; Return restores the parent history paused');

    state = await load(bookmarkFile, '#replay-input'); verify(state, base, 'close-at-11'); boundary(state);
    assert.equal(state.time, 59.25); assert.equal(state.view, 'compare');
    await change('variant-name', 'Before reset');
    const beforeReset = structuredClone(base); beforeReset.variants.find(item => item.id === 'close-at-11').name = 'Before reset';
    await step(() => click('rename-variant'), beforeReset, 'close-at-11');
    const initial = experimentFromScenario(createDemoScenario(42)); initial.variants[0].name = 'Market Bridge closure';
    state = await step(() => click('reset-button'), initial, initial.variants[0].id); boundary(state);
    check('Successful Import, Open replay and Reset establish fresh history boundaries without undoing into another workspace');
    assert.deepEqual(state.errors, []); evidence.status = 'passed';
  } catch (error) {
    evidence.status = 'failed'; evidence.error = String(error.stack || error); throw error;
  } finally {
    await finishBrowserEvidence(output, evidence, [
      async () => { if (browser) await browser.close(); },
      async () => { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } },
      async () => { if (temporary) await removeOwnedBrowserDirectory(temporary); },
    ]);
  }
  console.log(`Verified ${evidence.checks.length} experiment-history checkpoints. Evidence: ${path.join(output, 'evidence.json')}`);
}
if (import.meta.main) {
  try {
    const options = parseBrowserCheckArguments(process.argv.slice(2));
    if (options) await runExperimentHistoryCheck(options); else console.log(usage);
  } catch (error) { console.error(`DetourLab experiment-history check: ${error.message}`); process.exitCode = 1; }
}
