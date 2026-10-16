# Gate delivery regressions by job

Net late-job counts can hide which deliveries deteriorate. The scenario and experiment runners now offer two opt-in acceptance gates over the same job ledgers used by the [impact report](JOB_IMPACT.md):

```sh
node scripts/run-experiment.js examples/minimal-experiment.json --max-newly-late 0
node scripts/run-experiment.js examples/minimal-experiment.json --max-arrival-slip-s 6 --max-unreachable 0 --json
```

The first command exits **1** because `close-at-10` turns one on-time delivery late. The second exits **0**: the largest comparable arrival slip is exactly six seconds, and all deliveries remain reachable. Equality meets a limit. No network, package installation, browser or new input format is required.

## Two distinct questions

- `--max-newly-late N` limits the number of jobs whose status changes **on-time → late**. It uses the engine's status, including its floating-point deadline tolerance. A previously late job becoming on time cannot cancel this count. A baseline-unreachable job becoming late is a recovery with no comparable baseline arrival, not a newly late delivery under this definition.
- `--max-arrival-slip-s N` limits the **greatest positive arrival-time difference**, in seconds, among jobs reachable in both runs. Earlier arrivals cannot cancel a later one. This catches later-but-still-on-time deliveries and already-late deliveries that deteriorate further. Values are not rounded before comparison.

Both flags accept one finite nonnegative number each, consistent with the existing threshold parser. A fractional newly-late count limit is allowed; because the measured count is integral, a limit below one rejects any newly late job. Repeated flags are errors. Flag order does not affect JSON, violations or exit status.

These are extra gates. `--max-extra-late` retains its existing **signed net count** meaning, and `--max-unreachable` retains its **absolute disrupted/variant count** meaning. Choose limits appropriate to the experiment; a successful exit is not an operational safety certification or proof of an optimal plan.

## Reproduce a masked regression

The original [five-node synthetic experiment](examples/net-lateness.experiment.json) is small enough to verify by hand:

- Vehicle `one` starts at A. A→B takes 10 s. A→C→B takes 8 + 8 = 16 s. Its B delivery is due at 12 s.
- Vehicle `two` starts at D. D→E takes 10 s; E→D takes another 10 s. The first delivery at E requires 100 s of service. Its next delivery at D is due at 50 s.
- Variant `cut` closes A→B and D→E at time zero.

| Job | Baseline arrival/status | Cut arrival/status |
| --- | --- | --- |
| `newly-late` | 10 s / on time | 16 s / late |
| `skipped` | 10 s / on time | null / unreachable |
| `previously-late` | 120 s / late | 0 s / on time |

The engine skips unreachable work immediately. Skipping the E stop removes its travel and service from vehicle `two`'s sequence. It does not erase the new late delivery on vehicle `one`.

Both runs have **one late job**, so net additional lateness is **zero**. Of three jobs, two have comparable arrivals, one is incomparable, one becomes newly late, and the maximum arrival slip is **six seconds**. The experiment includes a separate clear-road control. Its canonical fingerprint is `6cbf0f0d642e87b8e336c782e002e8e0b0fd8eb0cccf7b806b2eb1622f1655dd`.

```sh
# Exit 0: this policy permits one unreachable job and sees no net extra lateness.
node scripts/run-experiment.js docs/examples/net-lateness.experiment.json --max-extra-late 0 --max-unreachable 1

# Exit 1: the added gate catches the formerly on-time delivery.
node scripts/run-experiment.js docs/examples/net-lateness.experiment.json --max-extra-late 0 --max-unreachable 1 --max-newly-late 0

# Exit 0 at the exact arrival-slip boundary; use 5.999999999 to get exit 1.
node scripts/run-experiment.js docs/examples/net-lateness.experiment.json --max-newly-late 1 --max-arrival-slip-s 6 --json
```

Allowing an unreachable job here is an illustrative policy choice, not a recommendation. `--max-unreachable 0` would also reject this example for a different reason. The new arrival gate is useful even when every delivery remains reachable.

## Missing evidence stays explicit

Arrival differences exist only when the same job has finite arrival times in both runs. The summary reports `comparableJobs` and `uncomparableJobs`; it does not insert zero for missing timings.

- With at least one comparable job, `maxArrivalSlipS` is the maximum of zero and all comparable differences. Zero means none of those comparable jobs arrived later.
- With **no comparable jobs**, including an empty job list, `maxArrivalSlipS` is **null**. A requested arrival-slip gate **fails closed with exit 1** and reason `no-comparable-jobs`. There is no measured maximum to compare with the limit.
- A newly-late-only gate can still pass with zero comparable jobs. Its count is zero, and the summary retains the null timing maximum. It does not establish that deliveries were completed.

Use `--max-unreachable` alongside either new gate when skipped work should cause failure. Human output calls out incomparable timing evidence. The existing experiment warnings about skipped work remain present.

## Opt-in output contract

When either new flag is supplied, JSON adds `jobComparison` at the scenario result's top level or on **each experiment variant**:

```json
{
  "totalJobs": 3,
  "comparableJobs": 2,
  "uncomparableJobs": 1,
  "newlyLateJobs": 1,
  "maxArrivalSlipS": 6
}
```

Thresholds and violations use metric keys `newlyLateJobs` and `maxArrivalSlipS`. Ordinary violations keep `{metric, actual, limit}`. An unevaluable arrival gate uses:

```json
{"metric":"maxArrivalSlipS","actual":null,"limit":0,"reason":"no-comparable-jobs"}
```

Experiment top-level violations also identify `variantId`. Requested thresholds apply independently to every variant. One failed or unevaluable variant fails the experiment. The existing `delta` fields and canonical input fingerprints do not change.

Without either new flag, non-help stdout/JSON, stderr and exit behavior retain the prior contract; no `jobComparison` field is added. Help text documents the new options. The separate job-impact report keeps its existing version and complete-row format.

The gate helper matches jobs by identity across the already completed ledgers. It does not resimulate, infer routes, mutate input, change closure behavior or alter arrival deadlines. The full simulation and all existing workload/input bounds still apply before output. Invalid input or a failed simulation exits **2** with no partial report. Successful policy checks exit **0**; violations, including absent comparison evidence, exit **1** with the complete result.

## Regression checks

```sh
node --test tests/job-gates.test.js tests/job-gates-cli.test.js
npm run check
```

Tests cover masking, same-status deterioration, exact limits, fractional values, empty and wholly incomparable work, multi-variant failures, deterministic ordering, duplicates, invalid input, ID matching and old output compatibility. These are Node API/subprocess checks, not native browser, terminal-emulator, traffic or production-fleet validation.
