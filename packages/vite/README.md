# @memoized-dom/vite

Vite 8 adapter for compiler-linked memoized-dom applications.

```ts
import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';

export default defineConfig({
  plugins: [
    memoizedDom({
      entries: 'src/entry.ts',
    }),
  ],
});
```

The entry is an ordinary TypeScript browser bootstrap containing one top-level
`mount(target, Component)` call. The adapter resolves that imported component,
derives its compiler entity identity, follows local static value imports with
Vite's resolver, compiles the graph through `compileModulesDetailed()`, returns
authored-module source maps from Vite transforms, and caches output per Vite
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

## Fullstack development

`memoizedDomFullstack()` installs a post-Vite server boundary. Vite continues
to own client modules, CSS, dependency optimization, and HMR. All remaining
requests are dispatched to a Web-standard server entry loaded through
`ssrLoadModule()`:

```ts
import { defineConfig } from 'vite';
import memoizedDom, { memoizedDomFullstack } from '@memoized-dom/vite';

export default defineConfig({
  appType: 'custom',
  plugins: [
    memoizedDom({ entries: 'src/entry.client.ts' }),
    memoizedDomFullstack({ entry: 'src/entry.server.ts' }),
  ],
});
```

The server entry exports `fetch(request)` or a default Web handler:

```ts
export function fetch(request: Request): Response {
  return new Response(`Request URL: ${request.url}`);
}
```

The dev adapter uses the published `@memoized-dom/adapters/node` bridge. It
does not emulate Node request/response objects or intercept Vite asset routes.
Production hosts can use the same Web handler directly on Bun/Workers, or the
Node adapter with an ordinary `node:http` server.

Run the package-owned integration tests and adapter benchmark with:

```bash
bun run --cwd packages/vite test
bun run --cwd packages/vite bench
```
