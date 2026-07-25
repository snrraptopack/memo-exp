# Architecture Review and Way Forward

> Audit date: 2026-07-24. This is an implementation status review. The
> normative emission contract remains `emission-spec.md`; the product intent
> remains `memoized-dom-paradigm.md`.

## Current system

The compiler performs whole-module analysis before emission:

1. Classify module state, components, helpers, instance state, and derivations.
2. Build component/list/conditional paths and binding-aware read sets.
3. Insert invalidation at the function scope where each write executes.
4. Emit one-shot DOM creation plus closure-based update functions with inline
   scalar guards.
5. Install a static access-table fragment for shared-state routing.

The runtime owns only registry topology, dirty scheduling, access resolution,
props boxes, keyed regions, and commit draining. Component state, DOM nodes,
slot caches, and per-instance derivations stay in factory closures. There is no
VDOM, signal cell, subscription graph, or runtime read tracking.

## Issue disposition

| Report | Finding | Current disposition |
|---|---|---|
| Duplicate `WRITES_n` arrays | Confirmed in old generated output | Fixed by write-set interning; generated benchmark artifacts refreshed; regression added |
| `const count = Count(..., [count])` | Confirmed TDZ and semantic shadowing | Fixed compiler-wide: runtime, factory, slot, node, region, row, computed, handler-temp, and write-set bindings share one Babel UID allocator |
| State `count` vs prop `count` table collision | Confirmed name-based read attribution | Reads now follow lexical binding identity; prop writes fail clearly instead of routing module state |
| `{oldVal}` vs `{payload.oldVal}` | The runtime requires the documented `payload.` namespace | Spec examples retain `{payload.*}`; failed interpolation falls back to reader supersets |
| Payload routing described as deferred | Documentation drift | Runtime comments now describe the shipped resolver |
| Local derived/computed values stay stale | Confirmed architecture gap | R14 recomputes them in the owner update prologue, after prop resync |
| Timer/promise updates stay stale through a local helper | Confirmed reachability gap | Reachable component-local helpers are instrumented transitively |
| Timer started during factory initialization | Still unsupported | Needs lifecycle ownership plus an instrumentation/fallback rule |

## Decisions

### Per-instance derivations

Do not create one computed entity per component instance. The owner is already
the exact invalidation unit, so local derivations are reassigned in source order
inside its existing update prologue:

`prop resync -> local derivations -> child/DOM guarded writes`

This has no registry allocation, table key, downstream commit, or scheduling
pass. Module computeds remain depth-`-1` entities because they can feed unrelated
component subtrees and benefit from change-gated propagation.

### Async and external work

Commit where the write runs, not when the originating event promise settles.
That gives correct timing for `await`, timers, and promise callbacks and avoids
replaying a handler-wide write set. The compiler currently guarantees this for
callbacks lexically reachable from analyzed handlers/helpers.

Factory-started timers and subscriptions need an explicit lifecycle design:
ownership, cleanup on subtree unregister, and a conservative invalidation
boundary when callback writes escape analysis. Silent support claims are not
acceptable.

### Access identity

Within one module, Babel binding identity is authoritative. String names are
only serialized after binding resolution. Every state key is module-qualified.
`compileModules()` resolves imports and exported mutator summaries to canonical
keys such as `./state.ts#store.selectedId`; it accepts bundler aliases or a host
resolver. Cross-file component composition is not linked yet.

## Priority roadmap

### P0: correctness boundaries

1. Make fallback completeness real for unknown calls, escaped mutable values,
   aliases, `delete`, `Object.assign`, and exception paths.
2. Specify and implement lifecycle-owned factory callbacks/subscriptions.
3. Extend the implemented state linker to cross-file component composition and
   bundler adapters.

### P1: source-language coverage

1. Fold reachable local-helper summaries into R14 purity checks.
2. Support destructured/default props without losing binding identity.
3. Expand nested list/conditional/component regions and recursive components.
4. Add SVG, style-object, class-object, and attribute-name semantics.

### P2: measured performance

1. Replace full-graph fixed-point reparsing with cached module facts and a
   dependency worklist. The initial linker benchmark records the graph-link
   overhead over prelinked transforms; see `bench/linker/README.md`.
2. Prototype compiler-selected per-entity dirty-reason masks. The isolated
   Chromium benchmark shows a large win for skipped expensive work and ~3× for
   a skipped 32-expression group; relevant nanosecond-scale paths are too noisy
   for a universal-mask claim. See `bench/invalidation/README.md`.
3. Profile select/swap/clear paths; they have the largest current gap to
   hand-written vanilla in the browser benchmark.
4. Add stable compiler-throughput and large-access-table benchmarks.
5. Measure lifecycle and full-hygiene changes independently; compiler-only
   improvements must not be credited as runtime gains.

## Benchmark baselines

Benchmark methodology and latest measurements live with each suite under
`bench/`; see `bench/README.md`. Architecture notes should reference those
baselines rather than duplicate tables that drift.
