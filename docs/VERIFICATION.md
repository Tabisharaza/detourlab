# Verification record

**Current public demo: v5**, deployed October 10, 2026 UTC from tested source `74e0356`. [Jump to its source mapping and desktop checks](#v5-renderer-deployment-and-desktop-checks). The earlier v4 record below is retained as historical evidence.

## Historical v4 application review

- Application source: `cb554b15d4e8c44a589acce4d5462ebe4538ef7e`
- Public demo: https://detourlab-tabish.tabisharaza.chatgpt.site/
- Deployed application version: 4, verified October 9, 2026 UTC
- Runtime used for local checks: Node `v24.19.0`, Linux x64
- The release-readiness branch adds documentation, repository templates and CI checks while preserving this application's runtime source. Its package/lockfile declaration is narrowed to Node `>=24.2.0` to match the release verifier's documented API floor; that minimum version has not itself been tested.

The source commit was matched to the saved hosted version. Deployment reported success, and the public page was subsequently exercised in a real desktop browser.

## Public source release and hosted CI

The [public repository](https://github.com/Tabisharaza/detourlab) was published on October 9, 2026 UTC. Its initial full-source commit is `6410b0acdf4ea8ecd7f54f64c28d7c579d21b9da`, with all 58 archive members verified against the remote tree. [Hosted CI](https://github.com/Tabisharaza/detourlab/actions/runs/37995893928) passed 173 tests per job on Node 24.19.0 and 24.21.0, with 20 CLI tests separately repeated and byte-identical rebuilds. [PUBLICATION.md](PUBLICATION.md) records exact archive, tree and toolchain evidence. These source-publication and documentation steps did not redeploy the v4 application.

## Historical v4 automated application checks

The v4 application passed 156 checks with zero failures/skips:

- Directed shortest paths, deterministic tie-breaking and randomized oracle comparisons
- Cutoff boundaries, already-entered edges, unreachable continuation, arrival deadlines and ledger invariants
- Strict scenario and experiment schemas, hostile inputs, byte/collection/work limits and export roundtrips
- Single-scenario and multi-variant CLI metrics, hashes, threshold exits and invalid input handling
- Twenty UI-state tests using the actual checked-in event handlers with mocked DOM/Worker interfaces
- Real module-worker protocol results and failure responses under Node
- Static build, license retention, output hashes and repeatable manifests

The mocked UI tests include variant independence, direction/time edits, cached playback selection, stale imports/messages/errors, Cancel/rerun, Reset and worker failure recovery. They are not browser tests. Release-specific CI/distribution tests are described separately in [CI.md](CI.md).

## Historical v4 desktop-browser checks

The exercised page used an approximately 1180×757 desktop viewport. Observed flows:

- Public page loads, the procedural district renders and default metrics match Node
- Duplicate and rename a variant
- Edit its event from 300 to 600 seconds with native keyboard input, preserving the original schedule
- Observe 118 late arrivals at 300 seconds and 106 at 600, matching the bundled CLI comparison
- Select variants without changing the shared replay time
- Inspect the zero-delta clear-road control
- Close and reopen one directed edge
- Use baseline overlay, replay, play/pause and keyboard timeline controls
- Cancel a running calculation, preserve its inputs and rerun successfully
- Reset to the original two variants and retain the minimum-two removal guard
- Dismiss the guide with Escape

No application error was observed in those exercised flows. This is a bounded functional review, not exhaustive coverage.

## Screenshot

`docs/images/workbench-v5-desktop.jpg` is the current README image: an unaltered, actual full-page capture of the public v5 workbench on October 10, 2026 UTC at approximately 06:28. It is 1165×1586 pixels and shows three locally configured variants, a 600-second cutoff, selected VAN-02, comparison view and a paused 04:00 replay. Late counts are 118, 0 and 106 for the five-minute closure, clear-road control and ten-minute closure. SHA-256: `83b2b2ee97aad183211250545f520560713d6cefd53eec801d853fce65ea9017`.

The earlier image is retained for historical provenance:

`docs/images/workbench-desktop.jpg` is an unaltered, actual full-page JPEG capture of the deployed v4 workbench, taken October 9, 2026 UTC. It is 1165×1586 pixels. It shows three locally configured variants, including a ten-minute bridge closure, and the corresponding computed results. It is not a generated mockup.

Image SHA-256 is recorded in [release checklist](RELEASE_CHECKLIST.md). The image contains only the synthetic application scene and its controls.

## V5 renderer deployment and desktop checks

The paused-scene guard and its [operation-count record](RENDERING.md) followed the initial source release. On **October 10, 2026 at 06:24:11 UTC**, the existing public URL was updated to **v5**. The v4 saved version remains available for rollback.

- Tested public source: [`74e0356c1fe0d7cfac0c2520906496aaef7869c6`](https://github.com/Tabisharaza/detourlab/commit/74e0356c1fe0d7cfac0c2520906496aaef7869c6)
- Public source tree: `008a23df56b1c392ffd677ed462b4483cb90d5bb`
- Hosting source revision: `14f6a3a765ba3ae054301ede293f5443e40f42cf`; all 67 public source files matched the tested GitHub tree, with hosting configuration kept separate from the public repository
- [CI run 38030451835](https://github.com/Tabisharaza/detourlab/actions/runs/38030451835): success on Node 24.19.0/npm 11.17.0 and Node 24.21.0/npm 11.19.0; **194 tests per job**, including the 20 CLI gates repeated separately, 17 verified distribution payloads plus a manifest, and byte-identical rebuilds
- Packaged distribution: all 17 payload files and `manifest.json` matched the local source-verified build. Manifest SHA-256: `3f44b78040b945b085551bfaada919dc900e65d90ab9e8b29405dc927079ab0a`

The hosting deployment reported success. This maps the reviewed source to the saved deployment, but does **not** prove a CDN-served byte hash: a separate executor HTTP request for the public manifest returned 403 and was not retried through another transport. The ordinary public page loaded and was tested in cloud Chrome.

Observed v5 flows:

- Default baseline: 311.8 km, **0 late**, 0 unreachable; five-minute bridge variant: 377.1 km, **118 late**, 0 unreachable; all 192 jobs completed in each
- Duplicate and rename a variant, then native-keyboard edits through 601 to 600 seconds: **106 late** and 376.6 km; the five-minute plan stayed at 118 and the clear-road control at 0
- Select VAN-02 while paused; switch comparison, baseline and disruption views; zoom in and reset zoom
- Play, pause, rewind and keyboard-scrub the timeline; changing variants retained the shared time
- Close and reopen one listed-direction bridge edge in the control; reopening restored its clear-road results
- Cancel a calculation with inputs preserved, then rerun and restore all three result cards
- Reset to the two original variants; verify the minimum-two removal guard; open the guide and dismiss it with Escape

A programmatic field-fill attempt did not trigger a recomputation in this automation pass; a genuine changed-value native keyboard edit did. This is not a passing assertion for that automation method or a diagnosed application defect. No source change was made for it.

The checks establish these functional interactions and an actual rendered screenshot. They do not measure CPU time, FPS, rasterization, real context-loss recovery or native ResizeObserver delivery. Automated Canvas/app integration tests remain Node stand-ins. The browser version/device was not recorded for a performance baseline, and no console-log audit was performed. Issue #3 stays open for the remaining profiling and rendering evidence.

## Known gaps

- Browser-native import/download roundtrip and file-picker cancellation
- Mobile viewport behavior and reduced-motion preference emulation
- Screen-reader review and a cross-browser/platform matrix
- Exhaustive visual testing of large imported graphs
- Named-browser/device before-and-after rendering timings, native resize/context-loss recovery and a console-log audit
- Independent verification of the exact CDN-served asset bytes
- Pull-request/fork CI behavior and Windows/macOS coverage (the verified hosted run was an Ubuntu push run)
- Real-world/operational model validation and project-name clearance

Source tests cover many import and interruption semantics, but those gaps must not be described as passed browser checks. Run the relevant tests in a permitted environment before upgrading the corresponding claim.

## Reproduce the principal figures

`node scripts/run-experiment.js examples/meridian-experiment.json --json`

Canonical experiment SHA-256:

`debaaf4b86e70a869608051ee8aad856b7699e2d964c4f7455a523c242ae318c`

| Variant | Meters | Late | Unreachable | Completed |
| --- | ---: | ---: | ---: | ---: |
| Baseline / clear-road control | 311800 | 0 | 0 | 192 |
| market-05 | 377080 | 118 | 0 | 192 |
| market-10 | 376600 | 106 | 0 | 192 |
| all-bridges-05 | 145680 | 0 | 57 | 135 |

The reduced distance and zero late count in `all-bridges-05` coexist with 57 skipped jobs. They do not establish an equal-service improvement.
