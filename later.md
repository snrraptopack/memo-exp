# Compiler Optimization Roadmap & Technical Notes

This document records architectural optimizations, potential performance enhancements, and future compiler passes to be revisited.

---

## 1. Parameter Mutation Invalidation: From `markDirtySubtree` to Surgical Channel Invalidation

### Current State
When an authored component helper mutates a collection element or nested object through a function parameter (such as in `tsrx-board`):
```ts
const handleToggleTask = (task: Task) => {
  task.completed = !task.completed;
};

const handleRemoveTask = (column: ColumnData, index: number) => {
  column.tasks.splice(index, 1);
};
```
The compiler's static analysis in `packages/compiler/src/handlers/analyze.ts` treats mutations on unrooted parameters as an unlocalized write. It currently falls back to `scope.rootFallback = true`, emitting:
```js
_MD.markDirtySubtree("App");
```
* **Correctness:** Safe and sound. The component and its children re-evaluate and the UI updates reliably.
* **Cost:** It triggers a full component subtree invalidation rather than a surgical, single-node DOM patch.

---

### Future Optimization Target

We can elevate parameter mutations to **Level 1 (Surgical Channel Updates)**:

#### A. Static Parameter Provenance Folding
When a helper like `handleToggleTask(task)` is passed down to `<BoardColumn onToggleTask={handleToggleTask} />` and called inside `@for (const task of tasks)`:
1. The compiler can observe at the call site that the argument `task` is an element of `column.tasks`, which is rooted at the instance state array `columns`.
2. Instead of falling back to `markDirtySubtree`, the provenance tracker can fold the parameter write back to the origin root `columns`.
3. The emitted commit becomes:
   ```js
   _MD.markDirty(_id, 0); // Exact dirty bit for `columns`
   ```
4. This limits the invalidation to only the expressions that depend on `columns` (such as `allTasks`, `completedCount`, and list reconciliation), without touching unrelated instance state.

#### B. Direct Leaf Item Row-Routing
For visual updates local to a leaf component (e.g. toggling `task.completed` modifying only the checkmark icon and CSS class of `<TaskCard />`):
1. The leaf component `<TaskCard />` can execute its own local $O(1)$ scalar DOM patch for `task.completed`.
2. A separate scalar notification updates only the derived `completedCount` in the parent `App` header, skipping full list reconciliation when no items were added or removed.

---

## 2. SPA-Only Runtime Bundle Decoupling (Completed 2026-09-02)

### Implemented Boundaries
* `@memoized-dom/runtime` and `@memoized-dom/runtime/client` contain the browser compiler surface and creation-only `mount()`.
* `@memoized-dom/runtime/hydrate` owns marker parsing, DOM adoption, payload restore, and mismatch recovery.
* `@memoized-dom/runtime/hot` owns dev-only component replacement.
* `@memoized-dom/runtime/server` installs `AsyncLocalStorage`; browser builds no longer contain Node/Bun detection or `node:async_hooks` loading.
* The compiler and Vite adapter emit the HMR subpath only for development graphs.

### Measured Result
The representative production Todo graph moved from **35,012 B raw / 11.51 kB gzip** to **25,793 B raw / 8.96 kB gzip**. That is a 9,219 B raw reduction (26.3%) and approximately 2.55 kB gzip (22.2%). The bundle benchmark now fails on size-budget regressions and on hydration, HMR, or Node host markers leaking into browser output.

The earlier 12–16 kB raw runtime target remains a separate optimization pass over the core registry, access routing, and keyed-list implementation; it is no longer a boundary-decoupling task.
