import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = 'examples/minimal-directed.json';
const flags = ['--max-extra-distance-pct', '--max-extra-late', '--max-unreachable'];
const metrics = ['extraDistancePct', 'extraLateJobs', 'unreachableJobs'];
const inheritedNames = ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty'];
const run = (runner, args, cwd = root) => spawnSync(process.execPath, [path.join(root, 'scripts', runner), ...args], {
  cwd, encoding: 'utf8', timeout: 15000,
});

for (const runner of ['run-scenario.js', 'run-experiment.js']) {
  test(`${runner} rejects every repeated threshold before reading input or returning metrics`, () => {
    for (const flag of flags) {
      for (const values of [['0', '100'], ['100', '0'], ['0', '0']]) {
        for (const file of [fixture, 'missing-duplicate-input.json']) {
          const result = run(runner, [file, '--json', flag, values[0], flag, values[1]]);
          assert.equal(result.error, undefined);
          assert.equal(result.status, 2, result.stderr);
          assert.equal(result.stdout, '');
          assert.equal(result.stderr, `DetourLab: ${flag} may only be supplied once.\n`);
        }
      }
    }
  });

  test(`${runner} emits byte-identical thresholds and violations regardless of flag order`, () => {
    for (const values of [['0', '0', '0'], ['30', '1', '0']]) {
      const ordered = flags.flatMap((flag, index) => [flag, values[index]]);
      const reversed = flags.map((flag, index) => [flag, values[index]]).reverse().flat();
      const a = run(runner, [fixture, '--json', ...ordered]);
      const b = run(runner, [...reversed, '--json', fixture]);
      assert.equal(a.status, values[0] === '0' ? 1 : 0, a.stderr);
      assert.equal(b.status, a.status, b.stderr);
      assert.equal(a.stderr, ''); assert.equal(b.stderr, '');
      assert.equal(a.stdout, b.stdout);
      const output = JSON.parse(a.stdout);
      assert.deepEqual(Object.keys(output.thresholds), metrics);
      assert.deepEqual(output.violations.map(item => item.metric), a.status ? metrics.slice(0, 2) : []);
    }
  });

  test(`${runner} never interprets inherited property names as threshold flags`, () => {
    for (const name of inheritedNames) {
      const result = run(runner, [name, '0', '--json']);
      assert.equal(result.status, 2, result.stderr);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /Only one .*file is allowed/u);
    }
  });

  test(`${runner} reads a bare file named like an inherited property without falling back to demo`, t => {
    const directory = mkdtempSync(path.join(tmpdir(), 'detourlab-cli-names-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const input = readFileSync(path.join(root, fixture));
    const expected = run(runner, [fixture, '--json']);
    assert.equal(expected.status, 0, expected.stderr);
    for (const name of inheritedNames) {
      writeFileSync(path.join(directory, name), input);
      const result = run(runner, [name, '--json'], directory);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, expected.stdout);
      assert.equal(result.stderr, '');
    }
  });
}

test('shared flags preserve scenario default, required experiment input and help without file reads', () => {
  const scenario = run('run-scenario.js', ['--json']);
  assert.equal(scenario.status, 0, scenario.stderr);
  assert.equal(JSON.parse(scenario.stdout).scenarioId, 'meridian-seed-42');
  const experiment = run('run-experiment.js', ['--json']);
  assert.equal(experiment.status, 2); assert.equal(experiment.stdout, '');
  assert.match(experiment.stderr, /JSON file is required/u);
  for (const runner of ['run-scenario.js', 'run-experiment.js']) {
    const help = run(runner, ['missing-help-input.json', '--help']);
    assert.equal(help.status, 0); assert.equal(help.stderr, '');
    assert.match(help.stdout, /--max-extra-late/u);
  }
});
