# Verification record

**Current public demo: v7**, deployed October 10, 2026 UTC from tested source `fb08b57`. [Jump to its source mapping and keyboard checks](#v7-modal-keyboard-deployment-and-desktop-checks). The earlier v4/v5/v6 records below are retained as historical evidence.

## Dynamic editor focus source milestone

This October 10, 2026 source update keeps surviving comparison cards, event inputs/Remove controls, presets and reopen chips in place during updates. Focus moves only when its control is removed or a focused Duplicate/Remove action becomes disabled at a variant limit. Closure callbacks read the current variant/event state, including repeated edits. The engine, schemas, file decoding and rendering model are unchanged.

The original source removed focused controls during card selection, event editing/deletion and worker-driven updates. The improved Node harness drops focus to body when a focused descendant is removed. Against the previous `4ea8387` application, **12 of the 16 new regression tests fail** and four existing-behavior controls pass; all 16 pass with the candidate. These are source-handler assertions, not browser timings or native keyboard tests.

Local verification used **Node 24.19.0 / npm 11.9.0 / Linux**: **39 JavaScript syntax checks, 357 tests with zero failures/skips, 20 separately repeated CLI gates, and 20 distribution payloads plus manifest**, with a byte-identical second build. The 16 new tests are included in the 357, and the repeated CLI tests are not additional unique tests. They cover retained node identity, blur-time body/new-target behavior, first/middle/last/only-event removal, same-action fallback, variant-scoped handlers, presets/chips, unavailable targets, worker terminal/stale updates, newer modal focus and variant-count boundaries.

[Runtime source `0559eecbf8f4c50a01d4fc608abd2228adbd2f6b`](https://github.com/Tabisharaza/detourlab/commit/0559eecbf8f4c50a01d4fc608abd2228adbd2f6b) passed [hosted run 38069928417](https://github.com/Tabisharaza/detourlab/actions/runs/38069928417). Both Node 24.19.0/npm 11.17.0 and Node 24.21.0/npm 11.19.0 jobs completed every step successfully, passing 357 tests, separately repeating 20 CLI gates and verifying byte-identical 20-payload builds plus manifest. The exact 82-file remote tree is `71fc63a1609b13ba67d77b65ea5ae898499d96a2`. **No browser or Sites deployment was performed in this pass.** The public demo remains v7; native Tab/blur ordering, scrolling/focus visibility and assistive-technology checks remain unverified for this new change. The [keyboard guide](KEYBOARD.md) provides the separate browser checklist. The existing stylesheet hides the reopen-chip list; its source-handler tests do not establish ordinary keyboard reachability. Existing native import/download and browser performance gaps remain open.

The clean runtime-source archive `detourlab-public-source-0559eec.zip` contains exactly 82 remote-matched files and passes ZIP integrity checks. It excludes Git/provider metadata and generated output. Size: 698,472 bytes; SHA-256: `063f06fdf1b2c8d04585e7d53ebc16fe165a5e9e2fc3bacaf438b3a6eba14921`. A later documentation-only commit records these outcomes without changing the runtime.

## File-input source milestone

The October 10, 2026 source update aligns browser/CLI file decoding and adds bounded reads to the legacy runner. It has **not been deployed to the public demo**. The current v7 mapping and browser observations below remain the last live verification.

Local checks used **Node 24.19.0 / npm 11.9.0 / Linux**:

- Lockfile check, syntax checks for **38 JavaScript files**, and **341 tests** passed with zero failures/skips.
- **110 new tests** include 34 byte-input/handler/CLI regressions and 76 seeded roundtrip/schema tests. The fixed corpus contains 48 experiments and 189 variants, six with empty work, plus 25 malformed mutations.
- All **20 existing CLI gates** passed in a separate repeated run; they are already part of the full suite, not additional unique tests.
- **20 distribution payloads plus the manifest** passed exact allowlist, source-byte, license and SHA-256 verification. A second build matched every byte.
- Nine default/bundled CLI invocations had identical exit codes, stdout bytes and stderr bytes before and after the change. Valid fixture metrics and fingerprints did not change.

Original repros established silent malformed-UTF-8 replacement in the app/legacy CLI, an unwritten FIFO hanging the legacy CLI, and an oversized unknown key producing a multi-megabyte error. The new tests cover strict rejection, valid U+FFFD/BOM handling, exactly 2 MiB versus one byte over, partial/growing-file reads, regular-file enforcement, escaped/bounded diagnostics, and obsolete import results. Node Blob/File and checked-in handler stand-ins are used; no native browser file picker, browser profiling, screen-reader behavior or deployment was tested in this pass.

See [FILE_INPUT.md](FILE_INPUT.md) for the contract and reproduction commands. [Runtime commit `e9285ee6d8e47a753ffb6dccc580df9c8488cfd5`](https://github.com/Tabisharaza/detourlab/commit/e9285ee6d8e47a753ffb6dccc580df9c8488cfd5) passed [run 38055582446](https://github.com/Tabisharaza/detourlab/actions/runs/38055582446): both Node 24.19.0/npm 11.17.0 and Node 24.21.0/npm 11.19.0 jobs passed all 341 tests, repeated 20 CLI gates and byte-reproduced the 20 payloads plus manifest. All steps succeeded. The exact 81-file remote tree is `ed114b1e0c3933383776dd630fff6bdd6bdfc668`. Browser QA [issue #2](https://github.com/Tabisharaza/detourlab/issues/2) stays open.

The clean source archive `detourlab-public-source-e9285ee.zip` contains exactly those 81 remote-matched source files, excludes Git/provider metadata and generated output, and passes ZIP integrity checks. Size: 690,525 bytes; SHA-256: `9ff54a8f60a8e4a8a61f1d5379cee59903cf9d951e85b5e9b1462973393f3db2`. A later documentation-only commit records these outcomes without changing that runtime.

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

`docs/images/workbench-v5-desktop.jpg` is the city-view README image: an unaltered, actual full-page capture of the public v5 workbench on October 10, 2026 UTC at approximately 06:28. It is 1165×1586 pixels and shows three locally configured variants, a 600-second cutoff, selected VAN-02, comparison view and a paused 04:00 replay. Late counts are 118, 0 and 106 for the five-minute closure, clear-road control and ten-minute closure. SHA-256: `83b2b2ee97aad183211250545f520560713d6cefd53eec801d853fce65ea9017`.

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

## V6 tiny lesson deployment and desktop checks

On **October 10, 2026 at 09:00:21 UTC**, the existing public URL was updated to **v6**. The preceding v5 and older saved versions remain available for rollback.

- Runtime/source milestone: [`359570c81260b17778e3e8291128e2191ff149d2`](https://github.com/Tabisharaza/detourlab/commit/359570c81260b17778e3e8291128e2191ff149d2)
- Public source tree: `95b42608ee6b58bf53163d111c64804fa8363af4`; all **72 files**, modes, sizes and Git blob hashes were checked against the local source archive
- Hosting source revision: `2640a7147534192eae18d84628015931f407eda9`; its 72 public files matched the tested GitHub tree, with hosting configuration separate
- [CI run 38039735868](https://github.com/Tabisharaza/detourlab/actions/runs/38039735868): success on Node 24.19.0/npm 11.17.0 and Node 24.21.0/npm 11.19.0, with **220 tests per job**, **20 CLI gates separately repeated**, and byte-identical rebuilds
- Distribution: **19 payload files plus `manifest.json`**, all byte-matched to the checked source and packaged deployment. Manifest SHA-256: `9b3c98089ce2bc9b5ddf23249b5a234f2807ee5bb198910ff2e740dbb432417f`
- Portable tiny experiment fingerprint: `7a757f1b53531826e98f44a706d3c6d235986682e6517c3c542f116fa8bf7395`, with complete route/arrival/service ledgers independently checked

The milestone adds 26 tests over the prior 194: three fixture/documented-CLI assertions, two small-node label checks and 21 lesson tests. Independent review repeated the aggregate checks and exercised additional interruption/restoration cases. The routing engine, scenario and experiment validators, Worker protocol and public type files are byte-unchanged.

Actual cloud Chrome checks used a **1165×757 CSS-pixel desktop viewport**:

- Enter opens the optional native dialog with Cancel focused. Cancel and Escape dismiss it, restore the visible entry focus and retain city results. The guide's lesson entry also dismisses safely.
- Confirm starts the four-node lesson at 0 s, Compare view and 1×. The real range control reports value **10** with step **1**; import is visibly disabled with an explanation.
- Keyboard activation of the 10 s plan shows **260 m**, **1 late / 1 job**, **0 unreachable**, **A → B → D → C**, arrival **00:26** against due **00:22**, **+4 s**, and **00:29 elapsed** including service.
- The 11 s plan shows **200 m**, **0 late**, **A → B → C**, arrival **00:20**, and **00:23 elapsed**. The clear-road plan gives the same final outcomes.
- Renaming the lesson invalidates its reference story and disables the three reference step buttons. Reset lesson restores the canonical input and step controls without losing the prior-work backup.
- Play/pause and keyboard timeline controls respond. Returning restores the previous variant, VAN-02 selection, **240 s** replay, **120×** speed, baseline view, **300 s** new-closure setting and an unfinished variant-name draft exactly; playback stays paused and results recompute.
- A second entry, Cancel, second confirmed lesson and return work; ordinary Reset afterward restores the original city and 118-late bridge result.
- The actual map visibly contains A/B/C/D labels, the closed edge and detour. Textual path and outcome controls are also present outside Canvas.

A Tab press moved from Cancel to Start; a subsequent native Tab yielded no focused page-element ID before Escape. This is recorded without claiming a complete focus-trap or keyboard accessibility audit. One cleanup wait for the restored city result timed out; a fresh page inspection then showed the correct completed result. No application defect or timing guarantee is inferred from that automation timeout.

The actual screenshot `docs/images/tiny-lesson-desktop.jpg` was captured at approximately **09:03 UTC**, unaltered, at **1165×1604 pixels**. It shows the selected 10-second plan, paused 00:10 replay, three result cards and the computed detour. SHA-256: `a55adb6f2c076507295e28cf3add7901ff756b4890f2e564fe366837aa4e6608`.

The native deployment receipt, source/package comparisons and browser interactions are separate evidence. No independent CDN-served byte comparison was performed for v6; the earlier v5 manifest-request restriction was not retried or bypassed. No file chooser, browser import/export roundtrip, DevTools, console audit, mobile emulation, screen reader, cross-browser matrix or browser performance profiling was exercised in this pass. The in-app built-in example does not close the native file-import gap.

## V7 modal keyboard deployment and desktop checks

On **October 10, 2026 at 09:44:29 UTC**, the existing public URL was updated to **v7**. Saved v6, v5 and v4 versions remain available for rollback.

- Tested public source: [`fb08b57457eb70abe107eca0cab41f6f3d30261f`](https://github.com/Tabisharaza/detourlab/commit/fb08b57457eb70abe107eca0cab41f6f3d30261f)
- Public source tree: `6f304bd496fe40b40893b74d8ae735e6ce40cd2b`; all **75 files**, regular-file modes, sizes and Git blob hashes matched the checked source archive
- Hosting source revision: `9c49632005e1089f69e211ee0af1ed9a9ddc1e84`; all 75 public files matched, with hosting configuration kept separate
- [CI run 38042346894](https://github.com/Tabisharaza/detourlab/actions/runs/38042346894): success on Node 24.19.0/npm 11.17.0 and Node 24.21.0/npm 11.19.0, with **231 tests per job**, **33 JavaScript syntax checks**, **20 CLI gates separately repeated**, and byte-identical rebuilds
- Distribution: **19 payload files plus `manifest.json`**, all matched byte-for-byte between the checked build and packaged deployment. Manifest SHA-256: `b82e73a1994004bbe40b210fa4d4dba329d9f1d6ac0ae4d5c27b578b86811b4f`

Eleven focused tests were added to the prior 220. Independent review repeated the aggregate checks and passed 15 further adversarial focus scenarios. It found a stale native-Escape close notification that could steal focus from a newer page control; that finding was fixed and regression-tested before publication. The routing engine, renderer, validators, Worker, tutorial data, dependencies and CI configuration are byte-unchanged. The shared UI harness now models actual element ancestry and queued close notifications; it remains a stand-in, not a browser DOM implementation.

The starting v6 behavior was checked in real cloud Chrome around **09:30 UTC**: lesson Tab moved Cancel → Start → BODY → Cancel, and Shift+Tab from Cancel also reached BODY. The guide had no accessible name and its forward sequence likewise reached BODY. Native Escape already worked and was preserved.

After v7 deployment, real cloud Chrome checks at approximately **09:44–09:47 UTC**, with a reported **1180×757 CSS-pixel viewport**, established:

- The guide has the accessible name **Rehearse the disruption.** Its heading receives initial focus at scroll position 0, with a visible 2 px lime outline. Space scrolls its content without starting the underlying simulation.
- From the heading, Tab reaches Close guide. Forward and reverse boundary navigation then stays between Close guide and Try a tiny example. Escape restores How it works.
- The lesson opens with Cancel focused. Forward and reverse boundary navigation stays between Cancel and Start. Escape restores Try a tiny example. No BODY focus stop appeared in the 11 ordinary Tab/Shift+Tab presses recorded across these two initial sequences.
- Opening the guide through Model assumptions and activating Close guide restores Model assumptions, keeping the unfinished variant name and the 118-late city result.
- Guide → lesson confirmation → Start keeps focus on Cancel, then Clear roads. The clear plan reports 200 m and zero late jobs; keyboard activation of the 10-second plan reports 260 m, one late job and A → B → D → C.
- During the lesson, the guide's example entry is disabled. Four recorded forward/reverse Tab presses from the heading and single available close button stay on Close guide; Escape still returns to the guide opener.
- Editing the lesson disables its reference controls; Reset lesson re-enables them and focuses Clear roads. Return restores the unfinished city name, focuses the original available entry and subsequently shows the original 118-late result. Immediate metric placeholders during recomputation were not counted as completed results.
- Three repeated keyboard cancellations retain the same city draft/results and restore the entry focus. Ordinary Reset restores the default variant name and retains focus on Reset experiment.

These are bounded desktop observations, not a complete accessibility audit. The synthetic queued-close races, hidden/disconnected openers and modified-shortcut cases were tested in the source harness, not forcibly injected into the live page. This pass did not use native file import/export, mobile emulation, a screen reader, another browser/platform, DevTools, console logs, performance profiling or an independent CDN asset download. Earlier access restrictions were not retried. See [keyboard behavior and design references](KEYBOARD.md).

## Known gaps

- Browser-native import/download roundtrip and file-picker cancellation
- Mobile viewport behavior and reduced-motion preference emulation
- Screen-reader review and a cross-browser/platform matrix
- Focus preservation across all dynamically rebuilt editor and result controls beyond these modal/lesson flows
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
