# Experiment format v1

An experiment compares 2–6 named closure variants over one shared network, fleet and ordered demand. It does not regenerate jobs per variant or optimize job assignment.

Required top-level fields:

- `format`: exactly `detourlab-experiment`
- `version`: exactly `1`
- `id`, `name`: safe identity and display label
- `baseScenario`: a complete validated scenario v1 with `closures: []`
- `variants`: 2–6 `{id, name, closures}` records

`closures` has the original scenario semantics: each `{id, edgeIds, atS}` closes its directed edges permanently from that cutoff. A vehicle already on an edge finishes it. All variants use the base scenario's exact dispatch times, speeds, distances, vehicle assignments, delivery sequence and deadlines.

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

`canonicalExperiment()` sorts object keys and preserves array order; Node computes SHA-256 from this input. This is a reproducibility fingerprint, not a signature or proof of data trustworthiness.

## Verification boundary

Node tests exercise the exact model, worker protocol, CLI and UI event-handler state through mocked DOM/Worker interfaces. They do not replace real browser, file-picker, mobile, reduced-motion or screen-reader tests. No claim of those checks follows from a passing mocked test.
