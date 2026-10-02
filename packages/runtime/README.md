# @memoized-dom/runtime

Dependency-free registry, scheduling, optional dirty-reason batching, access
routing, keyed regions, props boxes, cleanup/ref ownership, and DOM value helpers
for memoized-dom compiler output.

Application source does not need to import reactive primitives. The ordinary
browser entry imports only the mounting boundary:

```ts
import { mount } from '@memoized-dom/runtime';
import { App } from './App';

mount('root', App);
```

Generated modules import this package as one namespace:

```js
import * as MD from '@memoized-dom/runtime';
```

`mount()` resolves string targets with `document.getElementById()`, owns only
the nodes produced by the compiled root, returns an idempotent `unmount()`
handle, and keeps the compiler's private factory ABI out of authored code.
Pass `{ onHydrateError(error) { /* log mismatch */ } }` as a third argument
to observe a hydration mismatch before `mount()` replaces server markup with
a fresh client render.

## Keyed list ownership

General reconciliation keeps retained keys in the region's existing Map. A
private frame marker detects duplicates and preserves consumed-key visibility
for in-frame `refreshKey()` and `size()` calls. Key evaluation, row updates and
cleanup hooks retain their forward ordering. Removed keys remain available to
cleanup hooks until the general removal pass finishes; placement follows cleanup.
Ordered row records preserve lifecycle order after reorders.

Fresh rows are staged separately until commit. Fresh mounts and complete
replacements adopt the staged Map directly. Interrupted frames remain disposable,
including when a retained prop update or render throws before its ordered record
is stored. This preserves ownership; reconciliation is not transactional and
does not roll back authored effects or completed DOM writes after an exception.

## Entity teardown

`unregisterSubtree()` removes the registered subtree before running cleanup hooks,
with descendants disposed before their owners. Entities without child links use
a direct removal path. Traversal buffers are retained for nested owners; error
arrays are created only when a cleanup reports a failure. Owner cleanups still
run in reverse registration order, and reported failures do not stop later hooks.

Registry generation advances before removal notifications and cleanup hooks.
Each removal invalidates the cached ID list before notifying listeners, so calls
to `registeredIds()` during teardown reflect the current registry. Previously
returned ID snapshots keep their contents.

List regions become terminal before running disposal callbacks. Reentrant
`dispose()`, reconciliation and refresh calls then do nothing, and `size()`
returns zero. Disposal finishes the remaining rows, entities and anchors before
reporting cleanup failures: one error is rethrown unchanged, multiple errors are
reported together. Interrupted frames retain the same ownership coverage.

The compiler marks proven DOM-only inline rows with the final `resourceFree`
argument to `createListRegion()`. Those entries have no entities or disposal
callbacks. Complete clear/replacement and ordinary unmount can remove their
owned DOM range without visiting empty cleanup records. Clear retains the same
boundary comments; unmount removes them. Other callers retain normal cleanup,
including callers that disable row ID tracking without this additional proof.

The package is independently buildable:

```bash
bun run build
```
