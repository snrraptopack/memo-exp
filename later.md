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
