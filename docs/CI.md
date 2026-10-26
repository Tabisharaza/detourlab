# CI and release verification

## Preview server symbolic-link rejection

The October 26, 2026 source fix closes a gap between the preview's URL allowlist
and the filesystem it actually reads. The previous handler checked the requested
path lexically, then used `stat` and `readFile`, which followed symbolic links.
An allowed asset pathname could therefore return a linked file outside the
preview root or in a hidden directory. The independent distribution verifier
already rejected release-tree links, but running the source preview did not use
that verifier.

The handler now uses `lstat` on the selected root and every requested descendant.
It rejects symbolic links even when their targets are otherwise allowed assets,
requires directories for intermediate components and a regular file at the end,
and rejects percent-encoded backslashes remaining in decoded paths consistently
across host path conventions. Literal backslashes are normalized to forward
slashes by the URL parser before these checks.
Both GET and HEAD repeat these checks on every request. A rejection returns the
existing generic 404 without reading the target body; later valid requests still
work. Loopback binding, method restrictions, successful bytes/security headers,
body-free HEAD and read-before-success behavior are unchanged.

Ten added tests use original synthetic temporary files and the existing real
Node HTTP response objects over in-memory streams. Six link cases failed against
the original handler with HTTP 200 rather than 404: outside/hidden/allowed file
targets and root/top-level/nested directory links. Additional cases cover root
index links, dangling/cyclic links, every path-check failure boundary, repeated
requests after a directory becomes a link, recovery, and ordinary nested/encoded
assets. These are filesystem/handler tests, not a listening server or native
browser run. No private data, uploads or external services are involved.

Local verification on **Node 24.22.1 / npm 11.9.0 / Linux** passed **694 core +
120 optional schema/editor tests = 814 distinct tests**, with no failures or
skips. The **113 separately repeated CLI tests** overlap the core total. Root
and optional dependency lockfiles installed unchanged with lifecycle scripts
disabled. Syntax checks cover **72 core JavaScript files** and two optional
`.mjs` files. The documented Meridian experiment command succeeded. All **26
distribution payloads plus manifest** are byte-identical across repeated builds
and to the retained pre-fix distribution. No application/model, schema,
dependency, workflow or deployed asset changes are included. Hosted CI must be
checked for the exact published source commit separately.

The checks are intentionally not a claim of race-free confinement. Inspection
and read remain separate operations; hostile concurrent directory replacement,
hard links and symlink ancestors of the selected root are outside this trusted-
checkout preview's guarantee. They do not change static deployment behavior.
Native-browser/import and hosted deployment gates remain separate.

## Portable distribution manifest paths

The October 24, 2026 build fix separates manifest names from host filesystem
paths. Previously, `scripts/build.js` used `path.relative` for manifest keys.
On Windows, its backslashes conflict with the release verifier's deliberately
slash-separated allowlist. The build now joins actual directory-entry names
with `/` for the manifest, while retaining native `path.join` for file access.
It does not rewrite literal backslashes in POSIX filenames, broaden the release
allowlist, change asset bytes, or change the version-1 manifest format.

Three new build tests cover the real build with Win32 relative-path return
values, deeper nested paths with spaces and Unicode, and distinct POSIX names
containing a literal backslash versus a directory separator. The existing build
test now also invokes the independent release verifier. Two new regressions
failed against the previous builder. With the fix, the ordinary and injected
Win32-relative builds have identical manifest bytes, and the full release build
passes hash, source-byte, license and exact-allowlist verification.

Local checks on **Node 24.22.1 / npm 11.19.1 / Linux** passed **677 core + 120
optional schema/editor tests = 797 distinct tests**, with no failures or skips.
The **113 separately repeated CLI tests** overlap the core total. Syntax checks
cover **72 core JavaScript files** and two optional `.mjs` files. The **26
distribution payloads plus manifest** are byte-identical across repeated local
builds and to the retained pre-fix distribution. Application, model, schema,
dependency, workflow, server and deployed assets are unchanged.

The Win32 tests run in isolated Node subprocesses with only `path.relative`
supplied by `path.win32`; all filesystem operations still use the Linux host.
This reproduces the separator defect, not a native Windows or macOS run, and
does not establish cross-OS, cross-locale or browser reproducibility. The POSIX
literal-backslash case is skipped on Windows, where that character is a path
separator. New hosted CI must be checked for the exact published source commit.
Existing browser/import and deployment gates remain separate.

## Preview server read-failure recovery

The October 23, 2026 source fix keeps a transient asset read failure from
terminating the local preview server. Previously, `scripts/serve.js` committed
HTTP 200 after `stat` but before awaiting `readFile`. If a concurrent `--dist`
rebuild removed the asset in that interval, the error handler attempted a second
`writeHead`, causing `ERR_HTTP_HEADERS_SENT` and an unhandled request rejection.
The server now reads the complete GET body before committing success; a failed
read returns the existing generic 404, and later requests can still succeed.
HEAD continues to check the file without reading or sending its body.

Nine new tests exercise real Node `IncomingMessage`/`ServerResponse` objects
over in-memory streams, with deterministic filesystem failures. They cover
ENOENT, EACCES and EIO recovery; no premature successful headers; HEAD behavior;
exact successful payload bytes and existing security headers; stat/non-file
failures; and unchanged method/path rejection. Four response-order regressions
failed before the fix; all nine checks now pass. The handler is importable
without starting a listener. Subprocess checks intercept `listen` to verify
that direct source/`--dist` startup reaches the existing loopback/port wiring
once, while import reaches it zero times, under `import.meta.main`.

Final local checks on **Node 24.22.1 / npm 11.19.1 / Linux** passed **674 core +
120 optional schema/editor tests = 794 distinct tests**, with no failures or
skips. The **113 separately repeated CLI tests** overlap the core total. Syntax
checks covered **72 core JavaScript files** and two optional `.mjs` files. All
**26 distribution payloads plus manifest** remain byte-identical across repeated
builds and to the pre-fix Node-baseline distribution. No browser application,
engine, schema, dependency, workflow or deployed asset changes are included.

These checks do not open a listening socket or a browser, and do not establish
native-browser, Windows/macOS or hosted-CI results. A rebuild can still produce
temporary 404s; this fix is not an atomic whole-distribution snapshot. Existing
browser/import and deployment gates remain separate.

## Current Node security baseline

As of **October 23, 2026**, use **Node 24.22.1** for local development,
networked dependency installation and builds. [The official release](https://nodejs.org/en/blog/release/v24.22.1)
is part of the [October 21 security update](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases),
including the eMudhra CA remediation and other security fixes. `.node-version`
and the sole CI matrix entry pin this exact patch. The former 24.19.0 and
24.21.0 lanes are removed rather than continuing registry installation with
unpatched runtimes. No application code, dependency/lockfile, action pin,
workflow permission, hosting setting or deployment changes with this update.

The `>=24.2.0` package/lockfile range remains an API compatibility floor, not
an endorsement of unpatched versions or proof that the minimum was tested.
Earlier version numbers, test totals and linked runs below are historical
records of those exact commits; they do not verify this new toolchain change.
The action runtime supplied by GitHub's runner is separate from the project
Node selected by setup-node; this pin does not attest to its patch level or
any hosted application's runtime.

Local verification on **October 23, 2026**, using the official Linux x64
**Node 24.22.1 / npm 11.19.1** distribution, passed **665 core tests + 120
optional schema/editor tests = 785 distinct tests**, with no failures or
skips. The **113 CLI tests repeated separately** overlap the core count.
Syntax checks covered **71 core JavaScript files** and the optional tool's
two `.mjs` files. The dependency-free root lockfile and the optional checker's
unchanged lockfile both installed successfully with lifecycle scripts disabled;
the optional install used a writable workspace-local npm cache. The documented
Meridian experiment command passed. All **26 distribution payloads plus
manifest** matched across two builds and the retained pre-change source build.
No application bytes changed. New hosted CI must still be inspected for the
exact published patch commit; local checks do not claim browser or deployment
verification.

## Road-picker and lifecycle-focus local verification

The corrected October 19, 2026 source passes **601 core tests + 120 optional
schema/editor tests = 721 distinct tests**, including 29 road-picker and nine
run-lifecycle focus regressions. The **113 separately repeated CLI tests** are
already included in the core total. Local toolchains remain **Node 24.19.0 /
npm 11.9.0 / Linux**; syntax coverage is **60 core JavaScript files** and the
optional tool's **two `.mjs` files**. The aggregate check builds 20 static
payloads; distribution verification confirms source parity and a byte-identical
second build, including the manifest. Hosted CI for [published source `addd5f6`](https://github.com/Tabisharaza/detourlab/commit/addd5f62bba1225c23b779c8c9ab684db2be1326) and [CI run 39227618544](https://github.com/Tabisharaza/detourlab/actions/runs/39227618544) passed on both Node 24.19.0 and 24.21.0. Every job step succeeded, including the complete tests, CLI gates, optional tooling and repeat-build verification. This verifies that feature commit, not subsequent documentation edits.

The existing workflow discovers the new tests without changing permissions,
Node/action pins or dependencies. [The verification record](VERIFICATION.md#road-picker-and-run-lifecycle-focus-milestone)
separates local source evidence, v9 browser observations and the corrected
v10 deployment with its passed native cancellation/completion retests and
served-manifest check. Hosted Node CI does not launch a browser.

## Portable experiment review-packet milestone

The [review-packet source `92a6cac`](https://github.com/Tabisharaza/detourlab/commit/92a6cacd138155569cd3913f8affa04077382b68) passed [hosted run 39086496176](https://github.com/Tabisharaza/detourlab/actions/runs/39086496176) on **October 18, 2026 UTC**. Both matrix jobs completed every step successfully: Node **24.19.0 / npm 11.17.0** (job **117554070842**) and Node **24.21.0 / npm 11.19.0** (job **117554070650**), on Ubuntu 24.04 image **20261012.334.1**.

Each job passed **563 core tests + 120 optional authoring tests = 683 distinct tests**, separately repeated **113 CLI tests** already included in the core count, checked **59 core JavaScript files** plus the optional tool's two files, and reproduced all **20 browser payloads plus manifest** byte-for-byte. Local checks on Node 24.19.0 / npm 11.9.0 / Linux passed the same counts. The **88 new source tests** comprise 25 report-model, 34 CLI/identity, 28 filesystem and one checked-in-example parity test. None failed or skipped.

The [packet workflow](REVIEW_PACKETS.md) consolidates the complete experiment, existing policy, every variant's metrics and delivery outcomes into bounded `bundle.json` and readable `REVIEW.md`. It performs one whole-experiment simulation. Distinct hashes cover canonical report data and exact readable-review bytes; generated reproduction checks the current implementation fingerprint and both artifacts. No supplied limits means not evaluated. A failed policy still produces the complete packet with exit 1.

Independent review passed **32 supplemental checks**, separately reran all **88 milestone tests**, and verified **23 prior CLI invocations** retained exact stdout/stderr/exit behavior. These overlapping checks are not added to the 683-test count. The review exercised fixture reconciliation, precision/nulls, generated shell reproduction and tamper rejection, actual concurrent CLI writers, existing/symlink destinations, real output-limit inputs and injected cleanup failures. It found no blocking runtime defects. The [checked-in tiny review](examples/tiny-review/REVIEW.md) and [machine bundle](examples/tiny-review/bundle.json) are regenerated byte-for-byte by a source test.

All **117 public source files** matched Git blob IDs, sizes and modes in tree `e6ac41111faabf87243169db733de400bbcd0559`. The browser payloads and manifest remain byte-identical to the v8 source/build; no Site deployment, UI, engine, input schema, dependency, license or workflow-permission change is part of this milestone. Existing screenshot and native-browser evidence retains its historical scope. Hard-link output publication is not atomic directory visibility or crash-durable storage; adversarial co-writer races, unusual filesystems, native Windows/macOS and browser behavior remain outside this verification. This record names the exact runtime source commit; a later documentation-only commit requires its own CI check.

## Per-job acceptance-gate milestone

Local checks on **October 16, 2026**, using **Node 24.19.0 / npm 11.9.0 / Linux**, passed **475 core tests** and **120 optional authoring tests**, with zero failures or skips. The **43 new tests** comprise 21 helper/contract cases and 22 actual CLI subprocess cases. CI separately repeats **79 CLI cases** already included in the core count. Syntax checks cover **51 core JavaScript files** and the optional tool's two files.

The [new opt-in gates](JOB_GATES.md) catch newly late deliveries and worst comparable arrival slip, including a documented fixture where net late counts conceal a different delivery becoming late. A requested timing gate fails closed when no comparable arrivals exist. Existing aggregate thresholds, input fingerprints and the job-impact report contract remain unchanged. Fourteen prior CLI invocations preserve byte-identical stdout/stderr and exit codes; 20 of the 22 new subprocess cases fail against the previous source, with two old-contract controls passing.

The repeated builds and all **20 browser payloads plus manifest** remain byte-identical to v8. Only headless scripts, tests, documentation and the existing CLI test step change. Node/action pins, workflow permissions, schemas, dependencies and licenses are unchanged. Independent review found no correctness blockers and separately confirmed 36 old-command compatibility cases. [Gate source `42f1551`](https://github.com/Tabisharaza/detourlab/commit/42f155150a79b6575ae6dabbb3e5bd3528a30feb) passed [hosted run 38864089074](https://github.com/Tabisharaza/detourlab/actions/runs/38864089074) on October 16, 2026 UTC. Both jobs completed every step successfully: Node 24.19.0/npm 11.17.0 (job 116852800616) and Node 24.21.0/npm 11.19.0 (job 116852800225). Each passed 475 core plus 120 optional tests (595 distinct), repeated 79 CLI cases, checked 51 core plus two optional syntax files, and reproduced all 20 payloads plus manifest. All 106 source files matched remote tree `f149d5d27d8c63bb1e830ee92d386f5e6efc7f65`. This evidence names that exact source commit; later documentation changes require their own CI check. Browser and terminal-emulator QA gaps remain separate.

## Headless job-impact milestone

Local checks on **October 15, 2026**, using **Node 24.19.0 / npm 11.9.0 / Linux**, passed **432 core tests**, **120 optional authoring tests**, **48 core JavaScript syntax checks** and the optional tool’s two syntax checks. The 48 new tests comprise 20 report tests and 28 actual CLI subprocess tests. CI now separately repeats the new CLI cases alongside the existing gates: **57 repeated tests**, not additional unique tests.

The command exposes job status and timing differences hidden by aggregate counts. In the reference Meridian comparison, 125 arrivals change while 118 jobs become late. Null unreachable comparisons, engine deadline tolerance, original job order and the whole-experiment budgets remain explicit. The output-size guard is tested at an injected smaller bound; a full 2000-job valid input is also checked under the real 4 MiB output limit. See [the report contract and exact examples](JOB_IMPACT.md).

Ten existing runner invocations retain byte-identical stdout/stderr and exit codes. Both builds, all 20 payloads and the manifest match the retained v8 distribution byte-for-byte. No browser module, input schema, root dependency, Node/action pin, workflow permission or Site deployment changes. Independent review passed the new and full core suites; native browser and terminal-emulator coverage remain separate. [Job-impact source `1277646`](https://github.com/Tabisharaza/detourlab/commit/12776464cee43e077a4ab5b83546d882adc9e03b) passed [hosted run 38692255287](https://github.com/Tabisharaza/detourlab/actions/runs/38692255287) on October 15, 2026 UTC. Both jobs completed every step successfully: Node 24.19.0/npm 11.17.0 (job 116280637764) and Node 24.21.0/npm 11.19.0 (job 116280638007). Each passed 432 core and 120 optional tests with zero failures/skips, repeated 57 CLI gates, checked 48 core and two optional JavaScript files, and reproduced every byte of the 20 payloads plus manifest. All 101 source files matched remote tree `402690bf224d8dd53662ac92d3eb6f7c2768f3fd`. This evidence names that exact source commit; later documentation changes require their own CI check.


## Portable scenario authoring milestone

The October 14, 2026 local check used **Node 24.19.0 / npm 11.9.0 / Linux**. The existing core suite passed **384 tests** and **44 JavaScript syntax checks**, with the **29 CLI gates** repeated separately. The isolated optional checker passed **120 additional tests**: 86 structural/runtime-boundary cases and 34 JSON language-service cases, plus syntax checks for its two `.mjs` files. Repeated gates are not extra unique tests. Core checks also passed with the optional dependencies absent.

CI now installs the optional checker from its separate lockfile with lifecycle scripts disabled, then runs it on both existing Node versions. Ajv 8.20.0 and vscode-json-languageservice 5.7.2 are exact direct pins; the lockfile fixes 11 packages total. Root package dependencies, Node/action pins and read-only workflow permissions are unchanged. See [the authoring contract](JSON_SCHEMAS.md) and [tool dependency notices](../tools/schema-check/THIRD_PARTY_NOTICES.md).

Both local builds and all **20 payloads plus manifest** match the retained v8 distribution byte-for-byte. These checks use validator/language-service APIs, not a native editor or browser. [Authoring source `69ebb18`](https://github.com/Tabisharaza/detourlab/commit/69ebb18c906f49be648f3c20e06f9641ee6bd8b1) passed [hosted run 38526280719](https://github.com/Tabisharaza/detourlab/actions/runs/38526280719) on October 14, 2026 UTC. Both jobs completed every step successfully: Node 24.19.0/npm 11.17.0 (job 115727271160) and Node 24.21.0/npm 11.19.0 (job 115727271424). Each passed 384 core tests, 120 optional authoring tests and 29 repeated CLI gates, with 44 core syntax checks, two optional syntax checks and byte-identical 20-payload builds plus manifest. All 96 source files matched remote tree `bc0bc5b003c633213737af93001ce9c683c97b11`. This record verifies that exact authoring-source commit; later documentation changes need their own CI check.

## CLI human-label presentation milestone

The October 13, 2026 local check used Node **24.19.0 / npm 11.9.0 / Linux** and passed **384 tests** and **44 JavaScript syntax checks**. Eighteen new tests cover escaped controls and literal backslashes in human reports while preserving JSON data, hashes and ordinary output. Of the 13 subprocess tests, nine fail against the previous reporters and four are compatibility controls; the other five test the new formatter directly. The existing workflow discovers all 18 through `node --test`; its separate argument/threshold gate remains **29 repeated tests**, not 47.

The change is confined to CLI presentation, tests and documentation. Browser source, package dependencies, workflow permissions/pins and schemas are unchanged. See [the display contract](FILE_INPUT.md#human-cli-label-display) and [verification record](VERIFICATION.md#cli-human-label-presentation-milestone). [Source `211fcfd`](https://github.com/Tabisharaza/detourlab/commit/211fcfdbb4dc1fc448faf0bfefd3072f8af8cf67) passed [hosted run 38361085167](https://github.com/Tabisharaza/detourlab/actions/runs/38361085167) on October 13, 2026 UTC. Both jobs completed every step successfully: Node 24.19.0/npm 11.17.0 (job 115175182591) and Node 24.21.0/npm 11.19.0 (job 115175182370). Each passed 384 tests, repeated 29 CLI gates, syntax-checked 44 JavaScript files, and reproduced every byte of the 20 payloads plus manifest. This record is tied to that CLI source commit, not later documentation changes or browser behavior.

## CLI argument-contract milestone

The October 13, 2026 local check used Node **24.19.0 / npm 11.9.0 / Linux** and passed **366 tests**, **41 JavaScript syntax checks**, and **29 separately repeated CLI gates**. The nine new actual-process regressions are included in the full suite; the repeated gates are not additional unique tests. They cover all three duplicate threshold flags, argument-order stability, inherited-property filenames and the existing default/help behavior. Four of these tests fail against the prior `b2f9997` source and five serve as compatibility controls. Eight ordinary runner invocations retain byte-identical stdout/stderr and exit codes.

The workflow now explicitly repeats `tests/cli-arguments.test.js` with the existing CLI gates. Node/action pins, permissions and other steps are unchanged. All **20 distribution payloads plus manifest** remain byte-identical to the v8 package; no browser application source was changed. Two local builds also matched every byte. [Source `84d93be`](https://github.com/Tabisharaza/detourlab/commit/84d93bec1a1323301f0ae8c7fc6b443bf42f65f6) passed [hosted run 38359389637](https://github.com/Tabisharaza/detourlab/actions/runs/38359389637) on October 13, 2026 UTC. Both jobs completed every step successfully: Node 24.19.0/npm 11.17.0 (job 115169719153) and Node 24.21.0/npm 11.19.0 (job 115169718826). Each passed 366 tests, repeated 29 CLI checks, syntax-checked 41 JavaScript files and reproduced all 20 payloads plus manifest. This evidence names that CLI source commit, not later documentation commits or native browser behavior.

## Historical onboarding status

The v6 onboarding milestone [`359570c`](https://github.com/Tabisharaza/detourlab/commit/359570c81260b17778e3e8291128e2191ff149d2) passed [run 38039735868](https://github.com/Tabisharaza/detourlab/actions/runs/38039735868) on **2026-10-10 UTC**. Both matrix jobs passed **220 tests**, separately repeated the **20 CLI gates**, verified **19 payload files plus the manifest**, and reproduced every build byte. Toolchains were Node 24.19.0/npm 11.17.0 (job 114177411256) and Node 24.21.0/npm 11.19.0 (job 114177411223); all steps succeeded. The [v6 verification record](VERIFICATION.md#v6-tiny-lesson-deployment-and-desktop-checks) separates real browser checks from stand-ins. This evidence names that exact milestone commit, not every later docs change.

### Prior renderer milestone

For the deployed v5 renderer source [`74e0356`](https://github.com/Tabisharaza/detourlab/commit/74e0356c1fe0d7cfac0c2520906496aaef7869c6), [run 38030451835](https://github.com/Tabisharaza/detourlab/actions/runs/38030451835) succeeded on **2026-10-10 UTC**. Both matrix jobs passed **194 tests**, separately repeated the **20 CLI gates**, and verified **17 payload files plus the manifest** and byte-identical second builds. Actual toolchains were Node 24.19.0/npm 11.17.0 and Node 24.21.0/npm 11.19.0 on Ubuntu 24.04 image 20261004.327.1. Every job step succeeded. [The v5 browser/deployment record](VERIFICATION.md#v5-renderer-deployment-and-desktop-checks) covers separate evidence and limitations. This record is tied to that runtime commit, not an assertion about every later documentation commit.

### Initial release history

The workflow in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) **passed for the initial public source release** [`6410b0a`](https://github.com/Tabisharaza/detourlab/commit/6410b0acdf4ea8ecd7f54f64c28d7c579d21b9da). [Run 37995893928](https://github.com/Tabisharaza/detourlab/actions/runs/37995893928) completed successfully on **2026-10-09 UTC**. Both jobs passed all **173 tests**, repeated the **20 CLI gates**, and verified **17 distribution payload files plus the manifest** with byte-identical second builds. The repeated CLI gates are part of the full suite, not 20 additional unique tests. See the [publication record](PUBLICATION.md) for exact jobs, toolchains and archive-to-commit mapping.

Local verification on **2026-10-09** used Node **24.19.0**, npm **11.9.0**, and Linux. The commands below passed locally: lockfile validation, all **173 tests** in the full check, the **20 dedicated CLI gates**, and two-build distribution verification. Node **24.21.0 was not exercised locally** in that pre-publication pass. The later hosted run used **24.19.0 / npm 11.17.0** and **24.21.0 / npm 11.19.0** on Ubuntu 24.04 image **20261004.327.1**; every job step succeeded. That establishes this push workflow's execution for that commit, not a test of fork approval behavior, pull-request events or every environment. The earlier source bundle correctly described CI as pending at the time it was prepared.

## Modal keyboard milestone

[Source `fb08b57`](https://github.com/Tabisharaza/detourlab/commit/fb08b57457eb70abe107eca0cab41f6f3d30261f) passed [run 38042346894](https://github.com/Tabisharaza/detourlab/actions/runs/38042346894) on October 10, 2026 UTC. Both existing matrix jobs completed successfully: Node 24.19.0/npm 11.17.0 and Node 24.21.0/npm 11.19.0. Each checked 33 JavaScript files, passed **231 tests**, repeated all **20 CLI gates**, verified **19 distribution payloads plus the manifest**, and reproduced every build byte. Eleven new focused regressions cover modal keyboard handlers and delayed close events. The workflow itself is unchanged. [Actual browser observations](VERIFICATION.md#v7-modal-keyboard-deployment-and-desktop-checks) are recorded separately; hosted CI does not launch a browser.

## Dynamic editor focus milestone

The dynamic-control source change passed local checks on Node 24.19.0 / npm 11.9.0: **39 JavaScript files, 357 tests**, the separately repeated **20 CLI gates**, and **20 payloads plus manifest** with byte-identical rebuilds. Sixteen focus regressions are included in the full suite. The workflow and permissions are unchanged; `node --test` discovers the new test file. [Source `0559eec`](https://github.com/Tabisharaza/detourlab/commit/0559eecbf8f4c50a01d4fc608abd2228adbd2f6b) passed [run 38069928417](https://github.com/Tabisharaza/detourlab/actions/runs/38069928417) on October 10, 2026 UTC. Both jobs completed every step successfully: Node 24.19.0/npm 11.17.0 (job 114265091722) and Node 24.21.0/npm 11.19.0 (job 114265091554), using Ubuntu 24.04 image 20261004.327.1. Each passed 357 tests, repeated 20 CLI tests, checked 39 JavaScript files and reproduced all 20 payloads plus manifest. Repeated tests are not additional unique tests. This evidence names that runtime commit; a later documentation-only commit requires its own CI verification. [Verification scope](VERIFICATION.md#dynamic-editor-focus-source-milestone) distinguishes handler/DOM stand-ins from native browser behavior and the v7 demo at the time of that source milestone.

## File-input milestone

The October 10, 2026 file-input source update passed local checks on Node 24.19.0 / npm 11.9.0: 38 syntax-checked JavaScript files, **341 tests** (110 newly added), all 20 separately repeated CLI gates, and **20 payload files plus the manifest** with a byte-identical second build. The existing workflow includes the new test files through `node --test`; workflow permissions, pins and steps are unchanged. [Source `e9285ee`](https://github.com/Tabisharaza/detourlab/commit/e9285ee6d8e47a753ffb6dccc580df9c8488cfd5) subsequently passed [hosted run 38055582446](https://github.com/Tabisharaza/detourlab/actions/runs/38055582446) on October 10, 2026 UTC. Both matrix jobs completed every step successfully: Node 24.19.0/npm 11.17.0 (job 114223232203) and Node 24.21.0/npm 11.19.0 (job 114223231815), on Ubuntu 24.04 image 20261004.327.1. Each passed all 341 tests, repeated the 20 existing CLI gates, verified all 20 payload files plus manifest and reproduced every build byte. These counts are per job; repeated tests are not additional unique tests. This evidence names the runtime commit and does not assert that subsequent documentation-only commits inherit its CI result. The [source verification record](VERIFICATION.md#file-input-source-milestone) separates this Node-based evidence from the v7 demo at the time of that source milestone and remaining browser QA.

## What the workflow does

The `verify` job runs on pushes, pull requests, and manual dispatch with one exact matrix entry: **24.22.1**, matching [`.node-version`](../.node-version). Older compatibility lanes were removed for the October 2026 security baseline. The job has a ten-minute timeout. A newer run for the same workflow/ref cancels the older run. It uses `ubuntu-24.04`, asserts the selected Node version before any npm installation, and records actual Node/npm versions in its logs.

1. `npm ci --ignore-scripts --no-audit --no-fund` checks the committed lockfile without running installation lifecycle scripts or contacting the npm audit service. The root lockfile contains only this project; no app dependencies are installed in this step.
2. `npm run check` syntax-checks JavaScript, runs the complete Node test suite, and builds `dist/`.
3. `node --test tests/cli.test.js tests/experiment-cli.test.js tests/cli-arguments.test.js tests/job-impact-cli.test.js tests/job-gates-cli.test.js tests/experiment-report-cli.test.js` explicitly repeats the CLI regression gates. Both runners must report success with exit `0`, threshold violations with exit `1` and usable result output, and invalid input with exit `2`. Experiment coverage also exercises every variant, exact threshold boundaries, canonical hashes, malformed/oversized inputs, and deterministic budget failures. The job-impact CLI repeats its diagnostic-output, selection, byte/label and budget checks; exit 0 there means a report was produced, not that thresholds passed.
4. `npm ci --prefix tools/schema-check --ignore-scripts --no-audit --no-fund` installs the separately locked optional validator/editor packages. `npm run verify --prefix tools/schema-check` syntax-checks its two files and runs the offline schema/language-service corpus. Installation needs the npm registry; the tests allow only local schema loading.
5. `node scripts/verify-dist.js` validates the built distribution. The job copies that first build to a temporary directory, rebuilds, and verifies the new tree against the copy.
6. `git diff --exit-code && git diff --cached --exit-code` checks that verification did not change tracked source in the clean checkout. Ignored build output is expected; this is not a general check for arbitrary untracked files.

The workflow only grants `contents: read`. Checkout does not persist credentials. It uses no repository secrets, write permissions, publishing steps, deployment environments, artifact uploads, dependency cache, or privileged pull-request trigger. The actions may use GitHub's short-lived, read-only job token for fetching source and Node. Running CI still executes the submitted code; the workflow is not a sandbox for safely running a malicious program on a personal machine.

## Verify a local checkout

Use Node 24.22.1 to match the current security and reproduction baseline. No version-manager installation is required by the project; use an existing toolchain or your normal trusted Node installation method. From the repository root:

```sh
node --version
npm --version
npm ci --ignore-scripts --no-audit --no-fund
npm run check
node --test tests/cli.test.js tests/experiment-cli.test.js tests/cli-arguments.test.js tests/job-impact-cli.test.js tests/job-gates-cli.test.js tests/experiment-report-cli.test.js
# Optional authoring-tool checks, required for schema/editor changes and hosted CI:
npm ci --prefix tools/schema-check --ignore-scripts --no-audit --no-fund
npm run verify --prefix tools/schema-check
node scripts/verify-dist.js
```

For the same byte-level rebuild comparison used in CI, run this in Bash after the commands above:

```sh
reference="$(mktemp -d "${TMPDIR:-/tmp}/detourlab-dist.XXXXXX")"
trap 'rm -rf "$reference"' EXIT
cp -R dist/. "$reference/"
npm run build
node scripts/verify-dist.js dist "$reference"
```

The verifier accepts `[distribution-directory] [reference-directory]`. No arguments means this checkout's `dist/`. It exits `0` for success, `1` for failed verification, and `2` for an invalid invocation. It only reads the provided trees and checked-out release source. Building replaces `dist/`; keep personal files outside that generated directory.

For targeted verifier tests:

```sh
node --test tests/release.test.js
```

## What a passing distribution check proves

[`scripts/verify-dist.js`](../scripts/verify-dist.js) uses only Node built-ins. Its reviewed `RELEASE_FILES` allowlist is independent of both the build script and the generated manifest. The current source has **26 payload files**, plus `manifest.json`, including the shared browser-impact and review modules. Historical CI records above retain their original counts.

- The actual tree contains exactly the allowed files and directories. Additional files, hidden configuration, private examples, unexpected empty directories, non-regular entries, and symbolic links fail verification.
- The manifest is version `1`, has only `version` and `files`, and lists exactly the payload files with lowercase SHA-256 hashes.
- Every hash matches the corresponding actual file bytes.
- Every payload file is byte-identical to its checked-out source. This includes nonempty `LICENSE` and `THIRD_PARTY_NOTICES.md`, so rehashing an altered notice does not make the check pass.
- When a reference build is supplied, both trees are independently verified and every file is compared byte-for-byte, including `manifest.json`. Comparing manifest strings or hashes alone would not establish this.

When intentionally adding or removing a public asset, review its contents and update `RELEASE_FILES` in the same change. Do not replace the allowlist with a recursive acceptance rule just to make the test green. The verifier's regression tests deliberately include corrupt bytes, changed-but-rehashed licenses, omitted files, private/config file additions, path-shaped manifest keys, symlinks, invalid schemas, and equivalent-but-byte-different manifest serialization.

## What a passing check does not prove

- It does not attest that a deployed site serves these bytes. The manifest is unsigned; a source checkout, verifier, and manifest changed together are not an independent provenance guarantee.
- It does not scan for credentials or personal data embedded inside allowed files, audit repository history, or approve the contents of newly allowed assets. Human review and an appropriate secret scan remain release responsibilities.
- Two builds in one environment demonstrate repeatability for that source and toolchain. They do not prove reproducibility across every OS, Node version, filesystem, locale, or future runner image. Filesystem metadata and archive timestamps are not compared.
- The Node tests include UI and worker harnesses, but this job does not launch a real browser. Visual layout, keyboard/screen-reader behavior, actual browser workers, import/export interactions, and static-host headers need separate browser verification.
- It makes no performance guarantee, optimal-routing claim, operational safety judgment, or validation against real traffic. Benchmark timing is deliberately not a pass/fail gate on shared CI hardware.
- It does not create a release, configure branch protection, publish a package, upload a distribution, or deploy a site.

## Pins and maintenance

### Actions

The following upstream release pages, full commit links, README instructions, and exact-commit action definitions were inspected on **2026-10-09**. The workflow uses full commit IDs; the version comments are explanatory labels.

| Action | Release | Pinned commit |
| --- | --- | --- |
| `actions/checkout` | [v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) | [`3d3c42e5aac5ba805825da76410c181273ba90b1`](https://github.com/actions/checkout/commit/3d3c42e5aac5ba805825da76410c181273ba90b1) |
| `actions/setup-node` | [v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0) | [`949feb2413d6458794dcd2491c4babbbce0c15c1`](https://github.com/actions/setup-node/commit/949feb2413d6458794dcd2491c4babbbce0c15c1) |

Both exact action definitions declare a Node 24 action runtime: [checkout source](https://github.com/actions/checkout/blob/3d3c42e5aac5ba805825da76410c181273ba90b1/action.yml), [setup-node source](https://github.com/actions/setup-node/blob/949feb2413d6458794dcd2491c4babbbce0c15c1/action.yml). The action runtime is separate from the project's selected Node version.

The upstream [checkout README](https://github.com/actions/checkout/blob/3d3c42e5aac5ba805825da76410c181273ba90b1/README.md) and [setup-node README](https://github.com/actions/setup-node/blob/949feb2413d6458794dcd2491c4babbbce0c15c1/README.md) document the Node 24 runner requirement: Actions Runner **2.327.1 or newer**. No container action is used here. Setup-node supports `.node-version`, explicit Node releases, and disabling automatic package-manager caching.

Before changing a pin, inspect the official release and full commit, review relevant release notes and action inputs/runtime, update the workflow's SHA and version comment, and rerun local checks. A maintainer must then inspect the remote run for that exact source commit. Do not copy an unverified short hash or assume a movable major tag is immutable.

### Node and runner

- `package.json` and the lockfile declare **`>=24.2.0`**. The release verifier uses `import.meta.main`, added in 24.2.0 according to the [versioned Node documentation](https://nodejs.org/download/release/v24.21.0/docs/api/esm.html#importmetamain) and [24.2.0 release notes](https://nodejs.org/en/blog/release/v24.2.0). This is a source-derived API floor, not evidence of a test run on 24.2.0. It corrects the earlier overly broad `>=24` declaration. The browser application and routing engine are unchanged.
- `.node-version` and the sole CI matrix entry pin **24.22.1**. Its [official release page](https://nodejs.org/en/blog/release/v24.22.1) and [security announcement](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) were checked on 2026-10-23. This is a current recommended baseline, not a promise that this patch remains current forever. The prior 24.19.0/24.21.0 test records remain historical; do not use those unpatched versions for networked installs or builds.
- Review Node 24 updates and security releases before public release and as part of routine maintenance. Update `.node-version` and the exact matrix entry together in a small reviewed change, use that version locally, run the entire verification sequence, and inspect the resulting remote CI run. Add compatibility lanes only on patched releases. `package.json`'s `>=24.2.0` range is compatibility intent, not evidence that every newer Node release has been tested.
- CI uses the npm bundled with the selected official Node distribution; the workflow does not separately upgrade it. Historical local runs reported npm 11.9.0, which differed from the stock distribution. Record the real Node and npm versions for every run rather than assuming the local and hosted toolchains are identical.
- `ubuntu-24.04` is an explicit OS family, **not an immutable machine image**. GitHub refreshes it. The [hosted runner documentation](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) lists this supported x64 label. The [Ubuntu 24.04 image inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md), inspected on 2026-10-09, listed image `20261004.327.1` and cached Node `24.21.0`; setup-node can download the exact requested release when it is absent from that cache. The inventory also announced a future `ubuntu-latest` change, which is why this workflow does not rely on that moving OS alias.
- Keep the runner's image version and actual Node/npm versions from the first successful remote run with the release evidence. Changing runner labels or adding more platforms should be an explicit, tested change. This workflow does not claim Windows, macOS, or self-hosted runner verification.

## Checklist for subsequent source changes

The [initial publication record](PUBLICATION.md) closes the first remote-run gate. For each later source revision:

1. Confirm the intended commit, workflow file, and action pins are present in the repository.
2. Inspect the CI run for **every configured matrix version** on that exact new commit (currently Node 24.22.1 only). Record its URL, commit, runner image, Node/npm versions, and all step outcomes. A previous green run is not evidence for a changed commit; report a new run as pending until all configured jobs succeed.
3. Investigate startup/permission failures separately from failing project checks. Do not add secrets, write permissions, or privileged triggers to make ordinary verification work.
4. Review the browser and release evidence before publishing a changed build, and retain the existing alpha's documented QA gaps until they are actually tested. Enabling required checks or deployment is a separate maintainer decision.
