# CI and release verification

## Status

For the deployed v5 renderer source [`74e0356`](https://github.com/Tabisharaza/detourlab/commit/74e0356c1fe0d7cfac0c2520906496aaef7869c6), [run 38030451835](https://github.com/Tabisharaza/detourlab/actions/runs/38030451835) succeeded on **2026-10-10 UTC**. Both matrix jobs passed **194 tests**, separately repeated the **20 CLI gates**, and verified **17 payload files plus the manifest** and byte-identical second builds. Actual toolchains were Node 24.19.0/npm 11.17.0 and Node 24.21.0/npm 11.19.0 on Ubuntu 24.04 image 20261004.327.1. Every job step succeeded. [The v5 browser/deployment record](VERIFICATION.md#v5-renderer-deployment-and-desktop-checks) covers separate evidence and limitations. This record is tied to that runtime commit, not an assertion about every later documentation commit.

### Initial release history

The workflow in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) **passed for the initial public source release** [`6410b0a`](https://github.com/Tabisharaza/detourlab/commit/6410b0acdf4ea8ecd7f54f64c28d7c579d21b9da). [Run 37995893928](https://github.com/Tabisharaza/detourlab/actions/runs/37995893928) completed successfully on **2026-10-09 UTC**. Both jobs passed all **173 tests**, repeated the **20 CLI gates**, and verified **17 distribution payload files plus the manifest** with byte-identical second builds. The repeated CLI gates are part of the full suite, not 20 additional unique tests. See the [publication record](PUBLICATION.md) for exact jobs, toolchains and archive-to-commit mapping.

Local verification on **2026-10-09** used Node **24.19.0**, npm **11.9.0**, and Linux. The commands below passed locally: lockfile validation, all **173 tests** in the full check, the **20 dedicated CLI gates**, and two-build distribution verification. Node **24.21.0 was not exercised locally** in that pre-publication pass. The later hosted run used **24.19.0 / npm 11.17.0** and **24.21.0 / npm 11.19.0** on Ubuntu 24.04 image **20261004.327.1**; every job step succeeded. That establishes this push workflow's execution for that commit, not a test of fork approval behavior, pull-request events or every environment. The earlier source bundle correctly described CI as pending at the time it was prepared.

## What the workflow does

The `verify` job runs on pushes, pull requests, and manual dispatch with an explicit two-version matrix: **24.19.0** (the locally tested baseline recorded in [`.node-version`](../.node-version)) and **24.21.0** (the current official Node 24 LTS release when checked on 2026-10-09). The second version is additional compatibility coverage, not a runtime minimum or a condition for creating this alpha repository. Each job has a ten-minute timeout, at most two matrix jobs run in parallel, and one matrix failure does not cancel the other. A newer run for the same workflow/ref cancels the older run. Both use `ubuntu-24.04`, assert the selected Node version, and record Node/npm versions in their logs.

1. `npm ci --ignore-scripts --no-audit --no-fund` checks the committed lockfile without running installation lifecycle scripts or contacting the npm audit service. The current lockfile contains only this project: there are no third-party packages to install.
2. `npm run check` syntax-checks JavaScript, runs the complete Node test suite, and builds `dist/`.
3. `node --test tests/cli.test.js tests/experiment-cli.test.js` explicitly repeats the CLI regression gates. Both runners must report success with exit `0`, threshold violations with exit `1` and usable result output, and invalid input with exit `2`. Experiment coverage also exercises every variant, exact threshold boundaries, canonical hashes, malformed/oversized inputs, and deterministic budget failures.
4. `node scripts/verify-dist.js` validates the built distribution. The job copies that first build to a temporary directory, rebuilds, and verifies the new tree against the copy.
5. `git diff --exit-code && git diff --cached --exit-code` checks that verification did not change tracked source in the clean checkout. Ignored build output is expected; this is not a general check for arbitrary untracked files.

The workflow only grants `contents: read`. Checkout does not persist credentials. It uses no repository secrets, write permissions, publishing steps, deployment environments, artifact uploads, dependency cache, or privileged pull-request trigger. The actions may use GitHub's short-lived, read-only job token for fetching source and Node. Running CI still executes the submitted code; the workflow is not a sandbox for safely running a malicious program on a personal machine.

## Verify a local checkout

Use Node 24.19.0 to match the recorded baseline. No version-manager installation is required by the project; use an existing toolchain or your normal trusted Node installation method. From the repository root:

```sh
node --version
npm --version
npm ci --ignore-scripts --no-audit --no-fund
npm run check
node --test tests/cli.test.js tests/experiment-cli.test.js
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

[`scripts/verify-dist.js`](../scripts/verify-dist.js) uses only Node built-ins. Its reviewed `RELEASE_FILES` allowlist is independent of both the build script and the generated manifest. The current release has **17 payload files**, plus `manifest.json`.

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
- `.node-version` pins **24.19.0**, the locally verified baseline, rather than silently selecting the latest available patch. Its [official Node release page](https://nodejs.org/en/blog/release/v24.19.0) was checked on 2026-10-09. This is **not a claim that 24.19.0 is the newest or a permanently recommended security baseline**.
- The second CI matrix entry pins **24.21.0**. Its [official release page](https://nodejs.org/en/blog/release/v24.21.0), the [Node 24 archive](https://nodejs.org/en/download/archive/v24) and the [release index](https://nodejs.org/dist/index.json) were rechecked on 2026-10-09 and establish that it is an existing, current Node 24 LTS release. The initial public source release subsequently passed this matrix job in [run 37995893928](https://github.com/Tabisharaza/detourlab/actions/runs/37995893928). This is verified coverage of that commit, not every later change; 24.21.0 is not required to run the project. Recheck official releases later rather than assuming it remains current.
- Review Node 24 updates and security releases before public release and as part of routine maintenance. Update the exact matrix entry in a small reviewed change, use that version locally when available, run the entire verification sequence, and inspect the resulting remote CI run. If promoting a new reproduction baseline, update both `.node-version` and the baseline matrix entry together. Prioritize security fixes. `package.json`'s `>=24.2.0` range is compatibility intent, not evidence that every newer Node release has been tested.
- CI uses the npm bundled with the selected official Node distribution; the workflow does not separately upgrade it. The actual local environment reported npm 11.9.0, which can differ from the stock distribution. Record the real Node and npm versions for every run rather than assuming the local and hosted toolchains are identical.
- `ubuntu-24.04` is an explicit OS family, **not an immutable machine image**. GitHub refreshes it. The [hosted runner documentation](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) lists this supported x64 label. The [Ubuntu 24.04 image inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md), inspected on 2026-10-09, listed image `20261004.327.1` and cached Node `24.21.0`; setup-node can download the exact requested release when it is absent from that cache. The inventory also announced a future `ubuntu-latest` change, which is why this workflow does not rely on that moving OS alias.
- Keep the runner's image version and actual Node/npm versions from the first successful remote run with the release evidence. Changing runner labels or adding more platforms should be an explicit, tested change. This workflow does not claim Windows, macOS, or self-hosted runner verification.

## Checklist for subsequent source changes

The [initial publication record](PUBLICATION.md) closes the first remote-run gate. For each later source revision:

1. Confirm the intended commit, workflow file, and action pins are present in the repository.
2. Inspect the CI run for **both matrix versions** on that exact new commit. Record its URL, commit, runner image, Node/npm versions, and all step outcomes. A previous green run is not evidence for a changed commit; report a new run as pending until both jobs succeed.
3. Investigate startup/permission failures separately from failing project checks. Do not add secrets, write permissions, or privileged triggers to make ordinary verification work.
4. Review the browser and release evidence before publishing a changed build, and retain the existing alpha's documented QA gaps until they are actually tested. Enabling required checks or deployment is a separate maintainer decision.
