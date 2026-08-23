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

| Phase | Status |
|---|---|
| 0 — freeze list identity / push invalidation | keying behavior covered by existing keyed-list tests; hydration-safe key encoding contract not yet written |
| 1.1 — request/application runtime context | **complete**: kernel, cleanup, props, mount, access routed; isolation tested |
| 1.2 — environment capabilities | **complete**: RenderEnvironment on every runtime (mode/document/schedule/effects/refs); effects gated server-side; volatile pulls disabled without a frame scheduler; structural anchors route through the injected document |
| 1.3 — module-state isolation | **probe complete**: cells proven isolated + reactive (Option B); compiler lowering pass not yet written |
| 1.4 — LinkeDOM reference renderer | **first tier working**: renderToString/renderWithDom over LinkeDOM; server/client structural parity tested; effects/refs verified off |
| 1.5 — CSR-equivalence matrix | **complete**: corpus over text/attrs/escaping/innerHTML/SVG/fragments/conditionals/lists/dynamic tags/slots + server effect/ref/cleanup guarantees; route and data states deferred to their wiring slice |
| 2–6 | gated behind phase 1 exit criteria |

## Next slices

1. **Router/data wiring:** request-local router + data runtime injection
   into renderToString; extends the parity corpus with route regions and
   deterministic data-loading states (finishes proposal §1.5).
2. **Phase 1.3 lowering:** compiler pass rewriting authored module-state
   bindings into cell operations for server builds.
3. **Router/data wiring:** request-local router + data runtime injection
   into renderToString.
