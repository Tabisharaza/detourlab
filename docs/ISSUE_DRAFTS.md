# Useful issue drafts

These scopes were prepared before publication. Selected work is now public:

- [#1: Tiny multi-variant experiment walkthrough](https://github.com/Tabisharaza/detourlab/issues/1), implemented in source `359570c` with fixture, documented fingerprint and exact ledger regressions; its original documentation scope is separate from the added optional browser lesson
- [#2: Real desktop-browser import/export roundtrips](https://github.com/Tabisharaza/detourlab/issues/2), a bounded subset of scope 1 below
- [#3: Profile and avoid redraws of unchanged paused scenes](https://github.com/Tabisharaza/detourlab/issues/3), based on scope 4 below

The numbered headings below are draft scope numbers, not GitHub issue numbers. Scope 3 is implemented as documented below; scope 2 has a deployed implementation with accessibility acceptance still open. Other unimplemented scopes remain proposals. None implies an assignment or delivery commitment. Use each public issue's own acceptance criteria when contributing.

## 1. Exercise file roundtrips and interruptions in a real browser

**Problem:** Current source tests cover bounded JSON, export parity and asynchronous state ordering. The browser-native file chooser/download path and mobile/reduced-motion matrix remain unverified.

**Suggested scope:** A separate browser-test job or documented repeatable harness using only synthetic local fixtures and the static preview. Keep browser-test tooling optional for ordinary `npm start` users.

**Acceptance:**

- Export 2 and 6 variants, reimport, and reproduce all CLI hashes/metrics.
- Cancel a chooser; import malformed, oversized and hostile-label JSON without replacing the current valid experiment.
- Start an import, then Reset or import a newer file; the later action wins.
- Rapidly edit a cutoff, Cancel, rerun and change variants; no stale results reappear.
- Exercise narrow/wide viewports, keyboard-only controls and reduced-motion preference.
- Record actual browser versions and artifacts. Do not substitute mocked state tests for these checks.

**Non-goals:** Adding accounts, uploads, production datasets or remote data services.

## 2. Make the road picker searchable and accessible

**Status:** Search/filter and saved-schedule context are implemented in the
[v9 road picker](ROAD_PICKER.md), with bounded desktop Chromium observations.
A run-lifecycle focus issue found during review is corrected and deployed in
v10. Native cancellation/completion retests passed; public GitHub source mapping
and exact-commit CI remain pending. Screen-reader and
broader accessibility evidence remain open, so the original acceptance scope
below is not fully complete.

**Problem:** The default scene has 807 undirected road pairs in one native select. Searching by road/junction is cumbersome, and the map is not a complete assistive-technology interface.

**Suggested scope:** An accessible search/filter over existing road choices, with explicit from/to direction and closure status. Preserve the existing keyboard-operable path while evaluating alternatives.

**Acceptance:**

- Find a road by name or node ID without pointer interaction.
- Announce selected road, direction, cutoff and affected variant.
- Keep focus predictable after an event edit/removal or a variant switch.
- Verify one-way roads, duplicate road names and hostile display labels.
- Include screen-reader and keyboard evidence, without changing routing results.

**Non-goals:** A new map provider or changes to graph semantics.

## 3. Publish formal scenario and experiment JSON Schemas

**Status:** Implemented on October 14, 2026: [two versioned schemas, scoped editor associations and an optional structural/language-service checker](JSON_SCHEMAS.md). Native editor-window verification is not claimed. The original scope and acceptance criteria remain below for context.

**Original problem:** Runtime validation is strict, but editors could not offer schema-backed completion or early diagnostics.

**Suggested scope:** Versioned schemas for scenario v1 and experiment v1, paired with documentation and parity tests. Keep runtime validation authoritative for procedural checks that JSON Schema cannot express.

**Acceptance:**

- Validate every checked-in fixture and reject unknown fields, missing required fields, numeric violations and variant-count errors.
- Explain which foreign-key, aggregate-byte/workload and safe-record checks remain runtime-only.
- Check parity on a shared set of valid/invalid serialized fixtures.
- Keep old single-scenario import behavior explicit.
- Pin any optional schema-test tooling and retain dependency-free app startup.

**Non-goals:** A breaking format redesign or claims that schema validation replaces runtime safety checks.

## 4. Stop redrawing unchanged paused scenes

**Original problem:** `app.js` requests frames continuously and the initial `map.js` repainted unchanged paused scenes. A [source redraw guard and deterministic counts](RENDERING.md) now address the redundant paints. The v5 demo passed bounded desktop interaction checks; named-browser/device CPU, raster/FPS and larger-fixture evidence remains pending, so issue #3 stays open.

**Suggested scope:** Measure first, then invalidate/draw only when playback, selection, geometry, closures, viewport or relevant UI state changes. Preserve the same ledger-driven positions and screenshot semantics.

**Acceptance:**

- Publish before/after measurements with browser, device, fixture and method.
- A paused unchanged scene does not continuously repaint.
- Resize, zoom, variant changes, cutoff edits, restart and resume still update immediately.
- Run a representative near-budget synthetic fixture without claiming unmeasured universal frame rates.
- Keep rendered vehicle positions equal to the existing timestamp interpolation contract.

**Non-goals:** Replacing Canvas or silently reducing correctness to hit a benchmark.

## 5. Expand cross-runtime routing evidence

**Problem:** The engine has independent Node oracles and tested browser examples, but broad cross-browser/platform ledger equivalence is not yet established.

**Suggested scope:** A small canonical corpus of directed, disconnected, fractional-cutoff and equal-cost scenarios, executed through the actual Worker and Node runners.

**Acceptance:**

- Compare exact job statuses, edge-entry legality, distances, finish times and canonical input hashes.
- Include same-time closures, already-entered edges, service-boundary events and unreachable continuation.
- Name the browser/OS/Node versions used and capture any numeric tolerance policy explicitly.
- A mismatch produces the smallest failing synthetic scenario and expected/actual ledgers.

**Non-goals:** Real traffic validation, new solvers or accepting nondeterminism without explaining it.
