# Browser review export: design and release boundary

## Need

The existing experiment export preserves the input but makes a reviewer rerun the CLI before seeing the results. The new source workbench keeps a complete completed experiment and its evidence together, without credentials, network requests or a second simulation.

The project remains a synthetic, fixed-sequence logistics laboratory. It is not a live city intelligence dashboard or a realistic traffic predictor.

## Design references, not copied implementation

- [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) makes scenes portable through sharing/export. DetourLab applies the general need for inspectable portable evidence to its own synthetic delivery experiments, rather than copying its globe, feeds or visual design.
- [kepler.gl save/export guidance](https://github.com/keplergl/kepler.gl/blob/master/docs/user-guides/k-save-and-export.md) distinguishes a visual view from its underlying data/configuration. DetourLab similarly provides a readable review and complete machine bundle.
- [SUMO TripInfo](https://eclipse.dev/sumo/docs/Simulation/Output/TripInfo.html) illustrates why individual outcomes and unfinished work matter. DetourLab retains every delivery outcome and explicitly marks unreachable work rather than treating reduced traveled distance as success.

These references inform product requirements only. No code or assets from these projects are included. Existing MIT code, synthetic examples and third-party notices retain their licenses.

## Evidence and lifecycle

`createBrowserReview(experiment, completedResults)` snapshots and validates the completed internal Worker ledgers before asynchronous Web Crypto hashing. A shared pure report projection, renderer and UTF-8 output budgets serve browser and CLI callers. Node hashing remains in the CLI wrapper; Node-only modules are not shipped to browsers.

The UI takes identity references to the current experiment and completed result set. Editing, loading another experiment, canceling or rerunning clears preparation. An older asynchronous completion or failure cannot replace a newer dialog. Closing/Escape invalidates preparation. Changing only selected variant or replay time does not change the all-variant evidence.

In source, when a delayed valid import invalidates results, a focused download moves to **Close** before it is disabled; a focused **Review results** trigger moves to **Run all variants**. Newer focus on another control or the dialog heading is preserved. A rejected import keeps the valid review and its focus intact. These lifecycle cases have DOM/Worker stand-in coverage, not native-browser or assistive-technology verification; the source fix is not a deployment claim.

Downloads are separate explicit clicks. The JSON contains complete per-job rows; the Markdown prioritizes at most 20 exceptions per variant and states omitted counts. Both carry content fingerprints, not signatures. Browser generator identity is explicitly unverified (`implementation: null`, `sourceRevision: null`) and acceptance is not evaluated because no policy was supplied. Use the CLI for source-identified reports and explicit thresholds.

## Release and remaining checks

The public v11 demo now serves the browser exporter. Actual desktop Chromium downloads were saved and verified against the source rerun; repeated export, tiny-example values, edited fresh data and modal keyboard behavior passed. See [the bounded deployment record](VERIFICATION.md#v11-browser-review-deployment-and-native-checks). Native import roundtrip, mobile, assistive technology and cross-browser checks remain open. No contribution issue is closed merely because the source exporter exists.

Hosted release and native checks are separate from source publication. Public GitHub publication and its exact-commit CI are recorded separately in VERIFICATION.md.
