# DetourLab experiment review

One second changes the route · experiment minimal&#45;cutoff&#45;experiment

Overall policy verdict: **passed**. Every supplied variant is evaluated independently; no automatic best variant is selected.

Scenario: Four&#45;node directed example. Seed: 1. Network: 4 nodes, 4 directed edges. Demand: 1 vehicles, 1 jobs. Display horizon: 60 s; it does not truncate the simulation.

A small reproducible network&#58; close B to C at 10 seconds and route B to D to C instead&#46;

## Decision limits

- Synthetic scenario with fixed travel times; this is not a forecast, operational safety certification or route optimization.
- Vehicle assignments and supplied per-vehicle job order remain fixed. Deadlines apply to arrival; service completion is separate. Engine floating-point boundary tolerance is preserved.
- Unreachable jobs are skipped. Lower distance or fewer late jobs may reflect lost service and do not establish an equal-service improvement. Review completed and unreachable work together.
- Timing differences are null if either arrival is unreachable. No comparable arrivals fails a requested maximum-arrival-slip gate; no policy means not-evaluated.
- Changed outcomes do not prove a changed route, closure causality or a better plan. Unchanged outcomes do not prove identical routes.

## Reproducibility and integrity

- Experiment SHA-256: 7a757f1b53531826e98f44a706d3c6d235986682e6517c3c542f116fa8bf7395
- Policy SHA-256: 5b1d040cbd8516b8637db5141e0c73748c9090a081cf12200b70dd4d40b87a67
- Bundle integrity SHA-256: 4c9611f334134ef93c488e6451e01cd52a09c60b2298c2d59ca9dc880453bb50
- Engine version: 0&#46;1&#46;0. Generator: detourlab; package version: 0&#46;1&#46;0; report version: 1.
- Source revision: unknown. Generator metadata is supplied, not authenticated by the model helper.
- Implementation fingerprint: 9c75aee3c2e981ed7e603a7171b37411c0b37b240923c11d1562fcc5c55753b4.
- Hashes identify content; they are not signatures or proof of authorship. Bundle integrity hashes canonical JSON of all fields except integrity. Canonical JSON sorts object keys and preserves array order; the file itself is readable indented JSON.
- The full normalized experiment, ordered policy, every outcome and every violation are embedded in bundle.json. No timestamp, local input path or user identity is inferred.

## Acceptance policy

| Metric | Maximum allowed | Meaning |
| --- | ---: | --- |
| unreachableJobs | 0 | Absolute unreachable-job count in this variant, not a baseline difference. |
| maxArrivalSlipS | 6 | Maximum positive comparable arrival difference, floored at zero; null with no comparable jobs fails closed. |

Equality meets a limit. Thresholds apply to every variant and use literal timing precision.

## All-variant summary

| Run | Verdict | Distance (m) | Completed / total | On-time | Late | Unreachable | Changed jobs | Newly late | Max arrival slip (s) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Clear-road baseline | reference | 200 | 1 / 1 | 1 | 0 | 0 | — | — | — |
| Clear roads (clear) | passed | 200 | 1 / 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| Close at 10 s (close&#45;at&#45;10) | passed | 260 | 1 / 1 | 0 | 1 | 0 | 1 | 1 | 6 |
| Close at 11 s (close&#45;at&#45;11) | passed | 200 | 1 / 1 | 1 | 0 | 0 | 0 | 0 | 0 |

Baseline totals: 20 s travel; 0 s arrival delay; 0 reroutes; 0 affected vehicles.

## Variant 1: Clear roads

ID: clear. Policy verdict: **passed**.

### Complete closure schedule

0 closure records; 0 directed-edge references; 0 distinct affected directed edges. Records below retain input order. Each edge remains closed from its earliest listed closure time; repeated references do not reopen it. Entry decisions respect engine boundary tolerance; an already-entered edge finishes.

Clear-road control: no closures.

### Outcomes and gates

- Completed 1/1; on-time 1; late 0; unreachable 0 (0 newly unreachable).
- Distance 200 m; travel 20 s; arrival delay 0 s; reroutes 0; affected vehicles 0.
- Baseline differences: +0 m distance, +0% distance, +0 net late jobs. The unreachable gate value is the absolute count 0.
- Job outcomes: 0 changed, 1 unchanged; 0 status changes; 0 arrival changes. 0 arrive later but remain on time.
- Comparable arrivals: 1; uncomparable: 0; newly late: 0; maximum arrival slip: 0 s.

All requested thresholds met for this variant.

Status transitions (baseline rows → variant columns):

| Baseline → variant | on-time | late | unreachable |
| --- | ---: | ---: | ---: |
| on-time | 1 | 0 | 0 |
| late | 0 | 0 | 0 |
| unreachable | 0 | 0 | 0 |

### Exception jobs

Showing 0 of 0 changed jobs; 0 omitted here. The full 1 machine rows, including unchanged jobs, are in bundle.json.

Priority: newly unreachable, newly late, then largest positive comparable arrival slip, then other changed outcomes. Ties retain original input order. At most 20 rows per variant.

No changed job outcomes.

## Variant 2: Close at 10 s

ID: close&#45;at&#45;10. Policy verdict: **passed**.

### Complete closure schedule

1 closure records; 1 directed-edge references; 1 distinct affected directed edges. Records below retain input order. Each edge remains closed from its earliest listed closure time; repeated references do not reopen it. Entry decisions respect engine boundary tolerance; an already-entered edge finishes.

| Closure ID | Closes at (s) | Directed edge IDs |
| --- | ---: | --- |
| bc&#45;closure | 10 | bc |

### Outcomes and gates

- Completed 1/1; on-time 0; late 1; unreachable 0 (0 newly unreachable).
- Distance 260 m; travel 26 s; arrival delay 4 s; reroutes 1; affected vehicles 1.
- Baseline differences: +60 m distance, +30% distance, +1 net late jobs. The unreachable gate value is the absolute count 0.
- Job outcomes: 1 changed, 0 unchanged; 1 status changes; 1 arrival changes. 0 arrive later but remain on time.
- Comparable arrivals: 1; uncomparable: 0; newly late: 1; maximum arrival slip: 6 s.

All requested thresholds met for this variant.

Status transitions (baseline rows → variant columns):

| Baseline → variant | on-time | late | unreachable |
| --- | ---: | ---: | ---: |
| on-time | 0 | 1 | 0 |
| late | 0 | 0 | 0 |
| unreachable | 0 | 0 | 0 |

### Exception jobs

Showing 1 of 1 changed jobs; 0 omitted here. The full 1 machine rows, including unchanged jobs, are in bundle.json.

Priority: newly unreachable, newly late, then largest positive comparable arrival slip, then other changed outcomes. Ties retain original input order. At most 20 rows per variant.

| Job / vehicle / destination | Baseline → variant status | Arrival baseline → variant | Completion baseline → variant | Arrival slip | Delay baseline → variant | Arrival due |
| --- | --- | --- | --- | ---: | --- | ---: |
| job&#45;1 / van&#45;1 / C | on-time → late | 20 s → 26 s | 23 s → 29 s | +6 s | 0 s → 4 s | 22 s |

## Variant 3: Close at 11 s

ID: close&#45;at&#45;11. Policy verdict: **passed**.

### Complete closure schedule

1 closure records; 1 directed-edge references; 1 distinct affected directed edges. Records below retain input order. Each edge remains closed from its earliest listed closure time; repeated references do not reopen it. Entry decisions respect engine boundary tolerance; an already-entered edge finishes.

| Closure ID | Closes at (s) | Directed edge IDs |
| --- | ---: | --- |
| bc&#45;closure | 11 | bc |

### Outcomes and gates

- Completed 1/1; on-time 1; late 0; unreachable 0 (0 newly unreachable).
- Distance 200 m; travel 20 s; arrival delay 0 s; reroutes 0; affected vehicles 0.
- Baseline differences: +0 m distance, +0% distance, +0 net late jobs. The unreachable gate value is the absolute count 0.
- Job outcomes: 0 changed, 1 unchanged; 0 status changes; 0 arrival changes. 0 arrive later but remain on time.
- Comparable arrivals: 1; uncomparable: 0; newly late: 0; maximum arrival slip: 0 s.

All requested thresholds met for this variant.

Status transitions (baseline rows → variant columns):

| Baseline → variant | on-time | late | unreachable |
| --- | ---: | ---: | ---: |
| on-time | 1 | 0 | 0 |
| late | 0 | 0 | 0 |
| unreachable | 0 | 0 | 0 |

### Exception jobs

Showing 0 of 0 changed jobs; 0 omitted here. The full 1 machine rows, including unchanged jobs, are in bundle.json.

Priority: newly unreachable, newly late, then largest positive comparable arrival slip, then other changed outcomes. Ties retain original input order. At most 20 rows per variant.

No changed job outcomes.

## Reproduce from the embedded input and policy

Use a trusted checkout and a supported Node version. Place both saved files at the fixed placeholder path review-packet/. This read-only check requires the recorded implementation fingerprint to match the checkout, reruns all variants with the embedded policy, and compares both complete files byte for byte. Unknown provenance fails explicitly. Hash agreement does not authenticate the supplied generator metadata or source revision. No experiment label is used as a command.

```sh
node --input-type=module -e '
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { createExperimentReport, serializeExperimentReport, REPORT_LIMITS } from "./scripts/experiment-report.js";
import { createReportIdentity } from "./scripts/report-identity.js";
async function readBounded(file, limit) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("Packet input must be a regular file");
    if (stat.size > limit) throw new Error("Packet input exceeds byte limit");
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) throw new Error("Packet input exceeds byte limit");
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}
const original = await readBounded("review-packet/bundle.json", REPORT_LIMITS.maxBundleBytes);
const originalReview = await readBounded("review-packet/REVIEW.md", REPORT_LIMITS.maxReviewBytes);
const saved = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(original));
new TextDecoder("utf-8", { fatal: true }).decode(originalReview);
const current = await createReportIdentity();
const claimed = saved.generator?.implementation;
if (!claimed || claimed.algorithm !== "sha256" || claimed.sha256 !== current.implementation.sha256 || JSON.stringify(claimed.files) !== JSON.stringify(current.implementation.files)) throw new Error("Unknown or mismatched implementation fingerprint");
const rerun = createExperimentReport(saved.experiment, saved.policy, saved.generator);
const repeated = serializeExperimentReport(rerun);
if (!Buffer.from(repeated.bundleJson, "utf8").equals(original) || !Buffer.from(repeated.reviewMarkdown, "utf8").equals(originalReview)) throw new Error("Report differs");
console.log("Exact packet reproduction verified");
'
```

A reproduced policy failure remains a failure. An exact match establishes reproducibility under these inputs and implementation, not real-world validity.
