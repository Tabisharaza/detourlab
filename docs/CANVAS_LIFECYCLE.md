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
