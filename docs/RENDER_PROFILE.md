# Native Canvas render-call profiling

This optional, dependency-free harness advances the measurement portion of
[issue #3](https://github.com/Tabisharaza/detourlab/issues/3). It does not close
that issue or replace the [historical operation counts](RENDERING.md).

```sh
node tools/render-profile/run.js --browser /absolute/path/to/google-chrome \
  --out /tmp/detourlab-render-profile-new
```

Use the pinned development Node version and an already-installed Chromium.
The output directory must not exist. Nothing installs a browser, changes its
security flags, opens a personal profile or connects to a public site. The
existing bounded CDP pipe driver launches a fresh headless profile, and the
server listens on loopback only. A dedicated exact HTML route hosts canvases;
ordinary preview file access rules are unchanged. No application assets change.

## What is compared

Both lanes execute **the same current `NetworkMap` implementation**. The
`guarded` lane uses its ordinary redraw guard. The `forced` lane explicitly calls
`invalidateFrame()` before every render, retaining cached scene geometry but
forcing the visible frame to redraw. This is an **ablation/control**, not the
historical renderer, historical before/after benchmark or a deployed-app test.

Two existing original fixtures are used unchanged: Meridian seed 42 (432 nodes,
1,614 directed edges, 24 vehicles, 192 jobs), and the synthetic 40×40 grid
(1,600 nodes, 6,240 directed edges, 48 vehicles, 384 jobs). Node computes their
actual baseline/disrupted ledgers before browser timing. Both lanes receive
identical cloned state. No private or real-city data is involved.

Each fixture has separate paused and playing pages with two native 1000×700
CSS-pixel canvases at DPR 1, comparison view and its first selected vehicle.
The viewport is 1280×1600. The application and its continuous RAF loop are not
loaded. Initial ResizeObserver delivery settles over two animation callbacks;
this is setup, not native-resize certification.

Each mode runs six batches of 60 render calls per lane. Guarded runs first in
even-numbered batches, forced first in odd-numbered batches. Each lane has
12 excluded warmup calls and one excluded forced starting paint at 360 seconds
before every timed batch. Paused calls retain 360 seconds; playing calls advance
one second each to 420 seconds, identically in both lanes. These are deterministic
replay samples, not real-time playback or 60 Hz frame scheduling.

## Timing and correctness are different

`performance.now()` brackets only the synchronous batch loop, including its
state updates, optional invalidation, render calls and paint-count bookkeeping.
It measures renderer-call elapsed time with native Canvas API submission, **not**
completed GPU raster time, total browser main-thread work, FPS, battery use or
full-application performance. Off-thread work and browser scheduling can affect
observations. Headless hosted CPUs are not representative user devices; no
hardware-acceleration assumption is made. Timer-resolution zeros are retained.

Evidence preserves every raw batch, alternating order and descriptive min,
median, max and mean-per-call durations. There is **no timing/speed threshold**.
Expected paint counts are mandatory: paused guarded is zero per batch; paused
forced and both playing lanes each paint 60 times. A mismatch fails the run.

After **all** timed batches for a mode, exact RGBA readbacks and vehicle hit
points must match between lanes; the image must contain nontransparent pixels.
Readbacks are excluded from timing and occur only after that page's timing has
finished, avoiding their effect on later Canvas backend selection. This checks
the final paused/playing state, not every intermediate frame, human visual
quality or accessibility. Each mode gets a new page; old observers and canvases
are discarded when its target closes.

## Evidence and failure behavior

`evidence.json` contains observed browser/OS/Node versions, CPU model and logical
CPU count, viewport/protocol settings, fixture dimensions, complete input-state
hashes, source-file hashes, raw samples, parity results and summaries. A Git
checkout revision is included when available; source ZIPs use null. Hashes
identify bytes, not authorship or signed provenance.

An unavailable browser, wrong geometry, protocol timeout, malformed/incomplete
measurement, pixel/hit-point mismatch or cleanup failure exits 1. After output
creation, failures retain partial evidence marked failed when writable. Existing
evidence is never overwritten; failed output creation cannot leave a success
record. Cleanup closes only the owned browser/server/profile. Source tests do
not establish that a native browser measurement has run: actual CI evidence and
its exact revision must be reported separately.

Run focused non-browser tests with:

```sh
node --test tests/render-profile.test.js tests/browser-check.test.js
```

## First measured run — October 31, 2026

[Exact-source CI 41178417908](https://github.com/Tabisharaza/detourlab/actions/runs/41178417908)
passed on [`70f1e63`](https://github.com/Tabisharaza/detourlab/commit/70f1e63c846a20f897069648ce49e29d17085bff).
The [complete evidence](evidence/render-profile-2026-10-31.json) is reconstructed
without field changes from the job's printed evidence JSON. It records Headless
Chrome **156.0.8078.47**, Node **24.22.1**, Linux x64 kernel **7.0.0-1017-azure**,
CPU model **AMD EPYC 7763 64-Core Processor**, **4 visible logical CPUs**, and the
viewport/protocol above. The runner image is Ubuntu 24.04. Hardware acceleration
is not established.

Median elapsed milliseconds per **60-call batch**, rounded here to two decimals;
raw values, including timer-resolution zeros, remain in the evidence:

| Fixture / mode | Guarded | Forced redraw | Guarded / forced paints across 360 calls |
| --- | ---: | ---: | ---: |
| Meridian / paused | 0.05 | 20.35 | 0 / 360 |
| Meridian / playing | 13.10 | 12.90 | 360 / 360 |
| 40×40 grid / paused | 0.00 | 28.25 | 0 / 360 |
| 40×40 grid / playing | 27.75 | 26.30 | 360 / 360 |

All four final pixel/hit-point comparisons passed. A rounded zero is not zero
cost. Playing samples remain variable and do not show a general speedup; the
guard's intended work elimination is only for unchanged paused scenes. These
are synchronous call-loop observations on one hosted runtime, not historical
before/after, GPU, FPS, battery or user-device measurements.

The same CI passed **1,090 core + 120 optional = 1,210 distinct Node tests**,
**211 overlapping CLI repetitions**, byte-identical rebuild, unchanged tracked
source, and the separate **21-checkpoint browser integration suite**. Local
checks passed the same Node totals and unchanged 28 static payloads plus manifest.
Independent review found no remaining must-fix issue. Node tests, the 21 browser
checkpoints and these four profile cases are separate counts, not summed tests.
No public demo assets changed.

## Still open

Native resize/context-loss recovery, wider device/browser visual checks,
historical renderer timings, full-app profiling and remaining issue #3
acceptance are separate. Do not turn one measurement into a universal speedup,
a rendering-quality certification or an assertion that the hosted demo changed.
