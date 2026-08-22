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

## Current status against the proposal phases

| Phase | Status |
|---|---|
| 0 — freeze list identity / push invalidation | keying behavior covered by existing keyed-list tests; hydration-safe key encoding contract not yet written |
| 1.1 — request/application runtime context | **kernel + cleanup + props + mount + access routed** (this document) |
| 1.2 — environment capabilities | not started |
| 1.3 — module-state isolation | not started (proposal Option B direction; isolation probe pending) |
| 1.4 — LinkeDOM reference renderer | not started; consumes the runtime context from 1.1 |
| 1.5 — CSR-equivalence matrix | not started |
| 2–6 | gated behind phase 1 exit criteria |

## Next slices

1. **Phase 1.2:** `RenderEnvironment` capability descriptor (mode, document,
   effects/refs policy) replacing scattered `typeof window` checks.
2. **Phase 1.3 probe:** per-request graph evaluation prototype proving
   module-binding isolation between two concurrent renders.
3. **Phase 1.4:** `renderWithDom(App, { url, document })` over LinkeDOM,
   creating a fresh application runtime per call, refs/effects deferred.
