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
works. No browser retry or server startup was performed as part of this source
compatibility change. An unresolved historical preview failure is not claimed
fixed merely because these tests pass.

When using a managed preview environment, follow that environment's supported
launcher and open only its returned URL. A failure does not authorize a different
host, port, tunnel, network setting or security-warning bypass.

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
