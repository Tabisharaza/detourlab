# Experiment workbench: bounded milestone

This historical implementation plan started from v3, source commit `2910ba97352f14dbe0c9e5a074a2446f71880f47`. The workbench is now implemented in v4. See [the verification record](VERIFICATION.md) for completed checks and remaining gaps; the acceptance list below is the original scope, not a claim that every browser check passed.

## User workflow

1. Open one synthetic network/demand experiment with two named variants.
2. Select, rename or duplicate a variant, up to six.
3. Edit its independent closure events, including cutoff and direction, while other variants remain unchanged.
4. Compare real full-run distance, lateness, unreachable and completed-job counts against one identical open-network baseline.
5. Inspect the selected variant's ledger and synchronized playback at the shared experiment time.
6. Export one bounded experiment JSON. Reimport or run it headlessly with per-variant regression thresholds.

## Boundaries

No new routing algorithm, real-city data, private fleet data, persistent storage, telemetry or server account. Baseline and all variants share exactly one network, fleet and ordered demand. A shorter traveled distance caused by skipped jobs must be flagged, never celebrated as improvement.

## Format

`format: detourlab-experiment`, `version: 1`, identity, one closure-free `baseScenario`, and 2–6 variants containing identity and independent closure arrays. Single-scenario v1 imports upgrade explicitly into a supplied scenario plus clear-road control. Unknown fields, invalid references, excessive bytes/collections and unsafe records are rejected.

## Computation

A worker calculates the baseline once and each variant from shared input. Results carry variant identity and deterministic deltas. The UI terminates superseded work, rejects stale messages and exposes cancel/rerun. No partial results are called successful. Import selection, edits and Reset use generation guards so older reads cannot overwrite newer work.

## Acceptance

- Export/import reproduces all ledgers, KPIs and identifiers exactly.
- All variants share baseline inputs; editing one preserves every other closure schedule.
- Named variant create/duplicate/delete (minimum two), selection and bounded names behave consistently.
- Individual closure cutoff/direction edits preserve unrelated records.
- Baseline/control results are identical, with zero deltas.
- Malformed and oversized imports fail safely; old scenario files still work.
- Cancel, rapid edits and out-of-order worker/import completions cannot restore stale state.
- CLI reports stable input hashes, per-variant thresholds and correct exit codes.
- Existing 65 tests remain passing alongside new engine/format/CLI/UI-state tests.
- Browser interaction, mobile, reduced-motion and hosted-artifact checks remain separate gates and must be reported honestly.
