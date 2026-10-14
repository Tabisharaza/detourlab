# JSON Schemas for format v1

DetourLab provides original, MIT-licensed JSON Schemas for editor completion and early structural diagnostics:

- [`schemas/scenario-v1.schema.json`](../schemas/scenario-v1.schema.json): a standalone scenario v1
- [`schemas/experiment-v1.schema.json`](../schemas/experiment-v1.schema.json): an experiment v1 with 2–6 variants and a complete shared scenario whose `closures` is empty

Both use JSON Schema Draft-07 and standard keywords only. The experiment schema reuses the scenario's definitions through relative `$ref` values. Keep the two files together. Their `$id` values identify the schemas at this repository's raw-source URLs; schema identity is not a claim that those URLs are published, reachable or cached in a particular editor. An offline validator must load/register both local files rather than fetching references from the network.

These schemas describe the existing format. They do not change runtime validation or routing behavior. The [scenario contract](SCENARIOS.md), [experiment contract](EXPERIMENTS.md), [`src/scenario.js`](../src/scenario.js) and [`src/experiment.js`](../src/experiment.js) remain the authority for importing and running data.

## Associate files in an editor

Open the repository root in VS Code. The checked-in [workspace settings](../.vscode/settings.json) associate the five example files and filenames ending in `.scenario.json` or `.experiment.json` with their local schemas. Matching names can also be used for new synthetic inputs, for example `my-network.scenario.json` and `my-comparison.experiment.json`.

For another workspace, copy the two schema files into its `schemas/` directory, then merge the following into that workspace's `.vscode/settings.json`. Preserve other settings and existing schema associations. Adjust the file matches to your own files; do not associate every JSON file with DetourLab.

```json
{
  "json.schemas": [
    {
      "fileMatch": ["/**/*.scenario.json"],
      "url": "./schemas/scenario-v1.schema.json"
    },
    {
      "fileMatch": ["/**/*.experiment.json"],
      "url": "./schemas/experiment-v1.schema.json"
    }
  ]
}
```

The schema descriptions explain seconds, meters, directed edges, assigned job order, arrival deadlines and closure cutoffs. Use the editor's completion and hover help when authoring a matching file, and review its Problems panel for diagnostics. Other editors can associate these same Draft-07 schemas through their own configuration. Their reference resolution, regular-expression implementation and completion presentation may differ.

**Do not add a `$schema` property to a scenario or experiment document.** DetourLab rejects unknown fields, including `$schema`. Associate the schema in editor settings instead. The `$schema` properties inside the schema files themselves declare their dialect and are intentional.

## Valid examples

The five checked-in fixtures are complete examples:

- Scenarios: [`minimal-directed.json`](../examples/minimal-directed.json), [`meridian-default.json`](../examples/meridian-default.json), [`meridian-all-bridges.json`](../examples/meridian-all-bridges.json)
- Experiments: [`minimal-experiment.json`](../examples/minimal-experiment.json), [`meridian-experiment.json`](../examples/meridian-experiment.json)

A smaller valid scenario can contain one node, one vehicle and no work or roads. Save this as `idle.scenario.json`:

```json
{
  "version": 1,
  "id": "idle",
  "name": "Idle vehicle",
  "seed": 0,
  "description": "A synthetic one-node scenario with no jobs.",
  "nodes": [{ "id": "depot", "x": 0, "y": 0 }],
  "edges": [],
  "vehicles": [{ "id": "van", "startNode": "depot", "startTimeS": 0 }],
  "jobs": [],
  "closures": [],
  "durationS": 1
}
```

Here is a complete valid experiment over the same input, saved as `idle.experiment.json`. Different variant IDs can have identical schedules; names need not be unique.

```json
{
  "format": "detourlab-experiment",
  "version": 1,
  "id": "idle-comparison",
  "name": "Two clear-road controls",
  "baseScenario": {
    "version": 1,
    "id": "idle",
    "name": "Idle vehicle",
    "seed": 0,
    "description": "A synthetic one-node scenario with no jobs.",
    "nodes": [{ "id": "depot", "x": 0, "y": 0 }],
    "edges": [],
    "vehicles": [{ "id": "van", "startNode": "depot", "startTimeS": 0 }],
    "jobs": [],
    "closures": [],
    "durationS": 1
  },
  "variants": [
    { "id": "clear-a", "name": "Clear A", "closures": [] },
    { "id": "clear-b", "name": "Clear B", "closures": [] }
  ]
}
```

Fractional time and distance values are allowed within their bounds. Only `seed` must be an integer. A scenario must have at least one node and one vehicle; edges, jobs and closures may be empty. A closure event itself must contain at least one affected edge.

## Invalid examples caught by the schemas

Each edit below starts from a complete valid document and makes it invalid:

| Edit | Structural diagnostic |
| --- | --- |
| Add `"notes": "extra"` to the root or a record | Unknown property |
| Remove `description` from a scenario | Missing required property |
| Change `version` to `2` | Wrong format version |
| Change an ID to `"constructor"` or `"bad id"` | Reserved or malformed identifier |
| Change `name` to `" \t\n"` | Blank label |
| Include `"\u0001"` in a name | Unsupported low control character |
| Set `seed` to `1.5` or `4294967296` | Noninteger or out-of-range seed |
| Set `durationS` to `0` or an edge's `travelTimeS` to `0.09` | Numeric bound violation |
| Set `nodes` or `vehicles` to `[]` | Required nonempty array |
| Set a closure's `edgeIds` to `[]` or `["bc", "bc"]` | Empty or duplicate edge references within one event |
| Supply one or seven experiment variants | Variant count outside 2–6 |
| Put a closure in `baseScenario.closures` | Base scenario must have an empty closure schedule |

Every object record requires all of its documented properties and rejects unknown ones. IDs are 1–96 ASCII characters, starting with a letter or digit and continuing with letters, digits, `_`, `.`, `:` or `-`. `__proto__`, `prototype` and `constructor` are prohibited. Display labels are nonblank and prohibit U+0000–U+0008, U+000B, U+000C and U+000E–U+001F; tab, line feed and carriage return remain allowed when the label contains non-whitespace text.

## Checks that still require the runtime

Passing a schema is useful early feedback, not permission to skip DetourLab validation. In particular:

- **Foreign keys:** `from`, `to`, `startNode`, `nodeId`, `vehicleId` and closure edge IDs must point to existing records. A syntactically valid `"startNode": "missing"` passes the schema but fails the runtime when no such node exists.
- **Record-ID uniqueness:** IDs must be unique within the relevant nodes, edges, vehicles, jobs, closure schedule or variants array. Two nodes with the same ID and different coordinates can pass the schema and fail the runtime. Whole-object `uniqueItems` would not express uniqueness by ID, so these arrays do not claim to enforce it. `edgeIds` is an array of strings and does use `uniqueItems` within each closure.
- **Aggregate input limits:** The 2 MiB UTF-8 file/data bound is not a character-count or per-array rule. The experiment also limits all variants together to 8000 closure records and 48000 closure edge references. Per-list schema maxima do not enforce those totals. The 48000-reference limit is specific to experiments; it is not imposed on standalone scenarios.
- **Workload and output budgets:** Routing-edge visits, extracted-path visits, emitted segments, the experiment's aggregate 500000 result segments and the browser's calculation timeout depend on execution. The schemas do not simulate the graph or guarantee a run will finish within its budgets.
- **Safe JavaScript values:** The runtime inspects record/array prototypes, inherited properties, accessors, symbol/custom properties and sparse arrays before reading them. JSON Schema describes serialized JSON data; it is not a replacement for those defensive checks on JavaScript objects passed directly to the API. Non-finite JavaScript numbers are not JSON numbers, and JSON parsing itself must still succeed.
- **File decoding:** Malformed UTF-8, optional leading BOM handling and input-byte limits belong to the file-input path. See [FILE_INPUT.md](FILE_INPUT.md).

### String-length compatibility limit

JSON Schema `minLength` and `maxLength` count Unicode code points. DetourLab's existing string checks use JavaScript `.length`, which counts UTF-16 code units. These agree for ASCII and ordinary Basic Multilingual Plane text, but a supplementary character such as `🚚` counts as one code point and two UTF-16 code units.

For example, a `name` consisting of 61 truck emoji is 61 schema characters but 122 UTF-16 code units: it passes the schema's `maxLength: 120` and fails the runtime's 120-unit limit. The same distinction applies to scenario descriptions (4000) and all display labels (120). Safe IDs are ASCII, so their 96-character bound has no such difference. Both validators still reject blank labels and the specified low controls under the intended ECMAScript regular-expression semantics.

No runtime rule is relaxed to hide this difference, and the schemas do not use a custom length keyword. The shared serialized test corpus checks agreement where intended and explicitly tests this schema-pass/runtime-reject boundary. It is not a claim of universal validator parity for all Unicode input or all JSON Schema implementations.

## Validate and run authoritatively

From the repository root, use the existing dependency-free Node runners:

```sh
node scripts/run-scenario.js examples/minimal-directed.json --json
node scripts/run-experiment.js examples/minimal-experiment.json --json
```

Use the same commands with your own filenames. They parse, validate and simulate the supplied input, reporting deterministic metrics and a canonical input fingerprint. Invalid input exits with status 2. Execution budgets can also reject an otherwise structurally valid input.

The experiment importer and runner continue to accept a legacy scenario v1: they validate it and upgrade it to a supplied-closure variant plus a clear-road control without regenerating geometry, seed, demand or order. Use the **scenario schema** when editing that legacy file. The experiment schema intentionally describes experiment documents only; it does not hide the upgrade by accepting both formats.

## Optional schema and editor checks

The application and its ordinary startup/check workflow retain their dependency-free contract. Install the separately pinned development-only schema checker when you want the additional validation and editor-language-service checks:

```sh
npm ci --prefix tools/schema-check --ignore-scripts --no-audit --no-fund
npm run verify --prefix tools/schema-check
```

The checker loads both schema files locally. It checks the checked-in fixtures, shared valid/invalid structural cases and documented runtime-only boundaries, then exercises the VS Code JSON language service's associations, diagnostics, completion and hover behavior. These automated language-service checks are not a claim of interactive verification in a native VS Code window or a browser. Package versions and third-party license notices live under [`tools/schema-check/`](../tools/schema-check/).

When changing a format constraint, update the runtime, relevant schema and parity corpus deliberately, and run the normal repository checks as well. Do not weaken runtime validation merely to make schema acceptance match it.

## Authorship and license

These two schemas and this guide are original DetourLab contributions under the repository's [MIT License](../LICENSE). They model this repository's existing code and synthetic formats; no city dataset, third-party schema or remote service is bundled. The optional checker has its own dependency notices, separate from the dependency-free application.
