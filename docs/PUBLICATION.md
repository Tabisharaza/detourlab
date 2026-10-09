# Initial public source release

This is a historical verification record for the first full-source publication on **October 9, 2026 UTC** (October 10 in Riyadh). Later documentation and source revisions have their own commits and CI runs; the evidence below remains tied to the named initial commit.

## Source and archive mapping

- Public repository: https://github.com/Tabisharaza/detourlab
- Reviewed source archive: `detourlab-release-ready-3ae78b6.zip`, **334,032 bytes**, **58 files**
- Archive SHA-256: `f3db3318385119aa0613231561f643ce353ea6adccd1e2238ea4f5899b4d550f`
- Full-source commit: [`6410b0acdf4ea8ecd7f54f64c28d7c579d21b9da`](https://github.com/Tabisharaza/detourlab/commit/6410b0acdf4ea8ecd7f54f64c28d7c579d21b9da)
- Source tree: `91391c173f910990faa0c2d6a349d22154c21af4`

All 58 archive paths, regular-file modes (`100644`), byte sizes and Git blob hashes matched that remote tree. The ZIP excluded `.git`, `.openai`, provider configuration, generated `dist`, dependencies and private files. Its digest identifies this particular ZIP; GitHub-generated source archives may have different wrapper directories, timestamps and compression bytes.

The public history at initial publication contained two clean commits: a root [LICENSE-only bootstrap](https://github.com/Tabisharaza/detourlab/commit/ad69c4f4a7aa12ed23f24ea7b5eefedf6053cb98), then the full reviewed source tree above. No hosting-provider history was copied. This differs from the single-commit Git CLI example in [PUBLISHING.md](PUBLISHING.md), while preserving its clean-source requirement.

## Hosted CI evidence

[Run 37995893928](https://github.com/Tabisharaza/detourlab/actions/runs/37995893928) was triggered by a push of exactly `6410b0acdf4ea8ecd7f54f64c28d7c579d21b9da` and completed with **success** on October 9, 2026 UTC.

| Job | Node | npm | Full suite | Repeated CLI gates | Outcome |
| --- | --- | --- | --- | --- | --- |
| [114041762737](https://github.com/Tabisharaza/detourlab/actions/runs/37995893928/job/114041762737) | 24.19.0 | 11.17.0 | 173 passed | 20 passed | Success |
| [114041762900](https://github.com/Tabisharaza/detourlab/actions/runs/37995893928/job/114041762900) | 24.21.0 | 11.19.0 | 173 passed | 20 passed | Success |

The 20 CLI gates are deliberately repeated from the full suite; they are not additional unique tests. Both jobs had zero test failures and verified 17 distribution payload files plus `manifest.json`, source/license parity, byte-identical second builds and clean tracked source after checks. Every job step completed successfully. Both used Ubuntu 24.04, runner image `20261004.327.1` ([image release](https://github.com/actions/runner-images/releases/tag/ubuntu24%2F20261004.327)).

The pre-publication local checks used Node 24.19.0 with npm 11.9.0. Node 24.21.0 was verified later in hosted CI, not in that local pass. The declared Node 24.2.0 API floor was not itself tested. See [CI.md](CI.md) for scope, maintenance and reproducibility limits.

## Demo and human-facing checks

The [live demo](https://detourlab-tabish.tabisharaza.chatgpt.site/) remains deployed application v4, from application source `cb554b15d4e8c44a589acce4d5462ebe4538ef7e`. Source publication and this documentation follow-up did not deploy a changed application. [VERIFICATION.md](VERIFICATION.md) separates actual desktop-browser checks from mocked UI tests.

The published README was inspected in a real desktop browser. Its unaltered workbench screenshot loaded successfully at its natural 1165×1586 dimensions. The screenshot shows synthetic data; its provenance and hash are retained in the verification and release-checklist documents.

Selected contributor issues were published and read back:

- [#1: Add a tiny multi-variant experiment walkthrough](https://github.com/Tabisharaza/detourlab/issues/1)
- [#2: Verify import/export roundtrips in a real desktop browser](https://github.com/Tabisharaza/detourlab/issues/2)
- [#3: Profile and avoid redraws of unchanged paused scenes](https://github.com/Tabisharaza/detourlab/issues/3)

## Limits that remain

A passing Node workflow does not verify browser-native file selection/downloads, chooser cancellation, mobile/reduced-motion behavior, screen readers, a wider browser/platform matrix, or large-graph visual performance. Those checks remain open. Pull-request/fork behavior was not exercised by this push run. No operational traffic validation, production-readiness, adoption or Trending outcome is implied.
