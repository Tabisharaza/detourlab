# Release checklist

Checked items record completed evidence; unchecked items remain publication or verification work. The app remains an alpha with explicit model and QA limits.

## Verified before this documentation pass

- [x] Public v4 demo loads and the tested flows work.
- [x] Application source is `cb554b15d4e8c44a589acce4d5462ebe4538ef7e`.
- [x] Core application checks: 156 passed, zero failures/skips.
- [x] Node/browser example figures agree for the verified 300/600-second comparisons.
- [x] MIT license and original synthetic-data provenance are included.
- [x] Actual desktop screenshot is included, without image generation or alteration.

Screenshot SHA-256: `31ae1995fe2809e38589420cc4f44528841de2578b0eff17cb1f1ccbbe5b3ecc`.

## Source bundle checks

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

## Remaining browser/operational gates

- [ ] Real file import/download roundtrips and chooser cancellation
- [ ] Mobile, reduced-motion, screen-reader and cross-browser review
- [ ] Large-graph UI/performance evidence on named devices
- [ ] Operational validation before any real-world decision-support claims

Keep incomplete boxes incomplete until the corresponding evidence exists.

See [clean-source publication](PUBLISHING.md) for the fresh-history procedure. Publishing the repository does not establish that every outstanding QA check has passed.
