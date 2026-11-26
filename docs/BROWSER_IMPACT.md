# Inspect delivery changes in the browser

The source workbench now offers **Inspect deliveries** after a complete run. It compares a selected variant with the clear-road baseline by default, or compares two saved plans directly, without running the simulation again. This is a **source-only milestone**: no deployment or accessibility certification is implied. Later bounded native checks are recorded in [CSV verification](DELIVERY_CSV.md) and [search and ordering](DELIVERY_SEARCH.md).

## Find the difference hidden by a total

1. Run the experiment, then choose **Inspect deliveries** beside **Review results**.
2. Choose a variant inside the dialog. The workbench's selected variant follows that choice; its schedules and results are not edited.
3. Start with **Changed outcomes**, or choose **Status changes**, **Same-status arrival changes** or **All deliveries**.
4. Read baseline → variant for status, arrival, service completion and lateness. Every time is in seconds; signed changes are variant minus baseline.
5. Search by job, vehicle or node ID, and optionally order by **Largest arrival delay**. Default order remains the input order.
6. Use **Previous 20** and **Next 20** to inspect the other matching deliveries. These are pages, not a top-20-only sample. [Exact matching, ordering and limits](DELIVERY_SEARCH.md).

The complete summary always counts every delivery. A live status gives the page range, filtered count, total count and count excluded by the selected filter. The default changed-only view does not imply that unchanged work is absent. **All deliveries** includes it.

For the bundled `meridian-experiment.json`, `market-05` has 125 changed outcomes among 192 jobs: 118 status changes and seven same-status arrival changes. The timing-only filter exposes those seven directly. For `job-01-4`, arrival changes from 690 s to 741 s (+51 s) while both outcomes remain on time. Service completion changes from 710 s to 761 s. These values come from the completed simulation, not an estimate from the map.

For the tiny example, `close-at-10` shows on-time → late, arrival 20 s → 26 s, service completion 23 s → 29 s, and lateness 0 s → 4 s. `close-at-11` has no changed outcomes; select **All deliveries** to see its unchanged job.

## Compare two saved plans

In the source workbench, import the bundled [Meridian experiment](../examples/meridian-experiment.json)
and finish the run. Open **Inspect deliveries**. For **Candidate plan**, choose
**Market Bridge at 10:00**. For **Reference plan**, choose **Market Bridge at 05:00**.
The resulting candidate has 12 fewer late deliveries but 65 later arrivals;
46 are earlier and 81 unchanged. The metrics show distance, late, unreachable
and completed work for both sides with signed differences. Missing arrivals
are counted separately from unchanged arrivals. A reduction in completed
deliveries adds a coverage note even when late counts go down.

- The reference can be clear roads or any saved plan other than the candidate.
  Choosing the current named reference as candidate swaps the two plans.
  A different candidate keeps the existing reference. A reference change alone
  does not change the workbench's selected variant or replay time.
- Rows read **reference → candidate**, with signed change **candidate minus
  reference**. Search and order still apply to all matching evidence before
  paging. Changes to either plan reset to the first page, retaining the query,
  filter and ordering.
- **Replay reference arrival** and **Replay candidate arrival** open the same
  two plans side by side. Either action selects the delivery's vehicle, pauses
  both maps at that side's exact arrival and uses each plan's own ledger and
  closure schedule. A side without a recorded arrival has no replay action.
  **Return to delivery comparison** restores both plans, search, order, page and
  the exact arrival action without rewinding replay. A fresh **Inspect
  deliveries** still starts with the clear-road baseline.
- **Download all deliveries CSV** writes `detourlab-variant-comparison.csv`
  with both plan identities and all job rows in original input order. For
  machine-readable JSON and the same exact comparison values, use the
  [named-plan CLI](VARIANT_COMPARISON.md). The legacy baseline CSV is unchanged.

Focused source checks cover both directions, an unreachable side, tied names,
complete CSV, result invalidation, stale row actions and replay restoration.
The existing [CSV](DELIVERY_CSV.md) and [return](DELIVERY_RETURN.md) Chromium
harnesses now include a trusted keyboard path, actual named downloads checked
row-by-row against the CLI JSON, and named-pair replay/return. Those harnesses
do not certify OS file dialogs, assistive technology, physical devices, other
browser engines, or hosted deployment.

### Follow the same vehicle through both plans

For a hand-check, import the [four-node example](../examples/minimal-experiment.json).
Use **Close at 10 s** as reference and **Close at 11 s** as candidate. The
reference detours via D and reaches C at 26 s; the candidate enters B → C
before it closes and arrives at 20 s. Replay either arrival, then move the
shared clock to 15 s to see the routes and vehicle positions diverge. **Show
events → Scheduled closures** lists the reference's 10 s cutoff and the
candidate's 11 s cutoff, even though both schedules use the same closure ID.

The named split is temporary. Both panes share time, vehicle and zoom. Route
stats compare the displayed plans; status and stop details describe the
candidate. Fleet cards above the maps still show final clear-road deltas.
**Restore clear-road replay** returns to the ordinary split at the current
time, leaving the delivery return point available. Another map mode, another
candidate, an edit or a new run clears the named replay. Browser replay
bookmarks keep their existing format: restore clear-road replay before saving.
This is a vehicle-ledger view, not a trace attributed to a particular delivery.

## What the numbers mean

- `src/browser-impact.js` reuses `copyCompletedResults` and the same `projectJobOutcomes` function as the [CLI impact report](JOB_IMPACT.md). Existing metrics and signed aggregate deltas are copied without recalculation. Job differences retain exact JavaScript numeric values without display rounding.
- Job identity, assignment, destination, deadline and order come from the current validated experiment. Completed ledgers are checked using the shared report boundary. This checks internal consistency, not authenticity or engine provenance.
- Changed means status, arrival or service completion differs. Same-status arrival changes can remain within an arrival deadline and therefore disappear from aggregate lateness counts.
- **Not reached** represents an unreachable timing's explicit null. **Not comparable** represents a difference with at least one unreachable side. Neither is zero, an improvement or proof that no delay exists.
- The summary also shows baseline and variant completed/unreachable counts. Reduced distance or fewer late deliveries can reflect skipped work rather than a better plan.
- Empty experiments and empty filtered views have separate explanations. A no-match filter still reports total work and offers **All deliveries**.

This inspector is an outcome comparison. It does not infer per-delivery routes, edge distances or which closure caused a downstream delay. Unchanged outcomes do not establish unchanged paths. It evaluates no acceptance thresholds and makes no authenticated build-identity claim. The model, import/export format and headless reports remain unchanged.

## Bounded evidence and lifecycle

At most **20 body rows** are rendered per page, up to the existing 2,000-job input limit. Every row remains reachable through pagination. Filters operate over complete projected evidence. Search narrows the selected filter; optional arrival-delay ordering leaves incomparable deltas last. Changing filter, query, ordering or variant returns to the first page. Repeated activation of an already open inspector preserves the current page rather than rebuilding it.

The app holds references to the completed input and result set. A committed edit, successful import, reset, lesson transition, cancellation or rerun removes the old rows immediately and disables the inspection controls. Completion does not silently refill an already invalidated dialog; close and reopen it to inspect the new run. Stale Worker messages cannot reinstate old rows. A rejected import or mutation leaves the previous valid run intact.

Closing or Escape discards the inspection view. Reopening starts with changed outcomes, an empty query and input ordering. Replay time does not change final delivery evidence, and inspection pauses playback. Variant selection reuses the same completed result set and does not start a Worker. No data is uploaded. For complete portable evidence, close the inspector and use **Review results** to download the full JSON bundle.

## Keyboard and presentation

The inspector uses a named native dialog, native labeled selects and buttons, a captioned semantic table, scoped row/column headings, and text-only imported labels. Opening focuses the heading. Tab containment excludes disabled or hidden controls. The table's named scroll region is focusable so wide timing columns are not pointer-only. A page button that becomes disabled hands focus to the other available page action, or a filter when needed. Invalidation moves focus to Close before disabling the active control.

Escape and Close return to **Inspect deliveries**, or **Run all variants** if the former is disabled. Deferred close events cannot reclaim focus after the dialog reopens. Space inside the dialog does not toggle background playback. The new CSS introduces no animation and does not override the existing global reduced-motion rules. This design and automated handler evidence are not a native keyboard, screen-reader, mobile or reduced-motion pass.

## Reproduce source checks

```sh
node --test tests/browser-impact.test.js tests/browser-impact-ui.test.js tests/named-impact-ui.test.js
npm run check
node scripts/verify-dist.js
```

Focused tests cover exact CLI/report parity for all tiny and Meridian variants; 125/118/seven distinct counts; every filtered page and all 2,000 supported jobs; unreachable nulls; fractional engine tolerance; no simulation or mutation; stale/edit/import/cancel/reset/lesson/repeated-run flows; forced disabled dispatch; safe imported labels; keyboard focus, Escape and deferred close notifications; and bounded errors.

Before claiming a native-browser release, separately exercise actual keyboard traversal and focus visibility, horizontal table scrolling, last/first page transitions, Escape/reopen, selection and filter announcements with assistive technology, 200% zoom, narrow/mobile layouts, reduced motion and other browsers. Run native import/recompute/cancel paths too. The original source milestone had no native evidence; later bounded Chromium observations and screenshots are linked above. Those do not close the remaining checks.

## Isolate the outcome you need to investigate

Use **Later arrivals** to isolate comparable positive arrival delays, whether or
not the delivery became late. Choose **Largest arrival delay** to see the
largest changes first. For the Meridian 5-minute → 10-minute pair, there are
65 matching deliveries; searching for `job-11-4` shows one 84-second delay.

**Newly unreachable deliveries** shows stops reached by the reference but not
the candidate. **Recovered deliveries** shows the opposite transition. A
stop reached by neither plan appears in neither filter. These separate views
can expose changed coverage even when the two plans complete the same number
of deliveries. All three filters work with a saved reference or the implicit
clear-road baseline.

Search and pagination are local display controls. Replay and Return preserve
the filter without restarting the simulation. CSV and named comparison
evidence JSON still include every delivery, even when no filtered rows appear.

## Complete CSV download

The source inspector now offers **Download all deliveries CSV**. It exports the
selected variant's full completed comparison regardless of filter, search, ordering or page,
using the same deterministic serializer as the CLI. [Format, text precautions
and verification](DELIVERY_CSV.md) distinguish this source feature from hosted
deployment and spreadsheet-product testing.

## Continue from a row into replay

In the default comparison, the arrival cell provides separate baseline and variant replay actions for
recorded arrivals. A choice closes the inspector, selects the delivery’s vehicle
and pauses the synchronized maps at that exact timestamp. Null arrivals have no
action. [Navigation semantics, safeguards and evidence](DELIVERY_REPLAY.md).
This selects the existing vehicle replay, not a per-delivery route or a causal
explanation of the delay.
