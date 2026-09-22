# Fullstack guide

How routing, route preparation, SSR, and server functions fit together in
Memoized DOM. Everything here is convention-based: follow the file layout and
the compiler does the wiring.

## The shape of an app

```
vite.config.ts        one plugin
main.ts               client entry — mounts the root component
server.ts             server entry — builds the app, registers routes + SSR
src/                  components
server/               server-only code, never shipped to the browser
  config/index.ts     exports interface ServerTypes — your app's server contract
  config/*.ts         services, db clients, anything server-side
  functions/*.ts      server functions — auto-generated HTTP endpoints
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';

export default defineConfig({
  appType: 'custom',
  plugins: [
    memoizedDom({
      clientEntry: 'main.ts',  // required — browser bootstrap
      serverEntry: 'server.ts', // optional — omit for browser-only apps
      server: 'server',        // optional — server convention root (default: 'server')
    }),
  ],
});
```

```ts
// main.ts — the file clientEntry points at
import { mount } from '@memoized-dom/runtime';
import { Main } from './src/Main';

mount('root', Main);
```

`mount('root', Main)` does double duty: it hydrates matching SSR HTML when
present, or renders fresh when it isn't. You write one mount call; the runtime
decides which path to take.

## Routing

### Declaring routes

Put a `route` attribute on a JSX element or component. It renders only when the
URL matches:

```tsx
function Main() {
  return (
    <main>
      <nav>...</nav>
      <Home route="/" />
      <Story route="/story/:id" />
      <section route="/about"><h1>About</h1></section>
    </main>
  );
}
```

Rules:

- A `route` attribute binds to the **enclosing component**. Elements with
  `route` are siblings, not nested — a route element whose parent doesn't match
  never renders.
- Params use `:name` — `/story/:id` matches `/story/42`.
- Two routes can't declare the same pattern in one graph — the compiler errors.

### Navigating

Three ways, pick by what the markup is:

```tsx
<a route-to="/story/3">Read</a>          // anchor — compiles to a real href,
                                         // intercepted client-side, works without JS

<div route-to="/story/3">Read</div>       // non-anchor — gets a click handler

<button onClick={() => navigate('/story/:id', { params: { id: '3' } })}>
  Read
</button>
```

`route-to` also takes an object:

```tsx
<a route-to={{ path: '/story/:id', params: { id }, query: { tab: 'comments' } }}>
```

`navigate` comes from `@memoized-dom/router`, along with `back()`,
`forward()`, and `navigateRelative()`.

## `$routed` — route preparation

`$routed` loads data **before** a route renders. During SSR it runs on the
server; during client navigation it runs before the route commits; the result
is serialized into the page so hydration doesn't refetch.

```tsx
import { $routed } from '@memoized-dom/router';

function Story() {
  const story = $routed(({ params, services }) =>
    services.db.story(Number(params.id))
  );

  return <h1>{story.title}</h1>;
}
```

### The one hard rule: it must be attached to a route

`$routed` is route preparation — it needs a route identity. The component must
have a `route` attribute on its callsite (`<Story route="/story/:id" />`) or on
an element inside it. If it doesn't, the compiler fails with
`` `$routed` in component 'Story' is not attached to a route `` — fix the
markup, don't try to work around it.

### What the callback receives

Destructure only what you need — **what you pick decides where the code runs**:

| Field | Gives you | Runs |
|---|---|---|
| `url` | parsed `URL` of the target (`url.pathname`, `url.search`) | client + server |
| `params` | route params — `{ id: '42' }` | client + server |
| `query` | frozen `URLSearchParams` — `query.get('page')` | client + server |
| `state` | mutable cache bag that persists across navigations for this preparation | client + server |
| `signal` | `AbortSignal`, aborted if the user navigates away mid-prepare | client + server |
| `request` | the real incoming `Request` — headers, cookies | **server only** |
| `locals` | per-request bag from your middleware | **server only** |
| `services` | your app's service registry | **server only** |
| `platform` | host platform binding, if provided | **server only** |

### Server classification is automatic — and important

Destructuring `request`, `locals`, `services`, or `platform` (or calling a
`#server/` import) marks the preparation `server: true`. The compiler then
**removes the function body from the client bundle entirely**. On client
navigation the browser calls the internal `/_memoized/routed` endpoint, the
server runs your code, and only the return value travels back.

Consequences you'll actually notice:

- `console.log(services)` inside a server preparation prints in the **server
  terminal**, never the browser console.
- Server preparations keep secrets and DB handles off the client for free.
- A universal preparation (`url`/`params`/`query`/`state`/`signal` only) can
  run in the browser with zero network hop.

### Redirects

Return `redirectRoute('/login')` from a preparation to redirect before the
route renders — e.g. an auth check using `locals.user`.

## SSR

```ts
// server.ts
import { serve } from '@memoized-dom/server';
import { Main } from './src/Main';

const app = serve();

app.ssr(Main);            // SSR fallback for every non-API GET
// or per-path:
app.ssr('/story/:id', Story);

export default app;
```

What happens automatically:

- The component renders to HTML with hydration markers and a serialized
  payload (routed preparations + data source state).
- The browser mounts the same component, adopts the server DOM, restores the
  payload, and attaches events — no refetch, no re-render.
- Effects and refs don't run during SSR.

**The root component must be the same on both sides.** `mount('root', Main)`
on the client and `app.ssr(Main)` on the server. If they differ (mount `Main`,
ssr `App`), hydration can't adopt the tree — the client renders fresh and
`$routed` values won't be restored.

## Server functions

Files in `server/functions/` become typed RPC endpoints automatically.

```ts
// server/functions/stories.ts
import { getServerContext } from '@memoized-dom/server';

export async function getStories() {
  return db.stories();
}

export async function postVote(id: number) {
  const { locals } = getServerContext();
  return db.vote(id, locals.user);
}
```

```tsx
// anywhere in your components — no fetch, no URL, fully typed
import { getStories, postVote } from '#server-functions';
```

Conventions:

- **The filename is the namespace.** `functions/stories.ts` → endpoints at
  `/_fn/stories/<exportName>`.
- **The export name's verb prefix is the HTTP method.** `get*` → GET,
  `post*` → POST, `put*`, `patch*`, `delete*` etc. Mutation functions
  (`post*` and friends) can't run during render — call them from event
  handlers.
- **`export const middleware`** in the file composes in front of every
  endpoint it registers:

```ts
export const middleware = [
  async (context, next) => {
    console.log(context.request.method, context.url.pathname);
    return next();
  },
];
```

- **`getServerContext()`** reads the active request — `request`, `locals`,
  `services`, `platform`. Works for real HTTP calls and in-memory SSR
  dispatch alike.
- Throwing inside a function → 500. The client-side promise rejects; use
  `$track(...)` `onError`/`onSuccess` to react to it.

## `serve()` — wiring the server context

```ts
import { serve } from '@memoized-dom/server';

const app = serve({
  createLocals: () => ({ requestId: crypto.randomUUID(), user: undefined }),
  createServices: async () => ({ database: await connectDb() }),
});
```

The **option keys** (`createLocals`, `createServices`, `createPlatform`,
`onError`) are fixed — the functions you pass can be named anything:

- `createLocals(request)` — runs **per request**. Its return value is
  `context.locals` everywhere: route handlers, middleware, server functions,
  `$routed`. Put per-request data here (request id, session user).
- `createServices()` — runs **once per app instance**, lazily. Its return
  value is `context.services` — your app's dependency registry (db, queues,
  caches). This is what `services` in `$routed` and `getServerContext()`
  resolves to.
- `createPlatform(request)` — optional host binding, also once per request.
- `onError(error, context)` — turns thrown errors into Responses; without it
  errors become a bare `500`.

### Middleware and routes

```ts
const app = serve({ createLocals, createServices });

// global middleware — runs for everything
app.use(async (context, next) => {
  const response = await next();
  console.log(`${context.request.method} ${context.url.pathname} → ${response.status}`);
  return response;
});

// path-scoped middleware
app.use('/api/admin/*', requireAdmin);

// routes — handler is last, middleware can precede it
app.get('/api/health', (context) => ({ ok: true }));
app.post('/api/echo', guard, (context) => ({ id: context.locals.requestId }));
```

Handlers get `{ request, url, params, locals, services, platform }` and can
return an object (serialized as JSON) or a `Response`.

### `ServerTypes` — the typing contract

`server/config/index.ts` must export an interface named **`ServerTypes`** —
that name is fixed, the plugin generates type declarations from it:

```ts
// server/config/index.ts
import type { ApplicationServices } from './services';

export interface ServerTypes {
  locals: { requestId: string; user?: string };
  services: ApplicationServices;
  platform?: unknown;
}
```

This one interface types `context.locals`/`context.services` in `serve()`,
server functions, **and** `$routed` preparations. If the editor shows
`services` as untyped, the generated `.memoized/server-config.d.ts` is stale —
restart the dev server, then the TS server.

### The `#server/` alias

Anything under the server root is importable as `#server/<path>` **from server
code only** (`server.ts`, `server/functions/*`, server-classified `$routed`
bodies). The compiler strips these imports from the client bundle — using one
in a `$routed` callback also marks it server-classified.

## Cheat sheet

- Component needs route data before render → `$routed` + a `route` attribute.
- Preparation touches db/secrets/session → destructure `services`/`locals`/
  `request` — it stays server-side automatically.
- Reusable async call from an event handler → server function (`post*`),
  imported from `#server-functions`, wrapped in `$track` for status.
- Per-request data → `createLocals`. App singletons → `createServices`.
  Types → `ServerTypes` in `server/config/index.ts`.
- Page not interactive → check that `mount()` and `app.ssr()` use the same
  root component.
