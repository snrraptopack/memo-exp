# Architecture Review and Way Forward

> Audit date: 2026-07-26. This is an implementation status review. The
> normative emission contract remains `emission-spec.md`; the product intent
> remains `memoized-dom-paradigm.md`.

## Current system

The compiler performs whole-module analysis before emission:

1. Classify module state, components, helpers, instance state, derivations, and
   reactive effects.
2. Build component/list/conditional paths and binding-aware read sets.
3. Insert invalidation at the function scope where each write executes.
4. Emit one-shot DOM creation plus closure-based update functions with inline
   scalar guards.
5. Install a static access-table fragment for shared-state/effect routing.

The runtime owns only registry topology, dirty scheduling, access resolution,
props boxes, keyed regions, render-before-effect commit draining, and returned
effect teardown. Component state, DOM nodes, slot caches, and per-instance
derivations stay in factory closures. There is no VDOM, signal cell,
subscription graph, or runtime read tracking.

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
| Destructured/default props and body projections | Confirmed stale-binding gap | R24 replays projections before dependent derivations and DOM writes |
| Fragments, spreads, rich DOM values, and SVG | Confirmed JSX/DOM gap | R24 preserves ordered roots/overrides and emits specialized or general DOM-aware updates |
| Component children on keyed rows | Confirmed first-item capture/identity gap | R24 owns one current-item slot under each runtime row id |
| Unrelated local writes replay every derivation | Confirmed avoidable per-instance work | R25 emits numeric reasons only when the local dependency structure can skip a replay group |
| No reactive external-synchronization primitive | Confirmed reactivity gap | R26 emits statically routed component-owned effect entities with render-first ordering and automatic returned teardown |
| Conditional effect feedback falsely cycles | Confirmed static normal-exit over-invalidation | R26 guards each direct effect write/call site by whether it executed; stabilizing feedback settles while genuine loops retain the cascade guard |
| `effect(() => console.log(count))` self-invalidates | Confirmed unknown-argument boundary conflict | Direct effect arguments crossing unknown APIs are read-only inputs; visible/direct writes and reactive receiver methods remain writable |
| List sourced from a destructured prop is rejected | Confirmed R7 classifier omission | Prop bindings and static prop member paths are owner-local list sources; R10/R24 refresh the binding before reconciliation |
| Component-body `if`/`switch` calculations stay stale | Confirmed render-prelude gap | R27 combines pure exhaustive statement derivations with expression derivations in source order and applies R25 dirty-reason selection |
| JSX early returns rerun or cannot compose | Confirmed structural-return gap | R27 lowers tail early-return chains and terminal JSX if/switch forms to one stable region with owned subtree disposal |
| Chained JSX ternary rejected as a non-JSX branch | Confirmed binary-analyzer gap | R27 flattens right-associated chains into one multi-branch conditional region and supports fragment branches |
| Module-level pure `if`/`switch` is one-time only | Confirmed shared-derived-state gap | R28 emits depth-(-1) singleton flow computeds with per-target change gating and canonical cross-module routing |

## Decisions

### Per-instance derivations

Do not create one computed entity per component instance. The owner is already
the exact invalidation unit. Local expression and pure control-flow
derivations stay in its existing update prelude and retain source order:

`prop resync -> const/if/switch prelude -> child/DOM/region guarded writes`

This has no registry allocation, table key, downstream commit, or scheduling
pass. Module expression and statement computeds remain depth-`-1` entities
because they can feed unrelated component subtrees and benefit from
change-gated propagation. R28 statement computeds replay one exhaustive
`if`/`switch` per source update and commit each changed target independently.

The compiler uses structural dual mode. If every exact local source reaches
every derivation, the prologue remains unconditional and writes use bare
`markDirty(id)`. When the dependency graph has skippable groups, writes carry
numeric reasons. One reason remains a scalar; a frame that batches different
reasons promotes them to a Set. Unscoped table, props, owner, and fallback
marks mean full replay. No method-name or cost whitelist is involved.

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

### Reactive effects

`effect(() => ...)` is an optional compiler intrinsic for synchronizing
reactive values with systems outside JSX; it is not a state wrapper or a hook
with a dependency array. Immediate module/local/prop/derivation reads are
collected statically and routed to a child `owner/$effects/index` entity.
Render/computed entities always drain before effect entities. The latest
returned synchronous disposer runs before rerun and on unmount.

Direct effect writes retain ordinary local/shared routing but use per-site
execution booleans. Skipped conditional sites do not commit, so finite
feedback may stabilize. An actually unconditional feedback loop remains
bounded by the 100-pass cascade guard. Values passed to unknown APIs in the
direct effect body are read-only consumption: they establish reads without
claiming a hidden mutation. Visible helper summaries, direct writes, and calls
on reactive receivers remain mutation paths.

Initial effects are post-render, not a separate post-attachment mount hook.
The normal browser frame usually follows insertion of the returned root, but
detached factories, synchronous custom schedulers, and SSR do not imply
`node.isConnected`.

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
callee, analogous to a compile-time content slot. Static calls link slot
updates to the lexical owner. Keyed calls allocate one slot closure per row,
use the row id as its entity base, and replay the retained row's current item
before updating mounted caller content.

### Conservative mutation boundary

Direct roots, static store paths, and literal `Object.assign` sources produce
exact interned write sets. Every call on a reactive receiver produces a
bounded write effect for that receiver, independent of method name. Dynamic paths,
identifiable aliases/destructuring sources, and direct reactive root arguments
retain finite root boundaries. Visible helpers preserve relative parameter
paths through local and linked calls.

Within keyed components, the row item boundary is its actual prop path
(`item` or `props.item`), not the whole props object. Writes through another
prop refresh the row and use component-graph provenance to commit the
caller-side canonical state identity. Provenance flows through direct and
forwarded props, including destructured aliases. Multiple call sites union
their finite keys. A spread, external prop, or other source whose shared
identity cannot be bounded retains the root fallback.

Only a summary with no finite receiver, argument, instance, row, or state root
dirties the root subtree. Unresolved imported functions are the current common
case. Commits are still emitted on normal exits; exception-path behavior
remains an explicit P0 decision. Numeric dirty reasons now skip unrelated
local derivations inside selected entities. A bitmask may later replace their
representation, but neither mechanism replaces access-table routing or
changes the bounded-write-effect contract.

## Priority roadmap

### P0: correctness boundaries

1. Decide exception-path commit semantics with dedicated performance evidence.
2. Validate root-id installation across independently mounted linked graphs.
3. Decide whether a future host mount ABI should provide a distinct
   post-attachment effect phase; R26 currently promises post-render only.

### P1: source-language coverage

1. Fold reachable local-helper summaries into R14 purity checks.
2. Expand recursively nested ordinary conditional regions, lists inside list
   rows, and recursive components. Early-return regions may own one analyzed
   conditional; mounted components and mapped lists inside conditional
   branches are supported.
3. Support richer children-slot insertion positions while retaining one-mount
   ownership.

### P2: measured performance

1. Replace full-graph fixed-point reparsing with cached module facts and a
   dependency worklist. The initial linker benchmark records the graph-link
   overhead over prelinked transforms; see `bench/linker/README.md`.
2. A/B the production scalar/Set dirty reasons against a 32-bit mask
   representation. Structural dual mode now skips unrelated local derivations;
   the isolated Chromium prototype suggests masks may lower dispatch overhead,
   but relevant nanosecond-scale paths remain too noisy for a universal claim.
   See `bench/invalidation/README.md` and `bench/local-derived/README.md`.
3. Profile select/swap/clear paths; they have the largest current gap to
   hand-written vanilla in the browser benchmark.
4. Add stable compiler-throughput and large-access-table benchmarks.
5. Add effect mount/rerun/teardown and feedback-drain benchmarks without
   conflating compiler overhead with runtime scheduling.

### Packaging and host integration

The runtime, compiler, and Vite 8 adapter are separate workspace packages.
The Vite adapter collects static value imports through the host resolver,
compiles one connected graph per Vite environment, and caches linked output.
Managed-file changes invalidate that graph and request a full browser reload:
the current factory closures and module state cannot be replaced safely by
state-preserving HMR. Other bundlers should receive separate adapter packages
over the same `compileModules()` host-resolver contract.
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
10. Preserve specialized explicit-attribute emission while optimizing the
    ordered spread patcher. `bench/jsx/README.md` currently measures about
    1.11x mount and 1.20x rich-update cost for spreads under happy-dom.

## Benchmark baselines

Benchmark methodology and latest measurements live with each suite under
`bench/`; see `bench/README.md`. Architecture notes should reference those
baselines rather than duplicate tables that drift.
