# Keyboard controls and focus

DetourLab uses native buttons, selects and sliders for the experiment controls. The road dropdown and direction selector offer an alternative to clicking roads on Canvas; the route inspector exposes computed outcomes as text. The [road picker](ROAD_PICKER.md) adds a labeled search field, concise result count and saved-schedule context while retaining the native road selector.

## Dialogs

- **How it works** and **Model assumptions** open the same named field guide. Its heading receives initial focus so the beginning of the longer content stays in view.
- **Try a tiny example** opens a named confirmation with **Cancel** focused. Opening it pauses playback but does not replace the current experiment.
- **Tab** and **Shift+Tab** cycle through the active dialog's visible, enabled controls. Hidden and disabled controls are excluded. A dialog with one available control keeps ordinary Tab navigation on that control.
- **Escape**, **Cancel** or **Close guide** dismiss the dialog. Focus returns to its available opener or a visible fallback. These actions do not confirm the lesson.
- Starting the lesson moves focus to its first plan. Returning to the previous experiment and resetting the lesson also leave focus on a useful control.

Browser shortcuts with Control, Alt or Meta are not captured by the ordinary Tab handler. Native dialog behavior keeps the underlying page inert while a modal is open. No positive `tabindex` order or custom replacement for the native dialog is used.

## Playback and editing

Use native keyboard behavior for each control: Enter or Space activates a focused button; arrow keys operate a focused range or select. Focusing an input or opening either dialog prevents the page-level Space shortcut from toggling playback underneath it. A comparison card selects the plan to inspect; final result cards and playback time describe different things.

## Dynamic experiment controls

Comparison cards and closure-editor controls update when their data or calculation status changes. The current source keeps surviving controls in place by identity, rather than removing and recreating the active control:

- A comparison card remains focused by variant identity when selected or refreshed by a result.
- Editing a closure's start time retains its input and adjacent Remove control. This avoids removing the next native Tab/click target during the input's change event. Invalid edits return to the latest committed value.
- Removing an event moves to the next available Remove action, the previous one if last, or an available road-editing control if empty. With searchable road editing, that final fallback is the road selector when it has choices or the enabled search field when it does not. The same source handler supports reopen chips, but the existing stylesheet hides that chip list; this is not an assertion that those chips are currently keyboard-reachable.
- Activating a preset keeps a corresponding available preset in place through the refresh.
- If focused Duplicate reaches the six-variant limit, or focused Remove reaches the two-variant minimum, focus goes to the variant selector instead of staying on a newly disabled button.

Fallback focus is tied to the control being removed or disabled, not an earlier click or worker request. A later result must not move focus away from another input, playback control or open dialog. Surviving controls do not need a focus call. No delayed focus timer, positive `tabindex` or custom Tab order is added.

The original dynamic-focus improvement was deployed in v8; its [historical record](VERIFICATION.md#v8-source-parity-deployment) retains that scope. The [v9 desktop review](VERIFICATION.md#v9-road-picker-deployment-and-bounded-desktop-checks) checked specific native picker transitions and the no-choice search fallback. It does not establish every dynamic-editor transition or assistive-technology behavior.

## Run completion and cancellation

The v9 native review exposed lost focus when **Cancel run** disappeared during
cancellation or completion. The corrected source deployed in v10 moves focus to **Run all
variants** before hiding Cancel, but only if Cancel still owns focus. It does
not reclaim focus from a newer control or modal. Current-run completion,
returned errors, Worker failure, timeout and construction failure use the same
handoff; stale callbacks remain guarded.

Nine new source regressions cover these lifecycle cases. Independent review
passed 25 dynamic-focus tests and five terminal-path probes. These are source
checks. The [v10 native retest](VERIFICATION.md#v10-native-focus-checks-and-screenshot)
separately passed two flows: Run → Shift+Tab → Space canceled and focused Run all
variants; Run → Shift+Tab visibly focused Cancel before normal completion, then
completion focused Run all variants. The `bridge` query and Foundry Bridge
selection survived both. Error/timeout paths, stale callbacks and newer-modal
cases remain source-only checks.

## Implementation and regression checks

The application keeps native `showModal()`, `close()` and `cancel` behavior. Deliberate app transitions resolve their focus immediately and consume later close notifications, so a queued notification cannot restore stale focus over a newer modal or lesson. Restoration checks that its target is still connected, visible and enabled.

Run the aggregate checks before contributing:

```sh
npm run check
```

The Node UI harness exercises the real event handlers with DOM and Worker stand-ins, including delayed close notifications and focus loss when focused controls are detached. It does not implement a browser layout engine, keyboard tab-order algorithm or screen reader. Passing these tests is not evidence that native keyboard behavior has been tested.

For a real-browser review, open each dialog by keyboard and check initial focus, forward and backward boundary wrapping, Escape, explicit close, guide-to-lesson transition, confirmation, repeated open/close, lesson reset and return. Also open the guide while a lesson is active, when its lesson-entry button is disabled. Check the visible focus indicator and that the underlying experiment is unchanged after cancellation.

For the dynamic editor, repeatedly select a comparison card with the keyboard, update a closure time with Enter and then with Tab, remove the first/middle/last/only event and activate presets. Only check reopen chips if that UI is made visible; the current stylesheet hides the chip list. Let a result arrive while a card is focused, then repeat with focus on a different control and in an open guide. Confirm that focus stays visible and useful without interrupting native navigation. The v9 record covers only the particular transitions observed there; all other cases in this broader checklist remain unverified.

The dated browser observations and remaining gaps are in [VERIFICATION.md](VERIFICATION.md). No complete accessibility audit or WCAG conformance claim is made.

## Design references

- [W3C APG modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): initial focus, boundary navigation, dismissal and focus return
- [MDN native dialog element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog): browser-provided modal behavior

- [W3C APG keyboard interface guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/): keeping focus visible and predictable when interactive content changes
- [MDN element blur event](https://developer.mozilla.org/en-US/docs/Web/API/Element/blur_event): focus loss on removal and browser event-order differences
- [MDN HTMLElement.focus()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/focus): focusing the intended control

The dynamic-focus references were checked on October 10, 2026. These references informed the interaction design; they are not certifications of this implementation.
