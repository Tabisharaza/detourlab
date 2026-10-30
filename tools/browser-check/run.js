#!/usr/bin/env node
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { platform, release, arch, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequestHandler } from '../../scripts/serve.js';
import { canonicalExperiment, exportExperiment, parseExperiment, simulateExperiment } from '../../src/experiment.js';
import { decodeFileInput } from '../../src/file-input.js';
import { launchChromium } from './chromium.js';
import { browserFixtures, invalidBrowserFiles } from './fixtures.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const usage = `Optional DetourLab real Chromium integration check (Node 24.22.1)
Usage: node tools/browser-check/run.js --browser /absolute/path/to/chromium --out NEW_DIRECTORY

Runs only the local checkout with synthetic files in a fresh temporary profile.
Uses CDP file injection, actual app downloads, and native module Workers; does NOT
exercise the operating-system file chooser, accessibility or a deployed site.
Output must not exist. No browser/dependency install, existing profile, external
URL, sandbox-disabling flag or remote-debugging listening port is accepted.
Exit 0 only after every check passes; exit 1 on any failed check or unavailable
browser. After output setup, failed runs retain partial evidence marked failed when writable.`;

export function parseBrowserCheckArguments(args) {
  if (args.includes('--help')) return null;
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!['--browser', '--out'].includes(key) || Object.hasOwn(values, key) || !value || value.startsWith('--')) throw new Error('Supply --browser and --out exactly once. Use --help.');
    values[key] = value;
  }
  if (!values['--browser'] || !path.isAbsolute(values['--browser']) || !values['--out']) throw new Error('An absolute browser executable and a new output directory are required.');
  return { executable: values['--browser'], output: path.resolve(values['--out']) };
}

/** Cleanup all owned resources and preserve failure status before writing evidence. */
export async function finishBrowserEvidence(output, evidence, cleanups) {
  let cleanupError;
  for (const cleanup of cleanups) {
    try { await cleanup(); }
    catch (error) { cleanupError ??= error; }
  }
  if (cleanupError) { evidence.status = 'failed'; evidence.cleanupError = String(cleanupError.stack || cleanupError); }
  evidence.completedAt = new Date().toISOString();
  await writeFile(path.join(output, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  if (cleanupError) throw cleanupError;
}

// Instrument only observation and one explicit delayed-read seam. Native Worker
// construction, postMessage, message delivery and app handlers remain intact.
const observation = `(() => {
  const NativeWorker = window.Worker;
  window.__detourlabCheck = { request: null, result: null, errors: [] };
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', event => { window.__detourlabCheck.result = event.data; });
      this.addEventListener('error', event => { window.__detourlabCheck.errors.push(String(event.message)); });
    }
    postMessage(data, ...rest) {
      window.__detourlabCheck.request = data;
      return super.postMessage(data, ...rest);
    }
  };
  window.addEventListener('error', event => window.__detourlabCheck.errors.push(String(event.message)));
  window.addEventListener('unhandledrejection', event => window.__detourlabCheck.errors.push(String(event.reason)));
})();`;

async function run({ executable, output }) {
  // Exclusive creation ensures a run can never overwrite earlier evidence.
  await mkdir(output);
  const downloads = path.join(output, 'downloads'), fixturesDirectory = path.join(output, 'fixtures');
  const evidence = { format: 'detourlab-browser-check', version: 1, status: 'running',
    startedAt: new Date().toISOString(), runtime: { node: process.version, os: platform(), release: release(), arch: arch() },
    viewport: { width: 1280, height: 900, deviceScaleFactor: 1 }, checks: [], fixtures: [],
    limitations: ['CDP file injection is not an operating-system file chooser or chooser-cancellation test.',
      'Synthetic local Chromium integration only: not cross-browser, mobile, screen-reader, performance or deployed-site verification.',
      'A Worker observer records actual native messages; delayed-read cases override only one selected File.arrayBuffer promise, not app handlers or Workers.',
      'Source and fixture hashes identify bytes, not authorship or signed provenance.'] };
  let browser, server, temporary;
  try {
    temporary = await mkdtemp(path.join(tmpdir(), 'detourlab-browser-'));
    await mkdir(downloads); await mkdir(fixturesDirectory);
    const profile = path.join(temporary, 'profile'); await mkdir(profile);
    const files = ['index.html', ...(await readdir(path.join(root, 'src'))).filter(f => /\.(js|css)$/u.test(f)).map(f => `src/${f}`)].sort();
    evidence.sourceFiles = await Promise.all(files.map(async file => ({ path: file, sha256: sha256(await readFile(path.join(root, file))) })));
    evidence.sourceSha256 = sha256(JSON.stringify(evidence.sourceFiles));
    const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 5000 });
    evidence.checkoutRevision = revision.status === 0 && /^[a-f0-9]{40}\s*$/u.test(revision.stdout) ? revision.stdout.trim() : null;
    server = http.createServer(createRequestHandler(root));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await launchChromium(executable, profile);
    evidence.browser = await browser.send('Browser.getVersion');
    await browser.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloads, eventsEnabled: true });
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params = {}) => browser.send(method, params, sessionId);
    const evaluate = async expression => {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error(`Browser evaluation failed: ${response.exceptionDetails.exception?.description || response.exceptionDetails.text}`);
      return response.result.value;
    };
    const until = async (expression, description, timeout = 35000) => {
      const end = Date.now() + timeout;
      do { if (await evaluate(expression)) return; await delay(50); } while (Date.now() < end);
      throw new Error(`Timed out: ${description}`);
    };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { ...evidence.viewport, mobile: false });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: observation });
    await send('Page.navigate', { url: origin });
    await until("document.documentElement.dataset.ready === 'true'", 'initial native Worker run');
    const check = (name, detail = {}) => { evidence.checks.push({ name, status: 'passed', ...detail }); console.log(`PASS ${name}`); };
    const snapshot = () => evaluate(`({ request: window.__detourlabCheck.request, result: window.__detourlabCheck.result,
      revision: document.documentElement.dataset.revision, status: document.getElementById('status-line').textContent,
      variantIds: [...document.querySelectorAll('#variant-select option')].map(option => option.value),
      cards: document.querySelectorAll('#variant-results [data-variant]').length,
      errors: window.__detourlabCheck.errors })`);
    let importAfterRevision = -1;
    const settle = async expected => {
      await until(`document.documentElement.dataset.revision === String(window.__detourlabCheck.request?.id)
        && window.__detourlabCheck.request?.id > ${importAfterRevision}
        && window.__detourlabCheck.request?.experiment.id === ${JSON.stringify(expected.id)}
        && document.getElementById('cancel-run').hidden`, `completed ${expected.id}`);
      const state = await snapshot();
      assert.deepEqual(state.errors, [], 'no browser/Worker errors');
      assert.equal(canonicalExperiment(state.request.experiment), canonicalExperiment(expected));
      const { id, ...actual } = state.result;
      assert.equal(id, state.request.id);
      assert.deepEqual(actual, simulateExperiment(expected), 'complete native Worker ledger must equal Node');
      assert.deepEqual(state.variantIds, expected.variants.map(v => v.id));
      assert.equal(state.cards, expected.variants.length);
      return state;
    };
    const setFile = async file => {
      importAfterRevision = (await snapshot()).request.id;
      const { root: document } = await send('DOM.getDocument');
      const { nodeId } = await send('DOM.querySelector', { nodeId: document.nodeId, selector: '#import-input' });
      assert.ok(nodeId);
      await send('DOM.setFileInputFiles', { nodeId, files: [file] });
    };
    const exportFile = async () => {
      let download, failure;
      const removeStart = browser.on('Browser.downloadWillBegin', event => { download = event; });
      let done = false;
      const removeProgress = browser.on('Browser.downloadProgress', event => {
        if (download && event.guid === download.guid && event.state === 'completed') done = true;
        if (event.state === 'canceled') failure = new Error('Browser canceled the download.');
      });
      try {
        await evaluate("document.getElementById('export-button').click()");
        const end = Date.now() + 15000;
        while (!done && !failure && Date.now() < end) await delay(25);
        if (failure) throw failure;
        assert.ok(done && download, 'actual app download must complete');
        assert.match(download.guid, /^[a-zA-Z0-9-]+$/u);
        const file = path.join(downloads, download.guid);
        const bytes = await readFile(file);
        return { file, bytes, name: download.suggestedFilename };
      } finally { removeStart(); removeProgress(); }
    };
    const cli = file => {
      const result = spawnSync(process.execPath, ['scripts/run-experiment.js', file, '--json'], { cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
      assert.equal(result.status, 0, result.stderr); assert.equal(result.signal, null); assert.equal(result.error, undefined);
      return JSON.parse(result.stdout);
    };
    const verifyDownload = async (expected, inputFile, label) => {
      const downloaded = await exportFile();
      assert.equal(canonicalExperiment(parseExperiment(decodeFileInput(downloaded.bytes))), canonicalExperiment(expected));
      assert.deepEqual(cli(downloaded.file), cli(inputFile), 'CLI hash, baseline, identities and all variant metrics must survive download');
      check(label, { experimentSha256: sha256(canonicalExperiment(expected)), downloadedSha256: sha256(downloaded.bytes), download: `downloads/${path.basename(downloaded.file)}` });
      return downloaded;
    };
    const fixtures = browserFixtures(JSON.parse(await readFile(path.join(root, 'examples/minimal-experiment.json'), 'utf8')));
    for (const fixture of fixtures) {
      const file = path.join(fixturesDirectory, `${fixture.id}.json`), bytes = Buffer.from(exportExperiment(fixture));
      await writeFile(file, bytes, { flag: 'wx' });
      evidence.fixtures.push({ file: `fixtures/${path.basename(file)}`, sha256: sha256(bytes), experimentSha256: sha256(canonicalExperiment(fixture)), variants: fixture.variants.length });
      await setFile(file); await settle(fixture);
      check(`${fixture.id}: native Worker full-ledger parity`);
      const first = await verifyDownload(fixture, file, `${fixture.id}: first actual download and CLI parity`);
      await setFile(first.file); await settle(fixture);
      const second = await verifyDownload(fixture, file, `${fixture.id}: reimported download and second CLI parity`);
      assert.deepEqual(second.bytes, first.bytes);
      // The application clears input.value before asynchronous work, so selecting
      // exactly the same path twice must dispatch a second real input change.
      const before = (await snapshot()).request.id;
      await setFile(first.file); await settle(fixture);
      assert.ok((await snapshot()).request.id > before);
      check(`${fixture.id}: same-file reselection and byte-identical roundtrip`);
    }
    const hostile = fixtures[2], hostileFile = path.join(fixturesDirectory, `${hostile.id}.json`);
    const labels = await evaluate(`({ name: document.getElementById('experiment-name').textContent,
      roads: [...document.querySelectorAll('#road-select option')].map(x => x.textContent), options: [...document.querySelectorAll('#variant-select option')].map(x => x.textContent),
      injected: document.querySelectorAll('svg[onload], img[onerror], script:not([src])').length })`);
    assert.equal(labels.name, hostile.name);
    assert.ok(labels.roads.some(label => label.includes(hostile.baseScenario.edges[0].roadName)));
    assert.ok(labels.options.includes(hostile.variants[0].name)); assert.equal(labels.injected, 0);
    check('HTML-like labels and literal replacement character stay inert text');
    for (const invalid of invalidBrowserFiles(exportExperiment(hostile))) {
      const file = path.join(fixturesDirectory, invalid.name); await writeFile(file, invalid.bytes, { flag: 'wx' });
      const before = await snapshot();
      await evaluate("document.getElementById('toast').textContent = ''");
      await setFile(file);
      await until("document.getElementById('toast').textContent.startsWith('Import rejected.')", invalid.name);
      assert.match(await evaluate("document.getElementById('toast').textContent"), invalid.error);
      assert.equal((await snapshot()).request.id, before.request.id);
      await verifyDownload(hostile, hostileFile, `${invalid.name}: rejected without replacing current experiment`);
    }
    // A schema-valid BOM-containing file exactly at the byte cap must succeed.
    const bomText = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(exportExperiment(fixtures[0]))]);
    const atLimit = path.join(fixturesDirectory, 'bom-at-limit.json');
    await writeFile(atLimit, Buffer.concat([bomText, Buffer.alloc(2 * 1024 * 1024 - bomText.length, 0x20)]), { flag: 'wx' });
    await setFile(atLimit); await settle(fixtures[0]); check('BOM included in exact 2 MiB acceptance boundary');

    const holdRead = async () => evaluate(`(() => {
      const original = File.prototype.arrayBuffer;
      window.__detourlabCheck.held = false;
      File.prototype.arrayBuffer = function(...args) {
        File.prototype.arrayBuffer = original;
        const nativeRead = original.apply(this, args);
        window.__detourlabCheck.held = true;
        return new Promise((resolve, reject) => { window.__detourlabCheck.releaseRead = () => nativeRead.then(resolve, reject); });
      };
    })()`);
    for (const action of ['reset', 'newer-import']) {
      await holdRead(); await setFile(hostileFile);
      await until('window.__detourlabCheck.held === true', 'held browser File read');
      if (action === 'reset') {
        await evaluate("document.getElementById('reset-button').click()");
        await until("document.documentElement.dataset.revision === String(window.__detourlabCheck.request?.id) && document.getElementById('cancel-run').hidden", 'Reset worker completion');
      } else {
        await setFile(path.join(fixturesDirectory, `${fixtures[1].id}.json`)); await settle(fixtures[1]);
      }
      const before = await snapshot(), beforeFile = await exportFile();
      await evaluate('window.__detourlabCheck.releaseRead()');
      // A task boundary after the promise resolves lets the unchanged app's
      // awaiting import continuation run. No wall-clock race is relied upon.
      await evaluate('new Promise(resolve => setTimeout(resolve, 0))');
      assert.equal((await snapshot()).request.id, before.request.id);
      assert.deepEqual((await exportFile()).bytes, beforeFile.bytes);
      check(`Pending actual File read superseded by ${action}`);
    }
    // Start/cancel in one browser task before a Worker can return, then rerun.
    await evaluate("document.getElementById('run-experiment').click(); document.getElementById('cancel-run').click()");
    assert.match(await evaluate("document.getElementById('status-line').textContent"), /cancel/i);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('#variant-results [data-variant] div')].map(x => x.textContent)"), Array(6).fill('Run to compare'));
    assert.equal(await evaluate("document.getElementById('distance-value').textContent"), '—');
    await evaluate("document.getElementById('run-experiment').click()");
    await settle(fixtures[1]);
    await verifyDownload(fixtures[1], path.join(fixturesDirectory, `${fixtures[1].id}.json`), 'Cancel then rerun preserves input and restores actual Worker results');
    assert.deepEqual((await snapshot()).errors, []);
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = 'failed'; evidence.error = String(error.stack || error);
    throw error;
  } finally {
    // Cleanup failures are failures too; never leave a passed evidence file
    // beside a nonzero exit caused by a leaked browser or failed cleanup.
    await finishBrowserEvidence(output, evidence, [
      async () => { if (browser) await browser.close(); },
      async () => { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } },
      async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); },
    ]);
  }
  console.log(`Verified ${evidence.checks.length} browser integration checks. Evidence: ${path.join(output, 'evidence.json')}`);
}

if (import.meta.main) {
  try { const selected = parseBrowserCheckArguments(process.argv.slice(2)); if (selected) await run(selected); else console.log(usage); }
  catch (error) { console.error(`DetourLab browser check: ${error.message}`); process.exitCode = 1; }
}
