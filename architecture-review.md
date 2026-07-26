# Architecture Review and Way Forward

> Audit date: 2026-07-25. This is an implementation status review. The
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
| Module-derived arrays hide retained object-field writes | Confirmed unsound identity gate | Mutable references now propagate conservatively; distinct equal primitive arrays retain shallow suppression |
| Timer/promise updates stay stale through a local helper | Confirmed reachability gap | Reachable component-local helpers are instrumented transitively |
| Timer started during factory initialization | Confirmed lifecycle gap | R20 instruments setup callbacks and binds explicit `cleanup(disposer)` to subtree unregister |
| Aliases, reflective writes, and unknown calls | Confirmed conservative-boundary gaps | R17 added sound fallbacks; R19 narrows identifiable receivers, roots, and helper-parameter paths |
| Handler with no recognized write skips rendering | Confirmed drift from the event-boundary contract | R18 invalidates the nearest component/row/region; guarded updates remain scoped |
| Method-name mutation blacklist | Semantically incomplete and unnecessary | Removed in R19; every reactive receiver call has a bounded receiver effect |
| JSX component children/composition | Confirmed source-language gap | R21 emits lazy caller-owned content slots linked to the caller's guarded update |
| Cross-file component composition | Confirmed graph-linking gap | R22 links factory shape, caller paths, keyed-row mode, children, callbacks, and cleanup across named/default imports |
| Component-local collection lists | Confirmed module-only R7 gap | R23 keeps instance roots private while arrays/object paths and derived Map/Set/object views reconcile in the owner |
| Named local declaration as handler | Confirmed resolver gap | R23 resolves lexical function declarations and instruments reachable writes |
| Async module helper called by an event | Confirmed post-await gap | R23 commits the summary immediately at the event and again on normal async completion |

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

Commit where the write runs. Async named helpers have two conservative
observable phases: their event call site commits after synchronous invocation
to expose pre-await writes, and the helper commits again on normal completion
to expose continuation writes. Instance helpers target their owner directly;
module helpers route canonical summaries. The compiler guarantees callbacks
lexically reachable from analyzed handlers/helpers, factory setup
calls/constructors, and module initialization. Factory resources use explicit
`cleanup(disposer)` ownership. Root and keyed-row unregister drain descendants
before owners and each owner in LIFO order. Module-started work table-routes
writes but remains module/application-owned. No exception wrapper or implicit
cleanup is introduced.

### Access identity

Within one module, Babel binding identity is authoritative. String names are
only serialized after binding resolution. Every state key is module-qualified.
`compileModules()` resolves imports, exported function summaries, and component
factory identities; it accepts bundler aliases or a host resolver. The
component graph maps defining-file reader analysis back to caller-derived
entity paths, including import aliases and keyed rows.

### Component children

Do not pass eager DOM arrays or element descriptions. The caller emits a stable
mount function; the callee invokes it only where it renders its reserved
`children` interpolation. Mounted content keeps a separate scalar-guard/update
closure, and the lexical caller invokes that update directly. This preserves
plain closure state and static access routing without a runtime child graph.

The content is caller-owned even though its DOM insertion point belongs to the
callee, analogous to a compile-time content slot. Static slots support current
host/component/list/conditional forms and forwarding. Dynamic row-call slots
remain separate work because retained list entries need per-item slot update
and teardown ownership.

### Conservative mutation boundary

Direct roots, static store paths, and literal `Object.assign` sources produce
exact interned write sets. Every call on a reactive receiver produces a
bounded effect for that receiver, independent of method name. Dynamic paths,
identifiable aliases/destructuring sources, and direct reactive root arguments
retain finite root boundaries. Visible helpers preserve relative parameter
paths through local and linked calls.

Only a summary with no finite receiver, argument, instance, row, or state root
dirties the root subtree. Unresolved imported functions are the current common
case. Commits are still emitted on normal exits; exception-path behavior
remains an explicit P0 decision. Dirty-reason masks may later skip independent
work inside a selected entity, but they do not replace access-table routing or
change the bounded-effect contract.

## Priority roadmap

### P0: correctness boundaries

1. Decide exception-path commit semantics with dedicated performance evidence.
2. Define bundler adapter integration around the implemented graph API.

### P1: source-language coverage

1. Fold reachable local-helper summaries into R14 purity checks.
2. Support destructured/default props without losing binding identity.
3. Expand nested list/conditional/component regions and recursive components.
4. Add SVG, style-object, class-object, and attribute-name semantics.
5. Extend children slots to keyed component-row calls and richer insertion
   positions.

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
5. Keep measuring full-hygiene changes independently; compiler-only
   improvements must not be credited as runtime gains. R20 teardown cost is
   isolated in `bench/lifecycle/README.md`.
6. Track component-slot mount/update overhead in
   `bench/children/README.md`; current happy-dom results show mount cost but a
   near-parity hot update.
7. Preserve branch-specific write sets through visible helper calls. Summary
   unions currently let a runtime dispatch helper invalidate list structure
   and unrelated derivations for a scalar-only branch. The framework benchmark
   demonstrates this with `mutatePlain(snapshot, scenario)`: direct bounded
   mutation improves the 100-row path, but reactive rename/no-change still
   scale with list size. Optimize the dirty set before masks; a bitmask only
   makes routing an already-correct set cheaper.
8. Keep cross-file component runtime parity and compiler latency separate.
   `bench/components/README.md` finds no runtime adapter cost; graph compilation
   remains about four times the one-file application latency on this small
   case because fixed-point passes reparse modules.
9. Preserve lightweight rows for instance-backed collections by passing their
   owner id through the internal row ABI. `bench/local-state/README.md` records
   mount parity and no measured update penalty for the conservative row-plus-
   owner path; broader browser workloads still decide future grouping work.

## Benchmark baselines

Benchmark methodology and latest measurements live with each suite under
`bench/`; see `bench/README.md`. Architecture notes should reference those
baselines rather than duplicate tables that drift.
