# Optional package cost — 2026-10-08

Audit baseline: `9b4896d`, with the changes described below. The current execution
checklist is [Rearchitecture plan](./rearchitecture-plan.md). This is a package
reachability audit, not a claim that all compiler or rendering costs are solved.

## Findings and corrections

- Preserve the server package's source module boundaries in published output.
  Importing only `json()` previously retained the string document implementation,
  its prototype setup and the Node request host. The response helper now retains
  only its implementation. The existing render/session engine is unchanged.
- Optimistic operations already have a resolved resource, so use the existing
  resource tracker directly. Removed the utility's call through the public
  form-or-resource tracker; no new tracker or public API was introduced.
- Removed the CSS package at the user's request, including its source, tests,
  design, build/test commands and workspace lockfile entries. The exploratory
  CSS fixes were discarded with the package. No dependency version changed.

Paired public-entry probes use identical esbuild settings and current dependencies;
the before report was captured before these package changes. They include an IIFE
export wrapper. Server probes measure server code, not browser bytes.

| Published API probe | Before raw / gzip B | After raw / gzip B |
|---|---:|---:|
| `utils.optimistic` | 26,773 / 8,618 | 26,102 / 8,449 |
| `server.json` | 8,016 / 2,968 | 520 / 325 |
| `server.renderToString` | 90,244 / 28,812 | 90,203 / 28,746 |
| `adapters.htmlResponse` | 646 / 398 | 646 / 398 |
| `adapters.createDocumentStream` | 863 / 507 | 863 / 507 |
| `adapters/bun.createBunFetch` | 517 / 330 | 517 / 330 |

Node request conversion measures 1,489 / 837 B in the published probe and excludes
response-stream handling. This probe was added after the baseline capture, so no
before/after gain is claimed. Whole-bundle compression is not additive.

## Package coverage

| Package | Verified unused-feature boundary | Limits |
|---|---|---|
| Runtime | Local counter excludes module access resolution, lists, props, hydration, effects, opaque polling and host-scope overrides; capability tests check the features remain when required | Scheduler/ownership needed for interaction remains; dynamic creation is still retained where future instances need it |
| Data | Compiler-selected client fetches exclude restoration/stream waiters, transfer fingerprints, JSON body encoding and resource writes when those are not required | Public generic `$read`/constructors preserve restoration and resource dispatch; the optimistic probe still includes small form-recognition helpers through generic resource operations, though the full form tracker is omitted |
| Router | URL helper excludes pattern construction; lazy-module-only routing excludes routed-data execution; lazy retry and failure recovery pass | General routing and routed-data APIs retain their matching/preparation machinery |
| Utils | Unused package is absent from ordinary app graphs; optimistic operations use the existing resolved-resource tracker | Public promise conversion currently retains the generic data entry's restoration support; reducing that requires a separate correctness proof |
| Adapters | Web/Bun helpers exclude Node integration and renderer code; Node request conversion excludes response streaming | Explicit stream/Node adapter imports retain their selected functionality |
| Server | JSON helper excludes renderer and request-host initialization; string rendering excludes LinkeDOM | Rendering retains its request/session/data/router dependencies; those server bytes are not browser cost |
| Compiler, Vite, language service | No retained inputs in ordinary browser fixture graphs | These are build/editor tools; their installed or complete package size is not application browser size |
| CSS | Removed | No active package or unfinished CSS implementation plan |

The ordinary audit measured all 45 stable fixtures in package/source graphs.
Its default browser verifier assumes counter/Ada-shaped fixtures and cannot
verify the newer structural/composition fixtures: its first such case timed out.
A supported 22-fixture selection passed all **44** browser graphs, including
inputs, duplicates, keyed identity, requests, rebinding, encoded/opaque options,
lazy navigation and routed Group. No all-45 browser pass is claimed.

The focused capability tests execute response/stream helpers and optimistic
success/failure behavior in both source and published graphs. Existing public
data/router constructor tests guard against removing required writes, restoration,
lazy retry or recovery while specializing generated applications.

Production delivery controls at this batch still ship **zero JavaScript** for the
static page, noninteractive fetched page and fetched composition. A counter with
one static child or sixty forwarded static children ships the same 8,393 raw /
3,414 gzip B; adding static cards increases HTML, not client component factories.
Lazy routing and routed request/Group controls retain their required browser
programs. The nine-fixture SSR audit uses compiler/Vite `9b4896d` on the before
side and current runtime packages on both sides; HTML, payload and browser chunks
match. This isolates compiler delivery, not the server-helper packaging savings.

## Reproduction and remaining work

After the affected packages are built:

```bash
bun run bench:size:capabilities
bunx vitest run tests/optional-package-capabilities.test.ts tests/runtime-package-boundaries.test.ts tests/data-capability-bundle.test.ts tests/router-capability-bundle.test.ts tests/package-boundaries.test.ts tests/compiler-backend-boundary.test.ts --no-file-parallelism
bun run bench:size:audit --verify --fixture=owner-counter --fixture=input-list --fixture=request-data --fixture=request-routed-group --fixture=route-lazy
```

Capability results and metafiles are under ignored `bench/package-size/dist/`.
The app audit rejects retained utility, server, adapter or tooling packages in
its ordinary fixtures. Stable test sources never come from examples.

Keep unresolved generic data costs and unproved creation/composition cases open
in the canonical checklist. Numeric keys remain deferred; broad new capability
paths are not justified by this audit. Routing, Group and dynamic lifetimes keep
their required JavaScript.
