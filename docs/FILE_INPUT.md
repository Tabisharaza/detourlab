# File input and reproducible roundtrips

The workbench Import action, single-scenario CLI and experiment CLI use the same byte-decoding contract. These are local JSON inputs; the application does not upload scenarios.

## Encoding and limits

- Use UTF-8 JSON. Malformed UTF-8 is rejected before JSON/schema parsing, with an instruction to save the file as UTF-8 and retry. Bytes are never silently replaced with a different label.
- An optional leading UTF-8 byte-order mark (BOM) is accepted and counts toward the **2 MiB (2,097,152 byte)** input limit. Export emits UTF-8 without a BOM.
- A correctly encoded literal replacement character (`U+FFFD`) is valid Unicode. It is not evidence of corrupt bytes and is not rejected merely for being present in a label.
- The browser checks file size before requesting its bytes and checks the returned bytes again. Both CLIs require a regular file, check its reported size and read at most the limit plus one byte before decoding. Empty, over-limit, unreadable, malformed JSON, unsupported-version and invalid-schema files fail explicitly.
- CLI file opening uses a nonblocking flag to avoid waiting for a writer on a FIFO on supported systems. A regular-file check and byte limit are not a universal I/O deadline or protection against every filesystem failure.
- Byte limits are separate from the graph, variant, closure and execution budgets in [SECURITY.md](../SECURITY.md). File decoding does not change those budgets or the routing model.

The library's `parseScenario(text)` and `parseExperiment(text)` APIs still accept strings. A caller that decodes bytes before calling those APIs owns that decoding choice. The shared file-entry helper applies strict decoding to app/CLI file input; it does not guess how an existing JavaScript string was produced.

## Rejected imports and useful errors

An invalid import leaves the previous experiment intact. Reset, a newer import, starting the lesson or editing the experiment invalidates an older pending import; its eventual bytes or error cannot replace the current state.

Displayed file error bodies are limited to 512 UTF-16 code units (plus a fixed UI/CLI prefix) and escape control characters that could manipulate a terminal or obscure the message. Ordinary schema paths and version details remain useful. Imported labels continue to use text rendering, not HTML. The browser error appears in the existing polite status toast; it is not a persistent error panel, and no screen-reader announcement timing is claimed here.

Both CLIs report invalid input on stderr and exit **2**, without emitting a successful result to stdout. Their success (`0`) and threshold-failure (`1`) behavior is unchanged. For portable files and the multi-variant schema, see [SCENARIOS.md](SCENARIOS.md) and [EXPERIMENTS.md](EXPERIMENTS.md).

## Human CLI label display

The human-readable runners escape scenario, experiment and variant names at the output boundary. C0 controls (`U+0000–001F`), DEL/C1 (`U+007F–009F`), `U+061C`, `U+200E–200F`, line/paragraph separators and bidi controls in `U+2028–202E`, and `U+2066–206F` become visible lowercase `\uXXXX` text. This keeps an accepted name's carriage returns, newlines, tabs and these controls from adding report lines or acting as display controls. Literal backslashes are doubled: an actual `U+202E` displays as `\u202e`, while literal backslash-u text displays as `\\u202e`. Other characters, including ordinary Unicode and emoji, are preserved. Valid names are already bounded to 120 UTF-16 code units; their escaped display is not truncated.

This presentation rule does not change accepted input, stored labels, canonical hashes, simulation metrics, thresholds or exit codes. `--json` retains its existing bytes and decoded values. It is machine-readable data, **not terminal-sanitized presentation**: JSON serialization escapes C0 controls but may leave C1 and bidi characters literal. Consumers that display JSON values must apply their own presentation rules. Browser rendering and portable exports are unchanged.

`tests/cli-display-format.test.js` enumerates the formatter's control ranges and checks ordinary Unicode, literal escapes and full-length expansion. `tests/cli-display.test.js` runs both actual CLI subprocesses, including legacy scenario upgrade, success/threshold failure, and unchanged machine data. These are captured-output checks, not terminal-emulator testing or a general Unicode-spoofing guarantee.

## Why this changed

Before this milestone, the app and legacy scenario runner decoded malformed UTF-8 by replacing bad bytes, while the experiment runner rejected the same file. A corrupt byte within a JSON label could therefore be accepted, exported and permanently changed without notice. The legacy runner also read the entire input before checking its size, and could wait indefinitely on an unwritten FIFO. Large or control-bearing unknown property names could produce excessively long or terminal-active error text.

The fix aligns acquisition/decoding and presentation at the entry points. It does not relax schema validation, change valid scenario metrics or claim to repair a corrupted file.

## Reproduce the automated checks

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
node --test tests/file-input.test.js tests/file-input-cli.test.js tests/import-roundtrip.test.js
node --test tests/cli-display-format.test.js tests/cli-display.test.js
node --test tests/cli.test.js tests/experiment-cli.test.js
node scripts/verify-dist.js
```

The corpus uses seed `0x5eedc0de`: **48 small experiments, 189 variants and six empty-work cases**, with **25 targeted invalid-schema mutations** and three CLI subprocess samples. It checks exact-entry and ±0.125-second cutoffs against hand-derived arrival times. It is deterministic and intentionally small enough for ordinary CI. It checks valid roundtrips and malformed mutations alongside focused byte-boundary, asynchronous import and CLI regressions. Seeds, case counts and exact assertions are checked into the test source, rather than generated from wall-clock time. Node Blob/File and mocked DOM/Worker tests exercise checked-in application handlers; they are not native browser file-picker tests.

The outstanding real file-picker/download, browser Worker and cross-browser checks remain tracked in [issue #2](https://github.com/Tabisharaza/detourlab/issues/2). See [VERIFICATION.md](VERIFICATION.md) for the exact deployed version and separate browser observations. A source commit or green Node CI run alone does not mean the hosted demo has been updated.

## API references

- [Blob.text()](https://developer.mozilla.org/en-US/docs/Web/API/Blob/text) interprets the bytes as UTF-8.
- [TextDecoder.fatal](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/fatal) distinguishes rejection of malformed encoding from replacement decoding.
- [Blob.arrayBuffer()](https://developer.mozilla.org/en-US/docs/Web/API/Blob/arrayBuffer) supplies bytes for strict decoding.
- [Node filesystem APIs](https://nodejs.org/docs/latest-v24.x/api/fs.html) describe file handles, bounded reads, file types and open flags.

These primary API references were consulted on October 10, 2026. Project tests establish this implementation's tested behavior; the references are not independent verification of the app.
