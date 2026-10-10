# Verification record

## Application release under review

- Application source: `cb554b15d4e8c44a589acce4d5462ebe4538ef7e`
- Public demo: https://detourlab-tabish.tabisharaza.chatgpt.site/
- Deployed application version: 4, verified October 9, 2026 UTC
- Runtime used for local checks: Node `v24.19.0`, Linux x64
- The release-readiness branch adds documentation, repository templates and CI checks while preserving this application's runtime source. Its package/lockfile declaration is narrowed to Node `>=24.2.0` to match the release verifier's documented API floor; that minimum version has not itself been tested.

The source commit was matched to the saved hosted version. Deployment reported success, and the public page was subsequently exercised in a real desktop browser.

## Public source release and hosted CI

The [public repository](https://github.com/Tabisharaza/detourlab) was published on October 9, 2026 UTC. Its initial full-source commit is `6410b0acdf4ea8ecd7f54f64c28d7c579d21b9da`, with all 58 archive members verified against the remote tree. [Hosted CI](https://github.com/Tabisharaza/detourlab/actions/runs/37995893928) passed 173 tests per job on Node 24.19.0 and 24.21.0, with 20 CLI tests separately repeated and byte-identical rebuilds. [PUBLICATION.md](PUBLICATION.md) records exact archive, tree and toolchain evidence. These source-publication and documentation steps did not redeploy the v4 application.

## Automated application checks

The v4 application passed 156 checks with zero failures/skips:

- Directed shortest paths, deterministic tie-breaking and randomized oracle comparisons
- Cutoff boundaries, already-entered edges, unreachable continuation, arrival deadlines and ledger invariants
- Strict scenario and experiment schemas, hostile inputs, byte/collection/work limits and export roundtrips
- Single-scenario and multi-variant CLI metrics, hashes, threshold exits and invalid input handling
- Twenty UI-state tests using the actual checked-in event handlers with mocked DOM/Worker interfaces
- Real module-worker protocol results and failure responses under Node
- Static build, license retention, output hashes and repeatable manifests

The mocked UI tests include variant independence, direction/time edits, cached playback selection, stale imports/messages/errors, Cancel/rerun, Reset and worker failure recovery. They are not browser tests. Release-specific CI/distribution tests are described separately in [CI.md](CI.md).

## Actual desktop-browser checks

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

`docs/images/workbench-desktop.jpg` is an unaltered, actual full-page JPEG capture of the deployed v4 workbench, taken October 9, 2026 UTC. It is 1165×1586 pixels. It shows three locally configured variants, including a ten-minute bridge closure, and the corresponding computed results. It is not a generated mockup.

Image SHA-256 is recorded in [release checklist](RELEASE_CHECKLIST.md). The image contains only the synthetic application scene and its controls.

## Later source-only rendering change

The paused-scene guard and its [operation-count record](RENDERING.md) were added after the initial source release. Their automated Canvas/app integration tests are Node stand-ins. They have not been deployed to the v4 demo or visually checked in a real browser, and do not extend the desktop-browser coverage above.

## Known gaps

- Browser-native import/download roundtrip and file-picker cancellation
- Mobile viewport behavior and reduced-motion preference emulation
- Screen-reader review and a cross-browser/platform matrix
- Exhaustive visual testing of large imported graphs
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
