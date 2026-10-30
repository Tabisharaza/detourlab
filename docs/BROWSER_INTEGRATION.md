# Repeatable real-browser file and Worker checks

The optional `tools/browser-check` harness runs the **actual browser application**
over the production loopback preview handler, injects original synthetic files,
waits for native module Workers, captures real app downloads, and reruns those
files with the existing Node experiment CLI. It addresses the automated portion
of [issue #2](https://github.com/Tabisharaza/detourlab/issues/2), not its native
file-chooser acceptance gate.

## Run it

Use the pinned Node release and an already installed Chromium-compatible browser:

```sh
npm run check
node tools/browser-check/run.js \
  --browser /usr/bin/google-chrome \
  --out ./new-browser-evidence
```

Replace the absolute executable path for your machine. `--out` must name a new
directory with an existing parent. The command refuses to overwrite previous
evidence. It installs nothing and needs no npm package, API key or account.
Core `npm run check`, app startup and the distributed app do not require a
browser. Repository CI separately runs the harness against its existing Chrome
installation and prints `evidence.json`, including on test failure.

The harness creates and removes its own temporary browser profile; it never
attaches to a running browser or reads a normal user profile. Chrome DevTools
Protocol uses inherited pipes, not a listening debugging port. The preview
listens only on `127.0.0.1` with an ephemeral port. No external URL is accepted,
no sandbox-disabling flag is provided, and the browser receives only synthetic
local fixtures. Chromium background services are disabled where supported; this
is not a claim of an OS-level network sandbox. If your environment cannot start
a sandboxed browser or bind loopback, the check fails instead of silently skipping
or changing security settings. Use an appropriate authorized test environment.

## What it checks

- **Two and six variants:** actual file-input change events, complete native
  Worker ledgers equal to Node, original variant IDs/order and populated cards.
  The six-plan fixture includes exact/fractional closure boundaries, simultaneous
  closures, disconnection and unreachable continuation.
- **Real downloads:** activate the app's unchanged export handler; wait for
  browser download completion; read that downloaded file; compare canonical
  input fingerprints and the entire CLI JSON (baseline, variant metrics,
  identities, deltas and policy status). Reimport the downloaded file, export
  again, and require byte-identical output. Select the same file path again and
  require a new completed run.
- **Rejection without replacement:** malformed JSON, malformed UTF-8, over-2-MiB
  files and a BOM that pushes input over the byte limit. Each rejected input
  must leave the last valid experiment exportable with the same CLI outcomes.
- **Accepted boundaries and display:** BOM-containing valid JSON exactly at
  2 MiB; literal U+FFFD; schema-valid HTML-like experiment/variant/road labels
  rendered as text rather than injected elements.
- **Interrupted reads:** pause one real selected file's `arrayBuffer` promise,
  complete Reset or a newer import, release the older read, and require that
  the newer state and exported bytes remain unchanged.
- **Cancel/rerun:** start and cancel in the same browser task before the native
  Worker can return; require cleared result presentation, then rerun and compare
  the restored complete native ledger and downloaded input.

An observer subclasses native `Worker` only to record requests and response
messages. It delegates construction and `postMessage` to the real implementation;
results are not mocked. The delayed-read test restores `File.prototype.arrayBuffer`
after intercepting one call and lets its actual bytes resolve later. This seam
is documented because it controls ordering rather than measuring real disk
latency. No application source or Worker implementation is modified.

## Evidence and interpretation

`evidence.json` records passed checkpoints, overall passed/failed status, actual
browser/Node/OS versions, viewport, source-file hashes, fixture/download hashes,
and limitations. The output directory retains original fixtures and actual
browser downloads. After output creation, a failed run retains partial evidence marked **failed**
when that directory remains writable; setup or disk-write failures can leave no report.
only exit 0 plus overall `passed` establishes a full run. A missing browser is
not a pass. Source hashes and a recorded checkout revision identify evidence,
not signed provenance. Run from a trusted checkout; this test runner is not a
sandbox for arbitrary repository code.

The core suite separately tests pipe framing, command and frame bounds,
protocol errors, timeouts, cleanup-facing failure behavior, isolation arguments
and fixture expectations. These Node tests are **not** browser-integration
results. The browser harness has no npm dependencies or automatic downloads.
The current hosted runner browser is not pinned by the project; record the
version from every run rather than extrapolating to other versions.

## Explicitly still unverified

CDP `DOM.setFileInputFiles` is automated file injection. It does **not** establish
that a person can open or cancel an OS picker, navigate folders, grant a native
file permission, or interact with browser download UI. The empty native-picker
cancel flow is not simulated and called a pass. Issue #2 remains open for those
checks in an appropriate desktop environment. Cross-browser/platform, mobile,
assistive technology, reduced-motion and rendering-performance acceptance are
also separate. This harness never changes or tests the hosted Sites deployment.

The first implementation's cloud-shell environment prevented native browser
startup (socket creation was restricted). Its ordinary escalation setup also
failed before execution; security controls were not weakened. Local core tests
and source review are recorded separately from any later exact-commit hosted
browser run. Do not infer a browser pass from a successful build alone.

## Design references

The scope favors reproducible local evidence over adding live feeds. Current
[God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) distinguishes live,
simulated and estimated spatial evidence; no code, data or imagery was imported.
The harness is original DetourLab test code using the official
[Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/),
including [file-input injection](https://chromedevtools.github.io/devtools-protocol/tot/DOM/#method-setFileInputFiles)
and [download events](https://chromedevtools.github.io/devtools-protocol/tot/Browser/#event-downloadProgress).
Chrome recommends isolating debugging from real profiles in its
[remote-debugging guidance](https://developer.chrome.com/blog/remote-debugging-port).
