# Inspect delivery changes in the browser

The source workbench now offers **Inspect deliveries** after a complete run. It compares a selected variant with the same clear-road baseline, without running the simulation again. This is a **source-only milestone**: no deployment, hosted CI, native-browser check or accessibility certification is implied by this document.

## Find the difference hidden by a total

1. Run the experiment, then choose **Inspect deliveries** beside **Review results**.
2. Choose a variant inside the dialog. The workbench's selected variant follows that choice; its schedules and results are not edited.
3. Start with **Changed outcomes**, or choose **Status changes**, **Same-status arrival changes** or **All deliveries**.
4. Read baseline → variant for status, arrival, service completion and lateness. Every time is in seconds; signed changes are variant minus baseline.
5. Use **Previous 20** and **Next 20** to inspect the other matching deliveries in original input order. These are pages, not a severity ranking or a top-20-only sample.

The complete summary always counts every delivery. A live status gives the page range, filtered count, total count and count excluded by the selected filter. The default changed-only view does not imply that unchanged work is absent. **All deliveries** includes it.

For the bundled `meridian-experiment.json`, `market-05` has 125 changed outcomes among 192 jobs: 118 status changes and seven same-status arrival changes. The timing-only filter exposes those seven directly. For `job-01-4`, arrival changes from 690 s to 741 s (+51 s) while both outcomes remain on time. Service completion changes from 710 s to 761 s. These values come from the completed simulation, not an estimate from the map.

For the tiny example, `close-at-10` shows on-time → late, arrival 20 s → 26 s, service completion 23 s → 29 s, and lateness 0 s → 4 s. `close-at-11` has no changed outcomes; select **All deliveries** to see its unchanged job.

## What the numbers mean

- `src/browser-impact.js` reuses `copyCompletedResults` and the same `projectJobOutcomes` function as the [CLI impact report](JOB_IMPACT.md). Existing metrics and signed aggregate deltas are copied without recalculation. Job differences retain exact JavaScript numeric values without display rounding.
- Job identity, assignment, destination, deadline and order come from the current validated experiment. Completed ledgers are checked using the shared report boundary. This checks internal consistency, not authenticity or engine provenance.
- Changed means status, arrival or service completion differs. Same-status arrival changes can remain within an arrival deadline and therefore disappear from aggregate lateness counts.
- **Not reached** represents an unreachable timing's explicit null. **Not comparable** represents a difference with at least one unreachable side. Neither is zero, an improvement or proof that no delay exists.
- The summary also shows baseline and variant completed/unreachable counts. Reduced distance or fewer late deliveries can reflect skipped work rather than a better plan.
- Empty experiments and empty filtered views have separate explanations. A no-match filter still reports total work and offers **All deliveries**.

This inspector is an outcome comparison. It does not infer per-delivery routes, edge distances or which closure caused a downstream delay. Unchanged outcomes do not establish unchanged paths. It evaluates no acceptance thresholds and makes no authenticated build-identity claim. The model, import/export format and headless reports remain unchanged.

## Bounded evidence and lifecycle

At most **20 body rows** are rendered per page, up to the existing 2,000-job input limit. Every row remains reachable through pagination. Four filters operate over complete projected evidence and preserve input order. Changing filter or variant returns to the first page. Repeated activation of an already open inspector preserves the current page rather than rebuilding it.

The app holds references to the completed input and result set. A committed edit, successful import, reset, lesson transition, cancellation or rerun removes the old rows immediately and disables the inspection controls. Completion does not silently refill an already invalidated dialog; close and reopen it to inspect the new run. Stale Worker messages cannot reinstate old rows. A rejected import or mutation leaves the previous valid run intact.

Closing or Escape discards the inspection view. Reopening starts with changed outcomes. Replay time does not change final delivery evidence, and inspection pauses playback. Variant selection reuses the same completed result set and does not start a Worker. No data is uploaded. For complete portable evidence, close the inspector and use **Review results** to download the full JSON bundle.

## Keyboard and presentation

The inspector uses a named native dialog, native labeled selects and buttons, a captioned semantic table, scoped row/column headings, and text-only imported labels. Opening focuses the heading. Tab containment excludes disabled or hidden controls. The table's named scroll region is focusable so wide timing columns are not pointer-only. A page button that becomes disabled hands focus to the other available page action, or a filter when needed. Invalidation moves focus to Close before disabling the active control.

Escape and Close return to **Inspect deliveries**, or **Run all variants** if the former is disabled. Deferred close events cannot reclaim focus after the dialog reopens. Space inside the dialog does not toggle background playback. The new CSS introduces no animation and does not override the existing global reduced-motion rules. This design and automated handler evidence are not a native keyboard, screen-reader, mobile or reduced-motion pass.

## Reproduce source checks

```sh
node --test tests/browser-impact.test.js tests/browser-impact-ui.test.js
npm run check
node scripts/verify-dist.js
```

Focused tests cover exact CLI/report parity for all tiny and Meridian variants; 125/118/seven distinct counts; every filtered page and all 2,000 supported jobs; unreachable nulls; fractional engine tolerance; no simulation or mutation; stale/edit/import/cancel/reset/lesson/repeated-run flows; forced disabled dispatch; safe imported labels; keyboard focus, Escape and deferred close notifications; and bounded errors.

Before claiming a native-browser release, separately exercise actual keyboard traversal and focus visibility, horizontal table scrolling, last/first page transitions, Escape/reopen, selection and filter announcements with assistive technology, 200% zoom, narrow/mobile layouts, reduced motion and other browsers. Run native import/recompute/cancel paths too. No screenshots or native-browser observations have been produced for this source milestone.
