# Compare sampled closure times

**Question:** What changes if this closure starts at one of these times?

The headless cutoff comparison copies one existing variant and changes exactly
one selected closure event's `atS`. It replaces the input variant set with 2–6
sampled candidates and runs the ordinary experiment engine once: one clear-road
baseline plus the candidates. Other closure records, network, fleet, demand,
assignments and job order stay unchanged.

This replaces repetitive duplicate/rename/edit steps for a bounded timing study.
It does not search for an optimal cutoff or add a new simulation model.

## Quick start with a hand-checkable boundary

```sh
node scripts/compare-cutoffs.js examples/minimal-experiment.json \
  --variant close-at-10 --closure bc-closure --times 10,11 \
  --max-extra-late 0 --max-unreachable 0
```

Actual generated results from the checked-in tiny fixture:

| Sample | Distance | Late | Unreachable | Completed | Supplied policy |
| --- | ---: | ---: | ---: | ---: | --- |
| 10 s | 260 m | 1 | 0 | 1 / 1 | Failed |
| 11 s | 200 m | 0 | 0 | 1 / 1 | Passed |

The first cutoff blocks entry at B at 10 s. At 11 s the van has already entered
that edge. See the [walkthrough](EXPERIMENTS.md#tiny-walkthrough-one-second-changes-the-route).
The complete report exits **1**, because at least one candidate failed, while
listing **11 s** as a passing *sample*. It does not infer a passing interval or
that 11 s is the earliest feasible, safest, best or optimal time.

[Actual generated report](examples/cutoff-comparison/tiny-comparison.json) and
[ordinary generated experiment](examples/cutoff-comparison/tiny-experiment.json)
are reproduced byte-for-byte by tests. The generated experiment fingerprint is
`2189bb85cb94a88acddbf49226b4261a514528f1a4385877ddece367b309d9bd`.

For the larger synthetic district:

```sh
node scripts/compare-cutoffs.js examples/meridian-experiment.json \
  --variant market-05 --closure market-bridge-closure \
  --times 0,300,600,900 --json
```

The checked Meridian input produced these sampled results (all 192 jobs completed,
zero unreachable in each row):

| Cutoff | Distance | Late arrivals |
| --- | ---: | ---: |
| 0 s | 385,960 m | 153 |
| 300 s | 377,080 m | 118 |
| 600 s | 376,600 m | 106 |
| 900 s | 347,560 m | 50 |

These four observations do not establish monotonic behavior at untested times.
No acceptance limits were requested in that command.

## Reuse the comparison elsewhere

Export mode prints a regular validated v1 experiment without simulating:

```sh
# Use a NEW destination. Shell redirection truncates the destination first:
# never redirect onto the input file.
node scripts/compare-cutoffs.js examples/minimal-experiment.json \
  --variant close-at-10 --closure bc-closure --times 10,11 \
  --export-experiment > my-new-cutoff-study.experiment.json

node scripts/run-experiment.js my-new-cutoff-study.experiment.json --json
node scripts/report-experiment.js my-new-cutoff-study.experiment.json \
  --out my-new-cutoff-review --max-extra-late 0 --max-unreachable 0
```

The command itself writes only stdout, never creates/overwrites a file. The
existing review command retains its own new-directory/no-overwrite contract.
The exported format also remains compatible with the existing browser import
format; this milestone does not establish a native-browser import test.

`--export-experiment` cannot be combined with thresholds or `--json`; exported
JSON is authoring output, not a completed or accepted simulation.

## Selection, bounds and identity

- Supply an existing variant ID and a closure event ID *within that variant*.
  Selecting a clear-road variant with no event fails. A legacy scenario may use
  its upgraded `supplied` variant and an existing event ID.
- Supply 2–6 distinct nonnegative decimal numbers (scientific notation allowed),
  each at most 604800 seconds. Comma-separated whitespace is allowed. Empty,
  non-finite, duplicate or excess samples fail, including numerically equivalent
  duplicates such as `1,1.0`. The raw list is limited to 1024 characters.
- Samples are sorted numerically. IDs are deterministic and distinct from the
  source experiment/base/variant IDs and the reserved `baseline` ID. Candidate
  names identify the sampled seconds. The source variant set is replaced, not
  retained as additional unsampled plans.
- The source experiment fingerprint and selected IDs/original cutoff are
  recorded separately from the generated experiment fingerprint. Changing other
  source plans changes the source identity even if the generated outcomes stay
  the same. Hashes are not signatures or authenticated provenance.
- The pure `createCutoffExperiment` helper copies/validates input and never
  simulates. It preflights aggregate closure/reference counts before replication
  and validates the generated experiment's full 2 MiB/8,000-event/48,000-reference
  limits. The existing engine operation limits and 500,000 total-result-segment
  cap include the clear-road baseline and every candidate. No weakened budgets,
  new dependencies or partial reports.
- `durationS` remains a minimum playback horizon, not a cutoff limit or work
  truncation. After-horizon cutoffs may legitimately have no effect.

## Policy and interpretation

All five existing gates apply independently to **every sampled candidate versus
the clear-road baseline**, not versus the source variant:
`--max-extra-distance-pct`, `--max-extra-late`, `--max-unreachable`,
`--max-newly-late`, `--max-arrival-slip-s`.

No gate means policy **not evaluated**, with `passingSampleTimesS: null`. With
policy, that array lists only passing samples (possibly empty). A requested
arrival-slip gate fails as unevaluable when there are no comparable arrivals;
unreachable jobs are never converted to zero-delay evidence.

Exit 0 means every requested gate passed, no policy was evaluated, or an export
completed. Exit 1 means at least one candidate failed with the complete report
still available. Exit 2 means invalid input, exceeded budget or failed simulation;
no partial stdout report is returned. `--help` retains precedence and reads no file.
Every option is single-use.

Other closures remain exact, including their order and edge lists. An earlier
overlapping closure can dominate the selected event, so samples need not produce
different outcomes. Later cutoffs are not assumed monotonically better. Lower
distance or fewer late jobs can reflect skipped unreachable work: always compare
completed/unreachable counts and warnings alongside distance/lateness. This is
fixed-cost synthetic scenario analysis, not a traffic forecast or safety decision.

## Verification boundary

Tests cover the pure builder, isolated copies/frozen input, ID collisions,
selection, numeric/argument limits, replicated event/reference/byte budgets,
shared gate semantics, actual CLI exits, deterministic artifacts, legacy inputs,
input decoding and ordinary-runner roundtrips. A valid expensive synthetic input
exports without simulation but fails the comparison's engine budget without a
partial report. Independent review uses separate adversarial checks.

No engine/model/schema or browser UI change. Existing public deployment,
native file chooser, accessibility and real-world validity checks remain separate.
