# Memoized DOM SSR — Implementation Log

Status: active development on branch `feat/ssr`
Scope of this document: **completed work only**. Design debate, open
questions, and future phases live in `ssr-proposal.md`; nothing below is
speculative. Each entry lists what changed, where, and what proves it.

Baseline: proposal phases 0–6 as sequenced in `ssr-proposal.md`. Work is
organized into small committed slices; every slice keeps the full test
suite green (`bun run typecheck && bun run test`).

---

## Slice 1.1a — Application runtimes: request-isolated kernel state

**Commit:** `feat(runtime): application runtimes - request-isolated kernel state (SSR slice 1.1)`

Every piece of mutable kernel state moved out of module globals into an
explicit `ApplicationRuntime` handle (`packages/runtime/src/kernel.ts`):

- entity registry, dirty set, volatile set
- invalidation-reason store (moved out of `dirty-reasons.ts` module scope;
  its helpers now take the store explicitly)
- scheduler, volatile-frame flag, scheduled/in-commit flags
- registry generation and id cache
- cycle diagnostics (render counts, mark attribution)

Public API added to `@memoized-dom/runtime`:

```ts
const runtime = createApplicationRuntime('request-1');
setActiveApplicationRuntime(runtime);        // or scoped:
runWithApplicationRuntime(runtime, () => { /* render */ });
runtime.dispose();
```

Behavior contract:

- The browser keeps one ambient default runtime (`browser-default`);
  every existing import behaves exactly as before.
- `runWithApplicationRuntime` restores the previous runtime even when the
  scoped function throws.
- `dispose()` unregisters all entities (draining cleanup hooks), clears all
  pending bookkeeping, and reactivates the ambient default if the disposed
  runtime was active.

**Tests:** `tests/ssr-runtime-isolation.test.ts` — two concurrent runtimes
share no registry entries; invalidation and commits route through the
active runtime only; scoped runs restore state on throw; dispose reactivates
the default.

## Slice 1.1b — kernel-adjacent stores routed through the runtime

**Commit:** this slice.

The kernel gained a generic per-runtime extension mechanism:

```ts
getExtensionStore<T>(key: string, create: () => T): T
```

Subsystems own their store shapes; the kernel provides request-scoped
storage and lifetime (`extensions` are cleared on `dispose()`). Routed
through it:

| Module | State moved onto the runtime |
|---|---|
| `cleanup.ts` | disposer maps and unregister-in-progress guards |
| `props.ts` | prop-box registry (`_propsBox` introspection included) |
| `mount.ts` | mounted-host/mounted-root bookkeeping (the one-application invariant is now per runtime, so two server requests can each mount the same compiled root) |
| `access.ts` | the entire access resolver: installed fragments, exact/wild/param reader tables, opaque set, wildcard expansions, resolution caches |

Deliberately still process-wide (static infrastructure or build artifacts):

- registry-change listeners and entity-dispose hooks (no per-request state;
  listeners mutate only the active runtime's own stores)
- delegated event-type registrations (keyed by event name)
- node-keyed caches (`WeakMap<Element, …>`) — nodes never cross documents
- `hot.ts` HMR records (development-only)

**Tests:** six new cases in `tests/ssr-runtime-isolation.test.ts` prove
cleanups registered in one runtime never drain from another, access-table
installs are invisible across runtimes, prop boxes do not cross-contaminate,
and dead-letter writes from a foreign runtime cannot mutate another
runtime's boxes.

## Build migration fix — rolldown on Windows

**Commit:** `fix(build): rolldown external predicate broke on Windows absolute paths`

The esbuild → rolldown migration produced empty dist shells for compiler,
vite, and language-service. Root cause: rolldown passes *resolved absolute*
ids to `external()`, which on Windows look like `C:/...` — failing both the
leading-slash and leading-dot checks, so every local module was treated as
external. Fixed with `node:path.isAbsolute()`; single-file `output.file`
configs were switched to directory output so any emitted chunk lands beside
the entry instead of vanishing.

## Pre-SSR correctness work on this branch

Committed on `agent/address-copilot-review-fixes`, merged fast-forward into
`main`, inherited by `feat/ssr`:

1. **Runtime:** per-entity commit render bound — a render cycle now fails
   fast with a diagnosis naming the entity and its top mark sources instead
   of burning the 100-pass drain every frame.
2. **Compiler:** JSX ref bindings excluded from reactive instance state
   (ref field writes no longer invalidate their owner — fixes the
   TelemetryCanvas cascade).
3. **Compiler:** opaque-rooted const chains compile as replaying derivations
   (resource-backed lists and optimistic mutations update), while
   destructuring, invocation, and argument pass-through keep factory-time
   snapshot semantics (`$fetch()` never replays per update).
4. **Compiler:** component-local helper parameter effects fold into call
   sites (transitively), so item-field mutations from hoisted helpers emit
   row-scoped commits inside the caller's row scope instead of crashing with
   `ReferenceError: _rowId3`.
5. **Example:** octopulse theming responds to the reactive toggle — semantic
   tokens bound through Tailwind v4 `@theme inline` plus a custom dark
   variant keyed on `[data-theme]`.

---

## Slice 1.2 — RenderEnvironment capability descriptor

**Commit:** this slice.

New module `packages/runtime/src/environment.ts` defines the capability
descriptor from proposal §1.2:

```ts
interface RenderEnvironment {
  mode: 'client-create' | 'server-dom' | 'server-string' | 'hydrate';
  document: DocumentLike;   // node ops for runtime-owned structure
  schedule: ((fn) => void) | null;  // null disables volatile pull frames
  effects: 'run' | 'defer' | 'disabled';
  refs: 'run' | 'defer' | 'disabled';
}
```

- Every ApplicationRuntime carries one (`createApplicationRuntime(id,
  environment?)` merges partial overrides over the client default).
- The kernel's volatile-pull loop uses `environment.schedule` instead of
  probing `globalThis.requestAnimationFrame`; a null schedule (servers)
  means nothing keeps ticking.
- `registerEffect`/`registerConditionalEffect` consult `effects`: in
  'disabled'/'defer' the entity still registers (structural ownership stays
  complete) but the callback never executes.
- Conditional-region anchors, list anchors/fragments/range removal, and
  mount's host lookup route through `environment.document` instead of the
  ambient global.

Known scope note: compiled element creation still references the global
`document` directly — routing emitted code through the environment document
lands with the Phase 1.4 reference renderer, which is exactly where it is
needed.

**Tests:** `tests/ssr-environment.test.ts` — client default capabilities;
structural anchors created through an injected document; effects recorded
but never executed under a server-shaped runtime; volatile pulls disabled
without a frame scheduler; per-runtime environment independence.

---

## Slice 1.3 — module-state isolation probe (complete)

**Commit:** this slice.

New primitive `packages/runtime/src/state-cells.ts` + probe suite
`tests/ssr-isolation-probe.test.ts`. Results against the proposal's two
candidate architectures:

### Option A (per-request graph evaluation) — proven correct, oracle tier

The same compiled fixture instantiated as separate module records isolates
perfectly: interleaved mutations of primitives and arrays never cross
requests. Cost confirmed: N requests = N module evaluations.

### Option B (state cells on the runtime) — prototype proven, production direction

`defineStateCell(key, initial)` / `readCell` / `setCell` / `updateCell`:
storage lives on the active ApplicationRuntime keyed by canonical linker
identity; values initialize lazily per runtime from authored defaults; a
shared compiled module (static descriptors) serves every request; writes
route invalidation through the access table under the canonical key, so
computeds/effects/components need no changes; `dispose()` resets cells to
authored defaults.

Probe evidence: divergent concurrent state across two runtimes over ONE
shared compiled module; zero cross-request reads; reader entity re-rendered
with its own request's value via existing commitWrites routing.

Decision log impact: Option B's "pending isolation-probe" condition is now
satisfied at the storage-primitive level. Remaining before it is the
production lowering: the compiler pass that rewrites authored module-state
bindings into cell reads/writes (exported live-binding semantics, cycles,
initialization order, HMR).

---

## Slice 1.4 — LinkeDOM reference renderer (first tier complete)

**Commit:** this slice.

New package `@memoized-dom/server` (`packages/server`) with two entry
points:

```ts
renderToString(App, { url?, document? })   // html string, always disposes
renderWithDom(App, { url?, document? })    // live handles, caller disposes
```

Per call it creates a fresh ApplicationRuntime (slice 1.1) configured as
`mode: 'server-dom'`, injected LinkeDOM document, `schedule: null`, effects
and refs disabled - then swaps the ambient document global for the
duration of the synchronous render (compiled element creation still reads
the global; routing emitted code lands when emission gains an environment
seam). Effects are recorded as entities but never execute; refs never
invoke.

**Parity proven:** a compiled fixture rendered through the server tier and
through client-side creation (happy-dom) produces structurally identical
HTML after normalizing serializer details (attribute order, runtime comment
anchors) - exactly the normalization rule the proposal permits. Two
operational findings encoded in the tests:

1. Server and client tiers must use separate module records: compiled
   template caches capture nodes from the document active at first
   creation. This mirrors production (server and client are separate
   builds).
2. Successive renders get fresh runtimes and byte-identical output;
   failure paths unregister and restore globals.

## Slice 1.5 — CSR-equivalence corpus (Phase 1.5)

**Commit:** this slice.

Grew the single-fixture parity check from slice 1.4 into the proposal §1.5
corpus. New harness `packages/server/tests/parity-harness.ts` compiles one
authored source into TWO module records (server tier + client tier — compiled
template caches capture the first-creation document), renders each through its
tier, and compares under declared-irrelevant normalizations. Corpus in
`packages/server/tests/parity.test.ts` covers: text/attribute/boolean/class/
style, escaping, trusted innerHTML, SVG namespaces, multi-root fragments,
conditional branches (element/text/empty), keyed/nested/empty lists, dynamic
intrinsic tags, component props + children slots, and the server-side
guarantees that effects, refs, and cleanup never execute during rendering.
Route regions and async data states stay deferred until request-local
router/data wiring lands.

Findings encoded along the way:

1. **Runtime:** `mountRef` is now capability-gated (`environment.refs !==
   'run'` records ownership but never invokes callbacks). 'defer' behaves as
   disabled until Phase 3 replays refs after adoption.
2. **Server renderer:** property-backed boolean attributes (`checked`,
   `disabled`, ...) are synced back to attributes before serialization
   (`syncBooleanAttributes`, exported) — some DOM serializers emit only
   attributes. `readOnly` maps to the lowercase `readonly` attribute.
3. **Server renderer fix:** top-level runtime comment anchors no longer leak
   into serialized HTML as raw text (comments were falling through to
   `textContent` when they had no `outerHTML`).
4. **Harness canonicalization rules** (declared serializer details):
   comment anchors dropped, attribute order sorted (quote-aware tokenizer,
   values may contain spaces), empty attributes equal bare attributes
   (`checked=""` ≡ `checked`), style trailing semicolon stripped,
   ambiguous ampersands canonicalized to `&amp;` (LinkeDOM leaves bare `&`
   in attribute values; parsers treat them literally), self-closing foreign
   elements expanded to empty pairs, whitespace collapsed.

Verified environment flake, not a regression: `r42-calculated-list-sources`
times out only under full-suite parallel load on this machine and passes in
isolation.

## Slice 1.6 — request-local router and data wiring

**Commit:** this slice.

Finished proposal §1.5: `renderToString`/`renderWithDom` now install a
request-local router and data runtime per call. Compiled modules keep their
convenient singleton imports (`route`, `$fetch`, `$action`) — delegation is
ambient:

- **Router** (`active-runtime.ts`): public exports and the compiler bridge
  (`@memoized-dom/router/internal`) delegate through an ambient pointer that
  defaults to the browser singleton. Compiled route manifests install once at
  module evaluation; `noteManifestResolver` records that resolver and replays
  it onto every newly activated runtime, so each request resolves its own URL
  against the application graph (solves the module-evaluates-once ordering
  problem). `ensureRouterConnected` memoizes per runtime.
- **Data** (`active-runtime.ts`): `$fetch`/`$action`/`clearDataRuntime` are
  delegating facades over the active data runtime.
- **Server** (`RenderOptions`): `url` installs a memory-history route
  runtime; `fetch` backs a request-local data runtime. Both are activated
  before the component call and restored/disposed in `finally`, including on
  thrown errors.
- **Build:** server `tsconfig.build.json` needed an explicit `rootDir` —
  importing workspace packages changed TS7's common-source-directory
  inference.

Corpus additions in `parity.test.ts`: route regions with params + query for
the request URL (both tiers under identical activation), unresolved data
states under an injected never-settling fetch, and successive-request URL
isolation through `renderToString`.

## Slice 1.7 — Phase 1.3 production lowering: module-state cells

**Commit:** this slice.

Compiler pass implementing proposal Option B for server builds (opt-in via
`compileModules({ moduleStateCells: true })`):

- Every reactive module root (`let` bindings, mutated `const` stores) lowers
  to `_MD.defineStateCell('<canonical-key>', default)` — the owner records
  its authored default (a FACTORY for object stores, so every request
  instantiates fresh objects); importers reference the same identity with no
  default. ESM postorder evaluation guarantees owner-first registration;
  emptied authored imports collapse to side-effect imports to preserve it.
- Reads lower to `_MD.readCell(<cell>)`, direct rebinding writes to
  `_MD.setCell`/`_MD.updateCell`. Member mutations (`store.items.push`) keep
  mutating through a lowered base read — they hit this request's own object;
  invalidation stays caller-side `commitWrites` under unchanged canonical
  keys, so access tables, computed entities, effects, and component updates
  need no changes.
- Non-literal initializers are rejected with code-frame errors rather than
  silently shared across requests.
- Emission handles shared AST nodes (creation/update closures referencing one
  identifier node) by rewriting to a fixpoint.

Runtime support: state cells gained an authored-defaults registry with
factory initials; the kernel gained `onRuntimeCreated`, and access fragments
are recorded in a process-wide static catalog replayed into every newly
created application runtime — SSR request contexts now receive the same
cross-module write→reader routing as the browser default.

Proven by `tests/ssr-cell-lowering.test.ts`: emitted shape, rejection
diagnostics, and the Phase 1 exit criterion end-to-end — ONE shared compiled
module record, TWO concurrent application runtimes, divergent mutations
through exported mutators, zero cross-request state, correct per-request
reactive updates.

**Vite wiring:** `moduleStateCells` flows through the adapter's existing
`CompileModulesOptions` surface into graph compilation (collector passthrough
tested by an opt-in build assertion in the adapter suite); the suite also
gained a 30s test timeout matching real Vite+Rolldown build durations.

## Slice 1.8 — Phase 1 exit review (gate to Phase 2)

**Commit:** this slice.

Formal review of the four proposal §Phase 1 exit criteria:

1. **No window/document required by the server renderer — PASS (one fix).**
   New bare-node probe (`exit-review.test.ts`, `@vitest-environment node`)
   caught `_MD.rootNodes` referencing the ambient `Node` class; fixed to a
   literal node-type constant. Import + render now work with no DOM globals.
2. **Two simultaneous renders cannot observe each other's state — PASS with
   one documented contract.** Kernel, cleanup, props, access tables, router,
   data, module-state cells, and effects are request-owned and replayed per
   runtime (slices 1.1–1.7). The remaining shared seam is the ambient
   `document` global during rendering plus module-scope template caches that
   pin the first-creating document; synchronous-only rendering makes this
   safe today, and routing emitted element creation through the environment
   document remains a prerequisite for any async/streaming render.
3. **CSR-equivalence matrix — PASS** (slices 1.5/1.6).
4. **Dispose on throw — PASS.** New probe: a throwing component fails its
   request, restores all globals, and later requests render normally through
   fresh contexts.

New probes live in `packages/server/tests/exit-review.test.ts`; the isolation
probe also exercises leaked-mutation checks over ONE shared compiled record
with cell-lowered module state.

Environment note: full-suite runs on this machine intermittently time out
arbitrary single tests under parallel load (r42 previously, r26 now); every
victim passes in isolation. Not treated as regressions without isolated
corroboration.

| Phase | Status |
|---|---|
| 0 — freeze list identity / push invalidation | **complete (slice 1.9)**: hydration-safe keyed identity shipped — type-tagged, escaped, collision-tested; push invalidation untouched |
| 1.1 — request/application runtime context | **complete**: kernel, cleanup, props, mount, access routed; isolation tested |
| 1.2 — environment capabilities | **complete**: RenderEnvironment on every runtime (mode/document/schedule/effects/refs); effects gated server-side; volatile pulls disabled without a frame scheduler; structural anchors route through the injected document |
| 1.3 — module-state isolation | **complete**: cells proven (slice 1.3 probe) AND compiler lowering shipped (slice 1.7); literal-initializer restriction documented |
| 1.4 — LinkeDOM reference renderer | **first tier working**: renderToString/renderWithDom over LinkeDOM; server/client structural parity tested; effects/refs verified off |
| 1.5 — CSR-equivalence matrix | **complete**: full §1.5 corpus incl. route regions (params/query/catch-all) and deterministic data states via request-local router/data wiring |
| Phase 1 exit review | **complete (slice 1.8)**: criteria verified; Phase 1→2 gate now awaits the data/async RFC agreement recorded in the decision log |
| 2–6 | gated behind phase 1 exit criteria |

## Slice 1.9 — Phase 0: hydration-safe keyed-list identity encoding

**Commit:** this slice.

The Phase 0 leftover closed: list row identity no longer stringifies keys
raw. New contract in `packages/runtime/src/list-keys.ts`, one encoding for
CSR and SSR alike:

- **Type-tagged primitives** — numbers `n:…`, strings `s:…`, bigints `g:…`,
  booleans `t`/`f` — so `1`, `"1"`, `1n`, and `true`/`"true"` can never
  collapse into one row id again.
- **Escaped string segments** — every code point outside
  `A–Z a–z 0–9 _ . ~ -` becomes uppercase percent-escape UTF-8, so `/`,
  `[`, `]`, `%`, whitespace, and unicode cannot break the
  `<prefix>/Row[...]` id/marker structure.
- **Round-trip decode** (`decodeListKey`) for the future adoption cursor;
  malformed input decodes to `undefined`, never throws. NaN has no canonical
  form and encodes to null (synthetic fallback); ±Infinity round-trips.
- **Declared limitation**: object/symbol/null/undefined keys keep
  process-local synthetic ids and cannot survive server→client transfer.

Integration:

- `rowIdFor` routes through the encoder; reconciliation maps still key on raw
  values, so keyed-reorder behavior is unchanged (proven by retained-row
  reorder test with mixed key types).
- Parameterized L2 commit patterns now interpolate payload values through the
  SAME encoder — precise ids match the ids rows actually carry; non-primitive
  payloads degrade to the readers superset per correctness invariant 4
  (`access.ts`).
- The hand-compiled todo-list fixture mirrors the new emitted shape; tests
  pinning historical `Row[1]`-style ids updated to `Row[n:1]` across m2, m3,
  m5, m10, m57, m58, r8, r20, r22, r23, recent-fixes.

Covered by `tests/list-key-encoding.test.ts`: tag distinctness, escape safety,
round-trips (edge numbers, bigints), rejection of malformed input, distinct
rows for formerly colliding keys, and reorder identity retention.

## Slice 2.0a — Phase 2 groundwork: marker serialization + $track conditional fix

**Commit:** this slice.

Phase 2 opening moves alongside the data layer's exact-site entities:

1. **Server serializer comment policy** (`RenderOptions.markers`): `true`
   preserves every structural anchor — conditional `when:`/list `list:`
   boundaries and future hydration markers — including bare top-level
   comments that element `outerHTML` cannot cover (with comment-termination
   validation); `false` (current default until client adoption ships) strips
   all comments for clean host-consumable HTML.
2. **Harness fix (root cause of a real parity failure):** the client tier was
   serialized *after* its data runtime was cleared in the activation
   `finally` — clearing source state flipped availability-driven regions to
   their else arms mid-capture. Client HTML is now captured inside the
   activation window.
3. **Compiler fix (`$track` conditionals):** mixed state+payload expressions
   were wrapped whole in the availability ladder, hiding state-driven loading
   UI whenever payload sinks existed in sibling arms. State-driven branches
   now evaluate immediately (RFC §5); payload sinks self-gate per site via
   render-gated reads; imperative R2 guards still apply inside nested
   functions. `map-site` recognizes render-gated list sources with an
   unresolved→empty-rows fallback.

Tests: new `markers.test.ts` (5 cases) + restored `$track` conditional
fixture in the parity corpus.

## Slice 2.0b — runtime-owned module source descriptions (RFC §16.4, §16.8.3)

**Commit:** `8efa47b` (plus holder-registration groundwork in `5fe49b5`).

Closes the data-lane prerequisite for marker freeze. Module-scope sources
(`export const x = $fetch(...)`) now survive cross-module compilation and
materialize per application runtime with explicit lifecycle retirement:

1. **Linker:** `analyzeManifest` lowers module-source declarations before
   analysis, so `$fetch` exports survive manifest convergence (fixed the
   `'currentUser' is not a linkable export` dev-server failure).
2. **Holder registration:** imported module refs referenced inside a
   component join its source-holder set (`scanTransparentSourceBindings`),
   so emission attaches ownership mounts (`ownResolvedValue`) and per-sink
   `connectResolvedValues` subscriptions — commits push-invalidate gated
   reads that have no component-local source.
3. **Description versioning:** `describeModuleSource` bumps a per-key
   version; HMR re-evaluation RETIRES stale materialized instances in every
   application runtime instead of silently reusing them.
4. **`DataRuntime.clear()` retirement:** instances register a disposer under
   the data runtime that materialized them; `clear()` runs them (§16.4
   lifetime contract: instances live until clear() or runtime disposal).
5. **Build fix:** `@memoized-dom/data`'s rolldown config externalizes
   `@memoized-dom/runtime` — bundling it duplicated kernel module state and
   silently broke per-runtime isolation.
6. **Runtime fix:** the default scheduler binds `queueMicrotask` (WebIDL
   this-sensitivity) — a detached call threw `Illegal invocation` in Chrome
   and killed the commit flush after async data committed.

**Tests:** `tests/module-source-descriptions.test.ts` proves the §16.8.3
gate over ONE shared compiled record: two roots materialize independent
instances with independent requests; `clear()` and HMR both retire;
descriptions never fire requests at module evaluation.
`tests/module-source-group-integration.test.ts` covers Group/$track/
derivation lowering over module refs. Browser-verified end-to-end
(workspace example: badge, rows, unread pill, late session commit).

**Lifecycle hardening:** `a81092a`. The HMR proof now resolves both versions
through the same application-runtime handles (the earlier helper accidentally
created fresh runtimes and could pass without exercising version retirement).
Replacement explicitly disposes the stale fetch resource, and each
`DataRuntime.clear()` disposer deletes only the exact cache entry it
materialized, so a late clear from the old version cannot evict the
replacement. The client committed-path test now restores/unregisters its
ambient runtime state and exercises notifications and session as independently
settling sources. Targeted module-source battery 10/10; root suite 87 files /
538 tests.

## Slice 2.0c — source-state snapshot envelope (RFC §16.6, §16.8.5)

**Commit:** `8b70169`.

`DataRuntime.serializeState()` / `restoreState(envelope)` implement the
§16.6 v1 envelope: per-source `{sourceId = deterministic request identity,
contractId, requestFingerprint = url, snapshot}`. Success transfers the
committed payload plus a revalidate intent (never an in-flight promise);
errors transfer a sanitized `{kind, status, statusText, message}` — cause,
data, and issues never transfer; pending transfers paused. `restoreState`
installs dormant records on the store; the next acquire with a matching
identity claims its record: success restores committed with ZERO duplicate
request, error restores its local branch retryable only through refresh,
pending restores paused until explicit refresh. Idle entries and
non-JSON-safe payloads are omitted. Unknown format versions are rejected.

**Tests:** `tests/snapshot-envelope.test.ts` — all four states, request
suppression, retry targeting, omission rules.

## Slice 2.1 — hydration marker emission (Phase 2 proper, first increment)

**Commit:** `d843ff5`.

Runtime anchors switch to the `hydration-markers.md` §2/§3 grammar
(bumped to draft v0.2), identical on client and server so CSR/SSR DOM stay
structurally identical (the parity corpus canonicalizes comments away):

- conditional/route regions: `mmd:g:<id>` open before branch content +
  uniform `/mmd` close (the trailing close anchor keeps its role as the
  stable branch-swap insertion point; empty regions emit an adjacent valid
  pair);
- keyed lists: `mmd:l:<idPrefix>` open + `/mmd` close around the row set;
- keyed rows: single-opening `mmd:w:<listId>:<encodedKey>` prepended into
  the row's node list at creation, so every reconcile path (fragment batch,
  LIS insertion, reorder) carries it — v0.2 deviation recorded in the
  protocol draft: single-open form, extent runs to the next sibling marker
  or the list close;
- server serializer wraps marker output in the `mmd:r:<rootId>` application
  root pair;
- `mmd:c` component pairs and `mmd:d` data-site singles are deferred to the
  adoption phase per RFC §16.7 (data sites need no marker category).

**Tests:** `packages/server/tests/markers.test.ts` asserts the full
grammar (g/l/w/r opens + `/mmd` closes, no text leakage); `tests/m8.test.ts`
updated to the g-pair shape; parity corpus unaffected (comment
canonicalization).

## Stabilization note — pre-slice fixes on this branch

**Commits:** `141a167`, `5fe49b5` (baseline snapshot `e7ecd6e`).

- Default scheduler binds `queueMicrotask` (see 2.0b #6).
- `@memoized-dom/vite` compiles lazy per-file graphs for files outside the
  primary entry graph, so every example serves at its own URL regardless of
  `MMD_EXAMPLE`; the shared gallery `entry.ts` collision is gone (gallery is
  a link list; per-example `index.html` + `main.ts`).
- Leftover-JSX diagnostics name the tag, owner component, and nearest
  located ancestor instead of Babel's "internal node" message.

## Stabilization note — real-browser corpus + coherent lazy graphs

**Commit:** `9b57aed`.

`bun run test:corpus` now boots the real Vite 8 server and drives every
served example in headless Chrome. It asserts a non-empty mount, zero
actionable console/page/HTTP errors, and example-specific async commit
outcomes (workspace session data).

The first corpus run exposed a gallery regression: after deleting the shared
`examples/entry.ts`, each imported component was being compiled as a separate
lazy graph, so `mount()` received a component that was not registered as the
mount module's application root. Missing entry seeds are now valid in gallery
mode, and every dependency reuses the coherent lazy graph that already
contains it. The same run fixed stale entry references in the GSAP,
OctoPulse, and Todo examples.

**Proof:** Vite adapter 6/6 (including a missing-seed/request-order
regression), TypeScript `--noEmit`, and Chrome corpus 17/17.

## Slice 2.2 — deterministic hydration cursor (Phase 3 opening)

**Commit:** `20ec21b`.

`@memoized-dom/runtime` now exports a read-only cursor over the emitted v0.2
marker stream. `createHydrationCursor(host, rootId)` locates exactly one
`mmd:r` pair; local cursors claim ordinary nodes and nested `mmd:c/g/l`
ranges in compiler order; `claimRow` bounds single-opening `mmd:w` rows at
the next depth-zero row marker or enclosing list close. Claims validate node
type, host tag, and namespace without creating, moving, or replacing nodes.
`HydrationMismatchError` reports the nearest structural owner plus exact
expected/actual shapes. The primitive is deliberately mutation-free:
factory adoption, lifecycle replay, and bounded recovery remain integration
work rather than being hidden inside marker parsing.

**Tests:** `tests/hydration-cursor.test.ts` (5 cases) covers grammar/dev
attributes, root identity preservation (`===`), nested and empty ranges,
v0.2 rows containing nested ranges, and marker/tag/missing-close failures.
Runtime build green.

## Slice 2.3 — emitted DOM creation routes through the environment document

**Commit:** `724fcac`.

Closes the slice-1.8 seam that blocked the settle coordinator and any
hydration document tier. Every DOM-producing factory now resolves the active
`RenderEnvironment.document` once (`const _document =
_MD.getActiveEnvironment().document`) and creates elements, text, fragments,
and SVG nodes through it. The binding is emitted per factory scope,
including nested scopes: conditional branches, list rows (lightweight and
stateful), render callbacks, children slots, and route regions. The
repeated-row DOM template cache keys on document identity and rebuilds per
document instead of leaking one request's template nodes into another.

Consequences:

- `@memoized-dom/server` no longer swaps `globalThis.document` or deletes
  `requestAnimationFrame` during render — concurrent request documents can
  no longer contaminate each other through process globals (the concurrency
  hardening prerequisite for Phase 5);
- `syncBooleanAttributes` walks via the node's `ownerDocument`;
- hydration/streaming can now supply their own document tier without
  touching compiled output.

**Tests:** root suite 85 files / 528 passed + 1 skipped (golden snapshots
deliberately updated for the one-line factory binding; stale ambient-form
assertions modernized across 9 suites), server suite 24/24, browser corpus
17/17, typecheck green.

## Slice 2.4 — compiler-order hydration node plan

**Commit:** `0ada33b`.

Adds the first mount-adoption primitive without changing the mount ABI or
structural runtimes. `HydrationNodePlan` performs one marker-aware post-order
walk over a claimed range, matching compiler creation order (`text → button →
section`) rather than DOM order (`section → button → text`). It excludes
nested `g/l/w` regions so their owning primitives receive separate plans,
validates node kind/tag/namespace on every claim, preserves node identity, and
keeps failed claims at the bounded position.

This follows the proposal's Phase 3 requirement to walk the client-compiled
shape and validate every step. Octane's elision model is inspiration only:
the validation property is adopted; byte-stability is not treated as the
correctness mechanism, and mismatch recovery remains our proposal's ladder.

**Tests:** runtime build plus `tests/hydration-cursor.test.ts` 7/7
(post-order identity, nested-range exclusion, and bounded failure added).

## Slice 2.5 — nested hydration marker identity index

**Commit:** `c332b8c`.

`HydrationMarkerIndex` performs one depth-first validation/index pass under
the root pair. It resolves nested `mmd:c/g/l/w` ranges by compiler-canonical
identity independently from DOM depth and post-order factory creation,
computes v0.2 row extents, rejects duplicate identities and kind mismatches,
and enforces one ownership claim per range. This separates marker location
from `HydrationNodePlan`'s ordinary-node serving; neither primitive mutates
the DOM or changes mount/cond/list behavior.

**Tests:** runtime build plus `tests/hydration-cursor.test.ts` 9/9
(nested element depth, paired ranges, rows, missing/mistyped/duplicate and
repeated claims).

## Slice 2.6 — static-root mount adoption

**Commit:** `d3d8bff`.

First bounded `mount()` integration. `hydrate(target, root)` validates the
`mmd:r` pair and runs the existing compiled root factory with a temporary
hydrate-mode `RenderEnvironment` on the ACTIVE browser runtime. The
environment is restored synchronously, while entity, scheduler, event, prop,
and extension ownership remain in that same runtime for later interactions.
`HydrationDocument` serves existing host/text nodes from
`HydrationNodePlan`; no element/text allocation occurs. The resulting
`MountedApplication` uses ordinary mount/unmount bookkeeping and removes the
root markers on unmount.

This increment intentionally accepts exactly one static host root. Fragment
roots and any indexed `c/g/l/w` range reject at the root boundary instead of
being ignored or remounted. Structural adoption and the remount ladder stay
separate per the proposal.

**Tests:** `tests/hydration-static-root.test.ts` proves node identity (`===`),
zero `createElement`/`createTextNode`, click-driven local updates after
environment restoration, bounded tag mismatch, and explicit structural
deferral. Root suite 86 files / 535 passed + 1 skipped; server 24/24;
typecheck green.

## Slice 2.7 — conditional branch adoption

**Commit:** `5ad2081`.

`createCondRegion` now participates in adoption. In hydrate mode it claims
its `mmd:g` range through the environment's `HydrationController` capability
(new optional field on `RenderEnvironment`, restored by
`runWithRenderEnvironment`), pushes a compiler-order plan for the claimed
range, and the active branch factory adopts the server nodes. Later branch
swaps create fresh nodes normally — the server rendered only one branch —
and the trailing close anchor keeps its role as the stable swap point.

Error precedence rule: a branch-factory mismatch is the primary diagnostic;
plan-completeness errors from `popRange` are suppressed when the factory
already threw, so the reported boundary is always the real skew site.

**Tests:** `tests/hydration-conditional.test.ts` — adopted branch identity
(`===`), post-adoption swap creating fresh nodes and detaching the adopted
arm, and tag skew reported at the conditional owner. Root suite 87 files /
537 passed + 1 skipped; server 24/24; typecheck green.

## Slice 2.8 — hydration-safe repeated DOM templates

**Commit:** `49b1bee`.

Repeated-row template emission now consults the active render environment
before reusing or cloning a detached template. Client-create mode retains the
existing document-keyed cache and deep-clone fast path. Hydrate mode instead
runs one shared module-level template constructor for every row, allowing the
hydration document to claim that row's own server nodes; it neither caches the
first claimed row nor clones it into later rows.

The constructor is emitted once. This preserves the one-static-constructor
invariant and avoids duplicating `createElement`/`createTextNode` bodies across
the cache-miss, cache-hit, and hydration branches. `canReuseTemplate()` is the
small runtime capability seam; it is false only while a hydration controller
is active.

This is deliberately the template half of list adoption. `createListRegion`
does not claim `mmd:l/w` yet, so no list hydration behavior is claimed by this
slice.

**Tests:** `tests/m58.test.ts` 14/14; hydration cursor/static/conditional
battery 28/28; R7/M5 golden snapshots updated; root suite 87 files / 538
tests; typecheck green.

## Next slices

1. **List/row adoption** — claim `mmd:l/w` and preserve row identity; the
   repeated-template cloning guard is now in place.
2. **Fragment/component-owner adoption** — multi-root results and `mmd:c`.
3. **Mismatch recovery ladder** — value correction, smallest structural-owner
   remount, and root fallback with partial-ownership teardown.
4. **SSR settle coordinator (§16.5)** — `resolve`/`shell` modes; the
   environment-document seam is now closed, so the remaining work is the
   settle/flush contract itself.
5. **Overhead measurement fixtures** — marker bytes vs element bytes per
   the Phase 2 overhead budget.
