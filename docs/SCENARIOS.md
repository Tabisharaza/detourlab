# Scenario format v1

[Versioned JSON Schemas and editor authoring](JSON_SCHEMAS.md) provide early structural feedback. Runtime validation remains authoritative; do not add `$schema` to input documents.

A scenario is a self-contained JSON object. All fields shown in the examples are required; unknown keys are rejected. See `examples/minimal-directed.json` for the smallest complete example and `src/engine.d.ts` for API types.

For a hand-checkable comparison of clear roads and closures one second apart, follow the [tiny experiment walkthrough](EXPERIMENTS.md#tiny-walkthrough-one-second-changes-the-route). It reuses this minimal scenario's graph, vehicle and job unchanged.

| Field | Meaning |
| --- | --- |
| `version` | Exactly `1` |
| `id`, `name`, `description` | Portable identity and display labels |
| `seed` | Unsigned 32-bit fixture seed; imported geometry is used as supplied |
| `nodes` | Unique `{id, x, y}` coordinates in arbitrary planar units |
| `edges` | Directed `{id, from, to, distanceM, travelTimeS, roadName}` records |
| `vehicles` | `{id, startNode, startTimeS}` |
| `jobs` | `{id, nodeId, vehicleId, dueTimeS, serviceTimeS}` in assigned sequence |
| `closures` | `{id, edgeIds, atS}` permanent closure events |
| `durationS` | Minimum playback horizon; work continues until finished |

## Semantics

- Time values use seconds after scenario start. The UI formats `minutes:seconds`, so `65:00` means 65 minutes, not a wall-clock hour.
- Distance uses meters; node-coordinate spacing does not determine distance or travel time.
- Each vehicle receives jobs in their relative order in the `jobs` array.
- A missing reverse edge means reverse traversal is impossible.
- Duplicate edge closures are allowed across events; the earliest cutoff wins.
- A closure at exactly an entry timestamp blocks the entry; a previously entered edge is completed.
- `dueTimeS` is an arrival deadline. An arrival exactly on the deadline is on time.
- `unreachable` jobs have `arrivalS: null` and `completedS: null`.
- Import preserves supplied geometry and demand; it does not regenerate them from the seed.
- The map editor honors the selected **both**, **forward** or **reverse** direction when toggling a clicked segment and preserves unrelated event schedules. A missing reverse edge is not created. The workbench slider sets the time for new events only; existing events are edited individually.

## Bounds

Maximum file size: 2 MiB UTF-8. Maximum 2,000 nodes, 8,000 directed edges, 100 vehicles, 2,000 jobs and 8,000 closure records. Each event has at most 8,000 edge references, subject to valid graph references and the overall byte limit. The schema also bounds identifier/text lengths, timestamps, coordinates and distances. Edge travel time must be at least 0.1 seconds and edge distance at least 0.01 meters. See [`src/scenario.js`](../src/scenario.js), including `LIMITS`, for all exact field constraints.

The [experiment format](EXPERIMENTS.md) adds an aggregate limit of 48,000 closure edge references across its variants. That separate bound does not apply to the standalone scenario validator.

Engine budgets: 20 million routing-edge visits, 4 million extracted-path visits and 250,000 emitted segments. These are deterministic fail-fast limits, not performance promises. The browser also terminates a worker calculation after 30 seconds.

## Reproduction

The current browser exports an [experiment](EXPERIMENTS.md), even when a legacy scenario was imported. Run that export with:

```sh
node scripts/run-experiment.js your-experiment.json --json
```

For an existing single-scenario file, the original runner remains available:

```sh
node scripts/run-scenario.js your-scenario.json --json
```

Each runner reports a SHA-256 of its canonicalized validated input. Object keys are sorted; array order remains significant. The experiment runner also accepts a legacy scenario, upgrading it to two variants and fingerprinting that experiment. These fingerprints detect input changes; they are not signatures of trusted authorship.

The original seed-42 metrics are protected by regression tests. Different seeds create different synthetic demand, never a claim about an actual city.

## File encoding

The app and all three CLI entry points accept UTF-8 JSON with an optional leading BOM, which counts toward the 2 MiB input bound. Malformed UTF-8 is rejected without substituting label characters. Exports have no BOM. [File input and reproducible roundtrips](FILE_INPUT.md) documents error handling, byte acquisition and the remaining native browser QA gap.
