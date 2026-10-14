# Experiment format v1

[Versioned JSON Schemas and editor authoring](JSON_SCHEMAS.md) provide early structural feedback. Runtime validation remains authoritative; do not add `$schema` to input documents.

An experiment compares 2–6 named closure variants over one shared network, fleet and ordered demand. It does not regenerate jobs per variant or optimize job assignment.

Required top-level fields:

- `format`: exactly `detourlab-experiment`
- `version`: exactly `1`
- `id`, `name`: safe identity and display label
- `baseScenario`: a complete validated scenario v1 with `closures: []`
- `variants`: 2–6 `{id, name, closures}` records

`closures` has the original scenario semantics: each `{id, edgeIds, atS}` closes its directed edges permanently from that cutoff. A vehicle already on an edge finishes it. All variants use the base scenario's exact dispatch times, speeds, distances, vehicle assignments, delivery sequence and deadlines.

## Tiny walkthrough: one second changes the route

[`examples/minimal-experiment.json`](../examples/minimal-experiment.json) compares exactly three variants on the four-node network from [`minimal-directed.json`](../examples/minimal-directed.json). The original scenario file is unchanged. Its graph, vehicle, job, metadata and order are copied exactly into `baseScenario`, with only `closures` cleared. Each variant supplies its own closure schedule:

| Variant ID | Closure | Distance | Arrival | Service complete | Job status | Completed / unreachable |
| --- | --- | --- | --- | --- | --- | --- |
| `clear` | None | 200 m | 20 s | 23 s | On time | 1 / 0 |
| `close-at-10` | `bc` at 10 s | 260 m | 26 s | 29 s | Late | 1 / 0 |
| `close-at-11` | `bc` at 11 s | 200 m | 20 s | 23 s | On time | 1 / 0 |

Check the arithmetic by hand:

1. The van enters `ab` at 0 s and reaches B at 10 s: 100 m in 10 s.
2. With clear roads, it enters `bc` at 10 s and reaches C at 20 s: another 100 m in 10 s, totaling 200 m.
3. A closure at **10 s** blocks that exact entry to `bc`. The van reroutes once at B, taking `bd` from 10–18 s (80 m), then `dc` from 18–26 s (80 m). Total: 100 + 80 + 80 = 260 m, arriving 4 s after the 22 s deadline.
4. A closure at **11 s** occurs after the van entered `bc` at 10 s. It finishes that edge at 20 s without a reroute. Closures prevent entry; they do not interrupt travel already in progress.

The deadline is an **arrival** deadline. The job's 3 s service time makes the van finish at 23 s or 29 s; finishing service after 22 s does not make the 20 s arrival late. Both clear roads and the 11 s variant match the baseline: zero extra distance and zero extra late jobs. The 10 s variant adds 60 m (30%) and one late job. All three complete the same one job with zero unreachable jobs, so the distance comparison covers equal completed work.

From the repository root, reproduce the metrics and fingerprint with:

```sh
node scripts/run-experiment.js examples/minimal-experiment.json --json
```

The JSON reports `experimentId: "minimal-cutoff-experiment"` and this canonical `experimentSha256`:

```text
7a757f1b53531826e98f44a706d3c6d235986682e6517c3c542f116fa8bf7395
```

This hashes the validated experiment, including labels and array order, rather than the raw file's whitespace. The CLI reports aggregate metrics; the hand-checkable route, arrival and service ledgers above are protected by `tests/experiment.test.js`.

## Validation

Imports and exports are limited to 2 MiB UTF-8. IDs and foreign references are checked; variants have unique IDs and closure events are unique within each variant. Plain records and arrays only: unknown/inherited/accessor/prototype properties are rejected. Aggregate limits cap the experiment at 8,000 closure records, 48,000 closure edge references and 500,000 returned route segments, including the baseline and clear-road copies. These supplement the scenario's graph and operation bounds. Export uses readable JSON when it fits and compact JSON otherwise.

A legacy scenario v1 JSON upgrades to two variants: the supplied closure schedule and a clear-road control. Its geometry, seed, demand and order are preserved, not regenerated.

## UI behavior

- Selection changes the inspected variant while preserving the shared playback time and selected vehicle.
- Duplicate makes an independent closure copy. Rename affects only that variant's label.
- Remove is unavailable at the two-variant minimum; duplication stops at six.
- Each closure event exposes an independent start time and removal control.
- The road direction selector applies to new toggles; a one-way edge has no implicit reverse.
- The slider sets new-event time only, preserving existing schedules.
- Every changed experiment invalidates old results. Superseded calculations terminate; stale completion/error messages are ignored.
- Cancel preserves input and clears output; Run all variants starts a fresh calculation.
- Newer imports, edits and Reset supersede older pending file reads.

## Results

The baseline is simulated once with no closures. Each variant returns the full vehicle/job ledger plus signed distance and lateness deltas and the absolute unreachable count. Clear-road variants match the baseline exactly.

Cards show final outcomes for the entire run. Playback shows positions at the selected time. Less distance is not inherently better: skipped jobs can shorten travel. Always read completed and unreachable counts with distance/late counts.

## Headless runner

`npm run experiment -- examples/meridian-experiment.json --json`

The CLI accepts bounded JSON experiments and legacy scenario files. Optional thresholds apply independently to every variant: `--max-extra-distance-pct`, `--max-extra-late`, and `--max-unreachable`. A threshold failure exits 1; malformed input/arguments exit 2. The original single-scenario runner remains available.

Both runners share one argument parser. `--help` preserves its existing precedence: it shows usage without validating other arguments or reading input. Otherwise, supply each threshold at most once, even when repeating the same value: duplicates exit 2 before reading a file or returning metrics. Threshold and violation fields use distance, lateness, then unreachable order regardless of flag order. The scenario runner still defaults to the seed-42 demo when no file is supplied; the experiment runner requires a file. Bare filenames such as `constructor` are treated as filenames, never inherited option names.

For example, the following rejects an ambiguous check rather than silently allowing the later value to weaken it:

```sh
node scripts/run-scenario.js examples/minimal-directed.json --max-extra-late 0 --max-extra-late 100 --json
# Exit 2; stderr: DetourLab: --max-extra-late may only be supplied once.
```

Use one `--max-extra-late 0` to receive the actual failing metrics (exit 1), or one `--max-extra-late 1` to allow this fixture's one extra late delivery (exit 0).

`canonicalExperiment()` sorts object keys and preserves array order; Node computes SHA-256 from this input. This is a reproducibility fingerprint, not a signature or proof of data trustworthiness.

## Verification boundary

Node tests exercise the exact model, worker protocol, CLI and UI event-handler state through mocked DOM/Worker interfaces. They do not replace real browser, file-picker, mobile, reduced-motion or screen-reader tests. No claim of those checks follows from a passing mocked test.

## File encoding

The app and both CLIs accept UTF-8 JSON with an optional leading BOM, which counts toward the 2 MiB input bound. Malformed UTF-8 is rejected without substituting label characters. Exports have no BOM. [File input and reproducible roundtrips](FILE_INPUT.md) documents error handling, byte acquisition and the remaining native browser QA gap.
