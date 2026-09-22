# SSR — rendering on the server

So far `mount` builds all the DOM in the browser. SSR flips the order: the
server runs your component first and sends real HTML, so the page paints
before JavaScript loads. `mount` then *adopts* that markup — no re-render.

## Wire the server entry

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';

export default defineConfig({
  plugins: [
    memoizedDom({
      clientEntry: 'src/main.ts',
      serverEntry: 'server.ts',   // one new line
    }),
  ],
});
```

`serverEntry` is the server composition root — a file that default-exports
a `serve()` application. The plugin switches Vite to `appType: 'custom'`
itself; this one option is the whole wiring.

## Minimal server

```ts
// server.ts
import { serve } from '@memoized-dom/server';
import { App } from './src/App';

const app = serve();

app.ssr(App);            // server-render on every page request

export default app;
```

That's the entire setup — `serve()` with no options, one `ssr` call,
default export. Every GET now returns fully rendered HTML plus a hydration
payload. `src/main.ts` doesn't change:

```ts
import { mount } from '@memoized-dom/runtime';
import { App } from './src/App';

mount('root', App);   // detects the server markup and hydrates
```

## SSR only some paths

`app.ssr(path, component)` renders a component only for requests matching
a route pattern:

```ts
app.ssr('/about', AboutPage);
app.ssr('/docs/:page', DocsPage);   // params work like route patterns
app.ssr('/blog/*', BlogSection);    // terminal wildcard too
```

Matching requests get server HTML; everything else falls through to the
normal client-rendered index. Use it to SSR landing/docs pages while the
app proper stays client-only, or to mount different roots per section.
You can mix: `app.ssr(App)` as the catch-all plus targeted entries.

## What `mount` does with server markup

`mount(target, component)` — two arguments only. Its three paths:

1. **Server markup present** (the `data-mmd-root` marker matches the
   component) → **hydrate**: adopt existing nodes, attach handlers,
   restore the embedded payload. Nothing is rebuilt.
2. **No server markup** → plain client mount, same as always.
3. **Markup doesn't match** what the component renders → the server DOM is
   discarded (`host.innerHTML = ''`) and the app mounts fresh client-side.
   It doesn't crash — but you paid a double render and lost the SSR paint,
   so treat mismatches as bugs to fix, not a fallback to rely on.

`mount` returns `{ host, rootId, nodes, mounted, unmount() }`.

## Server-render rules

- **Same component** in `app.ssr(X)` and `mount('root', X)` — adoption
  keys on the compiled root id; different components can never match.
- **Effects and refs never run on the server** — they first execute
  client-side after hydration. A component that needs the DOM at first
  paint must render everything declaratively.
- **One synchronous settle** — the server resolves derivations and data
  boundaries before serializing; nothing streams in later. Async work
  kicked off by `fetch` in the component body is not awaited — put
  must-render data behind the preparation/data layer, not a fire-and-forget
  call.

Next: [10 — `serve()` configuration](./10-serve.md)
