# Local preview server

`npm start` keeps the existing source preview at `http://127.0.0.1:4173`.
`npm start -- --dist` serves the built distribution instead. `npm run dev` is
an alias for the same constrained server, for tools that discover a `dev` script:

```sh
npm run dev -- --host 127.0.0.1 --port 4173 --strictPort
```

## Arguments

- `--host 127.0.0.1` is the only accepted host. Omitting it keeps the same host.
  Wildcards, hostname resolution, other loopback addresses and IPv6 are not
  enabled. No LAN exposure or network-permission change is introduced.
- `--port N` selects a decimal integer from 1 through 65535. It takes precedence
  over `PORT`. Without it, a nonempty `PORT` is validated using the same rule;
  unset/empty `PORT` keeps 4173. Whitespace, fractions, exponent notation and
  dynamically assigned port 0 are rejected rather than silently coerced.
- `--dist` selects `dist/`; otherwise the existing source asset directories are
  served. No arbitrary document root is accepted.
- `--strictPort` explicitly requests the behavior that is always used: one bind
  attempt to the exact port, with no fallback to a different port or host.

Flags are single-use, values are separate arguments, and unknown flags or
positional values fail before server creation. Invalid arguments exit 2. A bind
failure exits 1 and prints no success URL. Importing the server or argument parser
never starts a listener.

`PORT=43123 npm start` still selects 43123 on shells supporting that syntax;
`npm start -- --port 43123` is the cross-platform form. These examples describe
local development, not a public deployment or a guaranteed available port.

## Asset boundary unchanged

The existing GET/HEAD-only handler, allowlisted application directories, security
headers, hidden-path checks and symbolic-link rejection are unchanged. See
[SECURITY.md](../SECURITY.md#local-server-and-static-hosting) for the trusted-checkout
limitations. This server is not a production host or a filesystem sandbox.

## Evidence and limits

The previous package exposed only `start`, not `dev`. Its server ignored supplied
host/port flags and selected only `PORT` or 4173. An intercepted-listen reproducer
confirms these two configuration gaps without opening a listening socket.

The new argument tests exercise the actual CLI with the network listen method
intercepted, plus the pure parser, environment/flag precedence and bind-error
handling. Existing in-memory HTTP-handler tests still exercise path confinement,
I/O failures, GET/HEAD bytes and security headers. They do not prove that a browser
route, preview service, mobile emulation, file picker or assistive technology
works. The initial source-only validation did not start a preview or browser;
the separately approved desktop check below was performed after publication.

When using a managed preview environment, follow that environment's supported
launcher and open only its returned URL. A failure does not authorize a different
host, port, tunnel, network setting or security-warning bypass.

### Desktop QA — 2026-10-28

Source commit `23cd19d57af1718f864baca74714b4ad2f25aba2` was verified on remote
main, including all 152 blob identities and exactly nine intended changed files.
[CI run 40644586431](https://github.com/Tabisharaza/detourlab/actions/runs/40644586431)
passed on Node 24.22.1: 953 core tests and 120 optional tests, distribution
reproducibility and a clean tracked-source check.

After the documented configuration repair, one supported managed-preview start
returned a loopback URL; opening that exact URL in the desktop cloud browser
succeeded without an access/security warning. No alternate host, port or tunnel
was used. Actual UI checks on the built-in Meridian experiment verified:

- Delivery inspector: 125 of 192 changed outcomes, including 118 status changes
  and seven same-status arrival changes; 192 completed and zero unreachable.
- Next/Previous pagination: pages 1–7, ending at rows 121–125; Next disabled at
  the final boundary, with focus moved to Previous. Previous returned page 6.
- Filters reset pagination: same-status changes showed seven rows on one page
  with both page buttons disabled; status changes showed 118 matches on six pages.
- Switching to Clear-road control replaced the prior results with zero changes;
  its empty filtered state offered All deliveries, which showed all 192 outcomes.
- Escape and Close both dismissed the inspector and restored focus to Inspect
  deliveries. Enter reopened it with heading focus, Changed outcomes and page 1.
- Desktop screenshot inspection showed legible comparison columns and the
  intended scrollable dialog/table at the observed 1165 × 747 viewport.

This verifies the current supported desktop route, not the cause of the original
historical failure. File picker/import, downloads, mobile emulation, native
assistive technology and deployment were not exercised. Browser logs contained
extension metadata errors; those are not application failures or evidence of a
clean browser console. No claim of exhaustive UI or accessibility coverage is
made. The temporary tab was closed and the managed preview stopped after QA.

## Review-packet provenance

The review generator fingerprints `package.json` alongside its implementation
files. Adding the `dev` alias therefore changes the implementation identity even
though simulation logic and browser distribution bytes do not change. The tiny
checked-in review packet was regenerated through the normal report command; only
its implementation/integrity hashes changed, not experiment, policy or outcomes.
The old packet is still rejected by default under the new identity (exit 2).
Explicit `--compare-outcomes` reproduces its unchanged outcomes (exit 0) while
stating that the original implementation remains unverified. No identity check
was removed or weakened.
