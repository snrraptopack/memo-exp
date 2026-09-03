# Compiler Optimization Roadmap & Technical Notes

This document records architectural optimizations, potential performance enhancements, and future compiler passes to be revisited.

---

## 1. Parameter Mutation Provenance (Completed 2026-09-02)

When an authored component helper mutates a collection element or nested object through a function parameter (such as in `tsrx-board`):
```ts
const handleToggleTask = (task: Task) => {
  task.completed = !task.completed;
};

const handleRemoveTask = (column: ColumnData, index: number) => {
  column.tasks.splice(index, 1);
};
```
the compiler now folds the parameter write back to its canonical reactive source instead of losing the source at a component boundary.

### Implemented Boundaries

* Local helper calls already fold parameter writes through their call arguments.
* Cross-file component props now preserve list-item provenance through compiler-generated keyed-list callbacks.
* The collection can come directly from module state, from a parent prop path such as `column.tasks`, or from a local derivation. A local derivation carries all of its known reactive roots conservatively.
* The same ESTree analysis serves TSX and TSRX. TSRX `@for` participates because its frontend lowers to the compiler's existing structural list form; this does not introduce a whitelist of arbitrary collection methods.
* If an origin is unresolved or ambiguous, the compiler deliberately retains `markDirtySubtree` as the correctness fallback.

The `tsrx-board` path that motivated this note now emits canonical `markDirty`/`commitWrites` operations for `BoardColumn` and `TaskCard`, with no root-subtree fallback for their task mutation handlers.

### Remaining Optimization Target: Direct Leaf Row Routing

Canonical source invalidation is substantially narrower than invalidating the whole application subtree, but it may still reconcile a source-backed collection so that in-place object mutations remain observable. A future, separately proven optimization could route a leaf field write directly to the affected row and independently notify aggregate derivations. It must preserve aliasing and in-place mutation semantics; object-identity equality alone is not a safe reason to skip reconciliation.

---

## 2. Compiler-Proven List Structure Updates (Completed 2026-09-03)

The compiler now preserves whether a routed collection write is structural or
may change retained row content. This classification is based on the write
boundary, not the authored method name: root replacement and writes to the
collection receiver are structural; nested item-field writes and unresolved
helper/import effects remain ordinary conservative writes. There is no array
method or function whitelist.

Structural commits carry a canonical, source-addressed reason through a
dedicated access-table reader channel. A component owning two lists therefore
updates the exact affected list owner plus real independent readers, without
replaying every retained row merely because it is below the same component.
The runtime still validates keys and identity and retains the general keyed
reconciler with LIS as its correctness fallback.

Client-created list rows no longer allocate hydration comments per key. Their
compiler-emitted `ListEntry.nodes` already defines the exact live extent.
Server output and hydration keep their existing marker protocol; no SSR API or
contract changed.

### Measured Result

Across two consecutive local Chrome 152 seven-sample median runs,
component-row append to 10k measured 14.9–15.1 ms after a 36.2 ms baseline,
prepend 16.4–21.7 ms after 43.9 ms, pop 5.8–6.6 ms after 30.6 ms, reverse
39.2–54.5 ms after 89.4 ms, and scattered removal 3.7–6.1 ms after 13.6 ms.
Despite absolute machine noise, reverse held at 1.31–1.32x the hand-written
vanilla path. The checked-in harness is the reproducible contract.

### Remaining Optimization Target: Inline Row Entity Elision

Inline TSX/TSRX rows still register one reactive entity per item, while an
eligible component row already uses the allocation-free row ABI. This explains
the remaining creation, selection, and clear gap. The next compiler pass should
prove when an inline row can route its external reads through the list owner and
retain only its direct update closure. Instance-local collection sources also
remain conservative unless their existing keyed-item mutation journal provides
an exact reason.

#### Current Architecture and Exact Bottleneck

An inline keyed row currently lowers to all of the following:

1. A stable row id (`<owner>/<list>/Row[<key>]`) and a registered render entity.
2. A row-local update closure containing guarded DOM setters.
3. An `updateProps` closure that rebinds the current item and optional index.
4. A `ListEntry` that reports the row id in `entities`, causing removal to run
   `unregisterSubtree` for every discarded row.
5. Wildcard access-table readers (`Row[*]`) for module state consumed by the
   row, so one broad value such as `selected` can schedule every live row.

The entity is not pointless: it currently provides independently addressable
invalidation, dirty-reason storage, parent/child lifecycle ownership, recursive
cleanup for nested components and regions, and a destination for row-local
handler writes. The bottleneck is that simple host-only rows pay all of that
even when their generated update closure is already the complete unit of work.

The remaining cost now shows up clearly because client row hydration comments
have been removed:

* **Creation:** every row inserts into the registry, links into the parent's
  child set, and is tested against live wildcard reader patterns.
* **Broad row state updates:** a value read by all rows expands to and schedules
  every row entity separately, including dirty-reason bookkeeping.
* **Clear/removal:** every row unregisters independently and updates registry
  and wildcard caches even when its DOM was deleted as one range.
* **Memory:** each row retains an entity record, child metadata, registry key,
  and access-resolver membership in addition to its DOM/update closure.

This matches the Chromium contrast: eligible component rows use the
registry-free ABI, while inline clear of 10k rows measured 55.6–66.4 ms versus
11.2–15.2 ms for component rows. Inline selection also remained 3.6–3.9 ms
while the component-row path measured 0.2–0.4 ms.

#### Proposed Compiler Proof, Not a Runtime Guess

The compiler may elide an inline row entity only when the emitted row owns no
entity-dependent lifecycle. The initial proof should require:

* no nested component, conditional region, keyed region, dynamic component, or
  transparent data-policy entity;
* no effect, cleanup registration, ref disposer, volatile pull, or other
  lifecycle callback that currently attaches to the row id;
* no parameterized access route that deliberately targets one row entity by
  key; and
* a generated direct update closure for every dynamic host value, with index
  replay retained when the callback consumes the index.

For a proven row, emission can set `entities: []`, disable row-id tracking for
that list, route shared module reads to the list owner, and use the existing
row update closure directly for row-local handler writes. The list owner then
reconciles/replays those closures in one call. This is compile-time ownership
selection; the keyed topology algorithm and its LIS correctness fallback do
not change.

Rows failing any gate keep today's entity path. In particular, nested stateful
trees and precisely key-addressed invalidation must not be made slower or less
correct merely to improve a bulk benchmark. Event/devtools provenance also
needs a key-addressed identity that does not require a registry entry before
the optimization can be considered complete.

#### Acceptance Gates

* Existing keyed identity, event mutation, nested composition, cleanup, ref,
  conditional, transparent-source, hydration, and HMR tests remain unchanged.
* Add compiler snapshots for both an eligible host-only row and every rejected
  ownership category.
* Measure create, select, partial update, clear, scattered removal, and memory
  growth for both inline and component rows; no win may rely only on one bulk
  operation.
* Preserve the no-method-whitelist rule and add no parser/backend dependency;
  TSX and TSRX must receive the same decision after ESTree lowering.
* Keep arbitrary or unlinked effects conservative.

---

## 3. SPA-Only Runtime Bundle Decoupling (Completed 2026-09-02)

### Implemented Boundaries
* `@memoized-dom/runtime` and `@memoized-dom/runtime/client` contain the browser compiler surface and creation-only `mount()`.
* `@memoized-dom/runtime/hydrate` owns marker parsing, DOM adoption, payload restore, and mismatch recovery.
* `@memoized-dom/runtime/hot` owns dev-only component replacement.
* `@memoized-dom/runtime/server` installs `AsyncLocalStorage`; browser builds no longer contain Node/Bun detection or `node:async_hooks` loading.
* The compiler and Vite adapter emit the HMR subpath only for development graphs.

### Measured Result
The representative production Todo graph moved from **35,012 B raw / 11.51 kB gzip** to **25,793 B raw / 8.96 kB gzip**. That is a 9,219 B raw reduction (26.3%) and approximately 2.55 kB gzip (22.2%). The bundle benchmark now fails on size-budget regressions and on hydration, HMR, or Node host markers leaking into browser output.

The earlier 12–16 kB raw runtime target remains a separate optimization pass over the core registry, access routing, and keyed-list implementation; it is no longer a boundary-decoupling task.
