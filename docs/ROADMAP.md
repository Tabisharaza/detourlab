# Roadmap

## Implemented: reproducible synthetic workbench

One shared network and demand set supports 2–6 named variants, independent permanent closures, real outcome cards, a selected-vehicle route overlay, shared replay time, bounded JSON and headless thresholds. Cancellation and stale-result guards preserve a coherent experiment.

The current app deliberately retains fixed job assignment, fixed order and assumed edge costs. See [verified behavior and gaps](VERIFICATION.md).

## Implemented: portable scenario authoring

Original [Draft-07 scenario and experiment schemas](JSON_SCHEMAS.md) provide scoped editor diagnostics, completion and explanatory hover. A separately locked optional checker covers structural acceptance, explicit runtime-only limits and actual JSON language-service behavior. The engine, import/export contract and dependency-free app startup are unchanged. Native editor/browser checks are separate from this automated evidence.

## Implemented: headless delivery-impact inspection

The [job-impact explainer](JOB_IMPACT.md) shows which jobs change status, arrival or service completion for a chosen variant, with an explicit transition matrix, null unreachable comparisons and bounded complete JSON. It exposes same-status arrival shifts hidden by aggregate lateness without inferring per-job paths or complete causal attribution. Browser inspection and accessibility gates remain separate.

## Implemented: per-job regression gates

[Opt-in headless gates](JOB_GATES.md) reject newly late deliveries and excessive worst-case comparable arrival slip. They retain existing aggregate semantics and explicitly fail a requested timing gate when no comparable evidence exists. They do not change the model or browser app.

## Release-readiness gates

1. Publish a truthful README, live demo link, actual screenshot and model assumptions.
2. Keep source, license notices, lockfile, fixtures and build manifest reproducible.
3. The [initial public source release passed both CI jobs](PUBLICATION.md). Keep checking the exact commit for every subsequent change.
4. Complete the outstanding browser file, mobile, reduced-motion and accessibility checks in an appropriate environment.
5. Check the final project/repository name and retain the responsible-disclosure instructions. Advertising a private reporting channel requires verifying it first; enabling one is optional, not a publication gate.

[Release checklist](RELEASE_CHECKLIST.md) tracks these gates. No feature expansion is required to fix a documentation or publication problem.

## Next useful contributions

- Searchable, keyboard-friendly road selection and stronger non-map explanations
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
