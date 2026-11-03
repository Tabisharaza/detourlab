#!/usr/bin/env node
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir, platform, release, arch } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequestHandler } from '../../scripts/serve.js';
import { exportExperiment, simulateExperiment } from '../../src/experiment.js';
import { exportReplayBookmark, parseReplayBookmark } from '../../src/replay-bookmark.js';
import { launchChromium } from '../browser-check/chromium.js';
import { parseBrowserCheckArguments, finishBrowserEvidence, removeOwnedBrowserDirectory, documentReadyExpression } from '../browser-check/run.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
const rowSelector = '#replay-events-list button[data-event-id]';
export const usage = `Optional local Chromium replay-event navigation checks
Usage: node tools/replay-events-check/run.js --browser /absolute/path/to/chromium --out NEW_DIRECTORY
Fresh local profile, loopback source, synthetic inputs only. No installs or user profile.
Native Workers and unchanged renderers are observed, never replaced. Raw JPEG captures.
Output must not exist. Failed runs retain failed evidence and clean owned resources.
Not native-chooser, mobile-device, screen-reader, cross-browser or deployed-site certification.`;

/** Synthetic fractional boundaries, tied events, two vehicles and multiple pages. */
export function eventNavigationFixture(minimal) {
  const fixture = structuredClone(minimal);
  fixture.id = 'fractional-event-navigation';
  fixture.name = 'Follow an exact ledger event';
  fixture.baseScenario.id = 'fractional-event-network';
  fixture.baseScenario.vehicles[0].startTimeS = 0.25;
  fixture.baseScenario.jobs[0].serviceTimeS = 3.125;
  fixture.baseScenario.nodes.push({ id: 'E', x: 2, y: 1.5 });
  for (let i = 0; i < 12; i++) fixture.baseScenario.jobs.push({
    id: `same-node-${i + 1}`, nodeId: 'C', vehicleId: 'van-1', dueTimeS: 60, serviceTimeS: 0.125,
  });
  fixture.baseScenario.jobs.push({ id: 'isolated-job', nodeId: 'E', vehicleId: 'van-1', dueTimeS: 60, serviceTimeS: 0 });
  fixture.baseScenario.vehicles.push({ id: 'van-2', startNode: 'D', startTimeS: 0.5 });
  fixture.baseScenario.jobs.push({ id: 'second-van-job', nodeId: 'C', vehicleId: 'van-2', dueTimeS: 60, serviceTimeS: 0.75 });
  fixture.variants = [
    { id: 'fractional-detour', name: 'Detour at 10.25 s', closures: [{ id: 'fractional-cutoff', edgeIds: ['bc'], atS: 10.25 }] },
    { id: 'clear', name: 'Clear roads', closures: [] },
    { id: 'blocked', name: 'No onward route', closures: [{ id: 'blocked-cutoff', edgeIds: ['bc', 'bd'], atS: 10.25 }] },
  ];
  return fixture;
}

/** A global closure after every vehicle finishes still belongs to replay. */
export function lateClosureFixture(minimal) {
  const fixture = structuredClone(minimal);
  fixture.id = 'late-scheduled-event'; fixture.name = 'A closure after the route finishes';
  fixture.variants.find(variant => variant.id === 'close-at-10').closures.push({ id: 'late-first-street', edgeIds: ['ab'], atS: 123.375 });
  return fixture;
}

/** Independent oracle uses only completed ledger fields, not the UI event builder. */
export function expectedLedgerRows(experiment, result, vehicleId, variantId) {
  const rows = [];
  const add = (run, kind, category, time) => { if (Number.isFinite(time)) rows.push({ run, kind, category, time }); };
  const selected = result.variants.find(variant => variant.id === variantId);
  for (const [run, ledger] of [['baseline', result.baseline], ['variant', selected.result]]) {
    const vehicle = ledger.vehicles.find(item => item.id === vehicleId);
    for (const segment of vehicle.segments) {
      add(run, 'segment-entry', 'routing', segment.startS); add(run, 'segment-exit', 'routing', segment.endS);
    }
    for (const job of vehicle.jobs) {
      add(run, 'job-arrival', 'deliveries', job.arrivalS); add(run, 'job-completion', 'deliveries', job.completedS);
    }
    for (const reroute of vehicle.reroutes) add(run, 'reroute', 'routing', reroute.atS);
  }
  for (const closure of experiment.variants.find(variant => variant.id === variantId).closures) {
    add('schedule', 'closure-start', 'closures', closure.atS);
  }
  return rows;
}
const kindOrder = ['closure-start', 'segment-exit', 'job-arrival', 'job-completion', 'reroute', 'segment-entry'];
const runOrder = ['baseline', 'variant', 'schedule'];
const rowOrder = (a, b) => a.time - b.time || kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || runOrder.indexOf(a.run) - runOrder.indexOf(b.run);
const comparableRows = rows => rows.map(({ run, kind, category, time }) => ({ run, kind, category, time })).sort(rowOrder);
function verifyRows(actual, expected) {
  assert.deepEqual(comparableRows(actual), comparableRows(expected), 'visible event pages match the independent complete-ledger oracle');
  assert.deepEqual(actual.map(row => row.time), actual.map(row => row.time).sort((a, b) => a - b), 'events remain chronological');
  for (let i = 1; i < actual.length; i++) assert.ok(rowOrder(actual[i - 1], actual[i]) <= 0, 'ties keep documented kind and run order');
  for (const row of actual) assert.ok(Number.isFinite(row.time) && row.time >= 0 && row.label, 'every row has a finite timestamp and an accessible label');
}

// Record native postMessage/message events; never fabricate a result or app state.
const observeWorkers = `(() => {
  window.__eventCheck = { requests: [], result: null, errors: [] };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', e => { window.__eventCheck.result = e.data; });
      this.addEventListener('error', e => window.__eventCheck.errors.push(String(e.message)));
    }
    postMessage(value, ...rest) { window.__eventCheck.requests.push(value); return super.postMessage(value, ...rest); }
  };
  window.addEventListener('error', e => window.__eventCheck.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', e => window.__eventCheck.errors.push(String(e.reason)));
})();`;
const observeRenderers = `(async () => {
  const { NetworkMap } = await import('/src/map.js');
  const nativeRender = NetworkMap.prototype.render;
  window.__eventCheck.maps = {};
  window.__eventCheck.renderCalls = {};
  NetworkMap.prototype.render = function(...args) {
    const result = nativeRender.apply(this, args);
    window.__eventCheck.maps[this.canvas.id] = this;
    window.__eventCheck.renderCalls[this.canvas.id] = (window.__eventCheck.renderCalls[this.canvas.id] || 0) + 1;
    return result;
  };
})();`;

export async function runReplayEventsCheck({ executable, output }) {
  await mkdir(output); // Exclusive creation: never overwrite another run's evidence.
  const evidence = {
    format: 'detourlab-replay-events-check', version: 1, status: 'running', startedAt: new Date().toISOString(),
    runtime: { node: process.version, os: platform(), release: release(), arch: arch() }, checks: [], screenshots: [], fixtures: [],
    limitations: [
      'Local headless Chromium and synthetic fixtures only; not deployed, cross-browser, native chooser, mobile-device or assistive-technology certification.',
      'Worker observers record native requests/results. NetworkMap.render observation calls the unchanged renderer and retains read-only instance references.',
      'CDP DOM file injection, focus/key and pointer events are bounded integration evidence, not human usability or operating-system chooser tests.',
      'One delayed-read test holds a native File.arrayBuffer promise; app handlers, Worker execution and delivery are unchanged.',
      'Screenshots are unmodified captures; image existence/hash is not visual inspection. Source hashes identify bytes, not signed provenance.',
    ],
  };
  let browser, server, temporary;
  try {
    const files = [
      'index.html', 'examples/minimal-experiment.json', 'scripts/serve.js',
      ...((await readdir(path.join(root, 'src'))).filter(f => /\.(js|css)$/u.test(f)).map(f => `src/${f}`)),
      'tools/browser-check/chromium.js', 'tools/browser-check/run.js', 'tools/replay-events-check/run.js',
    ].sort();
    evidence.sourceFiles = await Promise.all(files.map(async file => ({ path: file, sha256: hash(await readFile(path.join(root, file))) })));
    evidence.sourceSha256 = hash(JSON.stringify(evidence.sourceFiles));
    temporary = await mkdtemp(path.join(tmpdir(), 'detourlab-events-'));
    const profile = path.join(temporary, 'profile'); await mkdir(profile);
    server = http.createServer(createRequestHandler(root)); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    browser = await launchChromium(executable, profile); evidence.browser = browser.version;
    const downloads = path.join(output, 'downloads'); await mkdir(downloads);
    await browser.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloads, eventsEnabled: true });
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
    const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
    const change = (id, value, event = 'change') => evaluate(`(() => {
      const element = document.getElementById(${JSON.stringify(id)});
      element.value = ${JSON.stringify(String(value))}; element.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
    })()`);
    const frames = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const ready = () => until("document.documentElement.dataset.revision === String(window.__eventCheck.requests.at(-1)?.id) && document.getElementById('cancel-run').hidden", 'native Worker completion');
    const snapshot = () => evaluate(`(() => {
      const x = window.__eventCheck;
      const disabled = id => document.getElementById(id).disabled;
      return {
        requests: x.requests.length, request: x.requests.at(-1), result: x.result, errors: x.errors,
        maps: Object.fromEntries(Object.entries(x.maps).map(([id, m]) => [id, {
          time: m.state.time, playing: m.state.playing, view: m.state.view, selectedVehicle: m.state.selectedVehicle,
          variantId: m.state.selectedVariantId, baseline: !!m.state.baseline, disrupted: !!m.state.disrupted,
          points: m.vehiclePoints, scenarioId: m.state.scenario.id,
        }])),
        calls: { ...x.renderCalls },
        rows: [...document.querySelectorAll(${JSON.stringify(rowSelector)})].map(b => ({
          id: b.dataset.eventId, time: Number(b.dataset.time), kind: b.dataset.kind, run: b.dataset.run,
          category: b.dataset.category, label: b.getAttribute('aria-label') || b.textContent,
        })),
        summary: document.getElementById('replay-events-summary').textContent,
        status: document.getElementById('replay-events-status').textContent,
        timeLabel: document.getElementById('replay-events-time').textContent,
        filter: document.getElementById('replay-events-filter').value,
        previousDisabled: disabled('replay-events-previous'), nextDisabled: disabled('replay-events-next'),
        pagePreviousDisabled: disabled('replay-events-page-previous'), pageNextDisabled: disabled('replay-events-page-next'),
        filterDisabled: disabled('replay-events-filter'),
        focusId: document.activeElement.id, focusEvent: document.activeElement.dataset.eventId || null,
      };
    })()`);
    const writeFixture = async (name, value) => {
      const file = path.join(output, name), bytes = Buffer.from(value);
      await writeFile(file, bytes, { flag: 'wx' });
      evidence.fixtures.push({ file: name, sha256: hash(bytes), bytes: bytes.length });
      return file;
    };
    const setFile = async (file, selector = '#import-input') => {
      const { root: doc } = await send('DOM.getDocument');
      const { nodeId } = await send('DOM.querySelector', { nodeId: doc.nodeId, selector });
      assert.ok(nodeId, `File input exists: ${selector}`);
      await send('DOM.setFileInputFiles', { nodeId, files: [file] });
    };
    const load = async (file, selector = '#import-input') => {
      const before = (await snapshot()).requests;
      await setFile(file, selector);
      await until(`window.__eventCheck.requests.length > ${before}`, 'import requested'); await ready(); await frames();
      return snapshot();
    };
    const verifyLedger = (state, expected) => {
      const { id, ...actual } = state.result;
      assert.equal(id, state.request.id); assert.deepEqual(actual, simulateExperiment(expected));
      assert.deepEqual(state.errors, []);
    };
    const verifyJump = (state, exactTime, requests) => {
      assert.equal(state.requests, requests, 'event navigation must not request computation');
      assert.equal(state.maps['network-map'].time, exactTime, 'jump preserves the exact ledger timestamp');
      assert.equal(state.maps['network-map'].playing, false, 'event navigation pauses playback');
      assert.equal(state.maps['network-map'].view, 'split');
      assert.equal(state.maps['baseline-map'].time, exactTime, 'split panes share the exact clock');
      assert.equal(state.maps['baseline-map'].selectedVehicle, state.maps['network-map'].selectedVehicle);
      assert.ok(state.timeLabel.includes(String(exactTime)), 'visible exact-time label matches the jumped timestamp');
    };
    const rowExpression = row => `document.querySelector(${JSON.stringify(`${rowSelector}[data-event-id=${JSON.stringify(row.id)}]`)})`;
    const jumpRow = async row => { await evaluate(`${rowExpression(row)}.click()`); await frames(); return snapshot(); };
    const press = async (key, code, windowsVirtualKeyCode) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
      await frames();
    };
    const allRows = async () => {
      let state = await snapshot();
      while (!state.pagePreviousDisabled) { await click('replay-events-page-previous'); state = await snapshot(); }
      const rows = [], pageIds = new Set();
      for (;;) {
        assert.ok(state.rows.length <= 20, 'each event page is bounded to 20 rows');
        const signature = state.rows.map(row => row.id).join('|');
        assert.ok(!pageIds.has(signature), 'pagination advances rather than looping'); pageIds.add(signature);
        rows.push(...state.rows);
        if (state.pageNextDisabled) break;
        assert.equal(state.rows.length, 20, 'nonfinal pages contain 20 rows');
        await click('replay-events-page-next'); state = await snapshot();
      }
      assert.equal(new Set(rows.map(row => row.id)).size, rows.length, 'no repeated event IDs across pages');
      return rows;
    };
    const firstPage = async () => {
      let state = await snapshot();
      while (!state.pagePreviousDisabled) { await click('replay-events-page-previous'); state = await snapshot(); }
      return state;
    };
    const geometry = () => evaluate(`(() => {
      const panel = document.getElementById('replay-events'), r = panel.getBoundingClientRect();
      const controls = [...panel.querySelectorAll('button, select')].map(e => {
        const b = e.getBoundingClientRect(); return { id: e.id || e.dataset.eventId, left: b.left, right: b.right, width: b.width, height: b.height };
      });
      return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth,
        panel: { left: r.left, right: r.right, width: r.width, height: r.height }, controls };
    })()`);
    const capture = async (name, viewport) => {
      await until("document.getElementById('toast').hidden", 'natural toast dismissal before raw capture');
      await evaluate(`document.getElementById('replay-events').scrollIntoView({ block: ${JSON.stringify(viewport.width < 600 ? 'start' : 'end')} })`);
      await frames();
      const dimensions = await geometry(); assert.equal(dimensions.overflow, false);
      assert.ok(dimensions.panel.left >= 0 && dimensions.panel.right <= viewport.width, 'event panel fits viewport');
      for (const control of dimensions.controls) assert.ok(control.left >= -1 && control.right <= viewport.width + 1, `control fits viewport: ${control.id}`);
      const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 65, captureBeyondViewport: false });
      const bytes = Buffer.from(data, 'base64'); assert.ok(bytes.length <= 1024 * 1024, 'raw screenshot fits 1 MiB');
      await writeFile(path.join(output, name), bytes, { flag: 'wx' });
      evidence.screenshots.push({ file: name, sha256: hash(bytes), bytes: bytes.length, viewport, geometry: dimensions,
        meaning: 'Unmodified local synthetic selected-vehicle event panel; not a deployed screenshot or a visual-inspection claim.' });
    };

    await send('Page.enable'); await send('Runtime.enable');
    const desktop = { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false };
    await send('Emulation.setDeviceMetricsOverride', desktop);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: observeWorkers });
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
    await until(documentReadyExpression, 'initial native Worker completion');
    await evaluate(observeRenderers); await frames();
    const tiny = JSON.parse(await readFile(path.join(root, 'examples/minimal-experiment.json'), 'utf8'));
    const tinyPerspective = { variantId: 'close-at-10', vehicleId: 'van-1', timeS: 15.25, view: 'split', zoom: 1 };
    const tinyBookmark = await writeFixture('tiny-events.replay.json', exportReplayBookmark(tiny, tinyPerspective));
    let state = await load(tinyBookmark, '#replay-input');
    verifyLedger(state, tiny); verifyJump(state, 15.25, state.requests);
    let rows = await allRows();
    verifyRows(rows, expectedLedgerRows(tiny, simulateExperiment(tiny), 'van-1', 'close-at-10'));
    assert.equal(rows.length, 16); assert.equal(rows.filter(row => row.time === 10).length, 6);
    check('Tiny native Worker matches Node ledger; all 16 rows and six tied cutoff events match completed evidence');
    state = await firstPage();
    const tinyReroute = state.rows.find(row => row.kind === 'reroute'); assert.ok(tinyReroute);
    const tinyRequests = state.requests;
    state = await jumpRow(tinyReroute); verifyJump(state, 10, tinyRequests);
    await click('replay-events-next'); await frames(); state = await snapshot(); verifyJump(state, 18, tinyRequests);
    await click('replay-events-previous'); await frames(); state = await snapshot(); verifyJump(state, 10, tinyRequests);
    await click('replay-events-previous'); await frames(); state = await snapshot(); verifyJump(state, 0, tinyRequests);
    assert.equal(state.previousDisabled, true);
    await click('replay-events-next'); await frames(); state = await snapshot(); verifyJump(state, 10, tinyRequests);
    check('Strict temporal navigation skips all same-time ties, pauses and shares one split-map clock without rerunning');

    await evaluate("document.getElementById('replay-events-filter').focus()");
    await press('Tab', 'Tab', 9);
    assert.equal((await snapshot()).focusId, 'replay-events-previous');
    await press('Tab', 'Tab', 9); assert.equal((await snapshot()).focusId, 'replay-events-next');
    await press('Tab', 'Tab', 9); state = await snapshot(); assert.equal(state.focusEvent, state.rows[0].id);
    await press('Enter', 'Enter', 13); state = await snapshot(); verifyJump(state, 0, tinyRequests);
    assert.equal(state.focusEvent, state.rows[0].id, 'jump does not replace the focused row');
    await evaluate(`${rowExpression(tinyReroute)}.focus()`); await press(' ', 'Space', 32);
    state = await snapshot(); verifyJump(state, 10, tinyRequests); assert.equal(state.focusEvent, tinyReroute.id);
    check('Native Tab, Enter and Space reach and activate stable event controls with retained row focus');
    await capture('event-desktop.jpg', desktop);
    const narrow = { width: 390, height: 1100, deviceScaleFactor: 1, mobile: false };
    await send('Emulation.setDeviceMetricsOverride', narrow); await frames(); await capture('event-narrow.jpg', narrow);
    check('Desktop and 390px CSS viewport event panel and controls fit without horizontal overflow; raw captures saved');
    await send('Emulation.setDeviceMetricsOverride', desktop); await frames();

    const fractional = eventNavigationFixture(tiny), fractionalResult = simulateExperiment(fractional);
    const fractionalFile = await writeFixture('fractional-events.experiment.json', exportExperiment(fractional));
    state = await load(fractionalFile); verifyLedger(state, fractional);
    await click('view-split'); await frames();
    const fractionalRequests = state.requests;
    rows = await allRows();
    const fractionalExpected = expectedLedgerRows(fractional, fractionalResult, 'van-1', 'fractional-detour');
    verifyRows(rows, fractionalExpected); assert.equal(rows.length, 64);
    assert.equal(rows.some(row => row.time === 0), false, 'null job times must not become zero-time rows');
    assert.equal(rows.some(row => /isolated-job/.test(row.label)), false, 'unreachable job has no fabricated event');
    assert.ok(rows.some(row => row.time === 29.375 && row.kind === 'job-completion'));
    assert.equal((await snapshot()).requests, fractionalRequests);
    check('Fractional fixture paginates 64 exact ledger events into 20-row pages and excludes unreachable null times');
    const secondPass = await allRows(); assert.deepEqual(secondPass, rows, 'page navigation preserves order and stable event identities');
    for (const filter of ['deliveries', 'routing', 'closures']) {
      await change('replay-events-filter', filter); state = await snapshot(); assert.equal(state.pagePreviousDisabled, true);
      const filtered = await allRows(); verifyRows(filtered, fractionalExpected.filter(row => row.category === filter));
      assert.equal((await snapshot()).requests, fractionalRequests);
    }
    check('Delivery, routing and scheduled-closure filters reset pages and preserve native Worker request count');

    await change('replay-events-filter', 'routing'); state = await firstPage();
    const fractionalReroute = state.rows.find(row => row.kind === 'reroute' && row.time === 10.25); assert.ok(fractionalReroute);
    // Play and jump in one browser task: no animation tick can obscure the exact assertion.
    await evaluate(`document.getElementById('play-button').click(); ${rowExpression(fractionalReroute)}.click()`);
    await frames(); state = await snapshot(); verifyJump(state, 10.25, fractionalRequests);
    assert.equal(state.focusId === 'replay-events-list', false);
    await click('replay-events-next'); await frames(); state = await snapshot(); verifyJump(state, 18.25, fractionalRequests);
    await click('replay-events-previous'); await frames(); state = await snapshot(); verifyJump(state, 10.25, fractionalRequests);
    await change('replay-events-filter', 'deliveries'); state = await firstPage();
    // Completion 29.375 is on a later page; locate the real row through page controls.
    let completion = state.rows.find(row => row.kind === 'job-completion' && row.run === 'variant' && row.time === 29.375);
    while (!completion && !state.pageNextDisabled) {
      await click('replay-events-page-next'); state = await snapshot();
      completion = state.rows.find(row => row.kind === 'job-completion' && row.run === 'variant' && row.time === 29.375);
    }
    assert.ok(completion); state = await jumpRow(completion); verifyJump(state, 29.375, fractionalRequests);
    check('Real fractional reroute and service-completion rows preserve exact time while pausing playback');

    const downloadBookmark = async () => {
      let started, done = false, failure;
      const offStart = browser.on('Browser.downloadWillBegin', event => { started = event; });
      const offProgress = browser.on('Browser.downloadProgress', event => {
        if (started && event.guid === started.guid && event.state === 'completed') done = true;
        if (event.state === 'canceled') failure = new Error('Bookmark download canceled');
      });
      try {
        await click('save-replay'); const end = Date.now() + 15000;
        while (!done && !failure && Date.now() < end) await delay(25);
        if (failure) throw failure;
        assert.ok(done && started, 'actual bookmark download completed'); assert.match(started.guid, /^[a-zA-Z0-9-]+$/u);
        const file = path.join(downloads, started.guid), bytes = await readFile(file);
        return { file, bytes, bookmark: parseReplayBookmark(bytes.toString('utf8')) };
      } finally { offStart(); offProgress(); }
    };
    const saved = await downloadBookmark();
    assert.deepEqual(saved.bookmark.perspective, { variantId: 'fractional-detour', vehicleId: 'van-1', timeS: 29.375, view: 'split', zoom: 1 });
    state = await load(saved.file, '#replay-input'); verifyLedger(state, fractional); verifyJump(state, 29.375, state.requests);
    check('Actual replay download and reimport preserve the exact event jump after native recomputation', { downloadSha256: hash(saved.bytes) });

    await change('replay-events-filter', 'all');
    const selectionRequests = (await snapshot()).requests;
    await change('vehicle-select', 'van-2'); await frames(); state = await snapshot();
    assert.equal(state.maps['network-map'].selectedVehicle, 'van-2'); assert.match(state.summary, /van-2/u);
    rows = await allRows(); verifyRows(rows, expectedLedgerRows(fractional, fractionalResult, 'van-2', 'fractional-detour'));
    assert.equal(rows.some(row => row.time === 26.25), false, 'former vehicle rows are removed');
    await change('variant-select', 'clear'); await frames();
    rows = await allRows(); verifyRows(rows, expectedLedgerRows(fractional, fractionalResult, 'van-2', 'clear'));
    await change('replay-events-filter', 'closures'); state = await snapshot();
    assert.deepEqual(state.rows, []); assert.equal(state.previousDisabled, true); assert.equal(state.nextDisabled, true);
    assert.equal(state.pagePreviousDisabled, true); assert.equal(state.pageNextDisabled, true); assert.match(state.status, /No events match/u);
    await change('vehicle-select', 'van-1'); await change('variant-select', 'blocked'); await change('replay-events-filter', 'all'); await frames();
    rows = await allRows(); verifyRows(rows, expectedLedgerRows(fractional, fractionalResult, 'van-1', 'blocked'));
    assert.equal(rows.some(row => row.run === 'variant' && row.category === 'deliveries'), false);
    assert.match((await snapshot()).summary, /Unreachable deliveries/u);
    assert.equal((await snapshot()).requests, selectionRequests);
    check('Vehicle and variant changes refresh event evidence; empty filters and blocked null arrivals remain explicit without a rerun');

    await change('variant-select', 'fractional-detour'); await change('replay-events-filter', 'routing'); state = await firstPage();
    const newerRow = state.rows.find(row => row.kind === 'reroute'); assert.ok(newerRow);
    await evaluate(`(() => {
      const native = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function(...args) {
        File.prototype.arrayBuffer = native;
        const pending = native.apply(this, args); window.__eventCheck.held = true;
        return new Promise((resolve, reject) => { window.__eventCheck.releaseRead = () => pending.then(resolve, reject); });
      };
    })()`);
    await setFile(tinyBookmark, '#replay-input'); await until('window.__eventCheck.held === true', 'held native bookmark read');
    state = await jumpRow(newerRow); const beforeRelease = state.requests; verifyJump(state, 10.25, beforeRelease);
    await evaluate('window.__eventCheck.releaseRead()'); await evaluate('new Promise(resolve => setTimeout(resolve, 0))'); await frames();
    state = await snapshot(); verifyJump(state, 10.25, beforeRelease);
    assert.equal(state.request.experiment.id, fractional.id);
    assert.match(await evaluate("document.getElementById('replay-status').textContent"), /navigated|navigation|canceled/u);
    check('New event navigation supersedes a delayed real bookmark read without restoring stale time or input');

    const pending = await evaluate(`(() => {
      document.getElementById('run-experiment').click();
      const pending = { rows: document.querySelectorAll(${JSON.stringify(rowSelector)}).length,
        previousDisabled: document.getElementById('replay-events-previous').disabled,
        nextDisabled: document.getElementById('replay-events-next').disabled,
        status: document.getElementById('replay-events-status').textContent };
      document.getElementById('cancel-run').click(); return pending;
    })()`);
    assert.equal(pending.rows, 0); assert.equal(pending.previousDisabled, true); assert.equal(pending.nextDisabled, true);
    assert.match(pending.status, /Calculating/u); await frames(); state = await snapshot();
    assert.deepEqual(state.rows, []); assert.equal(state.filterDisabled, true); assert.equal(state.previousDisabled, true); assert.equal(state.nextDisabled, true);
    assert.match(state.status, /No completed results/u);
    for (const map of Object.values(state.maps)) { assert.equal(map.baseline, false); assert.equal(map.disrupted, false); assert.deepEqual(map.points, []); }
    check('Pending and canceled native runs immediately clear event rows and both map result layers');
    await click('run-experiment'); await ready(); await frames(); state = await snapshot(); verifyLedger(state, fractional);
    await change('replay-events-filter', 'all'); rows = await allRows(); verifyRows(rows, fractionalExpected);
    state = await snapshot(); assert.deepEqual(state.errors, []);
    check('Rerun repopulates only the current complete native ledger after cancellation');
    const late = lateClosureFixture(tiny), lateResult = simulateExperiment(late);
    assert.equal(lateResult.baseline.durationS, 60);
    assert.ok(lateResult.variants.every(variant => variant.result.durationS === 60));
    const lateBookmark = await writeFixture('late-closure.replay.json', exportReplayBookmark(late, { ...tinyPerspective, timeS: 10 }));
    state = await load(lateBookmark, '#replay-input'); verifyLedger(state, late);
    await change('replay-events-filter', 'all'); rows = await allRows();
    verifyRows(rows, expectedLedgerRows(late, lateResult, 'van-1', 'close-at-10'));
    const lateRow = rows.find(row => row.kind === 'closure-start' && row.time === 123.375); assert.ok(lateRow);
    const lateRequests = (await snapshot()).requests;
    state = await jumpRow(lateRow); verifyJump(state, 123.375, lateRequests); assert.equal(state.nextDisabled, true);
    assert.ok(Number(await evaluate("document.getElementById('timeline').max")) >= 123.375);
    const lateSaved = await downloadBookmark(); assert.equal(lateSaved.bookmark.perspective.timeS, 123.375);
    state = await load(lateSaved.file, '#replay-input'); verifyLedger(state, late); verifyJump(state, 123.375, state.requests);
    assert.doesNotMatch(await evaluate("document.getElementById('replay-status').textContent"), /clamped/u);
    check('Late scheduled closure extends replay beyond the 60-second engine horizon and survives exact bookmark save/reopen', { atS: 123.375, engineDurationS: 60, downloadSha256: hash(lateSaved.bytes) });
    assert.deepEqual(state.errors, []);
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = 'failed'; evidence.error = String(error.stack || error); throw error;
  } finally {
    await finishBrowserEvidence(output, evidence, [
      async () => { if (browser) await browser.close(); },
      async () => { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } },
      async () => { if (temporary) await removeOwnedBrowserDirectory(temporary); },
    ]);
  }
  console.log(`Verified ${evidence.checks.length} replay-event checkpoints. Evidence: ${path.join(output, 'evidence.json')}`);
}
if (import.meta.main) {
  try {
    const options = parseBrowserCheckArguments(process.argv.slice(2));
    if (options) await runReplayEventsCheck(options); else console.log(usage);
  } catch (error) { console.error(`DetourLab replay-event check: ${error.message}`); process.exitCode = 1; }
}
