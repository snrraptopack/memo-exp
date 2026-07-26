# @memoized-dom/runtime

Dependency-free registry, scheduling, optional dirty-reason batching, access
routing, keyed regions, props boxes, cleanup ownership, and DOM value helpers
for memoized-dom compiler output.

Application source does not need to import reactive primitives. Generated
modules import this package as one namespace:

```js
import * as MD from '@memoized-dom/runtime';
```

The package is independently buildable:

```bash
bun run build
```
