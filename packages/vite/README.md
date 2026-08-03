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
the graph through `compileModulesDetailed()`, returns authored-module source
maps from Vite transforms, and caches output per Vite
environment.

During an edit, the adapter recompiles before notifying the browser. Compiler
failures therefore reach Vite's standard terminal and overlay feedback. It
diffs the linked generated graph and invalidates only outputs that changed.
Every generated module is a self-accepting HMR boundary. Ordinary live
components are disposed and recreated at their existing DOM position while
the browser document remains loaded. A root-component edit recreates that root
and therefore resets its local closure state. Lightweight keyed-row factories
currently remount their application root because retained rows do not own a
schedulable entity boundary.

Restart the Vite dev server after changing or rebuilding this server-side
plugin. An active Vite process does not hot-replace plugin hooks.

Run the package-owned integration tests and adapter benchmark with:

```bash
bun run --cwd packages/vite test
bun run --cwd packages/vite bench
```
