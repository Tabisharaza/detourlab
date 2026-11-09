# Keep your place while inspecting a delivery

The source workbench now completes the delivery-review round trip. Search and
order a comparison, jump to an arrival on the maps, then return to the same
comparison page and delivery rather than starting your review again.

## Follow one delivery out and back

1. Finish a run and open **Inspect deliveries**. Choose a filter, search or order
   and move to the page you want.
2. Use a row's **Replay baseline arrival** or **Replay variant arrival** action.
   The maps pause at that recorded arrival and select the delivery's vehicle.
3. Explore the replay. Scrubbing, playback, map view, zoom and vehicle selection
   do not lose your comparison while its completed variant remains current.
4. Choose **Return to delivery comparison**. The inspector restores its filter,
   query, order and page, then focuses the arrival action you used.

Returning restores the **comparison view**, not the old replay perspective.
It pauses playback but keeps your current replay time, vehicle, map view and
zoom. No simulation is rerun and experiment edits/history remain unchanged.
The full CSV still includes every delivery in original input order.

## One bounded, temporary return point

Only the most recent arrival journey can be returned to. Successful return
consumes it; another arrival action creates a new one. The ordinary **Inspect
deliveries** button still starts a fresh comparison with its documented defaults
and discards the old return point.

The return point belongs to the exact completed input, results and variant.
Switching variants, changing input, importing a workspace, starting a new run,
resetting or entering/leaving a lesson invalidates it. Switching back does not
resurrect it. Old retained callbacks cannot reopen a newer or invalid comparison.
Nothing is saved to storage or uploaded, and reload clears this temporary state.

Missing arrival times remain unavailable for replay; they never gain a return
point at an invented zero time. Navigation still selects an existing vehicle
replay, not a per-delivery route or a closure-causation explanation. See
[arrival semantics and limits](DELIVERY_REPLAY.md).

## Reproduce verification

```sh
node --test tests/delivery-return-ui.test.js tests/delivery-replay-ui.test.js
npm run check
node scripts/verify-dist.js
```

Application tests use DOM and Worker stand-ins. Native Chromium checks and
reviewed captures are recorded separately when verified. Neither constitutes
screen-reader, native OS chooser, physical mobile-device or cross-browser
certification. The hosted demo remains v11; this is a source milestone, not a
deployment.
