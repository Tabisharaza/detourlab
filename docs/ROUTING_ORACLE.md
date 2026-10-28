# Independent bounded routing evidence

DetourLab's source tests now compare the engine against a deliberately different,
test-only reference in `tests/helpers/routing-oracle.js`. This is engineering
regression evidence, not validation of real traffic or proof over all valid inputs.

## What is compared

```sh
node --test tests/routing-oracle.test.js
```

The suite has 104 tests: 96 deterministic generated scenarios and eight focused
checks. For each generated scenario it compares:

- All 25 ordered source/destination pairs, with no closures and with the edges
  closed at three seconds: 50 path comparisons per seed, 4,800 in total. These
  are assertions inside the 96 tests, **not 4,800 additional tests**.
- Exact node/edge paths, travel time and distance. Path preference is shortest
  travel time, then shortest distance, then ordinal edge-ID sequence. Locale
  sorting, array order and joined path strings do not define that preference.
- Every vehicle's ordered traversal segments and delivery records, including
  IDs, times, status, distances and finish time; all numeric outcome metrics and
  the resulting playback horizon.
- The same result after reversing nodes, edges, vehicles and closure records.
  Jobs are deliberately **not** reordered: their supplied per-vehicle order is
  the model contract. Input mutation is also rejected.

Reroute explanation arrays and the `reroutes`/`affectedVehicles` metrics are
explicitly excluded from this reference projection. Existing focused engine
checks still cover them. This suite must not be described as full-result,
browser, Worker, or cross-platform equivalence.

## Why the reference is independent

Production uses reverse Dijkstra, a heap, destination route trees and a bounded
closure-phase cache. The reference enumerates all simple directed paths from the
current source, sorts by the stated cost policy and scans closure records at
every edge entry. It uses no production validator, route helper, timeline or
cache. It executes fixed job sequences and service time from scratch.

Positive edge costs make a static optimum simple. A dynamically rerouted trip
can revisit a previously visited node, so the reference starts a fresh path
search at every entry. The explicit A–B–A–D–C case checks this distinction.

The generated corpus uses five nodes, at most 20 directed edges, two vehicles,
12 interleaved jobs and bounded closure schedules. Costs/times use integer
multiples of 0.25, so the tested sums are exactly representable in binary.
Seed generation uses a fixed 32-bit LCG (1664525, 1013904223), mapped using the
whole unsigned output, for seeds 0–95. It is deterministic, not a statistical
coverage guarantee. No external data or dependency is used.

The reference is test-only and intentionally unsuitable for large graphs:
six-node/40-edge limits, 100,000 recursive path visits per search and 1,000
traversals per vehicle prevent accidental expansion into unbounded work.
It assumes the trusted generated/curated fixtures; it is not an input validator.

## Focused cases and reproduction

Hand-checkable assertions cover conflicting time/distance/ID preferences,
parallel edges, shared-prefix ties, permanent-closure node revisits,
service-boundary cutoffs, repeated earliest cutoffs, already-entered edges,
unreachable-job continuation without service, same-node jobs, empty/disconnected
graphs, and a late-starting vehicle sorted before an early-starting vehicle.
The latter ensures cached closure state can move backward in simulated time
between vehicles. A coverage check ensures the generated corpus actually has
on-time, late, unreachable, moving, service, closure and rerouting examples.

A failure names its seed. Emit that original synthetic scenario from the same
checkout without depending on the engine:

```sh
node --input-type=module -e "import { generatedScenario } from './tests/helpers/routing-oracle.js'; console.log(JSON.stringify(generatedScenario(53), null, 2))" > oracle-53.json
node scripts/run-scenario.js oracle-53.json --json
```

The standalone output can be attached to a bug report with the exact revision,
Node version, failing test and expected/actual result. Do not replace the seed
with real delivery data. The seed suite is bounded exploration, not exhaustive
graph coverage or a minimized counterexample guarantee.

Decimal IEEE-754 boundary behavior remains a separate contract. This exact
reference does not copy production's tolerance formula or claim to verify it;
`tests/engine.test.js` retains the hand-calculated 0.1 + 0.7 / 0.8 closure case.
Large-graph budgets, native browser timing, browser imports and deployments also
remain separate checks. No engine, browser source, schema or public output
format is changed by this milestone.

## Recorded source check: October 28, 2026

On Linux with Node 24.22.1/npm 11.9.0, the 104 focused tests and full 845-test
core suite passed, plus 120 separately scoped optional schema/editor tests:
965 distinct tests in total. The 4,800 path assertions are included in those
counts. All 26 distribution payloads and their manifest remained byte-identical
to the preceding implementation and to a repeated build.

An independent, local, in-memory sensitivity experiment ran the complete
104-test suite against the unchanged engine and 12 deliberately altered copies.
The unchanged copy passed; every altered copy produced assertion failures with
all 104 tests completing (no timeout/process-error counted as a rejection):

- Prefer distance over time; discard secondary distance; reverse equal-cost ID preference
- Allow entry exactly at a closure; omit phase or destination from the route cache key
- Drop service time; assess the arrival deadline using service completion
- Stop after an unreachable job; charge service for an unreachable job
- Truncate the horizon; discard distance traveled before an unreachable outcome

The random seeds alone did **not** reject reversed ID preference. The explicit
parallel/shared-prefix fixtures did, which is why they remain required rather
than relying on a random-test count. This was a selected behavior-sensitivity
experiment, not an exhaustive mutation score or a proof of correctness. It made
no production-code changes and found no engine discrepancy in this corpus.
