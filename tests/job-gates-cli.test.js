import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const example = () => JSON.parse(readFileSync(path.join(root, 'docs/examples/net-lateness.experiment.json'), 'utf8'));
const scenario = () => { const e = example(); return { ...e.baseScenario, closures: e.variants[1].closures }; };
const run = (runner, args) => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', runner), ...args], { cwd: root, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.error, undefined);
  return result;
};
function inputFile(t, value) {
  const directory = mkdtempSync(path.join(tmpdir(), 'detourlab-job-gates-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'input.json');
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}
const selected = (runner, result) => runner === 'run-scenario.js' ? result : result.variants.find(v => v.id === 'supplied');
const flags = ['--max-newly-late', '--max-arrival-slip-s'];

for (const runner of ['run-scenario.js', 'run-experiment.js']) {
  test(`${runner}: net late count can pass while the new job gate fails`, t => {
    const file = inputFile(t, scenario());
    const old = run(runner, [file, '--json', '--max-extra-late', '0', '--max-unreachable', '1']);
    assert.equal(old.status, 0, old.stderr);
    assert.equal(selected(runner, JSON.parse(old.stdout)).delta.extraLateJobs, 0);
    const actual = run(runner, [file, '--json', '--max-extra-late', '0', '--max-unreachable', '1', '--max-newly-late', '0']);
    assert.equal(actual.status, 1, actual.stderr); assert.equal(actual.stderr, '');
    const result = JSON.parse(actual.stdout), row = selected(runner, result);
    assert.equal(result.passed, false);
    assert.deepEqual(row.jobComparison, { totalJobs: 3, comparableJobs: 2, uncomparableJobs: 1, newlyLateJobs: 1, maxArrivalSlipS: 6 });
    assert.deepEqual(row.violations, [{ metric: 'newlyLateJobs', actual: 1, limit: 0 }]);
  });

  test(`${runner}: exact new limits pass; a smaller arrival limit fails without rounding`, t => {
    const file = inputFile(t, scenario());
    for (const [limit, status] of [['6', 0], ['5.999999999', 1]]) {
      const actual = run(runner, [file, '--json', '--max-newly-late', '1', '--max-arrival-slip-s', limit]);
      assert.equal(actual.status, status, actual.stderr);
      const row = selected(runner, JSON.parse(actual.stdout));
      assert.equal(row.jobComparison.maxArrivalSlipS, 6);
      assert.deepEqual(row.violations, status ? [{ metric: 'maxArrivalSlipS', actual: 6, limit: Number(limit) }] : []);
    }
  });

  test(`${runner}: later but still on-time deliveries can trip the arrival gate`, t => {
    const s = scenario(); s.jobs[0].dueTimeS = 100;
    const actual = run(runner, [inputFile(t, s), '--json', '--max-newly-late', '0', '--max-arrival-slip-s', '5']);
    assert.equal(actual.status, 1, actual.stderr);
    const row = selected(runner, JSON.parse(actual.stdout));
    assert.equal(row.jobComparison.newlyLateJobs, 0);
    assert.deepEqual(row.violations, [{ metric: 'maxArrivalSlipS', actual: 6, limit: 5 }]);
  });

  test(`${runner}: already-late deterioration counts as arrival slip, not newly late`, t => {
    const s = scenario(); s.jobs[0].dueTimeS = 5;
    const actual = run(runner, [inputFile(t, s), '--json', '--max-newly-late', '0', '--max-arrival-slip-s', '5']);
    assert.equal(actual.status, 1, actual.stderr);
    assert.deepEqual(selected(runner, JSON.parse(actual.stdout)).jobComparison, { totalJobs: 3, comparableJobs: 2, uncomparableJobs: 1, newlyLateJobs: 0, maxArrivalSlipS: 6 });
  });

  test(`${runner}: empty work fails closed only for a requested arrival gate`, t => {
    const s = scenario(); s.jobs = [];
    const file = inputFile(t, s);
    const countOnly = run(runner, [file, '--json', '--max-newly-late', '0']);
    assert.equal(countOnly.status, 0, countOnly.stderr);
    assert.equal(selected(runner, JSON.parse(countOnly.stdout)).jobComparison.maxArrivalSlipS, null);
    const actual = run(runner, [file, '--json', '--max-arrival-slip-s', '0']);
    assert.equal(actual.status, 1, actual.stderr);
    assert.deepEqual(selected(runner, JSON.parse(actual.stdout)).violations, [{ metric: 'maxArrivalSlipS', actual: null, limit: 0, reason: 'no-comparable-jobs' }]);
    const human = run(runner, [file, '--max-arrival-slip-s', '0']);
    assert.equal(human.status, 1);
    assert.match(human.stdout, /no comparable arrivals/iu);
    assert.doesNotMatch(human.stdout, /null\s*>/u);
  });

  test(`${runner}: wholly incomparable work is not measured as zero arrival slip`, t => {
    const s = scenario(); s.jobs = [s.jobs[1]];
    const actual = run(runner, [inputFile(t, s), '--json', '--max-arrival-slip-s', '1000000']);
    assert.equal(actual.status, 1, actual.stderr);
    const row = selected(runner, JSON.parse(actual.stdout));
    assert.equal(row.jobComparison.comparableJobs, 0);
    assert.equal(row.jobComparison.uncomparableJobs, 1);
    assert.equal(row.jobComparison.maxArrivalSlipS, null);
    assert.equal(row.violations[0].reason, 'no-comparable-jobs');
  });

  test(`${runner}: omitted optional gates preserve the old JSON field contract`, t => {
    const actual = run(runner, [inputFile(t, scenario()), '--json', '--max-extra-late', '0']);
    assert.equal(actual.status, 0, actual.stderr);
    const result = JSON.parse(actual.stdout), row = selected(runner, result);
    assert.equal(Object.hasOwn(row, 'jobComparison'), false);
    assert.deepEqual(result.thresholds, { extraLateJobs: 0 });
    assert.deepEqual(Object.keys(row.delta), ['distanceM', 'extraDistancePct', 'extraLateJobs', 'unreachableJobs']);
  });

  test(`${runner}: all five threshold flags retain deterministic canonical ordering`, t => {
    const file = inputFile(t, scenario());
    const pairs = [['--max-extra-distance-pct', '0'], ['--max-extra-late', '0'], ['--max-unreachable', '0'], ['--max-newly-late', '0'], ['--max-arrival-slip-s', '0']];
    const a = run(runner, [file, '--json', ...pairs.flat()]);
    const b = run(runner, [...pairs.toReversed().flat(), '--json', file]);
    assert.equal(a.status, 1, a.stderr); assert.equal(b.status, 1, b.stderr);
    assert.equal(a.stdout, b.stdout); assert.equal(a.stderr, b.stderr);
    const result = JSON.parse(a.stdout);
    assert.deepEqual(Object.keys(result.thresholds), ['extraDistancePct', 'extraLateJobs', 'unreachableJobs', 'newlyLateJobs', 'maxArrivalSlipS']);
    assert.deepEqual(selected(runner, result).violations.map(v => v.metric), ['unreachableJobs', 'newlyLateJobs', 'maxArrivalSlipS']);
  });

  test(`${runner}: duplicates and invalid new limits fail before any input read`, () => {
    for (const flag of flags) {
      for (const value of ['', '-1', 'NaN', 'Infinity', '--json']) {
        const actual = run(runner, ['missing-gate-input.json', flag, value]);
        assert.equal(actual.status, 2); assert.equal(actual.stdout, '');
        assert.match(actual.stderr, /finite nonnegative number/u);
      }
      const missing = run(runner, ['missing-gate-input.json', flag]);
      assert.equal(missing.status, 2); assert.equal(missing.stdout, '');
      const duplicate = run(runner, ['missing-gate-input.json', flag, '0', flag, '1']);
      assert.equal(duplicate.status, 2); assert.equal(duplicate.stdout, '');
      assert.match(duplicate.stderr, /may only be supplied once/u);
    }
  });

  test(`${runner}: invalid input with an optional gate returns no partial metrics`, t => {
    const actual = run(runner, [inputFile(t, '{broken'), '--json', '--max-newly-late', '0']);
    assert.equal(actual.status, 2); assert.equal(actual.stdout, '');
    assert.match(actual.stderr, /not valid JSON/u);
    const help = run(runner, ['missing.json', '--help']);
    assert.equal(help.status, 0); assert.match(help.stdout, /--max-newly-late/u); assert.match(help.stdout, /--max-arrival-slip-s/u);
  });
}

test('experiment gates evaluate every named variant and identify each violation', () => {
  const actual = run('run-experiment.js', ['docs/examples/net-lateness.experiment.json', '--json', '--max-newly-late', '0', '--max-arrival-slip-s', '5']);
  assert.equal(actual.status, 1, actual.stderr);
  const result = JSON.parse(actual.stdout);
  assert.deepEqual(result.variants.map(v => [v.id, v.passed]), [['clear', true], ['cut', false]]);
  assert.deepEqual(result.violations, [{ variantId: 'cut', metric: 'newlyLateJobs', actual: 1, limit: 0 }, { variantId: 'cut', metric: 'maxArrivalSlipS', actual: 6, limit: 5 }]);
  assert.equal(result.variants[0].jobComparison.maxArrivalSlipS, 0);
  assert.equal(result.warnings.length, 1);
});

test('Meridian new-lateness gate agrees with independently exposed impact transitions', () => {
  const actual = run('run-experiment.js', ['examples/meridian-experiment.json', '--json', '--max-newly-late', '117']);
  assert.equal(actual.status, 1, actual.stderr);
  const result = JSON.parse(actual.stdout);
  const impact = run('explain-experiment.js', ['examples/meridian-experiment.json', '--variant', 'market-05', '--json']);
  assert.equal(impact.status, 0);
  const market = result.variants.find(v => v.id === 'market-05');
  assert.equal(market.jobComparison.newlyLateJobs, 118);
  assert.equal(market.jobComparison.newlyLateJobs, JSON.parse(impact.stdout).summary.transitions['on-time'].late);
  assert.equal(market.jobComparison.comparableJobs, 192);
});
