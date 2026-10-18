# Share a reproducible experiment review

A review packet keeps the experiment, acceptance limits, all variant results and delivery-level changes together. The recipient can read `REVIEW.md` without installing anything, then rerun the embedded experiment with the same source implementation. The command needs no browser, network, API key or package installation.

```sh
node scripts/report-experiment.js examples/minimal-experiment.json \
  --out tiny-review --max-arrival-slip-s 6 --max-unreachable 0
```

[Read the checked-in tiny packet](examples/tiny-review/REVIEW.md) and its [machine data](examples/tiny-review/bundle.json). An automated check regenerates both files byte-for-byte using the current source implementation and the command above.

The destination must not exist, and its parent directory must already exist. The command creates exactly two files:

- `bundle.json`: the complete versioned machine report, including the validated input and supplied policy
- `REVIEW.md`: readable comparisons, important exceptions, warnings and reproduction instructions

The tiny example has one delivery due at 22 seconds. Its clear-road arrival is 20 seconds. `close-at-10` arrives at 26 seconds, a six-second slip and four seconds of lateness. `close-at-11` remains at 20 seconds because the vehicle entered the affected edge before the closure. The six-second acceptance limit permits equality; it does not mean the delivery was on time.

For a deliberately failing policy, choose a different unused output directory:

```sh
node scripts/report-experiment.js examples/minimal-experiment.json \
  --out tiny-review-failed --max-newly-late 0
```

Exit **1** still produces the complete packet. It records the newly late job rather than hiding a failed experiment. No thresholds means **not evaluated**, not an acceptance pass.

## Questions the review answers

1. Which input and closure schedules were compared?
2. Which plans meet the limits actually supplied?
3. Which deliveries became unreachable or late, or arrived later while remaining on time?
4. Did skipped work make lower distance or lateness totals misleading?
5. What input, policy and implementation identity are needed to reproduce the comparison?

Every variant gets aggregate metrics, all status-transition counts and comparable-arrival statistics. The readable view includes up to **20 exception jobs per variant**, ordered by newly unreachable jobs, newly late jobs, then the largest positive comparable arrival slips. Ties retain original input job order. Omitted counts are explicit; machine output retains every job. This is an inspection priority, not an automatic choice of a best plan.

In the larger example, `market-05` changes 125 outcomes, although only 118 jobs become late. Seven changed deliveries still meet their deadlines. The `all-bridges-05` plan has 57 unreachable jobs: its lower traveled distance is not evidence of equal-service improvement.

```sh
node scripts/report-experiment.js examples/meridian-experiment.json \
  --out meridian-review
```

## Policy and exit codes

The report reuses the [existing five threshold flags](JOB_GATES.md). They apply independently to every variant:

| Flag | Existing meaning |
| --- | --- |
| `--max-extra-distance-pct N` | Signed aggregate distance growth percentage, with existing runner rounding |
| `--max-extra-late N` | Signed net additional late-job count |
| `--max-unreachable N` | Absolute variant unreachable-job count |
| `--max-newly-late N` | Baseline on-time to variant-late count |
| `--max-arrival-slip-s N` | Maximum positive unrounded arrival slip among jobs reachable in both runs |

Values must be finite and nonnegative. Each flag may appear once. Flag order does not affect the packet. Exact equality satisfies a limit. A requested arrival-slip gate fails closed when there are no comparable jobs; it does not substitute zero for missing evidence.

- **0:** complete packet generated, with all supplied limits met or no acceptance limits supplied
- **1:** complete packet generated with at least one failed or unevaluable requested gate
- **2:** invalid arguments/input, failed simulation, output-size limit or filesystem failure

There is no `--json` flag: the packet already contains JSON. `--help` reads no input. Use `./` for a filename beginning with `-`. Legacy scenario inputs are upgraded to the existing `supplied` and `clear-roads` variants.

## Machine contract

`bundle.json` has format `detourlab-experiment-report`, version `1`. It contains the complete normalized experiment and its existing canonical SHA-256, resolved policy and policy SHA-256, baseline metrics and jobs, and every variant's metrics, deltas, outcome summaries, job rows, ordered gate evaluations, verdict and violations. Machine-readable assumptions and skipped-work warnings preserve the interpretation limits even without the readable file.

Baseline identity/outcomes are stored once. Variant rows retain original job order and refer to those same jobs. Timing values are seconds with literal engine precision; unreachable arrivals, completions and comparisons remain `null`. Existing aggregate rounding and status tolerance are preserved. A changed outcome does not prove a changed route or identify a causal closure.

The report includes explicit generator/implementation identity and a content-integrity hash. It contains no timestamp, hostname, absolute input path or user name. JSON preserves valid original labels; downstream displays must treat them as untrusted data. The readable report separately encodes Markdown/HTML punctuation and displays line breaks, terminal controls and bidirectional control characters as visible escapes. This is not a certification of every third-party Markdown renderer. Labels never become filenames or shell commands.

## What the fingerprints establish

- The experiment fingerprint identifies the entire canonical validated input, including every closure schedule, independent of JSON whitespace or object-key order.
- The policy fingerprint identifies the resolved supplied limits in a fixed order.
- The implementation fingerprint hashes exact bytes of an explicit source-file allowlist covering the report command and its computation/serialization dependencies. The generator records that coverage; it does not fingerprint the entire repository, documentation, operating system or Node binary.
- `sourceRevision` is `null` when no revision was independently established. Package version `0.1.0` is not treated as proof of an exact commit.
- The payload integrity hash covers canonical JSON with sorted object keys and significant array order, excluding the integrity field. A separate review SHA-256 binds the exact UTF-8 `REVIEW.md` bytes, including its final newline. Hashes are not signatures and do not prove authorship or that a simulation is valid. Anyone who changes content can also calculate another hash.

Use a trusted source checkout and compare implementation identity when reproducing a packet. Embedding input makes rerunning possible; a fingerprint by itself is not evidence that someone reran it. The generated bounded reproduction command verifies the current implementation fingerprint, reruns the embedded input/policy and compares the recorded artifacts. It fails on unknown or mismatched implementation identity. Do not import a report bundle directly into the app: extract its `experiment` field first.

## Resource and filesystem boundaries

The existing strict UTF-8 **2 MiB regular-file input** and whole-experiment simulation budgets apply before reporting. The input allows 2–6 variants and at most 2,000 jobs. The complete pretty-printed machine bundle is capped at **8 MiB**, and the readable review at **1 MiB**, including their final newlines. Oversized reports fail explicitly rather than dropping machine rows.

The command stages and bounds both files before reserving a fresh output directory. It refuses existing files, directories and symlinks at the destination. Completed files are published with no-replace hard links, `REVIEW.md` first and `bundle.json` last. This is **not atomic directory visibility**: a concurrent reader may briefly observe a reserved directory with zero or one file. A packet is complete only when both files are present and its integrity checks succeed. Do not consume a directory while the command is still running.

Filesystems without hard-link support fail safely. Cleanup removes only entries owned by the attempted write, not unrelated preexisting files. These protections are not a security boundary against an untrusted co-writer with access to replace ancestor directories or output entries. Keep review output in a directory you control. No Windows/macOS filesystem verification is claimed by the Linux test suite.

The packet includes the entire input. Use synthetic or independently sanitized data and review it before sharing. This local command does not upload anything or make a directory public.

## Architecture and verification

The command validates the experiment, runs the existing whole-experiment simulation once, projects every variant from those completed ledgers and evaluates the existing gates from the same data. Shared pure projection also serves the existing single-variant explainer without changing its output contract. No routing, browser, schema or dependency changes are required.

```sh
node --test tests/experiment-report.test.js tests/experiment-report-cli.test.js tests/review-packet-filesystem.test.js tests/review-example.test.js
npm run check
node scripts/verify-dist.js
```

Regression coverage includes fixture reconciliation, embedded-input reproduction, deterministic bytes, policy ordering, null comparisons, hostile labels, bounded serialization and non-overwriting output behavior. Existing explainer and threshold commands remain compatible. These are Node/model/subprocess checks. Browser file-picker/download, keyboard, visual and profiling gaps remain recorded separately in [VERIFICATION.md](VERIFICATION.md).
