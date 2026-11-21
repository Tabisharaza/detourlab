import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createComparisonEvidence, renderComparisonEvidence } from '../scripts/comparison-evidence.js';
import { renderComparisonBrief } from '../scripts/comparison-brief.js';

const root = new URL('../', import.meta.url);
const load = name => JSON.parse(readFileSync(new URL(`../examples/${name}-experiment.json`, import.meta.url)));
const run = (...args) => spawnSync(process.execPath, ['scripts/review-comparison.js', ...args], { cwd: root, encoding: 'utf8' });

test('brief CLI reproduces checked-in tiny example byte-for-byte', () => {
  const result = run('brief', 'docs/examples/variant-comparison/tiny-evidence.json');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, readFileSync(new URL('../docs/examples/variant-comparison/tiny-brief.txt', import.meta.url), 'utf8'));
});

test('Meridian exposes 65 later arrivals despite 12 fewer late deliveries, with stable bounded ranking', () => {
  const evidence = createComparisonEvidence(load('meridian'), 'market-05', 'market-10');
  const result = renderComparisonBrief(evidence.report);
  assert.match(result, /Late deliveries: 118 → 106 \(-12\)/);
  assert.match(result, /192 delivery rows\): 46 earlier, 81 unchanged, 65 later, 0 not comparable/);
  const rows = result.split('Largest arrival regressions: 65 (showing first 5)\n')[1].split('\n\n')[0].split('\n');
  const ranked = evidence.report.jobs.filter(row => row.arrivalDeltaS > 0)
    .sort((a, b) => b.arrivalDeltaS - a.arrivalDeltaS).slice(0, 5);
  assert.deepEqual(rows.map(row => row.trim().split(' ')[0]), ranked.map(row => row.id));
  assert.match(rows[0], /; \+84 s$/);
  assert.equal(renderComparisonBrief(evidence.report), result);
});

test('missed arrivals are not zero-second comparisons', () => {
  const { report } = createComparisonEvidence(load('meridian'), 'market-05', 'all-bridges-05');
  const result = renderComparisonBrief(report);
  assert.match(result, /Completed deliveries: 192 → 135 \(-57\)/);
  assert.match(result, /Newly unreachable deliveries: 57 \(showing first 5\)/);
  assert.match(result, /57 not comparable/);
  assert.match(result, /→ unreachable \(no arrival\)\n/);
});

test('one recovery and one loss are visible even when completed deliveries net to zero', () => {
  const experiment = load('minimal');
  const base = experiment.baseScenario;
  base.nodes.push(...base.nodes.map(node => ({ ...node, id: `${node.id}2`, y: node.y + 3 })));
  base.edges.push(...base.edges.map(edge => ({ ...edge, id: `${edge.id}2`, from: `${edge.from}2`, to: `${edge.to}2` })));
  base.vehicles.push({ id: 'van-2', startNode: 'A2', startTimeS: 0 });
  base.jobs.push({ ...base.jobs[0], id: 'job-2', vehicleId: 'van-2', nodeId: 'C2' });
  experiment.variants = [
    { id: 'close-second', name: 'Close the second network', closures: [{ id: 'blocked', atS: 0, edgeIds: ['bc2', 'bd2'] }] },
    { id: 'close-first', name: 'Close the first network', closures: [{ id: 'blocked', atS: 0, edgeIds: ['bc', 'bd'] }] },
  ];
  const { report } = createComparisonEvidence(experiment, 'close-second', 'close-first');
  const result = renderComparisonBrief(report);
  assert.match(result, /Completed deliveries: 1 → 1 \(0\)/);
  assert.match(result, /Completed total is unchanged, but different deliveries were reached\./);
  assert.match(result, /Newly unreachable deliveries: 1\n  job-1 .* → unreachable \(no arrival\)/);
  assert.match(result, /Recovered deliveries: 1\n  job-2 .* unreachable \(no arrival\) → on-time/);
  assert.match(result, /2 not comparable/);
});

test('brief CLI escapes display names and rejects tampered, version-mismatched and non-regular input without stdout', t => {
  const dir = mkdtempSync(join(tmpdir(), 'detourlab-brief-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'evidence.json');
  const link = join(dir, 'evidence-link');
  const input = load('minimal');
  input.variants[1].name = 'Blue\u202e\\Lane';
  const evidence = createComparisonEvidence(input, 'close-at-10', 'close-at-11');
  writeFileSync(file, renderComparisonEvidence(evidence));
  symlinkSync(file, link);
  const safe = run('brief', file);
  assert.equal(safe.status, 0, safe.stderr);
  assert.ok(safe.stdout.includes(String.raw`Blue\u202e\\Lane`));
  const reject = (...args) => {
    const result = run('brief', ...args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^DetourLab:/);
  };
  reject(link);
  reject(dir);
  reject(file, 'extra');
  writeFileSync(file, renderComparisonEvidence({ ...evidence, version: 2 }));
  reject(file);
  evidence.report.jobs[0].arrivalDeltaS = 0;
  writeFileSync(file, renderComparisonEvidence(evidence));
  reject(file);
});
