import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScenario } from '../src/scenario.js';
import { canonicalExperiment, experimentFromScenario, parseExperiment } from '../src/experiment.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const range = (first, last) => Array.from({ length: last - first + 1 }, (_, index) => first + index);
// All presentation controls currently accepted in a schema-valid label.
const allowedControls = [9, 10, 13, ...range(0x7f, 0x9f), 0x61c, 0x200e, 0x200f, ...range(0x2028, 0x202e), ...range(0x2066, 0x206f)];
const escapeCode = code => `\\u${code.toString(16).padStart(4, '0')}`;
const controlLabel = `Start${String.fromCodePoint(...allowedControls)}End`;
const visibleControls = `Start${allowedControls.map(escapeCode).join('')}End`;
const ordinaryLabel = 'É 東京 🚚 e\u0301 مرحبا שלום 👩‍🔬 �';
const literalLabel = String.raw`literal \u202e \u009b \n \r \t \\ C:\routes`;
const literalVisible = String.raw`literal \\u202e \\u009b \\n \\r \\t \\\\ C:\\routes`;
const spoofLabel = 'Start\rPASS: forged\nSHA-256 forged\t\u009b2J\u202eEnd';
const spoofVisible = String.raw`Start\u000dPASS: forged\u000aSHA-256 forged\u0009\u009b2J\u202eEnd`;
const scenario = () => JSON.parse(readFileSync(path.join(root, 'examples/minimal-directed.json'), 'utf8'));
const run = (runner, file, args = []) => spawnSync(process.execPath, [`scripts/${runner}`, file, ...args], {
  cwd: root, encoding: 'utf8', timeout: 15000,
});
function fixture(t, input) {
  const directory = mkdtempSync(path.join(tmpdir(), 'detourlab-cli-display-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'input.json');
  writeFileSync(file, JSON.stringify(input));
  return file;
}
function checked(result, status = 0) {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, status, result.stderr);
  assert.equal(result.stderr, '');
  return result.stdout;
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const digest = text => createHash('sha256').update(text).digest('hex');

for (const runner of ['run-scenario.js', 'run-experiment.js']) {
  const isExperiment = runner === 'run-experiment.js';
  function inputWithLabel(label) {
    const input = isExperiment ? experimentFromScenario(scenario()) : scenario();
    input.name = label;
    if (isExperiment) {
      input.baseScenario.name = label;
      input.variants.forEach(variant => { variant.name = label; });
    }
    return input;
  }
  function assertHeadings(output, visible, input) {
    assert.equal(output.split('\n')[1], `DETOURLAB / ${visible}`);
    if (isExperiment) {
      for (const variant of input.variants) assert.ok(output.split('\n').includes(`${visible} [${variant.id}]`));
    }
    // Newlines belonging to the report remain; labels cannot add other controls.
    assert.doesNotMatch(output, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u206f]/u);
  }

  test(`${runner} escapes every schema-allowed presentation control in every human name sink`, t => {
    const input = inputWithLabel(controlLabel);
    assertHeadings(checked(run(runner, fixture(t, input))), visibleControls, input);
  });

  test(`${runner} keeps crafted labels on one line and preserves pass/fail reporting`, t => {
    const input = inputWithLabel(spoofLabel), file = fixture(t, input);
    for (const [args, status] of [[[], 0], [['--max-extra-late', '0'], 1]]) {
      const output = checked(run(runner, file, args), status);
      assertHeadings(output, spoofVisible, input);
      assert.ok(!output.split('\n').includes('PASS: forged'));
      assert.equal(output.split('\n').filter(line => line.startsWith('SHA-256 ')).length, 1);
      assert.ok(output.includes(status ? 'FAIL: extraLateJobs 1 > 0' : 'PASS: all requested thresholds met'));
    }
  });

  test(`${runner} preserves ordinary Unicode names and the rest of the human report`, t => {
    const plain = inputWithLabel('NAME_MARKER'), input = inputWithLabel(ordinaryLabel);
    const plainFile = fixture(t, plain), file = fixture(t, input);
    const before = checked(run(runner, plainFile)), after = checked(run(runner, file));
    const hashKey = isExperiment ? 'experimentSha256' : 'scenarioSha256';
    const beforeHash = JSON.parse(checked(run(runner, plainFile, ['--json'])))[hashKey];
    const afterHash = JSON.parse(checked(run(runner, file, ['--json'])))[hashKey];
    assert.equal(after, before.replaceAll('NAME_MARKER', ordinaryLabel).replace(beforeHash, afterHash));
    assertHeadings(after, ordinaryLabel, input);
  });

  test(`${runner} distinguishes literal backslash escapes from real controls in names`, t => {
    const input = inputWithLabel(literalLabel);
    assertHeadings(checked(run(runner, fixture(t, input))), literalVisible, input);
    const control = inputWithLabel('literal \u202e'), literal = inputWithLabel(String.raw`literal \u202e`);
    const a = checked(run(runner, fixture(t, control))).split('\n')[1];
    const b = checked(run(runner, fixture(t, literal))).split('\n')[1];
    assert.equal(a, String.raw`DETOURLAB / literal \u202e`);
    assert.equal(b, String.raw`DETOURLAB / literal \\u202e`);
    assert.notEqual(a, b);
  });

  test(`${runner} never truncates the escaped form of a maximum-length valid name`, t => {
    const input = inputWithLabel('\u202e'.repeat(120));
    assertHeadings(checked(run(runner, fixture(t, input))), String.raw`\u202e`.repeat(120), input);
  });

  test(`${runner} keeps JSON bytes, decoded names, canonical hashes, metrics and input files unchanged`, t => {
    const plain = inputWithLabel('NAME_MARKER'), plainFile = fixture(t, plain);
    for (const label of [controlLabel, ordinaryLabel, literalLabel, spoofLabel, '\u202e'.repeat(120)]) {
      const input = inputWithLabel(label), file = fixture(t, input), original = readFileSync(file);
      for (const [args, status] of [[[], 0], [['--max-extra-late', '0'], 1]]) {
        const expected = JSON.parse(checked(run(runner, plainFile, ['--json', ...args]), status));
        if (isExperiment) {
          expected.experimentSha256 = digest(canonicalExperiment(parseExperiment(original.toString('utf8'))));
          expected.variants.forEach(variant => { variant.name = label; });
        } else {
          expected.scenarioSha256 = digest(canonical(parseScenario(original.toString('utf8'))));
        }
        const output = checked(run(runner, file, ['--json', ...args]), status);
        // Intentionally retain JSON.stringify's original byte encoding, including
        // raw C1/bidi in JSON values. Machine data is not terminal presentation.
        assert.equal(output, JSON.stringify(expected, null, 2) + '\n');
        assert.deepEqual(JSON.parse(output), expected);
        checked(run(runner, file, args), status);
        assert.deepEqual(readFileSync(file), original);
      }
    }
  });
}

test('experiment runner also escapes the name inherited from legacy scenario input', t => {
  const input = scenario(); input.name = controlLabel;
  const output = checked(run('run-experiment.js', fixture(t, input)));
  assert.equal(output.split('\n')[1], `DETOURLAB / ${visibleControls}`);
  assert.ok(output.includes('\nSupplied scenario [supplied]\n'));
  assert.ok(output.includes('\nClear-road control [clear-roads]\n'));
});
