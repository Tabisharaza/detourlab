# Paused-scene redraw guard

This improvement addresses part of [issue #3](https://github.com/Tabisharaza/detourlab/issues/3). It avoids repeating visible Canvas drawing when the rendered state is unchanged. Source [`74e0356`](https://github.com/Tabisharaza/detourlab/commit/74e0356c1fe0d7cfac0c2520906496aaef7869c6) was deployed to the public demo as v5 on October 10, 2026 UTC. [Desktop interaction checks passed](VERIFICATION.md#v5-renderer-deployment-and-desktop-checks); browser rendering time and before/after profiling remain unmeasured.

## Two kinds of invalidation

- `NetworkMap.invalidate()` rebuilds cached scene geometry and repaints the visible frame. Scenario changes, closure edits, zoom, size and device-pixel-ratio changes need this path.
- `NetworkMap.invalidateFrame()` repaints overlays/vehicles while retaining the cached background. Result arrival/clearing, selected-vehicle and view changes use this path.
- `render()` also compares a fixed-size snapshot of scenario/state/result identities, zoom, dimensions, selected vehicle, view and replay time. That catches timeline scrubs, playback, and a rerun clearing results without requiring every caller to issue an invalidation.
- A successful paint records the snapshot. Skipped frames retain vehicle hit points; failed paints do not publish a completed frame signature.

The app replaces validated scenario and result objects. Future in-place changes must explicitly invalidate geometry or the visible frame. Deep hashing the graph on every frame would defeat this optimization. The guard does not alter routing, ledger interpolation, route visibility or job metrics.

Same-size ResizeObserver notifications no longer reset Canvas dimensions and erase its pixels. A real CSS-size, backing-size or device-pixel-ratio transition invalidates geometry. Context restoration invalidates the visible Canvas or the background as appropriate; see the [HTML Canvas standard](https://html.spec.whatwg.org/multipage/canvas.html).

The existing `requestAnimationFrame` loop remains active while paused. The guard stops drawing work, not every callback or all CPU use. Playback keeps painting when replay time changes; no universal speedup, frame-rate or battery-life claim follows.

## Reproduce deterministic operation counts

These are **Node Canvas stand-in counts**, not browser rasterization, elapsed rendering time, GPU measurements or frames per second. The stand-in runs the checked-in renderer and records Canvas API invocations. One warm-up paint is excluded, followed by 120 calls. Playing samples advance replay time by one second per call; paused samples keep time at 360 seconds. Both use comparison view, a 1000×700 CSS-pixel canvas and DPR 1.

```sh
node scripts/measure-render-counts.js
```

To compare the original public renderer with this source, use a trusted local checkout with the public history:

```sh
reference="$(mktemp "${TMPDIR:-/tmp}/detourlab-reference.XXXXXX.mjs")"
git show 97daa61291ec3dac2c8e4be4c68d1b68e6f89f4e:src/map.js > "$reference"
node scripts/measure-render-counts.js --reference-map "$reference"
rm "$reference"
```

The optional reference path executes local JavaScript. Use only a reviewed renderer revision, never an arbitrary downloaded file. A source ZIP has no Git history; obtain the verified public history separately if reproducing the comparison.

The [recorded counts](evidence/render-counts.json) were produced on October 10, 2026 UTC with Node 24.19.0 on Linux x64. The record contains each renderer's source SHA-256. No browser or device rendering time was measured.

| Synthetic fixture | Nodes / directed edges / vehicles / jobs | Paused visible clears, before → after | Playing visible clears, before → after |
| --- | --- | --- | --- |
| Meridian seed 42 | 432 / 1614 / 24 / 192 | 120 → 0 | 120 → 120 |
| Render grid 40×40 | 1600 / 6240 / 48 / 384 | 120 → 0 | 120 → 120 |

Visible drawing operations during unchanged paused samples fell from 169,200 to 0 for Meridian and 299,760 to 0 for the larger grid. Playing operation counts were unchanged: 168,428 and 299,822 respectively. These counts exclude the warm-up background build and count each recorded Canvas API invocation equally; they are not weighted estimates of rendering cost. The larger grid is a bounded synthetic fixture, not a claim that all maximum-size imports perform well.

## Regression coverage and remaining work

`tests/map-render.test.js` exercises the actual renderer with Canvas/DOM stand-ins. `tests/app-render.test.js` connects the actual app event handlers, its frame loop and actual renderer to synthetic DOM/Worker/Canvas stand-ins. They cover idle skips, changed times, backward seeks/replay, active playback, result arrival/clear/Cancel, variant/vehicle/view changes, zoom/resize, closure changes, import/Reset, stale imports and hit positions. `tests/render-counts.test.js` checks both fixture count reports.

These tests do not establish pixel correctness, native file-chooser behavior, real ResizeObserver delivery, actual context-loss recovery, browser main-thread time or accessibility. The public v5 desktop smoke pass exercised the controls listed in [VERIFICATION.md](VERIFICATION.md#v5-renderer-deployment-and-desktop-checks). Issue #3 remains open for named-browser/device before-and-after timings, viewport/warm-up/sample details and wider real-browser rendering checks, including native resize/context-loss behavior. The broader [known QA gaps](VERIFICATION.md#known-gaps) also remain open.
