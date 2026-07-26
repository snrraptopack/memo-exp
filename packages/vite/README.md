# @memoized-dom/vite

Vite 8 adapter for compiler-linked memoized-dom applications.

```ts
import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';

export default defineConfig({
  plugins: [
    memoizedDom({
      entries: 'src/App.tsx',
      rootId: 'App',
    }),
  ],
});
```

Entries are authored graph roots, not necessarily the browser bootstrap module.
The adapter follows local static value imports with Vite's resolver, compiles
the graph through `compileModules()`, and caches output per Vite environment.

Vite HMR cannot replace existing factory closures or their module state
bindings. A change to any managed graph file therefore invalidates all managed
modules through the environment module graph and requests a full browser
reload. This is conservative state-resetting development behavior, not
state-preserving component HMR.

Run the package-owned integration tests and adapter benchmark with:

```bash
bun run --cwd packages/vite test
bun run --cwd packages/vite bench
```
