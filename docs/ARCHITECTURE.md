# Architecture

DetourLab deliberately starts with the smallest inspectable runtime: browser ES modules, Canvas 2D, a module Worker, and Node 24. The application runtime has no npm dependencies or external services; optional schema-check tooling is isolated under `tools/`. A renderer upgrade should preserve the scenario/engine boundary.

## Data flow

1. `scenario.js` validates inputs and creates independent plain records.
2. `app.js` keeps the shared experiment and selected variant and posts the whole validated experiment to `simulation-worker.js`.
3. The worker validates again, computes the open-network baseline once, and computes each named variant from exactly the same demand.
4. Each result carries vehicle segment ledgers, job outcomes and summed metrics.
5. `map.js` interpolates those same segment timestamps. It does not invent trajectories.
6. The inspector shows final outcomes. The replay time controls vehicle position and active closure markers, not the headline final-run comparison.

The monotonically increasing UI request ID rejects stale worker messages. Every new run terminates the previous worker; Cancel also invalidates its request identity. Variant selection reuses matching completed results and preserves shared playback time. Editing clears prior metrics rather than displaying results from a different network. Worker runtime is capped at 30 seconds; core deterministic operation budgets apply in both browser and Node. Failed runs do not return partial success.

## Engine

The graph is directed. Reverse Dijkstra trees are cached per destination and closure state, minimizing assumed travel time, then distance. Lexically stable edge/node comparisons resolve equal alternatives. Closures create chronological permanent edge exclusions, with the earliest event winning for duplicate edge references.

Routing is reconsidered at each edge boundary. A newly closed edge cannot be entered at its cutoff, with a small numerical tolerance for floating-point summation. An edge entered earlier is completed. Jobs retain assigned vehicle and input order; service time affects later legs. Permanently unreachable jobs preserve traveled distance, record null arrival/completion, and leave the vehicle at the current node for the next job.

## Layout

- `src/experiment.js`: shared-data experiment schema, bounded variants and paired results
- `src/scenario.js`: bounded scenario schema, fixture generation and presets
- `src/engine.js`: shortest paths and deterministic simulation
- `src/engine.d.ts`: public API types
- `src/simulation-worker.js`: worker request/result protocol
- `src/app.js`: UI state, import/export and inspector
- `src/tutorial.js`: independently copied four-node lesson fixture, checked against the portable JSON example; small-unit presentation belongs to `app.js`
- `src/map.js`: original procedural district and ledger playback
- `scripts/run-experiment.js`: multi-variant fingerprints and threshold outcomes
- `scripts/run-scenario.js`: backward-compatible single-scenario paired-run thresholds
- `scripts/explain-experiment.js` and `scripts/job-impact.js`: bounded Node-only job outcome reports over the unchanged whole-experiment results
- `tests/`: engine, schema, CLI and integration tests
- `examples/`: portable, original JSON experiments

## Security boundaries

No import executes code or becomes HTML. Text is assigned with `textContent`. Schema identifiers have a restricted alphabet; prototype keys, inherited fields, accessors, unexpected fields and sparse arrays are rejected. JSON parsing is capped at 2 MiB. The renderer is not a security authority; correctness comes from validated engine inputs and its ledgers.

## Extension points

The optional tiny lesson keeps one validated experiment backup in browser memory, uses the same Worker protocol, and restores the prior workspace when the user returns. It adds no storage or alternate routing path. Reset during the lesson restores its reference fixture; ordinary edits invalidate reference instructions. Starting, resetting or returning supersedes pending imports and worker results. Reloading still clears unsaved work. Small-graph node labels are cached with scene geometry; the dense city renderer remains unchanged.

Add a pure routing policy only behind a stable engine interface and deterministic fixtures. Add real geometry as separately licensed city packs with recorded provenance. Add capacity/time-window optimization through an explicit solver adapter, not an unannounced change to the default model. Rendering, server storage and private integrations should remain optional.
