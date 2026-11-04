# Recover experiment edits

Undo and Redo make temporary road-closure experiments recoverable within the
current browser session. They restore validated experiment inputs and the
relevant selected variant, then recompute results through the ordinary Worker.
They never restore cached results as evidence.

## Scope and boundaries

History covers committed closure changes, cutoff edits, presets and variant
rename, duplication and deletion. Scrubbing, playback, vehicle selection, map
view, zoom and search are navigation, not experiment edits. Invalid changes and
identical input commits do not add an entry or discard an available redo.
A successful different edit after Undo discards the old redo branch.

The history retains at most 20 undo transitions. Current, undo and redo snapshots
share a 16 MiB serialized UTF-8 payload budget. Oldest undo entries are evicted
when a limit is reached; if only redo entries remain and selection metadata
grows beyond the byte budget, the farthest redo entries are removed first. This bounds the stored snapshot payload, not total
JavaScript heap, simulation results or browser memory. No history is sent to a
server or persisted in local storage. Reloading the page loses session history;
export an experiment or save a replay bookmark for durable handoff.

Successful import, Open replay and Reset begin a new workspace history. Failed
or canceled reads leave the current history intact. Guided lessons disable Undo/Redo and retain the previous workspace’s complete
history, including its redo branch. Returning restores that history; lesson
edits and lesson Reset do not become parent-workspace entries.

Undo/Redo preserves the current view, zoom and road-picker context. Its replay
time is clamped if necessary after the restored result establishes its valid
horizon. Undo/Redo pauses playback and supersedes older computation and pending file or
bookmark navigation. The restored input is recalculated before completed result
views become available. A failed or canceled recomputation does not turn the
previous result into evidence for the restored input.

Use the visible native buttons with pointer or keyboard. This milestone does
not intercept Ctrl/Cmd+Z, so ordinary text and number-field editing retains its
native behavior. Browser automation is not assistive-technology certification.

## Contributor checks

The pure history module is independent of simulation. App regressions cover
history boundaries, interrupted work and focus recovery. The optional native
harness uses synthetic fixtures and a fresh Chromium profile:

```sh
node tools/experiment-history-check/run.js --browser /path/to/chromium --out /tmp/history-evidence
```

Do not overwrite another run's evidence. File injection is separate from OS
chooser behavior, and a source milestone is separate from hosted deployment.

## Design context

Recoverable editing supports DetourLab's existing closure-comparison workflow;
it is not claimed as a novel industry interaction. Read-only comparison with
[God's Eye View](https://github.com/bilawalsidhu/gods-eye-view),
[kepler.gl playback](https://docs.kepler.gl/docs/user-guides/h-playback) and
[ArcGIS Experience Builder](https://doc.arcgis.com/en/experience-builder/11.5/build-apps/save-preview-publish.htm)
favored reliable authoring over another export format or a live-data expansion.
No code or data was copied and no demand or Trending outcome is promised.

A bounded November 4 GitHub Trending snapshot showed mostly AI/developer tooling,
not a relevant logistics comparator. It was not used as evidence of demand.
