# Release checklist

Checked items record completed evidence; unchecked items remain publication or verification work. The app remains an alpha with explicit model and QA limits.

## Historical v4 verification before initial publication

- [x] Public v4 demo loads and the tested flows work.
- [x] Application source is `cb554b15d4e8c44a589acce4d5462ebe4538ef7e`.
- [x] Core application checks: 156 passed, zero failures/skips.
- [x] Node/browser example figures agree for the verified 300/600-second comparisons.
- [x] MIT license and original synthetic-data provenance are included.
- [x] Actual desktop screenshot is included, without image generation or alteration.

Screenshot SHA-256: `31ae1995fe2809e38589420cc4f44528841de2578b0eff17cb1f1ccbbe5b3ecc`.

## Initial source bundle checks

- [x] Run `npm run check` and `node scripts/verify-dist.js`: 173 tests passed, zero failures/skips, and 17 payload files verified on Node 24.19.0.
- [x] Verify the lockfile under the pinned runtime and run the documented CLI commands, including success and threshold-failure exits.
- [x] Build twice and compare manifest and file bytes.
- [x] Confirm app runtime files still match the reviewed v4 application.
- [x] Check local documentation links, fixture figures and screenshot integrity.
- [x] Check the source archive against source bytes, excluding `.git`, provider configuration, private files and generated build output; review the included files for credentials.

These local checks were completed October 9, 2026 UTC. The added 17 tests exercise release-distribution verification; the application's previous 156 checks remain included. These local checks did not themselves establish hosted CI coverage. The later [public-release CI record](PUBLICATION.md) separately verifies both matrix jobs.

## Before creating the public repository

- [x] Confirm the available repository slug and publish [Tabisharaza/detourlab](https://github.com/Tabisharaza/detourlab). This is not trademark clearance.
- [x] Review the intended public source, license, screenshot and actual known gaps.
- [x] Document responsible disclosure without inventing a private inbox or requiring a security-setting change; optional private reporting can be added separately when approved.
- [x] Confirm no fabricated badges, usage numbers, adoption or Trending claims.

## After repository publication

- [x] Verify full-source commit `6410b0a` and all 58 remote paths, file modes, sizes and blob hashes against the reviewed archive.
- [x] Inspect [run 37995893928](https://github.com/Tabisharaza/detourlab/actions/runs/37995893928): both jobs and every step succeeded.
- [x] Record Node 24.19.0 / npm 11.17.0 and Node 24.21.0 / npm 11.19.0 separately from the local baseline.
- [x] Verify README links and actual image rendering from the published repository; the image loaded at 1165×1586 pixels.
- [x] Publish selected contribution issues [#1](https://github.com/Tabisharaza/detourlab/issues/1), [#2](https://github.com/Tabisharaza/detourlab/issues/2) and [#3](https://github.com/Tabisharaza/detourlab/issues/3), and read back their contents and labels.

These completed gates apply to the [initial public source release](PUBLICATION.md), not automatically to future revisions. A status badge is optional; the exact successful run is linked instead.

## October 10 renderer and v5 deployment

- [x] Publish source `74e0356` and verify all 67 public files against its remote tree.
- [x] Inspect [run 38030451835](https://github.com/Tabisharaza/detourlab/actions/runs/38030451835): both matrix jobs passed 194 tests and the separately repeated 20 CLI gates.
- [x] Deploy the matching source as v5 at the existing URL; retain v4 for rollback.
- [x] Exercise the bounded [v5 desktop workflows](VERIFICATION.md#v5-renderer-deployment-and-desktop-checks), including 0/118/106 late counts and Cancel/rerun/Reset.
- [x] Include the actual new desktop screenshot, SHA-256 `83b2b2ee97aad183211250545f520560713d6cefd53eec801d853fce65ea9017`.
- [ ] Independently verify exact CDN-served asset bytes; the executor manifest request returned 403.
- [ ] Measure browser rendering time and verify native resize/context-loss behavior; Node operation counts are not timing measurements.

## October 10 tiny lesson and v6 deployment

- [x] Verify source `359570c` and all 72 remote files against its sanitized source archive.
- [x] Verify [run 38039735868](https://github.com/Tabisharaza/detourlab/actions/runs/38039735868): both pinned Node jobs passed 220 tests and the separately repeated 20 CLI gates.
- [x] Verify all 19 payloads and the manifest, source parity and repeated builds.
- [x] Publish the same Site as v6, preserving v5 rollback.
- [x] Exercise the bounded [native lesson workflows and restoration](VERIFICATION.md#v6-tiny-lesson-deployment-and-desktop-checks), including exact cutoff outcomes and preserved draft name.
- [x] Record the actual 1165×1604 lesson screenshot and its hash.
- [ ] Complete keyboard/screen-reader and responsive viewport coverage; native dialog focus evidence remains bounded.

## Remaining browser/operational gates

- [ ] Real file import/download roundtrips and chooser cancellation
- [ ] Mobile, reduced-motion, screen-reader and cross-browser review
- [ ] Large-graph UI/performance evidence on named devices
- [ ] Operational validation before any real-world decision-support claims

Keep incomplete boxes incomplete until the corresponding evidence exists.

See [clean-source publication](PUBLISHING.md) for the fresh-history procedure. Publishing the repository does not establish that every outstanding QA check has passed.

## October 10 modal keyboard and v7 deployment

- [x] Verify reviewed [runtime source fb08b57](https://github.com/Tabisharaza/detourlab/commit/fb08b57457eb70abe107eca0cab41f6f3d30261f) and all 75 public source files.
- [x] Verify [run 38042346894](https://github.com/Tabisharaza/detourlab/actions/runs/38042346894): both Node jobs passed 231 tests, 20 repeated CLI gates and byte-identical builds.
- [x] Independently review delayed-close, hidden/disabled opener and repeated-modal focus cases; fix the native-Escape stale-focus finding.
- [x] Deploy the same public Site as v7; retain v6 rollback and older versions.
- [x] Exercise [desktop native keyboard flows](VERIFICATION.md#v7-modal-keyboard-deployment-and-desktop-checks): both modal boundaries, initial focus, Escape/Close return, single-control guide, lesson Reset/Return and repeated cancellation.
- [ ] Extend coverage to screen readers, mobile/responsive viewports and other browsers/platforms.
- [ ] Verify native file-import/export and broader dynamic-editor focus behavior in a permitted environment.

This scoped milestone does not complete the broader accessibility or native-file checklists above.

## File-input source release — October 10, 2026

- Runtime source: [`e9285ee6d8e47a753ffb6dccc580df9c8488cfd5`](https://github.com/Tabisharaza/detourlab/commit/e9285ee6d8e47a753ffb6dccc580df9c8488cfd5), parent `8cfceb58fd05118c24fb458029e9ee2c78219bfc`; remote tree `ed114b1e0c3933383776dd630fff6bdd6bdfc668`.
- All 81 remote source members matched reviewed local blob hashes, modes and sizes. The six new files are one browser-safe decoder/diagnostic helper, one Node bounded-reader helper, three test files and the file-input guide. No dependencies, workflow permissions or simulation algorithms changed.
- Independent original-fixture checks confirmed malformed-byte rejection across all three entry points, retained UI state/results, BOM consistency, FIFO rejection, bounded/escaped errors and unchanged valid CLI output.
- [CI run 38055582446](https://github.com/Tabisharaza/detourlab/actions/runs/38055582446) completed successfully for that exact runtime commit. Both Node matrix jobs passed 341 tests, the separately repeated 20 CLI gates and a byte-identical two-build comparison of 20 payloads plus manifest. [CI.md](CI.md#file-input-milestone) records exact jobs and toolchains.
- Runtime source ZIP: `detourlab-public-source-e9285ee.zip`, 690,525 bytes, 81 members; SHA-256 `9ff54a8f60a8e4a8a61f1d5379cee59903cf9d951e85b5e9b1462973393f3db2`. Every member matches the named remote runtime tree; ZIP integrity passes. No `.git`, `.openai`, provider configuration, generated `dist` or `node_modules` is included.
- This release updates GitHub source only. The public demo remains v7, and native file-picker/download QA is still open. Later docs may record this evidence; their own CI runs must be checked separately.

## Dynamic editor focus source release — October 10, 2026

- Runtime commit: [`0559eecbf8f4c50a01d4fc608abd2228adbd2f6b`](https://github.com/Tabisharaza/detourlab/commit/0559eecbf8f4c50a01d4fc608abd2228adbd2f6b)
- Exact remote tree: `71fc63a1609b13ba67d77b65ea5ae898499d96a2`; all **82 files** matched local Git blob hashes, sizes and modes.
- [Hosted CI 38069928417](https://github.com/Tabisharaza/detourlab/actions/runs/38069928417): both Node 24.19.0/npm 11.17.0 and Node 24.21.0/npm 11.19.0 jobs passed every step. Per job: 39 syntax checks, 357 tests, 20 CLI gates repeated separately, 20 payloads plus manifest and byte-identical rebuilds.
- Independent source review passed 357 aggregate tests, 44 focused dynamic/modal/workbench checks and 11 additional probes. Exact baseline fails 12 of the 16 new regression tests; four control cases already pass.
- Runtime source archive: `detourlab-public-source-0559eec.zip`, 698,472 bytes; SHA-256 `063f06fdf1b2c8d04585e7d53ebc16fe165a5e9e2fc3bacaf438b3a6eba14921`. Every member matches the published runtime source; ZIP integrity passes.
- A documentation-only follow-up records the completed runtime evidence. It does not alter application assets or assert that its own CI passed in advance.
- No new deployment or browser checks. Public demo remains **v7**. Native Tab/blur ordering, focus visibility during scrolling, assistive technology, file-picker/download and browser performance checks remain separate gaps. The existing stylesheet hides reopen chips; source tests do not make those chips keyboard-reachable.
