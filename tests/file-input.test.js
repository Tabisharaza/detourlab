import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFileInput, FILE_INPUT_MAX_BYTES, formatInputError, INPUT_ERROR_MAX_LENGTH } from '../src/file-input.js';
import { EXPERIMENT_LIMITS, parseExperiment } from '../src/experiment.js';
import { LIMITS, parseScenario } from '../src/scenario.js';
import { application, deferredFile, minimalScenario, scenarioText } from './helpers/application.js';

const encode = text => new TextEncoder().encode(text);
const invalidSequences = [
  ['isolated FF', [0xff]],
  ['isolated continuation', [0x80]],
  ['truncated two-byte sequence', [0xc2]],
  ['truncated three-byte sequence', [0xe2, 0x82]],
  ['truncated four-byte sequence', [0xf0, 0x9f, 0x9a]],
  ['invalid continuation', [0xe2, 0x28, 0xa1]],
  ['overlong encoding', [0xc0, 0xaf]],
  ['encoded surrogate', [0xed, 0xa0, 0x80]],
  ['above Unicode maximum', [0xf4, 0x90, 0x80, 0x80]],
];
const hostileLabel = sequence => {
  const text = scenarioText('invalid-bytes').replace('"name":"invalid-bytes"', '"name":"BYTE_MARKER"');
  const [before, after] = text.split('BYTE_MARKER');
  return new Uint8Array([...encode(before), ...sequence, ...encode(after)]);
};

test('file-byte limits agree with both existing text parser limits', () => {
  assert.equal(FILE_INPUT_MAX_BYTES, 2 * 1024 * 1024);
  assert.equal(FILE_INPUT_MAX_BYTES, LIMITS.maxBytes);
  assert.equal(FILE_INPUT_MAX_BYTES, EXPERIMENT_LIMITS.maxBytes);
});

for (const [name, sequence] of invalidSequences) {
  test(`strict decoder rejects ${name} within otherwise valid JSON labels`, () => {
    const bytes = hostileLabel(sequence);
    // Replacement decoding would silently turn this invalid file into a valid
    // scenario. File-entry paths must reject the original bytes instead.
    assert.doesNotThrow(() => parseScenario(new TextDecoder().decode(bytes)));
    assert.throws(() => decodeFileInput(bytes), /not valid UTF-8.*Save it as UTF-8 JSON/u);
    assert.throws(() => decodeFileInput(new Uint8Array(sequence)), /not valid UTF-8/u);
  });
}

test('decoder preserves valid multilingual labels, literal replacement characters and internal BOMs', () => {
  const scenario = minimalScenario('utf8-valid');
  scenario.name = 'Café 東京 🚚 � inner\ufeffBOM';
  const text = JSON.stringify(scenario), bytes = encode(text);
  assert.equal(decodeFileInput(bytes), text);
  assert.equal(decodeFileInput(bytes.buffer), text);
  assert.equal(decodeFileInput(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes])), text);
  assert.equal(parseScenario(decodeFileInput(bytes)).name, scenario.name);
  assert.equal(parseExperiment(decodeFileInput(bytes)).baseScenario.name, scenario.name);
  assert.equal(decodeFileInput(new Uint8Array()), '');
});

test('decoder respects Uint8Array view offsets instead of reading an entire backing buffer', () => {
  const text = scenarioText('view-offset'), bytes = encode(text);
  const backing = new Uint8Array(bytes.length + 4).fill(0xff);
  backing.set(bytes, 2);
  assert.equal(decodeFileInput(backing.subarray(2, -2)), text);
  assert.throws(() => decodeFileInput(backing), /UTF-8/u);
  assert.throws(() => decodeFileInput(text), /ArrayBuffer or Uint8Array/u);
});

test('actual bytes are checked before decoding, including multibyte text and the initial BOM', () => {
  const exact = new Uint8Array(FILE_INPUT_MAX_BYTES).fill(0x20);
  assert.equal(decodeFileInput(exact).length, FILE_INPUT_MAX_BYTES);
  const withBom = exact.slice(); withBom.set([0xef, 0xbb, 0xbf]);
  assert.equal(decodeFileInput(withBom).length, FILE_INPUT_MAX_BYTES - 3);
  const tooLarge = new Uint8Array(FILE_INPUT_MAX_BYTES + 1).fill(0xff);
  assert.throws(() => decodeFileInput(tooLarge), /2 MiB/u, 'size rejection takes precedence over invalid encoding');
  assert.throws(() => decodeFileInput(encode('é'.repeat(FILE_INPUT_MAX_BYTES / 2 + 1))), /2 MiB/u);
  assert.throws(() => decodeFileInput(new Uint8Array([0xef, 0xbb, 0xbf, ...exact.subarray(0, FILE_INPUT_MAX_BYTES - 2)])), /2 MiB/u);
});

test('diagnostics preserve useful ordinary messages and escape controls, separators and bidi overrides', () => {
  const ordinary = 'experiment.version must be 1. baseScenario.nodes[0].id is required.';
  assert.equal(formatInputError(new Error(ordinary)), ordinary);
  const unsafe = '\x1b[31m\x00\t\r\n\x7f\x9b\u061c\u200e\u200f\u2028\u2029\u202a\u202e\u2066\u2069';
  const result = formatInputError(new Error('Unsupported key ' + unsafe));
  assert.match(result, /\\u001b\[31m\\u0000\\u0009\\u000d\\u000a/u);
  assert.doesNotMatch(result, /[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u2028-\u202e\u2066-\u206f]/u);
  assert.equal(formatInputError(null), 'The input could not be processed.');
  assert.equal(formatInputError(new Error('')), 'The input could not be processed.');
});

test('diagnostics are bounded without splitting Unicode characters or partial control escapes', () => {
  for (const hostile of ['x'.repeat(FILE_INPUT_MAX_BYTES), '🚧'.repeat(2000), '\x1b'.repeat(2000)]) {
    const result = formatInputError(new Error('Unsupported key ' + hostile));
    assert.ok(result.length <= INPUT_ERROR_MAX_LENGTH);
    assert.ok(result.endsWith('…'));
    assert.ok(result.isWellFormed());
    assert.doesNotMatch(result, /\\(?:u[0-9a-f]{0,3})?…$/u);
  }
});

// Checked-in import handlers with real Blob bytes and DOM/Worker stand-ins.
// These tests do not exercise a browser file picker or native rendering.
async function loaded() {
  const app = application();
  await app.importExperiment(minimalScenario('current-experiment'));
  app.latestWorker().respond();
  return app;
}
function snapshot(app) {
  const state = structuredClone(app.state), worker = app.latestWorker(), requests = app.posted.length;
  return () => {
    assert.deepEqual(app.state, state);
    assert.strictEqual(app.latestWorker(), worker);
    assert.equal(app.posted.length, requests);
  };
}

test('browser handler rejects malformed bytes without replacing current data, results or worker', async () => {
  const app = await loaded(), unchanged = snapshot(app);
  for (const [, sequence] of invalidSequences) {
    await app.importFile(new Blob([hostileLabel(sequence)], { type: 'application/json' }));
    unchanged();
    assert.equal(app.element('toast').textContent, 'Import rejected. File is not valid UTF-8. Save it as UTF-8 JSON and try again.');
    assert.ok(app.element('toast').classList.contains('error'));
  }
});

test('browser handler accepts real UTF-8/BOM files without rewriting literal replacement characters', async () => {
  const app = await loaded(), scenario = minimalScenario('valid-utf8');
  scenario.name = 'É 東京 🚚 �';
  for (const prefix of ['', '\ufeff']) {
    await app.importFile(new Blob([prefix, JSON.stringify(scenario)], { type: 'application/json' }));
    assert.equal(app.state.experiment.baseScenario.name, scenario.name);
    assert.equal(app.element('scene-name').textContent, scenario.name);
    assert.match(app.element('toast').textContent, /Loaded/u);
  }
});

test('browser handler enforces reported size before reading and actual size before decoding', async () => {
  const app = await loaded(), unchanged = snapshot(app);
  let reads = 0;
  await app.importFile({ size: FILE_INPUT_MAX_BYTES + 1, arrayBuffer() { reads += 1; throw new Error('must not read'); } });
  assert.equal(reads, 0); unchanged(); assert.match(app.element('toast').textContent, /2 MiB/u);
  await app.importFile({ size: 1, async arrayBuffer() { reads += 1; return new Uint8Array(FILE_INPUT_MAX_BYTES + 1).fill(0xff).buffer; } });
  assert.equal(reads, 1); unchanged(); assert.match(app.element('toast').textContent, /2 MiB/u);
  const text = scenarioText('exact-byte-bound');
  const content = '\ufeff' + text + ' '.repeat(FILE_INPUT_MAX_BYTES - 3 - encode(text).length);
  const file = new Blob([content]); assert.equal(file.size, FILE_INPUT_MAX_BYTES);
  await app.importFile(file); assert.equal(app.state.scenario.id, 'exact-byte-bound');
  const exactUnchanged = snapshot(app);
  await app.importFile(new Blob([content, ' '])); exactUnchanged();
  assert.match(app.element('toast').textContent, /2 MiB/u);
});

test('browser read failures and bounded hostile schema diagnostics preserve the current experiment', async () => {
  const app = await loaded(), unchanged = snapshot(app);
  const files = [
    { size: 1, async arrayBuffer() { throw new Error('Read failed\x1b[31m\n\u202eunsafe'); } },
    new Blob(['{"version":3}']),
    new Blob(['{"' + '🚧'.repeat(2000) + '":0}']),
    new Blob(['{"' + 'x'.repeat(FILE_INPUT_MAX_BYTES - 6) + '":0}']),
    new Blob(['{"\\u001b[31m\\n\\u202e":0}']),
  ];
  for (const file of files) {
    await app.importFile(file); unchanged();
    const message = app.element('toast').textContent;
    assert.ok(message.startsWith('Import rejected. '));
    assert.ok(message.length <= 'Import rejected. '.length + INPUT_ERROR_MAX_LENGTH);
    assert.doesNotMatch(message, /[\x00-\x1f\x7f-\x9f\u2028-\u202e]/u);
  }
});

test('stale invalid byte reads cannot replace newer selections, Reset or lesson state and messages', async () => {
  for (const action of [
    app => app.importExperiment(minimalScenario('newer-selection')),
    app => app.element('reset-button').click(),
    async app => { await app.element('try-example-button').click(); await app.element('lesson-start').click(); },
    async app => { await app.element('try-example-button').click(); await app.element('lesson-start').click(); await app.element('return-experiment').click(); },
  ]) {
    const app = await loaded(), pending = deferredFile(), importing = app.importFile(pending.file);
    await action(app);
    const unchanged = snapshot(app), message = app.element('toast').textContent;
    pending.resolve(new Uint8Array([0xff]).buffer); await importing;
    unchanged(); assert.equal(app.element('toast').textContent, message);
  }
});
