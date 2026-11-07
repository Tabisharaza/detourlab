# Find deliveries without losing the complete comparison

After a completed run, open **Inspect deliveries**, choose a variant and filter,
then search by job, vehicle or destination node ID. This source feature reuses
completed results: it does not rerun routing, edit the experiment or upload data.
The hosted demo remains the separately recorded v11 release.

## Search and order

- Search is a trimmed, case-insensitive literal substring of any of the three
  IDs. It is not a regular expression, fuzzy search or a search of timing cells.
- The selected outcome filter is applied first. Counts distinguish those rows
  from search matches and the complete experiment. Clear the query or choose
  **All deliveries** when an expected delivery is outside the current view.
- **Input order** is the default. **Largest arrival delay** sorts comparable
  arrival changes, variant minus baseline, from largest to smallest. Negative
  values remain negative; ties keep original input order. Incomparable changes
  remain last, never treated as zero.
- This is not an overall severity score. An unreachable delivery may matter more
  than a timed delay, despite appearing last in this particular ordering. The
  complete status summary and explicit non-comparable labels remain visible.
- At most 20 rows are rendered. Search, filter, ordering and variant changes
  reset the page. Variant changes retain the query and ordering; closing and
  reopening starts again with changed outcomes, no query and input order.

For the bundled Meridian experiment, select `market-05`, choose all deliveries
and search `job-01-4`. Its arrival changes from 690 to 741 seconds (+51), even
though both outcomes remain on time. Searching a vehicle ID finds its assigned
jobs; searching a node ID finds deliveries to that destination.

**Download all deliveries CSV** always exports the selected variant's complete
comparison in original input order. No search, filter, sort or page truncates
the file. See [CSV format and import precautions](DELIVERY_CSV.md).

## Lifecycle and verification

Search and ordering are local presentation state. Input changes and reruns
invalidate the inspector with the same completed-result guards as before.
Replay time does not change final delivery outcomes. No stored result or source
job order is mutated. This adds no simulation claim or routing optimization.

```sh
node --test tests/browser-impact.test.js tests/browser-impact-ui.test.js
npm run check
node scripts/verify-dist.js
```

Pure tests cover matching, filter intersections, stable numeric ordering,
incomparable values, empty matches and bounded pagination. Application tests
cover resets, variant changes, invalidation and complete CSV independence.
Native Chromium evidence is recorded separately below when verified; DOM
stand-ins alone are not native keyboard, layout or accessibility evidence.
