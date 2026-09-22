# `serve()` — the server configuration

`serve()` creates the application your `serverEntry` file default-exports.
It takes one optional options object — four keys, all optional:

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

## Where these surface

Everything here lands in the `context` object passed to server code —
`{ request, url, params, locals, services, platform }`.

## Typing

`locals`, `services`, and `platform` are typed from your app's server
config (the `ServerTypes` export — covered next), so `context.services`
knows the shape you returned from `createServices` everywhere it's used.

Next: [11 — Server routing](./11-server-routing.md)
