# Compare a plan across synthetic Meridian seeds

**Question:** Does this closure plan meet my limits on more than the familiar
seed-42 fixture?

The existing [closure-time study](CUTOFF_COMPARISON.md) deliberately holds the
network and demand fixed. This complementary headless study regenerates the
original Meridian fixture for **2–12 explicitly chosen seeds**, runs the same
named plans on each, and retains every seed's own baseline and policy outcome.
It implements the roadmap's bounded multi-seed summary, not a new routing model.

```sh
node scripts/compare-seeds.js --seeds 0,42,4294967295 --max-extra-late 120
node scripts/compare-seeds.js --seeds 0,42,4294967295 --max-extra-late 120 --json
```

## A mean can conceal a failed sample

Actual output from the three explicit synthetic seeds above:

| Seed | Market Bridge at 05:00: late / policy | Market Bridge at 10:00: late / policy |
| --- | --- | --- |
| 0 | 122 / failed | 109 / passed |
| 42 | 118 / passed | 106 / passed |
| 4294967295 | 105 / passed | 101 / passed |

All six rows completed 192 jobs, with zero unreachable. Each clear-road baseline
had zero late jobs, so here late and additional-late counts coincide. They are
not interchangeable in a general experiment.

The 05:00 plan's **mean is 115** additional late jobs, below the supplied limit
of 120, yet the plan and overall study **fail** because seed 0 has 122. The
10:00 plan passes all three samples. The complete report is still emitted and
the command exits **1**. No aggregate mean can override a failed sample.

The [complete generated JSON](examples/seed-study/three-seeds.json) is reproduced
byte-for-byte by a test. These three chosen seeds are examples, not a random
population sample, evidence of statistical confidence, a real-world prediction,
or proof that either plan is best. No winning plan is selected.

## What changes, and what stays paired

`createDemoScenario(seed)` is the existing original fixture generator. A seed
changes **edge travel times, delivery destinations, service durations and
deadline slack**. Topology, node positions, edge distances, fleet starts and
per-vehicle job-ID order remain fixed. This is **not demand-only variation**.

Within each seed, every selected plan shares the exact same generated network,
vehicles, jobs and order. It is compared only with **that seed's** clear-road
baseline. Identically named job IDs across different seeds can describe different
destinations/deadlines and are **never paired across seeds**.

This command accepts no scenario file. Changing an arbitrary imported input's
`seed` metadata would not regenerate its geometry or demand; the tool never
pretends otherwise. Existing imported scenarios remain fully supported by the
ordinary experiment, impact, cutoff and review commands.

## Named plans and policy

Default plans are `market-05` and `market-10`. Use `--plans` for 2–4 distinct
members of this fixed set, in any input order:

| ID | Schedule |
| --- | --- |
| `market-05` | Both Market Bridge directions close at 300 s |
| `market-10` | Both Market Bridge directions close at 600 s |
| `all-bridges-05` | All six directed bridge edges close at 300 s |
| `clear-roads` | No closures; explicit control |

```sh
node scripts/compare-seeds.js --seeds 0,42 \
  --plans market-05,market-10,all-bridges-05,clear-roads --max-unreachable 0
```

The all-bridges plan has 63 unreachable jobs for seed 0 and 57 for seed 42.
It fails that policy, even though its skipped work reduces traveled distance
and late-arrival counts. Each affected seed/plan gets its own caution. Other
plans retain their own verdicts. Always read completed and unreachable counts
alongside distance and lateness.

The five existing flags retain their existing semantics:
`--max-extra-distance-pct`, `--max-extra-late`, `--max-unreachable`,
`--max-newly-late`, and `--max-arrival-slip-s`. Limits apply to every individual
seed × plan, relative to the corresponding clear-road baseline. Job gates reuse
the existing within-experiment comparison; unreachable arrivals are not compared
and a requested timing gate without comparable evidence fails closed.

Without policy flags, all verdicts are **`not-evaluated`**, `failedSeeds` is
`null`, and exit 0 means computation completed, not acceptance. With a policy,
`failedSeeds` is an explicit array per plan, including `[]` when all samples pass.

## Reproduce or inspect one sample

Export mode prints a standard validated v1 experiment **without simulation**:

```sh
# Use a NEW destination; shell redirection truncates existing files first.
node scripts/compare-seeds.js --export-seed 42 > new-seed42.experiment.json
node scripts/run-experiment.js new-seed42.experiment.json --json
node scripts/report-experiment.js new-seed42.experiment.json \
  --out new-seed42-review --max-extra-late 120
```

`--plans` applies to export too. Pass the same selected plans to reproduce the
reported canonical experiment SHA-256. The four-plan seed-42 export exactly
matches `examples/meridian-experiment.json`; the default export intentionally
contains only the two bridge-timing plans. Existing browser import understands
the format, but this source milestone does not establish native picker QA.

`--export-seed` cannot be combined with `--seeds`, `--json`, or threshold flags.
The command itself writes only stdout: it never creates or overwrites files.
Save the exported experiment **and source revision** for durable reproduction.
Input fingerprints are content identity, not signatures, original authorship,
or an executing implementation identity; a future generator can change output
for the same seed.

## Determinism, bounds and report contract

- `--seeds` requires 2–12 distinct unsigned decimal integers from 0 through
  4294967295. Fractions, signs, hexadecimal, scientific notation, empty values,
  duplicates (including `0,00`) and excess samples are rejected. Seeds sort
  numerically. Single-seed export accepts the same integer domain.
- `--plans` requires 2–4 unique exact IDs; output follows the table order above.
  Every flag may appear once; raw study-option strings are limited to 1024
  characters. Invalid requests are rejected before generation/simulation.
- There are at most **12 fixed-size experiments × 5 result ledgers = 60
  result ledgers**, including each baseline and any clear-road control. Clear
  controls reuse the engine's baseline-copy path. Each fixture has 432 nodes,
  1,614 directed edges, 24 vans and 192 jobs; no user-supplied dimensions or
  schedules expand that work. Ordinary per-engine and per-experiment work and
  segment limits still apply.
- Seeds execute sequentially. Only compact metrics, job comparisons, violations
  and fingerprints are retained between seeds, not full route ledgers.
- Version-1 `detourlab-meridian-seed-study` JSON includes `seeds`, `plans`,
  `thresholds`, overall `verdict`, complete per-seed `runs`, per-plan `variants`
  summaries, `warnings` and `limitations`. Every run contains its clear-road
  metrics and each selected plan's metrics, signed delta, job comparison,
  verdict and violations.
- Each descriptive statistic contains available `samples`, `missingSamples`,
  `min`, `max`, equal-weight `mean` rounded to six decimals, and all tied
  `minSeeds` / `maxSeeds`. These are statistics of per-seed metrics/deltas, not
  pooled vehicle or delivery data. Missing timing samples are excluded, counted
  and never converted to zero. A wholly missing statistic has null min/max/mean
  and empty extrema-seed arrays. Gates use each sample's existing engine/runner
  metric contract, never the rounded descriptive mean: distance deltas retain
  the runner's six-decimal rounding, while job timing retains literal precision.
- The entire pretty-printed report, including newline, is checked against a
  **1 MiB UTF-8 cap before stdout**. Invalid input, simulation/budget failure or
  an oversized report exits **2** with bounded stderr and no partial report.
  A completed failed policy exits **1** with the full report. `--help` exits 0
  without generating or simulating.

No dependencies, random time-based seeds, network calls, external map data,
engine semantics, application assets or existing CLI output contracts change.

## Design context and verification boundary

The roadmap called for bounded multi-seed summaries after design review. An
independent review selected this scope over per-job route attribution, which
would require attempt-boundary ledger changes rather than inferring causes.

Public primary-source context checked October 29, 2026:
[SUMO's randomness documentation](https://sumo.dlr.de/docs/Simulation/Randomness.html)
explains deterministic seed controls and repeated-seed runs. Its simulation
model and RNG are not DetourLab's, and none of its code/data is included here.
[God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) offers explorable
spatial layers and labels modeled/reconstructed evidence. DetourLab's distinct
focus remains a small synthetic, reproducible closure experiment, not a clone
of its globe, live surveillance, feeds or visual identity. These observations
motivate inspectable evidence; they are not adoption or Trending claims.

Local verification on October 29, 2026, with **Node 24.22.1 / npm 11.9.0 / Linux**
passed **1,035 core + 120 optional schema/editor tests = 1,155 distinct tests**,
with no failures or skips. The **21 new focused tests** and **211 separately
repeated CLI tests** are already included in the core total. Syntax checks
covered 92 core JavaScript files. Root and optional lockfiles installed unchanged
with lifecycle scripts disabled; optional packages came from the existing offline
cache. All 28 static payloads plus manifest reproduced byte-for-byte and matched
the verified pre-change source build. The existing Meridian runner and tiny
review-packet verifier also passed unchanged.

Independent code review found no must-fix findings; additional boundary-seed and
all-plan-subset probes are separate review evidence, not additional public tests.
Documentation review corrected an overbroad rounding claim to preserve the
existing runner contract above. Hosted CI must be checked for the exact published
source commit separately; local checks do not assert its outcome in advance.

Run `node --test tests/meridian-study.test.js tests/seed-study-cli.test.js` for
authoring parity, seed and plan bounds, descriptor safety, ordinary-engine
reproduction, all-sample policy, lost-service cautions, canonical output,
maximal bounded execution and actual CLI/export subprocesses. The aggregate
contributor checks, optional schema tests, independent review and exact-commit
hosted CI remain separate evidence. Browser imports, render profiling, mobile,
assistive technology and deployment are not established by this headless work.
