# Compare any two named plans

A plan can have fewer late deliveries overall while still making individual
deliveries arrive later. Compare the two schedules directly instead of joining
two reports that each use the clear-road baseline.

```sh
node scripts/compare-variants.js examples/minimal-experiment.json \
  --reference close-at-10 --candidate close-at-11
```

The tiny synthetic example has one delivery. With the 10-second cutoff, the
van takes the 260 m detour and arrives at 26 s. With the 11-second cutoff, it
has already entered the affected edge and arrives at 20 s after 200 m of
travel. The report shows **−60 m, one fewer late delivery and the same number
completed**. Arrival and service completion both shift by −6 s; lateness
shifts by −4 s because the deadline is 22 s. The [tiny JSON example](examples/variant-comparison/tiny.json)
is actual generated output and is reproduced byte-for-byte in the CLI tests.

## Read the trade-offs in Meridian

```sh
node scripts/compare-variants.js examples/meridian-experiment.json \
  --reference market-05 --candidate market-10 --json > comparison.json
```

The checked-in synthetic district gives these results:

| Measure | 5-minute closure (reference) | 10-minute closure (candidate) | Candidate − reference |
| --- | ---: | ---: | ---: |
| Distance | 377,080 m | 376,600 m | −480 m |
| Late deliveries | 118 | 106 | −12 |
| Unreachable deliveries | 0 | 0 | 0 |
| Completed deliveries | 192 | 192 | 0 |

Of those same 192 deliveries, **46 arrive earlier, 81 at the same time and 65
later**. Twelve change from late to on time. For a contrast, choose
`all-bridges-05` as the candidate: it has 118 fewer late deliveries than
`market-05`, but it also leaves 57 deliveries unreachable and completes 57
fewer. Their arrival differences are not comparable. Do not treat a decrease
in late jobs or distance as improvement without also checking completed work.

## Output and limits

- **Reference and candidate** are distinct IDs in the same experiment. They may
  represent any two saved schedules, including a named clear-road control. The
  built-in baseline is not an implicit selector. Legacy scenarios are upgraded
  as usual to `supplied` and `clear-roads`.
- **Human output** lists overall metrics, nonzero status transitions and the
  first 20 changed deliveries in original input order. This is a preview, not a
  ranking. Labels use the existing [terminal display policy](FILE_INPUT.md#human-cli-label-display).
- **`--json`** emits `detourlab-variant-comparison` version 1, with the engine
  version, the canonical experiment SHA-256, both plans and their complete
  metrics, signed aggregate differences, summary and every delivery in input
  order (at most 2,000). Names retain their original values. The hash identifies
  the entire validated experiment, not just the selected pair, and is not a
  signature. There is no execution timestamp or local path in the report.
- Each row includes the delivery, vehicle and destination IDs, arrival
  deadline, both statuses, arrivals, service completions, lateness, and signed
  timing differences. All times are in seconds. Differences are **candidate
  minus reference**, computed from the recorded values without an added
  rounding step. A missing arrival, completion or lateness is JSON `null`, and
  its difference is also `null`. A real zero stays zero.
- The summary includes all nine status transitions. The arrival buckets are
  mutually exclusive: **earlier**, **unchanged** and **later** require two
  recorded arrivals; **not comparable** includes every row missing an arrival
  on either side. A delivery unreachable on both sides belongs to that last
  bucket but is not counted as changed. A row is changed if its status,
  arrival or completion differs, not necessarily its route.

The command validates and simulates the whole experiment **once**, keeping
all existing byte, work and aggregate result limits, even for unselected plans.
Input is a local regular JSON file, up to 2 MiB, using the existing strict UTF-8
reader. The complete JSON output is capped at 4 MiB including its final newline.
The command only writes stdout or a diagnostic on stderr. Use a new output
filename when redirecting: never redirect onto the input file.

Exit **0** means a report was produced. Exit **2** means invalid input, a limit
was exceeded or simulation failed; no partial report is emitted. There is no
threshold verdict. Use the existing [job gates](JOB_GATES.md) for acceptance
against clear roads and [job impact](JOB_IMPACT.md) for a one-plan comparison
with CSV. Neither output format has changed.

This is deterministic synthetic fixed-order analysis. It does not explain
individual closure causality, find an optimum, or predict real traffic. It adds
a local CLI workflow without changing the model, browser workbench, dependencies
or hosted demo.

## Verify

```sh
node --test tests/variant-comparison.test.js tests/variant-comparison-cli.test.js
npm run check
node scripts/verify-dist.js
```
