# Contributing

A useful contribution makes a disruption experiment easier to trust, inspect or reproduce. Start with a minimal scenario or a tightly scoped improvement.

## Set up and verify

Use the Node version in `.node-version`, then run:

```sh
npm run check
node scripts/verify-dist.js
npm run experiment -- examples/meridian-experiment.json --json
```

No package installation is needed for the app. `npm ci --ignore-scripts --no-audit --no-fund` checks the dependency-free lockfile and matches CI setup. [CI.md](docs/CI.md) explains the exact workflow.

## Edit a scenario or schema

See [JSON_SCHEMAS.md](docs/JSON_SCHEMAS.md) for scoped editor associations and the difference between structural diagnostics and authoritative runtime validation. If changing the schemas or their editor integration, also run:

```sh
npm ci --prefix tools/schema-check --ignore-scripts --no-audit --no-fund
npm run verify --prefix tools/schema-check
```

This optional package is isolated from the app and core checks. Its [lockfile](tools/schema-check/package-lock.json) pins validator/language-service dependencies, with [license notices](tools/schema-check/THIRD_PARTY_NOTICES.md). Tests must load local schema files only, must not coerce or mutate inputs, and must retain explicit runtime-only rejection cases instead of claiming universal parity. Report native editor or browser checks separately.

For the headless job-impact workflow, run `node --test tests/job-impact.test.js tests/job-impact-cli.test.js`. Preserve original job order, engine status/tolerance semantics and explicit nulls for unreachable timings. [JOB_IMPACT.md](docs/JOB_IMPACT.md) defines the report contract and its limits.

For opt-in per-job acceptance gates, run `node --test tests/job-gates.test.js tests/job-gates-cli.test.js`. Preserve default output bytes, ID-based ledger matching, status tolerance, and the null/fail-closed no-comparable-arrivals contract. [JOB_GATES.md](docs/JOB_GATES.md) includes the hand-checkable masked-regression example.

## Choose a scope

Start with [open contribution issues](https://github.com/Tabisharaza/detourlab/issues). [Additional issue scopes](docs/ISSUE_DRAFTS.md) include reproducible problems, acceptance criteria and explicit non-goals, and distinguish published issues from proposals. Before adding a solver, city dataset, dependency or storage service, propose the interface and its effect on licensing, privacy and reproducibility.

A bug report should identify the source revision, Node/browser/OS version, expected and observed outcomes, and the smallest synthetic input that reproduces it. Do not attach production fleet data or secrets.

## Preserve the model contract

- Keep the engine usable unchanged in Node and browser Workers.
- Preserve stable tie-breaking and the supplied per-vehicle job order.
- Define event-boundary behavior before changing closure semantics.
- Add a regression fixture for routing, schema, export or state-ordering changes.
- Compare completed and unreachable work when interpreting distance/lateness.
- Keep renderer output tied to the simulation ledger.

## Pull request checks

1. Describe the concrete behavior change and its limits.
2. Run syntax, tests, build and distribution verification on the final source.
3. Report actual browser checks separately from mocked event-handler tests.
4. Keep unrelated cleanup out of a narrow fix.
5. Add no mandatory API key, tracking, external font or map service.
6. Attribute dependencies/datasets and retain their real license requirements.
7. Include named-fixture/device measurements for performance claims.
8. Update format/design docs when the public contract changes.

The PR template helps record this evidence. It does not grant deployment, repository settings or external publishing permission.

## Style and accessibility

Use the existing ESM style and platform APIs. Prefer small named helpers, safe text rendering and explicit failure states. Core actions should remain available without pointer-only map interaction. An accessibility improvement should include keyboard evidence and clearly distinguish checks performed from checks still pending.

## Security

Use [SECURITY.md](SECURITY.md) for vulnerability reporting and data-handling boundaries. A draft fixture or screenshot must contain only material appropriate for a public repository.
