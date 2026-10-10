# Design decisions

These decisions describe the current implementation. They are constraints contributors can question with a concrete experiment, rather than promises about future features.

## 1. Share inputs, vary the closure schedule

An experiment stores one closure-free base scenario and 2–6 named closure variants. Demand, assignment, job order, edge costs and dispatch times stay identical within a comparison. This makes each change explainable and avoids accidentally comparing two different generated fleets.

The first reference is always the open-network baseline. A clear-road variant must reproduce it exactly. Changing a variant's name has no routing significance; it still invalidates the UI run through the same conservative update path.

## 2. Keep a portable pure engine

The same JavaScript modules execute in a browser Worker and Node. No database, framework, secret or service is needed. Public `.d.ts` files document interfaces without adding a transpilation step.

Reverse Dijkstra minimizes assumed travel time. Stable cost and ID ordering resolves ties. This is a fixed-sequence shortest-path simulation. Adding reassignment or vehicle-routing optimization requires an explicit policy adapter and comparisons that disclose the changed policy.

## 3. Treat the ledger as evidence

Each vehicle's traversed edges include entry and exit times. Jobs include arrivals, service completion and status. The renderer interpolates this ledger, and final KPIs sum these outcomes. Decoration is procedural and carries no operational meaning.

The current UI overlays one selected vehicle's baseline and disrupted route. Variant selection preserves replay time and selected vehicle. Separate synchronized map panes are a future feature, not a current claim.

## 4. Define closures at edge entry

A closure is permanent from `atS`. A vehicle may finish an edge entered earlier; it cannot enter at or after the cutoff. Replanning happens at junctions. Numerical comparisons handle small floating-point accumulation noise at the cutoff.

If a stop becomes unreachable, the vehicle records it, retains distance already traveled, and tries the next stop from its current position and time. The current model does not wait for reopening or reassign the stop. A shorter trip can therefore mean less completed work.

## 5. Fail a whole calculation explicitly

Schema bounds reject malformed or excessive input. Deterministic engine budgets and an aggregate experiment segment budget reject expensive results. The browser also has a 30-second wall-clock timeout, which is a responsiveness safeguard rather than a cross-machine performance contract.

New runs terminate old workers. Request identity and worker identity reject late replies and errors, including messages after a terminal result. Cancel clears results but preserves inputs. Pending import reads are superseded by newer imports, edits or Reset.

## 6. Start with synthetic geometry

A fictional district is enough to test routing semantics and explainability without licensing a live provider or transmitting private fleet data. The renderer shows straight graph edges and procedural blocks. It does not contain real roads, live traffic, aerial imagery or a Riyadh dataset.

Real city packs are a separate extension. They need provenance, source date, licensing, attribution and geometry handling, with a clear separation between permissively licensed code and any differently licensed dataset.

## 7. Keep presentation optional

Canvas makes the initial district lightweight and visually explorable. Keyboard-accessible selects, event fields, result cards and textual delivery outcomes expose core controls outside the map. This is useful groundwork, not a completed accessibility audit.

Paused scenes still enter the animation loop, but the [redraw guard](RENDERING.md) skips unchanged visible paints. Browser timing and accessible road search remain concrete improvement opportunities; see the issue drafts. A different renderer should continue consuming the same validated ledgers.


## 8. Offer a reversible small example

The optional lesson loads the same four-node experiment checked by Node, with three closure schedules and one assigned delivery. It uses the ordinary validation, Worker, result cards and route inspector rather than a separate animation or hard-coded metric result. The explanation is reference text: editing the experiment marks it modified and disables the reference step controls until Reset lesson.

Starting requires an explicit choice. One independently validated in-memory backup retains the previous experiment and selected controls; returning recomputes its results and leaves playback paused. Reset inside the lesson restores the lesson, not the city, and keeps the backup. Import is disabled until returning so a separate file cannot silently replace the retained workspace. The backup is not durable storage: reload or closing the page clears it, and the dialog says so.

Metre-scale distances, second-scale lateness, capped textual routes for small graphs and cached junction labels make the example inspectable without relying only on map color. These are targeted usability changes, not a completed screen-reader or mobile audit.
