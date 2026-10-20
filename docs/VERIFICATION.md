# Verification record

**Current public demo: v10**, deployed October 19, 2026 UTC. [The v9 record](#v9-road-picker-deployment-and-bounded-desktop-checks) describes bounded desktop Chromium checks and the run-lifecycle focus finding. [The corrected v10 deployment](#v10-run-lifecycle-focus-deployment) is recorded separately. Native cancellation/completion retests and served-manifest parity passed; The [published source `addd5f6`](https://github.com/Tabisharaza/detourlab/commit/addd5f62bba1225c23b779c8c9ab684db2be1326) and [CI run 39227618544](https://github.com/Tabisharaza/detourlab/actions/runs/39227618544) are verified; both pinned Node jobs passed. Earlier version records remain historical evidence.

## Browser review source milestone

On **October 20, 2026 UTC**, the source workbench gained an all-variant review export using the exact completed Worker result. The browser and CLI share a pure report projection, renderer and output budgets. Browser packets explicitly have no acceptance policy and no verified implementation fingerprint. See [design and release boundary](BROWSER_REVIEWS.md) and [usage](REVIEW_PACKETS.md#download-from-the-browser-workbench).

Local checks on **Node 24.19.0 / npm 11.9.0 / Linux** passed **628 core tests + 120 optional authoring tests = 748 distinct tests**, **67 core JavaScript syntax checks**, and **113 repeated CLI tests** (already included in the core count). Twelve new UI handler tests cover exact result reuse, separate downloads, edit/import/run invalidation, old completion/rejection ordering, Escape/focus/Tab containment, failure/timeout and the modal Space shortcut. Fifteen browser-report tests exercise real demo/Meridian/tiny/floating fixtures, strict copied ledgers, complete data, byte/hash parity and budgets. Independent code review found a global Space shortcut reaching background playback from the modal title; the guard and regression test now prevent it.

Eighteen old/new report comparisons (three fixtures × three policy cases × two generator identities) preserved complete CLI bundle and review bytes. The checked-in tiny review was regenerated because the implementation fingerprint now includes the extracted shared modules. Engine behavior, schemas, model assumptions and the dependency-free lockfile remain unchanged. The release allowlist explicitly includes the five new browser modules. All **25 distribution payloads plus manifest** match a second build byte-for-byte, with source hashes and license notices verified.

**The public demo remains v10.** This source work does not claim native browser download/save/reopen, import roundtrip, mobile, screen-reader or hosted rollout checks. DOM/Worker stand-ins are not those checks. Exact-commit GitHub publication and CI must be verified separately; no contribution issue is closed by this milestone alone.

## Headless job-impact milestone

Local checks on **October 15, 2026**, using **Node 24.19.0 / npm 11.9.0 / Linux**, passed **432 core tests**, **120 optional authoring tests**, **48 core JavaScript syntax checks** and the optional tool’s two syntax checks. The 48 new tests comprise 20 report tests and 28 actual CLI subprocess tests. CI now separately repeats the new CLI cases alongside the existing gates: **57 repeated tests**, not additional unique tests.

The command exposes job status and timing differences hidden by aggregate counts. In the reference Meridian comparison, 125 arrivals change while 118 jobs become late. Null unreachable comparisons, engine deadline tolerance, original job order and the whole-experiment budgets remain explicit. The output-size guard is tested at an injected smaller bound; a full 2000-job valid input is also checked under the real 4 MiB output limit. See [the report contract and exact examples](JOB_IMPACT.md).

Ten existing runner invocations retain byte-identical stdout/stderr and exit codes. Both builds, all 20 payloads and the manifest match the retained v8 distribution byte-for-byte. No browser module, input schema, root dependency, Node/action pin, workflow permission or Site deployment changes. Independent review passed the new and full core suites; native browser and terminal-emulator coverage remain separate. [Job-impact source `1277646`](https://github.com/Tabisharaza/detourlab/commit/12776464cee43e077a4ab5b83546d882adc9e03b) passed [hosted run 38692255287](https://github.com/Tabisharaza/detourlab/actions/runs/38692255287) on October 15, 2026 UTC. Both jobs completed every step successfully: Node 24.19.0/npm 11.17.0 (job 116280637764) and Node 24.21.0/npm 11.19.0 (job 116280638007). Each passed 432 core and 120 optional tests with zero failures/skips, repeated 57 CLI gates, checked 48 core and two optional JavaScript files, and reproduced every byte of the 20 payloads plus manifest. All 101 source files matched remote tree `402690bf224d8dd53662ac92d3eb6f7c2768f3fd`. This evidence names that exact source commit; later documentation changes require their own CI check.

## Portable scenario authoring milestone

The October 14, 2026 source adds original Draft-07 scenario/experiment schemas, scoped local editor associations and a separately locked optional verification tool. It changes no runtime modules, fixtures, root dependencies, input/export format or engine metrics. The [authoring guide](JSON_SCHEMAS.md) explains early diagnostics and the definitive CLI path.

Local Node **24.19.0 / npm 11.9.0 / Linux** checks passed **384 core tests**, **44 core syntax checks**, and **120 additional optional tests** (86 schema/runtime-boundary tests plus 34 JSON language-service tests). The tool also syntax-checks its two `.mjs` files. The existing 29 CLI gates were repeated separately; they are already part of the core suite. Core checks also passed without the optional package's dependencies installed.

The corpus checks all five fixtures, required/unknown fields, numeric/list/identifier/string bounds, empty base closures, offline reference loading, scoped file associations, diagnostics, completion and contextual hover. Schema-pass/runtime-reject cases intentionally preserve the boundary for foreign keys, duplicate record IDs, aggregate/byte budgets and Unicode code-point versus UTF-16-unit length. Language-service testing exposed generic hover descriptions for arrival deadlines and cutoffs; contextual schema annotations now pass those checks. No native editor-window, terminal, browser or assistive-technology coverage is claimed.

All 20 browser distribution payloads and the manifest remain byte-identical to the retained v8 package and to a second build. No Site deployment was needed for this authoring-only change. The live demo remains v8, and its native browser QA gaps remain open. The optional packages are not shipped in the distribution; [their notices](../tools/schema-check/THIRD_PARTY_NOTICES.md) are separate from application attribution. [Authoring source `69ebb18`](https://github.com/Tabisharaza/detourlab/commit/69ebb18c906f49be648f3c20e06f9641ee6bd8b1) passed [hosted run 38526280719](https://github.com/Tabisharaza/detourlab/actions/runs/38526280719) on October 14, 2026 UTC. Both jobs completed every step successfully: Node 24.19.0/npm 11.17.0 (job 115727271160) and Node 24.21.0/npm 11.19.0 (job 115727271424). Each passed 384 core tests, 120 optional authoring tests and 29 repeated CLI gates, with 44 core syntax checks, two optional syntax checks and byte-identical 20-payload builds plus manifest. All 96 source files matched remote tree `bc0bc5b003c633213737af93001ce9c683c97b11`. This record verifies that exact authoring-source commit; later documentation changes need their own CI check.

## CLI human-label presentation milestone

The October 13, 2026 CLI-only correction makes control characters visible when formatting scenario, experiment and variant names in human reports. Schema-valid CR/newline/tab, C1 and bidi characters previously appeared verbatim and could distort report lines. The formatter escapes its documented controls as lowercase `\uXXXX` and doubles literal backslashes. It does not truncate valid names after escape expansion. This is captured-output evidence, not a terminal-emulator test, command-execution claim or comprehensive Unicode-spoofing defense.

Local checks on Node **24.19.0 / npm 11.9.0 / Linux** passed **384 tests** and **44 syntax checks**, including 18 new formatter/subprocess tests. All 85 selected formatter control code points and all 56 schema-accepted members are exercised. Nine of the 13 new subprocess tests fail on the previous reporters; four preserve existing behavior. Forty-two pre/post comparisons (26 ordinary commands and 16 crafted JSON commands) retained their exact exit codes, stdout and stderr bytes. The existing 29 CLI argument/threshold gates were also repeated separately.

JSON bytes, decoded values, canonical hashes, schemas and engine metrics remain unchanged. JSON is still machine-readable data, not terminal-sanitized text; downstream display consumers need their own presentation rules. All 20 browser payloads plus manifest remain byte-identical to the retained v8 package and a second build. No Site deployment or browser verification is part of this change. See [FILE_INPUT.md](FILE_INPUT.md#human-cli-label-display) for reproduction commands and boundaries.

[Source `211fcfd`](https://github.com/Tabisharaza/detourlab/commit/211fcfdbb4dc1fc448faf0bfefd3072f8af8cf67) passed [hosted run 38361085167](https://github.com/Tabisharaza/detourlab/actions/runs/38361085167) on October 13, 2026 UTC. Both jobs completed every step successfully: Node 24.19.0/npm 11.17.0 (job 115175182591) and Node 24.21.0/npm 11.19.0 (job 115175182370). Each passed 384 tests, repeated 29 CLI gates, syntax-checked 44 JavaScript files, and reproduced every byte of the 20 payloads plus manifest. This record is tied to that CLI source commit, not later documentation changes or browser behavior.

All 87 source files were verified against remote tree `66874fa8b11bb63449fd28fd9d555ff3d802fd41`. The documentation follow-up records this verified result without changing CLI or browser behavior.

## CLI argument-contract source milestone

On October 13, 2026, the two headless runners were moved to a shared argument parser after reproducing three legacy-runner problems: duplicate thresholds silently used the last value, inherited names such as `constructor` could produce a bogus threshold and run the default demo, and flag order changed JSON/violation ordering. Both runners now reject duplicate thresholds, recognize only their own option keys, and report thresholds in a fixed metric order. Input schemas, simulation results, canonical input hashes and ordinary output schemas are unchanged. See [the CLI contract and reproduction](EXPERIMENTS.md#headless-runner).

Local checks on Node **24.19.0 / npm 11.9.0 / Linux** passed **366 tests**, **41 syntax checks** and **29 separately repeated CLI tests**. All nine new actual-process tests pass; four fail on the preceding `b2f9997` source and five preserve existing behavior. Eight ordinary success/threshold-failure runner invocations retained their exact exit status, stdout and stderr bytes. All 20 browser distribution payloads plus manifest match the retained v8 package, and a second build matched every byte.

This is CLI-only work. The live demo remains v8, and the native file-picker/download, keyboard and rendering-profile checks remain open. No browser, deployment, new dependency, schema relaxation or engine change is included. [CLI source `84d93be`](https://github.com/Tabisharaza/detourlab/commit/84d93bec1a1323301f0ae8c7fc6b443bf42f65f6) subsequently passed [hosted run 38359389637](https://github.com/Tabisharaza/detourlab/actions/runs/38359389637): both Node 24.19.0/npm 11.17.0 and Node 24.21.0/npm 11.19.0 jobs completed every step successfully with the same 366-test, 29-CLI, 41-syntax and reproducible-build counts. All 84 source files matched remote tree `0ea20603f8b3a4c519ff3398762306eeb63412fb`. The source ZIP for that commit has SHA-256 `7e36016888c42e9b6fa1140fa455fd5617f33fecd6a1aec587cff32d028b6d0e` and contains only those 84 files (704,263 bytes); Git/provider configuration and generated output are excluded. This later documentation update records the result without changing the CLI or browser application.

## Dynamic editor focus source milestone

This October 10, 2026 source update keeps surviving comparison cards, event inputs/Remove controls, presets and reopen chips in place during updates. Focus moves only when its control is removed or a focused Duplicate/Remove action becomes disabled at a variant limit. Closure callbacks read the current variant/event state, including repeated edits. The engine, schemas, file decoding and rendering model are unchanged.

The original source removed focused controls during card selection, event editing/deletion and worker-driven updates. The improved Node harness drops focus to body when a focused descendant is removed. Against the previous `4ea8387` application, **12 of the 16 new regression tests fail** and four existing-behavior controls pass; all 16 pass with the candidate. These are source-handler assertions, not browser timings or native keyboard tests.

Local verification used **Node 24.19.0 / npm 11.9.0 / Linux**: **39 JavaScript syntax checks, 357 tests with zero failures/skips, 20 separately repeated CLI gates, and 20 distribution payloads plus manifest**, with a byte-identical second build. The 16 new tests are included in the 357, and the repeated CLI tests are not additional unique tests. They cover retained node identity, blur-time body/new-target behavior, first/middle/last/only-event removal, same-action fallback, variant-scoped handlers, presets/chips, unavailable targets, worker terminal/stale updates, newer modal focus and variant-count boundaries.

[Runtime source `0559eecbf8f4c50a01d4fc608abd2228adbd2f6b`](https://github.com/Tabisharaza/detourlab/commit/0559eecbf8f4c50a01d4fc608abd2228adbd2f6b) passed [hosted run 38069928417](https://github.com/Tabisharaza/detourlab/actions/runs/38069928417). Both Node 24.19.0/npm 11.17.0 and Node 24.21.0/npm 11.19.0 jobs completed every step successfully, passing 357 tests, separately repeating 20 CLI gates and verifying byte-identical 20-payload builds plus manifest. The exact 82-file remote tree is `71fc63a1609b13ba67d77b65ea5ae898499d96a2`. **No browser or Sites deployment was performed in that source-review pass.** The demo was then v7; v8 later deployed the tested source as recorded below. Native Tab/blur ordering, scrolling/focus visibility and assistive-technology checks remain unverified for this new change. The [keyboard guide](KEYBOARD.md) provides the separate browser checklist. The existing stylesheet hides the reopen-chip list; its source-handler tests do not establish ordinary keyboard reachability. Existing native import/download and browser performance gaps remain open.

The clean runtime-source archive `detourlab-public-source-0559eec.zip` contains exactly 82 remote-matched files and passes ZIP integrity checks. It excludes Git/provider metadata and generated output. Size: 698,472 bytes; SHA-256: `063f06fdf1b2c8d04585e7d53ebc16fe165a5e9e2fc3bacaf438b3a6eba14921`. A later documentation-only commit records these outcomes without changing the runtime.

## File-input source milestone

The October 10, 2026 source update aligns browser/CLI file decoding and adds bounded reads to the legacy runner. It was not deployed during that source-review pass. The v8 deployment below later includes these fixes. The v7 observations remain the last native-browser verification, rather than a test of the newer file-entry code.

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

## v8 source-parity deployment

On **October 11, 2026 at 06:59:54 UTC**, Sites reported a successful public deployment at the unchanged URL:

https://detourlab-tabish.tabisharaza.chatgpt.site

### Source and package mapping

- Tested public GitHub source: [`ffe3d15fb06bcf45222ead0172f703dca90c6f3a`](https://github.com/Tabisharaza/detourlab/commit/ffe3d15fb06bcf45222ead0172f703dca90c6f3a), tree `9ea7814dd5eeb7c9244441cdf224a2d6285a687c`.
- [CI run 38070113506](https://github.com/Tabisharaza/detourlab/actions/runs/38070113506) passed all 357 tests on both pinned Node versions. The 82-file source archive was independently compared against every remote file path, Git blob hash, size and mode before deployment.
- Hosting source commit: `24038d94811998599edb79b62873d6b6ede5c3fc`. Every public source file is byte-identical to the tested GitHub source; the only additional tracked file is the existing hosting identity/configuration. Hosting history was not copied into GitHub.
- Saved version: **8**. Deployment: `appgdep_6acb33e3803c8191a948aade812b17f9`. Saved-version readback confirms the hosting commit; Site readback confirms the configured public audience and unchanged URL. Versions **4, 5, 6 and 7** remain available in the version history for rollback.
- Fresh local check on Node 24.19.0/npm 11.9.0: **39 JavaScript syntax checks, 357 tests, 20 separately repeated CLI tests, and 20 distribution payloads plus manifest**. All passed; the second build matched every byte.
- The submitted deployment archive contains those **21 built files plus hosting metadata**. Each built file was compared byte-for-byte with the verified distribution before saving. The distribution manifest SHA-256 is `6012caf851b7c9aed8b3ac1391fcbf57aac1136a982ebb1640e9277cdd9253f3`.

### What was not verified

No browser was used for this deployment. Native file-picker/download roundtrips, the newer dynamic keyboard controls, native Tab/blur ordering, scrolling focus visibility, assistive technology, reduced-motion emulation and browser performance remain separate gaps. Earlier screenshots describe their named historical versions; no new screenshot is presented as v8 evidence.

An unauthenticated HTTP request to the public root returned **403** from this checking environment. No alternate credentials, headers or asset retries were used. Downloading the saved deployment archive for independent post-save inspection was also unavailable. Therefore, this record establishes native deployment success, saved-version provenance and the submitted package's source-byte mapping; it does **not** establish a successful direct HTTP smoke test or CDN-served byte hashes. The saved archive's reported storage hash is not represented as the local gzip hash.

The next acceptance step is a permitted browser check of v8's main workflow and newly deployed import/keyboard fixes, retaining the synthetic-only QA checklist in [issue #2](https://github.com/Tabisharaza/detourlab/issues/2) and [KEYBOARD.md](KEYBOARD.md). The existing file-picker/DevTools restrictions were not retried or bypassed.

## Per-job acceptance-gate source milestone

Local checks on **October 16, 2026**, using **Node 24.19.0 / npm 11.9.0 / Linux**, passed **475 core tests** and **120 optional authoring tests**, with zero failures or skips. The **43 new tests** comprise 21 helper/contract cases and 22 actual CLI subprocess cases. CI separately repeats **79 CLI cases** already included in the core count. Syntax checks cover **51 core JavaScript files** and the optional tool's two files.

The [new opt-in gates](JOB_GATES.md) catch newly late deliveries and worst comparable arrival slip, including a documented fixture where net late counts conceal a different delivery becoming late. A requested timing gate fails closed when no comparable arrivals exist. Existing aggregate thresholds, input fingerprints and the job-impact report contract remain unchanged. Fourteen prior CLI invocations preserve byte-identical stdout/stderr and exit codes; 20 of the 22 new subprocess cases fail against the previous source, with two old-contract controls passing.

The repeated builds and all **20 browser payloads plus manifest** remain byte-identical to v8. Only headless scripts, tests, documentation and the existing CLI test step change. Node/action pins, workflow permissions, schemas, dependencies and licenses are unchanged. Independent review found no correctness blockers and separately confirmed 36 old-command compatibility cases. [Gate source `42f1551`](https://github.com/Tabisharaza/detourlab/commit/42f155150a79b6575ae6dabbb3e5bd3528a30feb) passed [hosted run 38864089074](https://github.com/Tabisharaza/detourlab/actions/runs/38864089074) on October 16, 2026 UTC. Both jobs completed every step successfully: Node 24.19.0/npm 11.17.0 (job 116852800616) and Node 24.21.0/npm 11.19.0 (job 116852800225). Each passed 475 core plus 120 optional tests (595 distinct), repeated 79 CLI cases, checked 51 core plus two optional syntax files, and reproduced all 20 payloads plus manifest. All 106 source files matched remote tree `f149d5d27d8c63bb1e830ee92d386f5e6efc7f65`. This evidence names that exact source commit; later documentation changes require their own CI check. Browser and terminal-emulator QA gaps remain separate.


## Portable experiment review-packet milestone

The [review-packet source `92a6cac`](https://github.com/Tabisharaza/detourlab/commit/92a6cacd138155569cd3913f8affa04077382b68) passed [hosted run 39086496176](https://github.com/Tabisharaza/detourlab/actions/runs/39086496176) on **October 18, 2026 UTC**. Both matrix jobs completed every step successfully: Node **24.19.0 / npm 11.17.0** (job **117554070842**) and Node **24.21.0 / npm 11.19.0** (job **117554070650**), on Ubuntu 24.04 image **20261012.334.1**.

Each job passed **563 core tests + 120 optional authoring tests = 683 distinct tests**, separately repeated **113 CLI tests** already included in the core count, checked **59 core JavaScript files** plus the optional tool's two files, and reproduced all **20 browser payloads plus manifest** byte-for-byte. Local checks on Node 24.19.0 / npm 11.9.0 / Linux passed the same counts. The **88 new source tests** comprise 25 report-model, 34 CLI/identity, 28 filesystem and one checked-in-example parity test. None failed or skipped.

The [packet workflow](REVIEW_PACKETS.md) consolidates the complete experiment, existing policy, every variant's metrics and delivery outcomes into bounded `bundle.json` and readable `REVIEW.md`. It performs one whole-experiment simulation. Distinct hashes cover canonical report data and exact readable-review bytes; generated reproduction checks the current implementation fingerprint and both artifacts. No supplied limits means not evaluated. A failed policy still produces the complete packet with exit 1.

Independent review passed **32 supplemental checks**, separately reran all **88 milestone tests**, and verified **23 prior CLI invocations** retained exact stdout/stderr/exit behavior. These overlapping checks are not added to the 683-test count. The review exercised fixture reconciliation, precision/nulls, generated shell reproduction and tamper rejection, actual concurrent CLI writers, existing/symlink destinations, real output-limit inputs and injected cleanup failures. It found no blocking runtime defects. The [checked-in tiny review](examples/tiny-review/REVIEW.md) and [machine bundle](examples/tiny-review/bundle.json) are regenerated byte-for-byte by a source test.

All **117 public source files** matched Git blob IDs, sizes and modes in tree `e6ac41111faabf87243169db733de400bbcd0559`. The browser payloads and manifest remain byte-identical to the v8 source/build; no Site deployment, UI, engine, input schema, dependency, license or workflow-permission change is part of this milestone. Existing screenshot and native-browser evidence retains its historical scope. Hard-link output publication is not atomic directory visibility or crash-durable storage; adversarial co-writer races, unusual filesystems, native Windows/macOS and browser behavior remain outside this verification. This record names the exact runtime source commit; a later documentation-only commit requires its own CI check.

## Road-picker and run-lifecycle focus milestone

The October 19, 2026 implementation is based on public source
[`25c7fb6`](https://github.com/Tabisharaza/detourlab/commit/25c7fb636c6151d5a9e1b7ddcd5cf8c7e8ab349d).
The [road picker](ROAD_PICKER.md) adds native-selector name/ID filtering, count
feedback and saved-schedule context without changing graph grouping, direction
semantics or the routing engine. The subsequent lifecycle correction hands
focus from a disappearing **Cancel run** button to **Run all variants** only
while Cancel still owns it; newer control/modal focus and stale-run guards are
preserved.

Local checks on **Node 24.19.0 / npm 11.9.0 / Linux** passed **601 core + 120
optional tests = 721 distinct tests**, with no failures or skips. The total
includes **29 road-picker regressions** and **nine lifecycle-focus regressions**.
**113 CLI tests** are repeated separately and are not additional distinct tests.
Syntax checks cover **60 core JavaScript files** and **two optional `.mjs`
files**. The corrected distribution passed manifest/source verification for
**20 static payloads plus manifest**; a second build matched every byte, including
the manifest. These checks name the corrected source, rather than relying on
the earlier 592-core-test candidate's build receipt.

Initial independent picker review passed **95 focused tests**, **11 supplemental
probes** and **72 baseline pair-toggle assertions**. It resolved retained options
after a zero-edge import and redundant unchanged live-count assignments. Final
lifecycle review passed **25 dynamic-focus tests** and **five terminal-path
probes**, with no findings. These overlapping checks are not added to 721.
The lifecycle tests cover cancellation/completion, returned errors, Worker
failure, timeout, construction failure, repeated runs, stale callbacks and newer
control/modal focus. They use source-handler DOM/Worker stand-ins, not a browser.

Runtime/test changes are confined to `src/app.js`, `index.html`, `src/style.css`,
`tests/road-picker.test.js` and `tests/dynamic-focus.test.js`. The engine, map,
formats/schemas, Worker, package metadata, lockfile, workflow, licenses and shared
harness retain the baseline bytes.
The corrected runtime is deployed in v10; native cancellation/completion retests
and served-manifest parity passed as recorded below. The [published source `addd5f6`](https://github.com/Tabisharaza/detourlab/commit/addd5f62bba1225c23b779c8c9ab684db2be1326) and [CI run 39227618544](https://github.com/Tabisharaza/detourlab/actions/runs/39227618544) are verified; both pinned Node jobs passed. The v9 observations below are intermediate
evidence, not verification of the corrected runtime. Historical v4–v8 results
retain their original dates, mappings and limits.

## v9 road-picker deployment and bounded desktop checks

On **October 19, 2026 at 08:22:07.554212 UTC**, Sites reported a successful
**v9** deployment at the existing [public demo](https://detourlab-tabish.tabisharaza.chatgpt.site/).
This is an intermediate deployment record. The desktop review found a Cancel-run
focus defect, so it is not the final release acceptance record.

### Deployment mapping

- Hosting source commit: `4a44a3fb595d938e44b7fe6a907d2fe73cafdf3b`.
- Saved version: **9**, ID
  `appgprj_6ac90e32f4c0819188f610bb51276139~appgver_c47de415029c8191830cbbeb07f9bc72`.
- Deployment: `appgdep_6ad5d326574c81919a7b72d12bd1fb19`, reported successful at
  the timestamp above.
- Recorded deployment archive SHA-256:
  `da323172831eb164bb0ffe00b85c8e212cd4dcf2ae542d9b51a9d53ca2bd1464`.
- The candidate was based on public source
  [`25c7fb6`](https://github.com/Tabisharaza/detourlab/commit/25c7fb636c6151d5a9e1b7ddcd5cf8c7e8ab349d).
  This baseline commit and its CI are not the final road-picker source or CI.

The recorded archive digest identifies the deployment package. It is not a
claim about independently retrieved CDN asset bytes. The corrective v10 deployment is recorded separately below. Its own
source/package mapping and browser retest must not be inferred from v9.

### Browser scope

These observations used **desktop Chromium on Linux**, with native keyboard
input and the application's built-in synthetic district and tiny lesson. The
exact Chromium version was not captured. No screen reader
or other assistive technology was run.

### Road search, native controls and focus

- The default selector contained **807 road-pair choices**. Searching for
  `bridge` reduced the list to **3**; full endpoint ID `node-11-9` produced **4**;
  an uppercase, outer-whitespace-padded representative edge-ID query produced
  **1** matching choice.
- **Alt+Down**, arrow keys and **Enter** operated the native road selector.
  Native `m` type-ahead, **Tab**, **Shift+Tab** and visible focus were exercised.
- A one-direction Harbor-road closure and its removal were exercised. The
  selected-road context reflected the chosen direction and saved schedule.
- A zero-match search disabled the road selector and **Toggle** action.
  Removing the last closure event in this state moved focus to the enabled
  search field.
- **Clear search** restored **807** choices and retained focus on the Clear
  search button.
- Native **Escape** in the search field cleared its query and retained focus.
  This was observed browser search-input behavior, not an application modal
  dismissal or a guarantee about every browser.
- Variant changes, duplication and renaming were exercised while retaining the
  road-search state. **Reset** cleared the search.

### Lesson and dialog transitions

Lesson **Cancel**, **Escape** dismissal and **Shift+Tab** containment were
exercised. Starting and resetting the lesson began with an unfiltered picker;
returning restored the earlier experiment's search. The lesson's one-way road
explained the unavailable reverse direction, and the reverse toggle was a no-op.
These observations cover those particular transitions; they do not replace the
complete modal, worker-interruption or assistive-technology test matrix.

### Desktop zoom

**200% zoom** was set and verified through ordinary Chromium controls. The
rendered page was inspected and a screenshot captured to review reflow. The
initial page-directed shortcut did not change zoom; it is not counted as the
successful zoom check. The later native browser-control interaction is the
basis for the 200% observation.

This was desktop-browser zoom, not native mobile testing or mobile-device
emulation. No new screenshot is embedded in this record until its retained original
identity, exact pixel dimensions, timestamp and SHA-256 have been verified. Earlier v5/v6 screenshots remain evidence for those versions.

### Finding corrected in v10

A real **Cancel run** action stopped the calculation, but keyboard focus was
then reported on the page's **AXWebArea** rather than a useful enabled control.
The native review also exposed focus loss when the run completed while Cancel
held focus. The finding was identified as pre-existing. The corrected local
source now hands focus to **Run all variants** before hiding Cancel, only while
Cancel still owns it. Nine new regressions and independent source review pass;
the subsequent v10 native cancellation/completion retest passed as recorded
below. The v9 calculations themselves completed, but their focus behavior failed.

### Checks not established

- Native file selection, chooser cancellation and import/export roundtrips remain
  unverified.
- No console audit or browser performance profile was performed.
- Imported hostile/long/duplicate-label or no-edge fixtures were not exercised
  in the browser. Their source-test coverage remains a separate kind of evidence.
- Screen-reader announcements, reduced-motion behavior, native mobile devices
  and a wider browser/platform matrix were not tested.
- This pass does not establish exported-file/CLI parity, independent CDN asset
  hashes, a complete accessibility audit, WCAG conformance or production readiness.

The [road-picker contract](ROAD_PICKER.md) and [keyboard guide](KEYBOARD.md)
describe the intended behavior. Final release status must distinguish the
observed v9 flows above from any later corrective build, retests and CI results.

## v10 run-lifecycle focus deployment

On **October 19, 2026 at 08:38:08.674906 UTC**, Sites reported a successful
**v10** deployment at the unchanged [public demo](https://detourlab-tabish.tabisharaza.chatgpt.site/).
It includes the corrected Cancel-run focus handoff described above.

- Hosting source commit: `93b8ba0674799fe93e56c4b9eaff41e46b613780`.
- Saved version: **10**, ID
  `appgprj_6ac90e32f4c0819188f610bb51276139~appgver_81e48a8ae6fc8191b49b57354632ff5d`.
- Deployment: `appgdep_6ad5d6e8b098819192bc29318d7fd722`, reported successful
  at the timestamp above.
- Recorded deployment archive SHA-256:
  `61cf727ee95536352faf426dc17d5957911b1a548bcf3577651e52497c879b31`.
- The original **v8** remains saved for rollback.
- Saved-version readback confirms that v10's deployment ID matches the successful
  deployment receipt. The hosting checkout built matching source; `src/app.js`
  SHA-256 is `6ca77692bbff3a4b0578662f1c61786f434022a4d20d146784182cc21c72924d`.
  Local corrected-package verification and the repeated build passed as recorded
  above. These package checks are separate from served-manifest inspection.

The corrected source's 601 core tests and independent review are distinct from
the actual native-browser checks below. The [published source `addd5f6`](https://github.com/Tabisharaza/detourlab/commit/addd5f62bba1225c23b779c8c9ab684db2be1326) and [CI run 39227618544](https://github.com/Tabisharaza/detourlab/actions/runs/39227618544) are verified; both pinned Node jobs passed. Neither deployment provenance nor
the bounded desktop observations establish screen-reader behavior, mobile
coverage, a complete accessibility audit or operational readiness.

### v10 native focus checks and screenshot

On **October 19, 2026 at approximately 08:47 UTC**, the public v10 page was checked
in cloud-hosted **desktop Chromium on Linux**, at **100% zoom** with a
**1173×751 content viewport**. The exact browser version was unavailable. The
checks used native keyboard input and the built-in synthetic district:

- **Run all variants → Shift+Tab → Space** activated Cancel run, stopped the
  calculation and returned focus to **Run all variants**.
- **Run all variants → Shift+Tab** visibly focused Cancel before normal Worker
  completion; completion then returned focus to **Run all variants**.
- The `bridge` query and **Foundry Bridge** selection were preserved through
  both flows. Completed outcomes displayed baseline **311.8 km / 0 late /
  0 unreachable**, versus closure **377.1 km / 118 late / 0 unreachable**.
  These are rounded interface values for the synthetic model.
- Native selector type-ahead **m**, then **Return**, selected **Market Bridge**.
  Its lime focus outline was visibly present.

Worker errors, timeout, construction failure, stale callbacks and newer-modal
races were covered by source tests, not induced in this native pass. The earlier
v9 200% zoom observations retain their v9 scope; this v10 check used 100% zoom.

The [unaltered screenshot](images/road-picker-v10-desktop.jpg) was captured at
approximately **08:47 UTC**, visually inspected and copied without re-encoding.
It is **1173×751 pixels**, contains only synthetic application content, and has
no EXIF metadata. It shows the `bridge` filter, **3 of 807** choices, selected
Market Bridge, saved-schedule context and the native selector's visible focus.
It does not depict the transient cancellation/completion handoff.
Screenshot SHA-256:
`bf2740028fd84e2cb29fc946820abc800d8adbffaa3ca547716e3238b7048632`.

### Served manifest verification

The public [distribution manifest](https://detourlab-tabish.tabisharaza.chatgpt.site/manifest.json)
was read through the real browser and saved. Its bytes match the locally verified
`dist/manifest.json` exactly, with SHA-256
`8c3a5a1a4f540056f529daf3f651d95ce213fad2a6de4cb9df293c616cb1c016`.
All **20 listed payload hashes** match the corresponding verified local payloads,
including `src/app.js` hash
`6ca77692bbff3a4b0578662f1c61786f434022a4d20d146784182cc21c72924d`.

This verifies the served manifest and its agreement with the tested local build.
It does **not** independently download or hash each remote payload, and the
manifest is not a signed provenance guarantee. Native file-picker/download
roundtrips, screen readers, reduced motion, native mobile, additional browsers
and browser performance profiling remain unverified.
