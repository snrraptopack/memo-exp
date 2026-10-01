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

The package is independently buildable:

```bash
bun run build
```
