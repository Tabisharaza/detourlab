# Explain delivery impacts without the map

Aggregate counts answer how much changed. The job-impact explainer shows which deliveries changed, including later arrivals that still meet their deadlines. It compares one named variant with the same clear-road baseline used by the experiment runner.

```sh
node scripts/explain-experiment.js examples/minimal-experiment.json --variant close-at-10
node scripts/explain-experiment.js examples/meridian-experiment.json --variant market-05 --json > impact.json
```

No installation, browser, network, account or API key is needed. The input must be a local synthetic experiment or legacy scenario. The existing threshold runners and their output formats are unchanged.

## Trace the tiny example

The bundled `close-at-10` variant produces this job comparison:

```text
job-1 / vehicle van-1 / node C
  on-time -> late; arrival deadline 22 s
  Arrival 20 s -> 26 s; difference +6 s
  Service complete 23 s -> 29 s; difference +6 s
  Lateness 0 s -> 4 s; difference +4 s
```

These lines are actual captured command output. Its experiment fingerprint is `7a757f1b53531826e98f44a706d3c6d235986682e6517c3c542f116fa8bf7395`. Arrival and service completion are distinct: service takes three seconds after arrival. The six-second arrival shift turns an on-time delivery into one that is four seconds late.

Run the same command with `--variant close-at-11`: the job remains unchanged at arrival 20 s and completion 23 s. The vehicle entered the affected edge before its closure. See the [tiny walkthrough](EXPERIMENTS.md#tiny-walkthrough-one-second-changes-the-route) for the hand-checkable graph.

## Find impacts hidden by aggregate lateness

In the bundled Meridian experiment, `market-05` changes **125 job outcomes**, although only **118 jobs change from on-time to late**. All 192 jobs remain reachable. The other seven changed jobs arrive later but remain on time.

For example, `job-01-4`, assigned to `van-01`, has deadline 749 s. It arrives at 690 s in the baseline and 741 s in `market-05`: a **51 s** shift with **zero lateness in both runs**. Service completion moves from 710 s to 761 s. The report marks the outcome changed and the status unchanged.

The same job becomes unreachable in `all-bridges-05`. Its variant arrival, service completion and lateness are `null`; their comparisons are also `null`, not zero, negative delay or a claimed improvement. That variant has 57 unreachable jobs. Its shorter aggregate traveled distance must be read alongside skipped work.

The Meridian experiment fingerprint is `debaaf4b86e70a869608051ee8aad856b7699e2d964c4f7455a523c242ae318c`. Variant selection does not change this fingerprint: it identifies the entire validated experiment, including every schedule.

## Human and JSON views

The human view prints all nonzero status-transition counts and the first **20 changed jobs in original input order**. It states how many changed rows were omitted. This is a view limit, not ranking by severity or arrival time. `--json` emits **every job**, including unchanged and unreachable work, up to the existing 2000-job input bound.

Human headings escape supported control characters and literal backslashes using the existing [CLI display policy](FILE_INPUT.md#human-cli-label-display). JSON retains original label values as machine-readable data. It is not terminal-sanitized text; downstream renderers need their own display rules.

The JSON format is `detourlab-job-impact`, version `1`:

- `engineVersion`, `experimentId`, `experimentSha256`: model version and canonical input identity. No execution timestamp or local file path is included.
- `variant`: the selected variant's ID and original name.
- `baselineMetrics`, `variantMetrics`, `delta`: the same complete metrics and signed aggregate delta returned by the experiment runner. `delta.unreachableJobs` is an absolute variant count; aggregate distance deltas retain the runner's existing six-decimal rounding.
- `summary`: total, changed and unchanged job counts; status-change and arrival-change counts; and all nine baseline-to-variant status transitions. Zero-count transitions are retained.
- `jobs`: one row per original `baseScenario.jobs` entry, preserving that array's order across vehicles. Each row identifies its job, vehicle, destination node and arrival deadline.
- Each row's `baseline` and `variant` values contain `status`, `arrivalS`, `completedS` and `delayS`. Each row also has `changed`, `statusChanged`, `arrivalDeltaS`, `completedDeltaS` and `delayDeltaS`.

Timing units are seconds. Per-job numeric differences are **variant minus baseline**, without decimal rounding. A negative comparable difference means an earlier time or reduced lateness in this model; it is not proof of a better overall plan. A difference is `null` if either side is unreachable. Arrival-change counts include a number becoming `null` or vice versa.

`changed` means that status, arrival or service completion differs. It does not mean that the route changed. Identical outcomes do not prove identical paths. Status and lateness preserve the engine's floating-point boundary tolerance; a numerically tiny positive deadline difference already classified on time stays on time with zero lateness.

For CI policies that reject individual regressions, the [opt-in job gates](JOB_GATES.md) limit newly late deliveries and worst comparable arrival slip. The impact report itself remains diagnostic and keeps its existing output contract.

## Scope and limits

- The command validates and simulates the **whole experiment**, then selects a report. An invalid or over-budget unselected variant can therefore reject the run, just as in the existing experiment runner.
- Input uses the existing bounded regular-file reader: at most **2 MiB** including a leading BOM, strict UTF-8, strict fields and references. Named pipes and directories are rejected. Files are never rewritten.
- The full two-space-indented JSON output, including its final newline, is capped at **4 MiB**. Failure produces a bounded stderr message and no partial report.
- `--variant ID` is required and may appear once. Unknown variants, unsupported options, multiple files and missing values fail explicitly. Use `./` for a filename beginning with `-`.
- A legacy scenario is upgraded to `supplied` and `clear-roads` variants under the existing import contract. Supply one of those IDs when explaining a scenario file.
- Exit `0` means the report was produced. It is **not a threshold verdict**. Invalid input or failed simulation exits `2`. Use `scripts/run-experiment.js` and its threshold flags for acceptance gates.

This is an outcome comparison, not complete causal attribution. The existing segment ledger has no per-job attempt boundary, so this report does not infer per-job edge traces, route distances or a causal closure for every downstream delay. Jobs retain their assignment and sequence; unreachable work is skipped under the unchanged model. No routing, import/export format, browser interface or live deployment is changed by this tool.

## Verify the command

```sh
node --test tests/job-impact.test.js tests/job-impact-cli.test.js
npm run check
```

Tests cover the tiny cutoff boundary, same-status arrival shifts, skipped-work nulls, input order, baseline lateness, fractional deadline tolerance, immutable inputs, deterministic hashes and output, safe human labels, byte limits, failed budgets and hostile/nonregular files. These are Node API and subprocess checks. They do not close native browser import/export or rendering-profile issues.
