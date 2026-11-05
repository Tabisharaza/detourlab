# Canvas lifecycle reliability

A paused disruption comparison should survive a layout change without losing
its roads, vehicle positions or click targets. This milestone advances the
remaining native-resize work in [issue #3](https://github.com/Tabisharaza/detourlab/issues/3)
without adding a renderer, changing simulation results or making speed claims.

## Reproduce

Use Node 24.22.1 and an already installed Chromium browser:

```sh
node --test tests/map-render.test.js tests/canvas-lifecycle-check.test.js
node tools/canvas-lifecycle-check/run.js --browser /absolute/path/to/chromium --out /new/evidence-directory
```

The output directory must not exist. The harness starts only a loopback server
and fresh temporary browser profile, retains failure evidence and cleans owned
resources. It does not install software, use a personal profile or disable
browser security. `evidence.json` records source hashes and actual browser
identity; hashes identify bytes, not signed provenance.

## What the browser check establishes

The original seed-42 synthetic scenario is simulated once in Node and supplied
to two actual Canvas renderers: comparison and baseline. Native ResizeObserver
and Canvas methods remain unchanged. Instance wrappers count resize/build calls
while forwarding their original arguments and behavior.

- Initial native ResizeObserver delivery preserves an already painted canvas.
- Twenty explicitly invoked unchanged resize/render calls preserve pixels and
  skip painting. These calls are not claimed to be native observer deliveries.
- Native CSS narrow/wide transitions and two zero-size hide/show cycles recover.
- Emulated DPR transitions 1 → 1.5 → 2 → 3 → 1 preserve CSS geometry, respect the
  renderer's DPR-2 cap and update backing pixels. This is device emulation, not
  physical movement between monitors.
- Two isolated panes switch between side-by-side and stacked layouts. Existing
  [split-view checks](SPLIT_VIEW.md) separately exercise the application's controls.

Each visible checkpoint compares every RGBA byte, vehicle hit point, road
geometry and nearest-road query with a newly constructed renderer at the same
state and dimensions. References use the **same renderer implementation**, so
this is a lifecycle consistency test, not an independent rendering oracle.
Hidden canvases must have zero backing dimensions and no retained hit targets.
No noisy timing threshold or performance ratio is used.

## Context-loss handling: separate source evidence

The renderer now handles `contextlost` on either visible or cached background
Canvas. Once the event is handled it clears vehicle/road targets, clears hover,
invalidates the scene and suppresses painting until all lost layers restore.
This avoids publishing an apparently completed frame from ignored Canvas calls.
Restoration rebuilds cleared hit geometry even when state and dimensions did not
change. Loss/restoration does not alter the experiment or recompute simulation.

Recording Canvas stand-ins exercise each layer, unchanged-state recovery,
changes made while unavailable, repeated cycles, overlapping losses and both
restoration orders. Pointer movement and road/vehicle clicks cannot reuse old
targets after loss handling. Actual context loss is asynchronous; these claims
begin with event delivery, not an undetectable interval before it.

The browser harness **does not induce native GPU/Canvas context loss**. Synthetic
events and Node stand-ins cannot establish real driver/context recovery.
Historical before/after timings, full-app CPU/FPS, physical devices, cross-browser,
assistive technology and hosted deployment remain separate gates. Issue #3 is
not closed by this bounded milestone.

## Product context

The November 5 read of the requested [God's Eye View reference](https://github.com/bilawalsidhu/gods-eye-view)
reinforces the value of an inspectable interactive scene. DetourLab retains its
original synthetic logistics scope and keyless offline workflow. No reference
code, assets or live data were copied, and popularity is not evidence of demand
or a guarantee of adoption.

## Recorded source verification — November 5, 2026

[Source `fcdd349`](https://github.com/Tabisharaza/detourlab/commit/fcdd3493c40a3ec006c011f535fae9868bb83487)
passed [hosted CI run 41983389234](https://github.com/Tabisharaza/detourlab/actions/runs/41983389234).
The [raw lifecycle evidence](evidence/canvas-lifecycle-2026-11-05.json) is extracted
without field changes from the job's printed JSON and retains source hashes.
All **16 lifecycle checkpoints** passed, alongside the existing **69 browser
checkpoints** and **four render-profile cases**. These are separate from the
**1,240 core + 120 optional = 1,360 distinct Node tests**; the 211 CLI repetitions
overlap the core suite. The 31-file static release passed independent byte/hash,
allowlist and license checks, and a repeat build reproduced every byte.

Local Node and build checks passed. Local native Chromium could not start due to
an OS socket restriction, including a permitted escalation; browser evidence
comes from the hosted job, not that failed local launch. No browser security
flags were weakened. An additional read-only 60-cycle stand-in probe matched
fresh road/vehicle geometry after alternating context-loss events, but is not
included in either test count and is not native GPU-loss evidence.

Independent read-only review found no remaining must-fix issue. The public demo
has not been redeployed by this milestone; this is verified GitHub source.
