# Browser closure-time study

**Compare closure times** opens a temporary, non-destructive study. It does not
replace the workspace's variants, select a winner, or change the engine. Its
source is the saved workspace values; un-applied text fields are preserved but
not included. Study time and policy fields are read when Run is clicked. It is
available after the workspace run finishes or is canceled, when at least one
variant has an existing closure. The source implementation is not a claim that
the hosted demo has been updated.

## Try the one-second boundary

1. Open **Try a tiny example**, then choose **Close at 10 s**.
2. Select **Compare closure times**. The source variant is selected, but can be
   changed inside the study without changing the workspace selection.
3. Choose `bc-closure` and enter `10, 11` in the seconds field.
4. Optionally expand **Optional acceptance limits** and set maximum extra late
   deliveries and maximum unreachable deliveries to `0`. Blank limits are not
   evaluated; zero is a real limit.
5. Run the sampled comparison. The 10-second sample travels 260 m and is late;
   the 11-second sample travels 200 m and is on time. Both complete one delivery.
   The first fails those supplied limits; the second passes them.
6. Close to discard the study, or explicitly download the sampled experiment.
   The workspace and its unsaved name/search fields remain unchanged.

These are permanent **closure start times**, not reopening times. A vehicle
already on an edge when it closes finishes that edge. The 11-second result is a
passing sample, not a best/earliest safe time or evidence about other times.

## What the table means

- One clear-road baseline is computed, then each sampled schedule, through the
  existing `simulation-worker.js` and `simulateExperiment` path.
- Rows are sorted by start time, not ranked. Each uses the source variant's
  exact other closure events, network, vehicles, demand and delivery order.
- Distance and lateness changes compare with **clear roads**, not the original
  source variant. Completed and unreachable work remain visible in every row.
- The five optional gates are the existing extra-distance percentage, extra
  late jobs, absolute unreachable jobs, newly late jobs, and maximum comparable
  arrival slip. Every supplied limit must pass. No limits means **Not evaluated**,
  never an implicit pass. Unlisted gates are not evaluated.
- A requested arrival-slip gate fails when there are no comparable arrivals.
  Unreachable work is not treated as zero delay. Lower distance/lateness with
  skipped work does not establish an equal-service improvement.
- Earlier overlapping closures can dominate the chosen closure. The sampled
  outcomes establish no optimality, continuous passing interval, monotonicity,
  real-world prediction or operational safety.

## State, limits and export

The study uses the shared pure `src/cutoff-experiment.js` authoring helper; the
original CLI script path re-exports it. `src/cutoff-comparison.js` validates and
projects completed results using existing result-copy and policy helpers. It
never routes again. The CLI delegates to this same projection and retains its
report shape, hashes and checked-in output bytes.

Only 2–6 distinct times from 0 to 604800 seconds are accepted. Fractional seconds
are preserved. The same 2 MiB experiment, aggregate closure/reference, engine
work and 500,000-result-segment limits apply; the study's Worker is stopped after
30 seconds. Invalid requests start no Worker. No partial results are displayed.

Editing any study input cancels a pending study and clears old results. A newer
run, Cancel, Close or Escape terminates the previous Worker; queued old messages
cannot restore its results. Workspace changes or a workspace rerun invalidate
an open study until it is closed and reopened. Completion/cancellation hands
focus away from a disappearing Cancel button; stale results hand focus away
before being hidden. Native dialog focus/Tab behavior is shared with the other
modals, and the background replay Space shortcut is inactive while open.

**Download sampled experiment** is explicit and only enabled for completed,
current results. It saves ordinary v1 experiment JSON containing the sampled
schedules, not the results or acceptance limits. No upload or file picker is
used, and the workspace is never replaced. The regular CLI can run that input
and create a source-identified report with explicitly supplied policy limits.
Reloading or closing discards this temporary study; export important schedules.

## Verification boundaries

`tests/browser-cutoff.test.js` exercises the shared projection and
`tests/browser-cutoff-ui.test.js` executes real app handlers with DOM/Worker
stand-ins. The existing cutoff CLI fixtures remain byte-identical. Those tests
are source evidence, not native layout, file chooser, download, browser-worker,
mobile or assistive-technology evidence.

On October 28, 2026, local Node 24.22.1 / npm 11.9.0 checks passed
**1,014 core tests** (953 prior + 61 new) and **120 optional schema/editor tests**:
**1,134 distinct tests**, with no failures or skips. Syntax checks covered 88
JavaScript files. The static build includes 28 allowlisted payloads. Separate
repeated CLI parity checks are not counted as additional tests. Independent
read-only review found no remaining blocker after the queued terminal-Cancel
and comma-list keyboard-hint fixes.

## Bounded native desktop QA — October 28, 2026

Source [`f1419ecc`](https://github.com/Tabisharaza/detourlab/commit/f1419ecc3e2f3d581fb6045d3c42c3f91fbb62bb)
passed [exact-commit CI](https://github.com/Tabisharaza/detourlab/actions/runs/40647908461),
including all 1,134 distinct tests, reproducible distribution and clean tracked
source. A separate supported managed-preview check ran approximately
09:37–09:46 UTC in desktop Chromium. Only the launcher-returned URL was opened,
in a new temporary tab; no alternate host, port, tunnel or security bypass was used.

Observed through the actual UI and browser Worker:

- Meridian input `900, 0, 600, 300` produced sorted 0/300/600/900-second rows,
  with 153/118/106/50 late deliveries, 192 completed and zero unreachable in
  each. With no limits, every row said **Not evaluated**. A zero extra-late
  limit failed all four and displayed their violations.
- The bundled tiny lesson produced 260 m/one late delivery at 10 s versus
  200 m/zero late at 11 s; both completed one delivery. All five zero limits
  yielded one failed and one passed sample, with the expected distance,
  lateness, newly-late and six-second arrival-slip violations on the first.
- Duplicate times and seven samples were rejected with input focus and no old
  result rows. A source with no closure disabled Run. A negative policy value
  inside a collapsed disclosure was revealed and focused on rejection.
- A live six-sample run was canceled: inputs remained, partial results were
  absent, and focus returned from Cancel to Run. Editing completed sample
  inputs immediately removed the old results and export action.
- Initial heading focus, Tab/Shift-Tab wrapping, keyboard access to the table
  scroll region, and Close/Escape return focus passed. Space in the modal did
  not start background playback. Reopening started a fresh empty study.
- The saved source label remained distinct from an unsaved name. Closing the
  study and returning from the tiny lesson retained the original variant,
  unsaved name, road search and original computed outcomes.
- Settled 1165 × 747 screenshots showed readable five-column tables, policy
  violations, service counts, limitations and a visible keyboard focus outline.

Only the temporary QA tab was closed, and the managed preview was stopped.
One read-only tool-transport interruption recovered without navigating away.
Inspected error logs contained browser-extension metadata errors; no clean
console or exhaustive application-error coverage is claimed.

This is bounded desktop evidence, **not** native download, file-picker/import,
mobile emulation, assistive-technology, cross-browser, real-world validation or
live deployment evidence. No download, upload or file chooser was invoked.
Programmatically queued stale messages, timeout/failure injection and empty-
evidence policy cases remain source-test evidence rather than native checks.
