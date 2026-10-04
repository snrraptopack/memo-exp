# `serve()` — the server configuration

`serve()` creates the application your `serverEntry` file default-exports.
It takes one optional options object, every key optional:

```ts
import { serve } from '@memoized-dom/server';

const app = serve({
  createLocals: (request) => ({ ... }),
  createServices: () => ({ ... }),
  createPlatform: (request) => ({ ... }),
  onError: (error, context) => new Response('...', { status: 500 }),
});

export default app;
```

The **option names are fixed** — they're part of the API. The functions you
assign can be named anything; `serve({ createLocals: makeSession })` is
fine. What differs is *when each runs* and *what it produces*.

## `createLocals(request)` — per request

Runs on **every request**. Whatever it returns becomes `context.locals` —
a mutable bag for request-scoped data: authed user, request id, tracing,
whatever your request pipeline resolves.

```ts
const app = serve({
  createLocals: (request) => ({
    requestId: crypto.randomUUID(),
    user: readSession(request.headers.get('cookie')),
  }),
});
```

Omit it and `locals` is an empty object.

## `createServices()` — once per app

Runs **lazily, once**, the first time anything touches `context.services`.
The result is cached for the life of the app instance — this is where
long-lived shared dependencies belong: database handles, API clients,
caches.

```ts
const app = serve({
  createServices: async () => ({
    database: await openDatabase(process.env.DATABASE_URL),
  }),
});
```

It may be async — the first consumer awaits it. Contrast with `locals`:
services are *shared across requests*, locals are *fresh per request*.
Put a DB pool in services, never in locals; put the current user in
locals, never in services.

## `createPlatform(request)` — host bindings

Runs **per request** like `locals`, but it's not your app's data — it's
the deploy target's bindings. On a platform like Cloudflare Workers this
is the `env` object (KV namespaces, D1 databases, R2 buckets, secrets);
another adapter might inject edge/network context.

```ts
const app = serve({
  createPlatform: (request) => ({
    env: process.env,                       // whatever the host gives you
    region: request.headers.get('x-edge-region'),
  }),
});
```

Two ways `platform` gets populated:

- A **host adapter** dispatches requests with `platform` already attached
  — nothing to configure.
- **`createPlatform`** is the in-config fallback — it receives the raw
  `Request` and derives the bindings itself, which also makes it the seam
  for faking a platform in dev/tests.

Omit it and `context.platform` is `undefined`. Its type comes from the
optional `platform` key in your `ServerTypes` (`platform?: Env`), so the
same `Env` shape appears everywhere `context.platform` is read.

So the three map to three lifetimes:

| Option | Runs | Produces |
|---|---|---|
| `createLocals` | every request | your per-request data |
| `createServices` | once, lazily | shared app dependencies |
| `createPlatform` | every request | the host's bindings |

## `onError(error, context)` — the last-resort handler

Called when a request pipeline throws. Return the `Response` to send.
Without it, an unhandled error becomes a generic 500.

```ts
const app = serve({
  onError: (error) => {
    console.error(error);
    return new Response('Internal error', { status: 500 });
  },
});
```

## `render` and `onRender` — how pages render and how they went

`render` sets application-wide SSR defaults; each `app.ssr()` call can
override them for its root:

```ts
const app = serve({
  render: { mode: 'resolve', timeout: 2_000, deadline: 8_000 },
  onRender: (report) => metrics.record(report.outcome, report.durationMs),
});

app.ssr('/', Landing, { mode: 'shell' });            // paint now, data client-side
app.ssr('/account/*', Account);                      // resolved data, streamed
app.ssr('/docs/*', Docs, { delivery: 'buffer' });    // complete document, Server-Timing
```

| Option | Default | Meaning |
|---|---|---|
| `mode` | `'resolve'` | `resolve` waits for request data; `shell` serializes pending UI immediately |
| `timeout` | `10000` | soft data budget — when it elapses, pending UI is rendered |
| `deadline` | none | hard budget for the whole render, route preparation included |
| `markers` | `true` | hydration markers and payload; `false` for HTML that never hydrates |
| `delivery` | `'stream'` | `stream` or `buffer` (below) |

With `stream`, the response commits as soon as route preparation has decided
it — authentication gates and `redirectRoute()` still become real redirects —
and the document head is sent immediately while the application renders. The
application body is atomic: its markup and payload are sent together once the
render succeeds. If it fails after the response committed (for example, the
`deadline` passes), the document closes with an empty outlet and `mount()`
renders the page client-side, so users get a working page and never a
half-adopted one. With `buffer`, nothing is sent until the whole document is
ready, so every failure still reaches `onError`.

`onRender` receives one report per page: `outcome` is `complete`, `timeout`
(data budget elapsed), `shell`, `redirect`, `deadline`, `aborted` (client
disconnected), or `error`, plus `durationMs` and, for resolved renders,
`settleMs`.

## Where these surface

Everything here lands in the `context` object passed to server code —
`{ request, url, params, locals, services, platform }`.

## Typing

`locals`, `services`, and `platform` are typed from your app's server
config (the `ServerTypes` export — covered next), so `context.services`
knows the shape you returned from `createServices` everywhere it's used.

Next: [11 — Server routing](./11-server-routing.md)
