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
| `const count = Count(..., [count])` | Confirmed TDZ and semantic shadowing | Child-result binding is now hygienic; compiler-wide generated-name allocation remains P0 |
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
only serialized after binding resolution. Across modules, raw names are
insufficient; the target remains canonical keys such as
`./state.ts#store.selectedId`, produced by a linker/bundler stage that does not
exist yet.

## Priority roadmap

### P0: correctness boundaries

1. Replace all fixed emitter names (`id`, `parent`, `update`, `$t`, node/region
   names, `WRITES_n`) with one compiler-wide hygienic allocator.
2. Make fallback completeness real for unknown calls, escaped mutable values,
   aliases, `delete`, `Object.assign`, and exception paths.
3. Specify and implement lifecycle-owned factory callbacks/subscriptions.
4. Add cross-module canonical state keys and fragment linking before claiming
   imported-state support.

### P1: source-language coverage

1. Fold reachable local-helper summaries into R14 purity checks.
2. Support destructured/default props without losing binding identity.
3. Expand nested list/conditional/component regions and recursive components.
4. Add SVG, style-object, class-object, and attribute-name semantics.

### P2: measured performance

1. Prototype compiler-selected per-entity dirty-reason masks. The isolated
   Chromium benchmark shows a large win for skipped expensive work, ~3× for
   a skipped 32-expression group, and ~12% overhead for a single cheap slot;
   see `bench/invalidation-masks.md`.
2. Profile select/swap/clear paths; they have the largest current gap to
   hand-written vanilla in the browser benchmark.
3. Add stable compiler-throughput and large-access-table benchmarks.
4. Measure lifecycle and full-hygiene changes independently; compiler-only
   improvements must not be credited as runtime gains.

## Benchmark baseline

Chromium benchmark, median of 7 on this machine before the R14 changes:

| Scenario | Component rows | Inline rows | Vanilla |
|---|---:|---:|---:|
| create 1k | 22.0 ms | 37.6 ms | 11.2 ms |
| replace 1k | 26.7 ms | 32.5 ms | 13.6 ms |
| partial update | 0.8 ms | 0.7 ms | 0.3 ms |
| select row | 2.7 ms | 4.0 ms | 0.2 ms |
| swap rows | 1.2 ms | 2.1 ms | 0.1 ms |
| remove row | 1.9 ms | 1.1 ms | 0.1 ms |
| create 10k | 166.9 ms | 228.6 ms | 66.7 ms |
| append 1k to 10k | 33.6 ms | 35.1 ms | 9.1 ms |
| clear 10k | 62.9 ms | 96.7 ms | 3.3 ms |

R14 adds no work to components without local derivations. Browser results
should therefore remain statistically flat; correctness tests, DOM mutation
counts, and profiles should accompany any claim of improvement.

Post-change medians were consistent with that expectation: component/inline
`create 10k` measured 145.2/182.7 ms, partial update 0.7/0.7 ms, select
2.7/3.3 ms, and clear 59.7/74.7 ms. The faster creation numbers are treated as
run-to-run variance, not an R14 gain, because these benchmark sources emit no
local derivation prologue.
