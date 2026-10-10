# Keyboard controls and modal focus

DetourLab uses native buttons, selects and sliders for the experiment controls. The road dropdown and direction selector offer an alternative to clicking roads on Canvas; the route inspector exposes computed outcomes as text.

## Dialogs

- **How it works** and **Model assumptions** open the same named field guide. Its heading receives initial focus so the beginning of the longer content stays in view.
- **Try a tiny example** opens a named confirmation with **Cancel** focused. Opening it pauses playback but does not replace the current experiment.
- **Tab** and **Shift+Tab** cycle through the active dialog's visible, enabled controls. Hidden and disabled controls are excluded. A dialog with one available control keeps ordinary Tab navigation on that control.
- **Escape**, **Cancel** or **Close guide** dismiss the dialog. Focus returns to its available opener or a visible fallback. These actions do not confirm the lesson.
- Starting the lesson moves focus to its first plan. Returning to the previous experiment and resetting the lesson also leave focus on a useful control.

Browser shortcuts with Control, Alt or Meta are not captured by the ordinary Tab handler. Native dialog behavior keeps the underlying page inert while a modal is open. No positive `tabindex` order or custom replacement for the native dialog is used.

## Playback and editing

Use native keyboard behavior for each control: Enter or Space activates a focused button; arrow keys operate a focused range or select. Focusing an input or opening either dialog prevents the page-level Space shortcut from toggling playback underneath it. A comparison card selects the plan to inspect; final result cards and playback time describe different things.

Edits and calculations can replace dynamic result controls. This scoped change addresses the two modal flows and lesson transitions; it is not a guarantee of focus preservation for every dynamic editor action.

## Implementation and regression checks

The application keeps native `showModal()`, `close()` and `cancel` behavior. Deliberate app transitions resolve their focus immediately and consume later close notifications, so a queued notification cannot restore stale focus over a newer modal or lesson. Restoration checks that its target is still connected, visible and enabled.

Run the aggregate checks before contributing:

```sh
npm run check
```

The Node UI harness exercises the real event handlers with DOM and Worker stand-ins, including delayed close notifications. It does not implement a browser layout engine, keyboard tab-order algorithm or screen reader. Passing these tests is not evidence that native keyboard behavior has been tested.

For a real-browser review, open each dialog by keyboard and check initial focus, forward and backward boundary wrapping, Escape, explicit close, guide-to-lesson transition, confirmation, repeated open/close, lesson reset and return. Also open the guide while a lesson is active, when its lesson-entry button is disabled. Check the visible focus indicator and that the underlying experiment is unchanged after cancellation.

The dated browser observations and remaining gaps are in [VERIFICATION.md](VERIFICATION.md). No complete accessibility audit or WCAG conformance claim is made.

## Design references

- [W3C APG modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): initial focus, boundary navigation, dismissal and focus return
- [MDN native dialog element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog): browser-provided modal behavior

These references informed the interaction design; they are not certifications of this implementation.
