# Roadmap

## Implemented: reproducible synthetic workbench

One shared network and demand set supports 2–6 named variants, independent permanent closures, real outcome cards, a selected-vehicle route overlay, shared replay time, bounded JSON and headless thresholds. Cancellation and stale-result guards preserve a coherent experiment.

The current app deliberately retains fixed job assignment, fixed order and assumed edge costs. See [verified behavior and gaps](VERIFICATION.md).

## Implemented: portable scenario authoring

Original [Draft-07 scenario and experiment schemas](JSON_SCHEMAS.md) provide scoped editor diagnostics, completion and explanatory hover. A separately locked optional checker covers structural acceptance, explicit runtime-only limits and actual JSON language-service behavior. The engine, import/export contract and dependency-free app startup are unchanged. Native editor/browser checks are separate from this automated evidence.

## Implemented: headless delivery-impact inspection

The [job-impact explainer](JOB_IMPACT.md) shows which jobs change status, arrival or service completion for a chosen variant, with an explicit transition matrix, null unreachable comparisons and bounded complete JSON. It exposes same-status arrival shifts hidden by aggregate lateness without inferring per-job paths or complete causal attribution. The browser inspector below reuses the same projection; native-browser and accessibility gates remain separate.

## Implemented in source: browser delivery-impact inspection

The [delivery inspector](BROWSER_IMPACT.md) reuses completed results and the shared job projection to compare the selected variant with its baseline. It exposes same-status arrival shifts, original-order 20-row pages, explicit missing timing comparisons, full/filtered counts and keyboard-safe invalidation. No simulation, model or acceptance policy changes. Source tests are separate from native-browser, assistive-technology, mobile and deployment gates, which remain pending for this inspector.

## Implemented: per-job regression gates

[Opt-in headless gates](JOB_GATES.md) reject newly late deliveries and excessive worst-case comparable arrival slip. They retain existing aggregate semantics and explicitly fail a requested timing gate when no comparable evidence exists. They do not change the model or browser app.

## Implemented: portable experiment reviews

[Review packets](REVIEW_PACKETS.md) consolidate the validated input, existing acceptance policy, all variant metrics and complete delivery outcomes into deterministic machine data plus a readable offline review. The headless path reuses one simulation. Browser source now exports the exact completed Worker results through the same projection and renderer, with explicit unverified build identity and no acceptance policy. The v11 hosted rollout and bounded desktop download checks passed; native import roundtrips, mobile, assistive technology and cross-browser checks remain separate gates.

## Implemented: searchable road editing

The [road picker](ROAD_PICKER.md) filters the native selector by road name, full endpoint ID or representative edge ID, with result counts and saved-schedule context. It preserves existing grouping, direction semantics and variant independence. The v9 demo has bounded desktop Chromium evidence. A run-lifecycle focus finding was corrected with regression tests and independent review, then deployed in v10. Native cancellation/completion retests and served-manifest parity passed; [public GitHub source mapping and exact-commit CI passed](VERIFICATION.md#v10-native-focus-checks-and-screenshot).

## Release-readiness gates

1. Publish a truthful README, live demo link, actual screenshot and model assumptions.
2. Keep source, license notices, lockfile, fixtures and build manifest reproducible.
3. The [initial public source release passed both CI jobs](PUBLICATION.md). Keep checking the exact commit for every subsequent change.
4. Complete the outstanding browser file, mobile, reduced-motion and accessibility checks in an appropriate environment.
5. Check the final project/repository name and retain the responsible-disclosure instructions. Advertising a private reporting channel requires verifying it first; enabling one is optional, not a publication gate.

[Release checklist](RELEASE_CHECKLIST.md) tracks these gates. No feature expansion is required to fix a documentation or publication problem.

## Next useful contributions

- Complete native import roundtrips and cross-browser review checks; retain separate assistive-technology gaps
- Actual browser interruption/import/export coverage
- Paused-render and large-fixture profiling, with repeatable measurements
- Additional independent routing oracles and cross-browser deterministic fixtures
- Synchronized side-by-side map panes and bounded multi-seed summaries, after a clear design review

Start with the [published contribution issues](https://github.com/Tabisharaza/detourlab/issues). [ISSUE_DRAFTS.md](ISSUE_DRAFTS.md) links the selected public scopes and retains other proposals with concrete acceptance boundaries. An open issue is not an assignment or delivery commitment.

## Later: separately licensed real-city packs

A bounded OSM importer and a small Riyadh pack are plausible extensions. They require source provenance, extraction date, ODbL handling, contributor attribution and suitable geometry. Keep the dataset license separate from MIT code. Do not bulk-download standard OSM map tiles or make the core demo depend on an API key.

## Optional optimization adapters

A solver adapter could explore capacities, reassignment or delivery time windows. The UI and reports must disclose the changed policy so its results are not mistaken for the current fixed-sequence model.

## Outside the current product

Live surveillance, private production fleet data, realistic congestion forecasts, autonomous operating decisions, account systems, billing and hidden telemetry. Growth and Trending placement are outcomes to observe, not product guarantees.
