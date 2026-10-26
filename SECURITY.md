# Security

DetourLab is an early browser-local simulation app. It has no app account system, backend scenario store or third-party connector. A hosting provider may process normal web-request metadata independently of the application.

## Handling untrusted inputs

- JSON is data; imported labels are rendered with `textContent`, not HTML.
- Validators copy plain records and reject unknown fields, unsafe identifiers, inherited/accessor/prototype properties, sparse or modified arrays, invalid references and non-finite values.
- Browser file input and all four CLI entry points reject malformed UTF-8 and are bounded at 2 MiB, including an optional leading BOM. All four CLI entry points require regular files and bound bytes actually read; the browser checks reported and returned byte sizes.
- File-error presentation escapes control characters and limits message length. These are entry-point controls; library callers that supply already-decoded strings remain responsible for their decoding choice. See [file-input behavior and verification limits](docs/FILE_INPUT.md).
- No imported script, URL fetch, map tile or plugin is executed.

## Current resource bounds

| Resource | Limit |
| --- | ---: |
| UTF-8 JSON input/export | 2 MiB |
| Nodes / directed edges | 2,000 / 8,000 |
| Vehicles / jobs | 100 / 2,000 |
| Experiment variants | 2–6 |
| Aggregate experiment closure events / edge references | 8,000 / 48,000 |
| Engine routing-edge / extracted-path visits | 20 million / 4 million |
| Segments per engine run | 250,000 |
| Returned segments per experiment, including baseline/control copies | 500,000 |
| Browser whole-experiment timeout | 30 seconds |

Timestamp inputs are bounded to 604,800 seconds; individual edge travel time is 0.1–86,400 seconds and distance is 0.01–1,000,000 meters. Other text, coordinate and numeric constraints remain authoritative in `src/scenario.js` and `src/experiment.js`.

A budget failure returns an explicit failure instead of partial success. Superseded/canceled workers are terminated, and stale replies/errors cannot restore their results. These controls reduce accidental and hostile resource exhaustion; they are not proof against all browser memory/CPU pressure.

## Local server and static hosting

The included development server binds to `127.0.0.1`, accepts only GET/HEAD and restricts paths to application assets. It rejects symbolic links at the selected preview root and in every requested descendant, including links to otherwise allowed assets. Hidden path components, percent-encoded backslashes remaining in decoded paths and non-regular files are also rejected with a generic 404. HEAD performs the same path checks without reading a file body. Use a real checkout or distribution directory rather than a linked preview root.

This is a trusted-checkout development preview, not a production server or a filesystem sandbox. Path inspection and file reading are separate operations: an untrusted concurrent writer can replace a checked component before the read. Hard links and symlinks in ancestors of the selected root are not independently rejected. Keep the checkout and its parent directories under trusted control; do not put private data in allowed asset directories. [Handler regression evidence and limits](docs/CI.md#preview-server-symbolic-link-rejection) are separate from native-browser and deployment checks. Static deployments need normal host-level HTTPS and security-header configuration. No credential belongs in the frontend or hosting manifest.

## Reporting a vulnerability

Do not post a working exploit, sensitive route file or personal data in a public issue. Use the repository's private vulnerability-reporting facility only if the published repository shows it as available, or contact its maintainer through a separately verified private channel. If neither is advertised, open a minimal issue asking for a private contact method without including exploit details or sensitive data. No private-reporting inbox or response-time guarantee is asserted here.

Enabling a private-reporting feature is optional and is not a condition for publishing this alpha. It requires a separate maintainer decision; this source bundle does not change account or repository security settings.

## Public fixtures and reports

Use synthetic or independently sanitized scenarios. Never commit passwords, API keys, tokens, real customer addresses, employee information or precise private fleet routes. The demo needs none of them. Reproduction reports should include a minimal fixture, expected/actual behavior and runtime version, with secrets and personal data removed.

The Node-only job-impact explainer caps its complete pretty JSON report at 4 MiB including the final newline. It runs under the existing whole-experiment budgets before emitting output; no partial report is printed on failure. Machine JSON preserves original label data and still needs safe handling by downstream displays. See [the report contract](docs/JOB_IMPACT.md).

The [experiment review packet](docs/REVIEW_PACKETS.md) caps complete JSON at 8 MiB and readable Markdown at 1 MiB. It embeds the entire input, so inspect a packet before sharing it. Readable labels use separate Markdown/control escaping; machine strings are unchanged. Output refuses an existing destination and publishes fixed filenames without replacing unrelated files. Read the documented filesystem visibility and integrity limits: hashes are not signatures, and a packet is complete only when both artifacts are present.
