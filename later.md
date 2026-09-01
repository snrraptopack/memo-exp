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

## 2. SPA-Only Runtime Bundle Decoupling

### Current State
* `@memoized-dom/runtime` is currently ~38.5 kB minified / ~13.5 kB gzipped.
* It includes the full SSR hydration engine (`src/hydration.ts` — ~20 kB source), hot module reloading (`src/hot.ts`), and keyed list diffing in one monolithic bundle.

### Future Optimization Target
1. **Subpath Export for Hydration:** Move `hydration.ts` to `@memoized-dom/runtime/hydrate` so pure client SPAs using `mount('root', App)` do not pay the byte cost of the SSR cursor walker and mismatch recovery engine.
2. **Dead-Code Elimination for HMR in Production:** Ensure `hot.ts` and dev assertions are completely stripped when `import.meta.env.PROD` or `process.env.NODE_ENV === 'production'`.
3. **Target SPA Runtime Size:** **~12–16 kB minified / ~4–5.5 kB gzipped**.
