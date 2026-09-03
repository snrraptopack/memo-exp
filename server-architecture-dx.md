# Memoized DOM Server Architecture & DX Specification

**Status**: Draft RFC v0.3 — architecture review, no API implemented

**Audience**: Framework authors, backend contributors, and application developers

**Scope**: `@memoized-dom/server`, `@memoized-dom/adapters`, `@memoized-dom/data`, and developer ergonomics

---

## 1. Executive Summary & Motivation

In the initial implementation of the SSR showcase (`examples/ssr-showcase/server.ts`), server rendering and HTTP serving were functional but exposed significant low-level plumbing to the developer:

1. **Repetitive Boilerplate**: Developers had to manually read `index.html`, split it at `<!--ssr-outlet-->`, call `renderToReadableStream`, stitch chunks together with `createDocumentStream`, and wrap everything in `htmlResponse`.
2. **Dual-Source Data Duplication**: To support simulated data during SSR and browser requests, developers had to maintain both a `mockFetch()` for SSR and a matching `handleApi()` for real HTTP endpoints.
3. **Internal Mechanics Leaked**: Low-level flags like `{ markers: true, mode: 'resolve' }` and payload script transport details were manual responsibilities of the author.
4. **Lack of Composition**: No standard place for authentication, cookies, loggers, rate limiting, dev delays, or error handling. Ad-hoc `if (url.pathname.startsWith('/api/'))` branching does not scale.
5. **Context Leakage**: Side-effect imports (`import './session'`) risked cross-request contamination in multi-tenant server environments.

This specification outlines the unified architecture centered around **`defineServer`**, an in-memory **`serverFetch`** bridge, an onion **middleware pipeline**, and automatic **document lifecycle management**.

### Current Repository Baseline

This RFC builds on working lower-level pieces rather than replacing them:

* `@memoized-dom/server` already creates isolated application, route, and data
  runtimes per render and exposes `renderToReadableStream()` with shell/resolve
  modes, abort propagation, payload serialization, and explicit fetch injection.
* `@memoized-dom/adapters` already exposes the portable `WebHandler`, document
  stream composition, HTML response normalization, and the Node bridge.
* `@memoized-dom/vite` already loads a Web handler through `ssrLoadModule()` in
  development.
* `@memoized-dom/data` already supplies the request-local `$fetch` runtime,
  quiescent settling, serialized state, and the compiler-facing
  `ResolvedValue<T>` contract.

The missing layer is therefore an application-server composition API: route
dispatch, middleware/context, document policy, and a same-origin in-memory
fetch bridge. Rendering primitives remain independently usable for people who
bring another backend.

---

## 2. Core Architectural Principles

* **Web Standard Foundation**: The host boundary remains `Request -> Response`.
  Middleware receives a framework context containing an untouched Web
  `Request`; the framework never attaches non-standard fields to the platform
  object.
* **Generic Over Specific**: Don't bake custom DSLs into the framework for headers, caching, or CORS. Expose standard `ResponseInit` and provide functional utility helpers.
* **One Data Source**: A single route definition serves both live HTTP requests from the browser and in-memory `serverFetch` during SSR. Zero network loopback, zero duplicate mock handlers.
* **Explicit Request Context**: Request-scoped state (user session, trace IDs,
  platform bindings) lives in one `ServerContext` per dispatch rather than in
  module singletons.
* **Portable Core, Optional Conveniences**: The server core accepts a compiled
  document template or loader. Resolving `document: './index.html'`, scanning
  route folders, and Vite HMR are adapter/plugin conveniences because edge
  runtimes do not expose a filesystem.
* **Backend Independence**: `defineServer` is an optional composition layer.
  `renderToReadableStream`, data runtimes, and the `WebHandler` contract remain
  public so Hono, Elysia, Express adapters, Bun, Workers, or a custom backend
  can host the renderer without adopting the router.

---

## 3. The Unified Backend API: `defineServer`

Developers declare their application server in a single configuration block:

```ts
import { defineServer } from '@memoized-dom/server';
import { App } from './App';
import { session, logger, requireAuth, adminOnly, verifyStripe } from './middleware';

export default defineServer({
  // The root compiled UI component
  app: App,

  // HTML template container — framework loads, validates <!--ssr-outlet-->, and streams
  document: new URL('./index.html', import.meta.url),

  // Global middleware (runs for all incoming requests: pages, API, webhooks)
  middleware: [
    session(),
    logger()
  ],

  // Server endpoints and route-specific middleware
  routes: {
    // 1. Plain object/array handler -> automatically serialized to Response.json()
    '/api/stories': () => STORIES,

    // 2. Route with dedicated middleware and typed context
    '/api/me': {
      middleware: [requireAuth()],
      handler: (ctx) => ctx.locals.user,
    },

    // 3. Prefix group with middleware only (* = prefix group)
    // Applies to /api/admin/users, /api/admin/metrics, etc.
    '/api/admin/*': {
      middleware: [requireAuth(), adminOnly()],
    },

    // 4. Direct Web Standard Response handler
    '/health': () => new Response('ok', { status: 200 }),

    // 5. External Webhook with signature verification
    '/webhooks/stripe': {
      middleware: [verifyStripe()],
      handler: handleStripe,
    },
  },

  // Page render policy (§3.2). Defaults shown; every field is optional.
  render: {
    mode: 'resolve',     // 'resolve' settles request-owned data before flush; 'shell' streams the pending tree immediately
    markers: true,       // emit hydration markers + application/mmd+json payload for `hydrate`
    timeout: 10_000,     // 'resolve' quiescence budget before falling back to the settled shell
    delivery: 'stream',  // 'stream' flushes the document prefix while data settles; 'buffer' renders to a string first
  },

  // Default ResponseInit applied to rendered HTML pages (e.g. edge caching headers)
  init: {
    headers: {
      'cache-control': 'public, max-age=5, stale-while-revalidate=60',
    },
  },

  // Centralized error boundary for unhandled exceptions
  onError: (err, ctx) => {
    console.error(`[SERVER-ERROR] ${ctx.request.method} ${ctx.request.url}:`, err);
    return new Response('Internal Server Error', { status: 500 });
  },
});
```

A bare route handler is an implicit `GET`; use the method-map form when a
pathname supports another verb or more than one verb. `GET` supplies automatic
`HEAD`, and the router answers unmatched methods with `405` plus `Allow`.
Handlers are contextually typed from `createLocals` and `createPlatform`.

The generated server-function table is adapter-owned. In Vite fullstack
development, `memoizedDomFullstack` installs and hot-replaces that table on a
`defineServer` handler automatically. Custom production adapters can pass the
generated table through `serverFunctions`; application code never needs to
list individual named server functions in `routes`.

### Handler Return Types
A route handler can return any of the following; `defineServer` normalizes the response automatically:
* `object` | `array` $\rightarrow$ `Response.json(data)`
* `string` $\rightarrow$ `new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8' } })`
* `Response` $\rightarrow$ Passed through untouched
* `ReadableStream` $\rightarrow$ `new Response(stream)`

### HTTP Methods and Route Identity

A pathname alone is not a route identity. Public APIs, actions, and webhooks
need deterministic method dispatch, automatic `HEAD` handling, and a `405`
response with an `Allow` header when the path exists for another method. The
object form should therefore be method-aware, for example:

```ts
routes: {
  '/api/stories': {
    GET: () => STORIES,
    POST: { middleware: [requireAuth()], handler: createStory },
  },
}
```

The exact surface remains an RFC decision, but the router index must use
`method + pathname`; treating every handler as an implicit `GET` would leave
mutating `$fetch` calls, forms, and webhook semantics undefined.

---

## 3.1 Rendering Is a Policy, Not a Router Side Effect

The application server must expose the rendering choices that already exist
instead of hiding one opinion inside `defineServer`. Route dispatch determines
*what* handles a request; render policy determines *how* an application page
is delivered.

The current primitives provide these independent axes:

| Choice | Existing primitive or option | Meaning |
| :--- | :--- | :--- |
| Client-only application | `mount('root', App)` | Serve an empty application host and create the UI in the browser. No hydration markers or SSR payload are needed. |
| Immediate server shell | `mode: 'shell'` | Serialize the initial tree with pending arms immediately. It does not imply a later server-stream replacement protocol. |
| Resolved server render | `mode: 'resolve'` plus `timeout` | Wait for request-owned data to become quiescent, flush its UI, then serialize the resolved tree and state. |
| Hydratable HTML | `markers: true` plus `renderToResult*` or `renderToReadableStream` | Emit root/region markers and the `application/mmd+json` payload required by `hydrate`. |
| Clean/static HTML | `markers: false` plus `renderToString*` | Emit host-consumable HTML without adoption markers. Static generation is a build/deployment use of this output, not a new renderer. |
| Buffered delivery | `renderToString*` / `renderToResult*` | Materialize the application result before the host constructs its response. |
| Ordered stream delivery | `renderToReadableStream` | Allow the document prefix to flush while the application render settles; this is not out-of-order suspense streaming. |
| DOM correctness tier | `renderWithDom*` | Use the LinkeDOM reference renderer when live server nodes or parity testing are required. |

The high-level server API should accept an explicit page policy and delegate to
these primitives. It must not force every user into resolved SSR, streaming,
or hydration. Bring-your-own-backend users keep importing the low-level
renderers directly.

One inconsistency must be resolved before that surface is implemented:
`RenderOptions` documents `shell` as the default, while
`renderToReadableStream` currently settles unless `mode` is explicitly
`'shell'`. The composed server API must require or normalize one explicit
default rather than exposing different behavior based on delivery format.

### 3.2 The `render` Policy Block

`defineServer` exposes the rendering choices of §3.1 as one optional,
fully-defaulted `render` block. Every field is optional; omitting the block
selects the defaults below:

```ts
render: {
  mode: 'resolve',     // 'resolve' | 'shell'
  markers: true,       // boolean
  timeout: 10_000,     // milliseconds, 'resolve' only
  delivery: 'stream',  // 'stream' | 'buffer'
}
```

| Option | Default | Lowered to | Meaning |
| :--- | :--- | :--- | :--- |
| `mode` | `'resolve'` | `RenderOptions.mode` | `'resolve'` waits for request-owned data to become quiescent and flushes the resolved tree plus state payload. `'shell'` serializes the initial tree with pending arms immediately and never waits. |
| `markers` | `true` | marker + payload emission | `true` emits adoption markers and the `application/mmd+json` payload consumed by `hydrate`. `false` produces clean host-consumable HTML (static-generation and non-hydrating delivery). |
| `timeout` | `10_000` | `RenderOptions.timeout` | Quiescence budget for `'resolve'`. On expiry the render falls back to the settled shell rather than hanging the request. |
| `delivery` | `'stream'` | `renderToReadableStream` vs `renderToString*` | `'stream'` flushes the document prefix while the application settles (ordered streaming, not out-of-order suspense). `'buffer'` materializes the full result before the host builds its `Response`. |

Resolved decisions:

* **`defineServer` defaults are explicit, not inherited.** The block lowers to
  a fully-specified `RenderOptions` object; it never relies on the primitive's
  implicit default. This closes the `shell`-vs-`resolve` default divergence:
  the composed API always passes `mode` explicitly, and the `RenderOptions`
  documentation should be updated to match `'resolve'` as the composed
  default.
* **`mode: 'shell'` + `markers: true` is valid** and hydrates a pending
  shell; the client data runtime then resolves sources in the browser.
* **`markers: false` disables the payload entirely** — a hydrating client
  entry combined with `markers: false` is a startup configuration error in
  the Vite plugin, not a silent runtime mismatch.
* **`renderWithDom*` stays out of `render`.** The LinkeDOM correctness tier
  is a testing/parity tool, not a delivery policy; it remains a direct
  primitive import.
* **Per-route render policy is deliberately absent in v1.** An application
  has one page pipeline; mixed static/dynamic delivery can be introduced
  later as an optional route-level override without breaking this surface.

---

## 4. Middleware Pipeline & Request Context

### The Middleware Signature

```ts
export interface ServerContext<TLocals extends object = Record<string, never>> {
  readonly request: Request;
  readonly params: Readonly<Record<string, string>>;
  readonly locals: TLocals;
  readonly url: URL;
  readonly platform?: unknown;
}

export type Middleware<TLocals extends object = Record<string, never>> = (
  ctx: ServerContext<TLocals>,
  next: () => Promise<Response>,
) => Response | Promise<Response>;
```

The outer server still has the portable type `(request: Request) =>
Promise<Response>`. `ServerContext` is allocated once for the external request
and reused through its precompiled pipeline. Native `Request` instances are not
subclassed or mutated; some edge implementations freeze or internally brand
them, and adding `ctx`/`params` would no longer be a Web-standard contract.

### Execution Order (Onion Model)

For an incoming request such as `GET /api/admin/users`:

```text
Request In
  │
  ├─► 1. Global middleware (e.g. logger, session)
  │     │
  │     ├─► 2. Prefix group middleware (/api/*)
  │     │     │
  │     │     ├─► 3. Nested prefix middleware (/api/admin/*)
  │     │     │     │
  │     │     │     ├─► 4. Route-specific middleware (e.g. requireAuth)
  │     │     │     │     │
  │     │     │     │     └─► 5. Route handler (returns data)
  │     │     │     │
  │     │     │     ◄─ (Unwinding / post-processing)
  │     │     ◄─ (Unwinding)
  │     ◄─ (Unwinding)
  ◄─ (Unwinding)
Response Out
```

* Any middleware can **short-circuit** the chain immediately by returning a `Response` (e.g. `401 Unauthorized`, `302 Redirect`, or cached `Response`).
* Locals are shared linearly forward through `ctx.locals`. Middleware should
  extend a typed locals contract at server construction rather than casting a
  global record at each use.

### Example: Development Delay as Middleware

Instead of scattering `await delay(50)` throughout data handlers, simulated latency is isolated as a middleware concern:

```ts
export function devDelay(latencyMap: Record<string, number>): Middleware {
  return async (ctx, next) => {
    const pathname = ctx.url.pathname;
    const ms = latencyMap[pathname];
    if (ms) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
    return next();
  };
}
```

---

## 5. File-Based Routing & Folder Inheritance

Folder structure naturally maps to the `*` prefix grouping concept:

```text
server/routes/
  ├── _middleware.ts            -> Applies to /* (all routes and pages)
  ├── health.ts                 -> /health
  └── api/
      ├── _middleware.ts        -> Applies to /api/*
      ├── stories.ts            -> /api/stories
      ├── me.ts                 -> /api/me
      └── admin/
          ├── _middleware.ts    -> Applies to /api/admin/* (runs AFTER /api/_middleware)
          ├── users.ts          -> /api/admin/users
          └── users/
              └── [id].ts       -> /api/admin/users/:id  (extracts ctx.params.id)
```

```ts
// server/routes/api/_middleware.ts
export default [session(), logger()];

// server/routes/api/admin/_middleware.ts
export default [requireAuth(), adminOnly()];

// server/routes/api/me.ts
export const middleware = [requireAuth()];
export default (ctx) => ctx.locals.user;
```

---

## 6. Route Fallthrough & Page Protection

Non-API routes have no special case in the router:

```text
Incoming URL
  │
  ├─► Does URL match a route with a handler?
  │     YES -> Execute middleware chain -> Route handler -> Return Response
  │
  └─► NO (Page Render path)
        │
        ├─► Did URL match any prefix middleware? (e.g., /admin/*)
        │     YES -> Execute prefix middleware
        │            (If middleware returns a redirect Response -> Short-circuit!)
        │
        └─► Execute App SSR render pipeline -> Stream HTML document
```

### Protecting Pages with Server Redirects
If you declare:
```ts
routes: {
  '/admin/*': {
    middleware: [requireAuth()],
  },
}
```
When a user visits `/admin/dashboard`:
1. The route matches `/admin/*`.
2. It runs `requireAuth()`.
3. If unauthenticated, `requireAuth` returns `Response.redirect('/login', 302)`.
4. SSR is never executed, saving compute and preventing unauthorized HTML leaks.
5. If authenticated, middleware calls `next()`, falling through to render `App`.

---

## 7. The In-Memory `serverFetch` Bridge ("One Data Source")

### The Problem
Traditional SSR setups either:
1. Make an actual loopback HTTP request (`fetch('http://localhost:3000/api/stories')`), incurring socket overhead, port binding, and DNS latency.
2. Require authoring a separate `mockFetch` or service layer, duplicating routing logic.

### The Solution: Synthesized In-Memory Dispatch
`defineServer` creates an internal `serverFetch` function passed to `@memoized-dom/server`'s render options:

```ts
// Internal serverFetch logic inside defineServer
function createServerFetch(dispatch: InternalDispatch, parent: ServerContext) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      parent.url,
    );
    const request = input instanceof Request
      ? new Request(input, init)
      : new Request(url, init);

    // Only same-origin application URLs are eligible for internal dispatch.
    if (url.origin === parent.url.origin && dispatch.matches(url, request.method)) {
      const child = createChildContext(parent, request, url);
      return dispatch(child); // Same router, middleware, normalization and errors.
    }

    return parent.fetch(request);
  };
}
```

The bridge must not call a matched route handler directly. It enters the same
compiled dispatch pipeline as an external request so authentication,
route-specific middleware, response normalization, abort handling, and error
policy cannot be bypassed during SSR. The child dispatch inherits request
locals deliberately, carries the parent abort signal, and increments an
internal-depth guard so recursive `$fetch` cycles fail with a useful error.
Relative and same-origin targets may dispatch in memory; cross-origin targets
always use the host-provided fetch capability.

```text
Component authored code:
$fetch('/api/stories')
        │
        ├─► [On Server (SSR)]:
        │     Calls synthesized serverFetch() -> In-memory router -> Handler()
        │     (Zero network latency, settles asynchronously, serializes to state payload)
        │
        ├─► [On Client (Hydration)]:
        │     Reads directly from payload script tag (Zero network requests)
        │
        └─► [On Client (Subsequent Navigation / Actions)]:
              Calls standard browser fetch('/api/stories') -> Hits real server HTTP endpoint
```

---

## 8. Router Performance Architecture and Measurement Contract

`defineServer` cannot honestly guarantee zero overhead or "near-Bun speed"
before an implementation is benchmarked. The portable router should minimize
work through the following design constraints and publish latency,
throughput, and allocation measurements against raw host handlers.

The first `createServerRouter` foundation now establishes the behavior below
without composing SSR or filesystem discovery into it. Exact routes use a
method-indexed pathname map; dynamic routes use the existing segment trie;
`HEAD`, automatic `OPTIONS`, `405`/`Allow`, middleware order, route params,
fallback pages, error normalization, and request-local context reuse are
covered independently. Prefix middleware is still matched and assembled per
request in this first version. That remaining work must be measured and, where
possible, compiled into route pipelines at server construction before the
performance contract is considered complete.

The foundation is exported from the isolated
`@memoized-dom/server/router` subpath:

```ts
import { createServerRouter } from '@memoized-dom/server/router';
```

It is intentionally not eagerly re-exported by the LinkeDOM renderer entry.
Keeping those module graphs separate prevents a router-only edge deployment
from loading renderer code and ensures the server runtime installs its
request-context storage before renderer/data modules initialize.

### 1. $O(1)$ Hash Map for Static Routes
* **The Anti-Pattern**: Iterating an array of 50 regular expression patterns sequentially on every request.
* **The Invariant**: Static routes are indexed by method and pathname in a
  startup-built map. Engine-specific nanosecond claims are not part of the
  API contract and must not be inferred from a microbenchmark on one runtime.

### 2. Pre-Compiled Startup Pipelines
* **The Anti-Pattern**: Dynamically allocating middleware arrays, closure chains, and runner promises on *every incoming request*.
* **The Invariant**: Middleware composition is pre-computed and flattened **once at server startup** (`defineServer` initialization):
  * Routes with no middleware invoke the raw handler directly with **zero function wrappers**.
  * Routes with middleware execute a pre-composed function cached at startup.
    Onion dispatch still creates some per-request async state unless a measured
    state-machine runner removes it; "zero allocation" is an acceptance target,
    not an assumption.

### 3. Radix Trie Exclusively for Dynamic Routes (`:id`) & Prefix Groups (`*`)
* Only routes containing dynamic parameters (`/api/users/:id`) or wildcards (`/admin/*`) enter the Radix Tree.
* The tree extracts parameters segment-by-segment without invoking regular expression capture groups or allocating temporary regex objects.

### 4. In-Memory `serverFetch`
* During SSR, when components call `$fetch('/api/stories')` or server functions:
  * Dispatch bypasses TCP sockets, localhost loopbacks, and wire serialization.
  * The request enters the pre-compiled route and middleware pipeline
    **in memory**, preserving the same behavior as an external HTTP request.

### 5. Native Web Standard Passthrough in Bun
Because `defineServer` returns a standard `(request: Request) => Promise<Response>` function, Bun calls it directly:
```ts
// server.ts
import server from './server';
export default server; // Bun passes native C++ Request directly
```
There is no Node-style `req`/`res` translation layer in the Bun adapter. The
remaining framework dispatch and rendering overhead is measured rather than
described as zero.

### Required Benchmark Matrix

Before performance claims appear in public documentation, compare raw host and
`defineServer` handlers for static hits, dynamic params, middleware depth,
JSON normalization, in-memory data dispatch, streamed pages, aborted streams,
and concurrent requests. Run the same contract on Bun, Node, and at least one
edge isolate, reporting p50/p95/p99 latency, requests/second, bytes allocated,
and retained memory.

---

## 9. Client Developer Experience: Colorless Data

On the client, components import and consume data transparently:

```ts
// data/stories.ts
import { $fetch } from '@memoized-dom/data';

export interface Story {
  id: number;
  title: string;
  votes: number;
}

// Colorless async source: lazy description, zero execution at import time
export const stories = $fetch<Story[]>('/api/stories');
```

```tsx
// App.tsx
import { stories } from './data/stories';
import { Group, Pending, Error } from '@memoized-dom/data';

function StoriesPending() {
  return <div class="skeleton">Loading stories...</div>;
}

function StoriesError({ error }: { error: { message: string } }) {
  return <div class="error">{error.message}</div>;
}

export function App() {
  return (
    <div>
      <h1>Stories</h1>
      <Group data={stories}>
        <Pending component={StoriesPending} />
        <Error component={StoriesError} />
        {stories.map((story) => (
          <article key={story.id}>
            <h2>{story.title}</h2>
            <span>{story.votes} votes</span>
          </article>
        ))}
      </Group>
    </div>
  );
}
```

### Client Entry (`main.ts`)

Hydration is explicit. The client installs its data runtime first, then imports
the opt-in hydration entry so the SSR payload is restored before the compiled
tree adopts the marked DOM:

```ts
import { hydrate } from '@memoized-dom/runtime/hydrate';
import { createDataRuntime, setActiveDataRuntime } from '@memoized-dom/data';
import { App } from './App';

setActiveDataRuntime(createDataRuntime());

hydrate('root', App, {
  recover: true,
  onRecover: (err) => {
    console.error('[HYDRATION-MISMATCH]', err.message);
  },
});
```

`hydrate` reads the matching `application/mmd+json` payload by default,
restores the data cache, and adopts the root marker range. `recover: true` is
an explicit policy: a structural mismatch is reported through `onRecover`,
the incompatible server DOM is discarded, and the runtime falls back to
`mount`.

An SPA or client-rendered page imports `mount` from `@memoized-dom/runtime`
and does not require server markers or a payload:

```ts
import { mount } from '@memoized-dom/runtime';
import { App } from './App';

mount('root', App);
```

---

## 10. Platform Adapters & Host Integration

Because `defineServer` outputs a standard `(request: Request) => Promise<Response>` function, hosting integration is trivial:

### Bun
```ts
import server from './server';

export default {
  port: 3000,
  fetch: server,
};
```

### Node.js (via `@memoized-dom/adapters/node`)
```ts
import http from 'node:http';
import { createNodeHandler } from '@memoized-dom/adapters/node';
import server from './server';

const httpServer = http.createServer(createNodeHandler(server));
httpServer.listen(3000);
```

### Vite Fullstack Plugin (`@memoized-dom/vite`)
Vite's `memoizedDomFullstack({ entry: 'server.ts' })` loads `server.ts` via `ssrLoadModule` and expects `module.default ?? module.fetch`. Since `defineServer` exports this function, it integrates natively during local development with instant HMR.

### Edge Runtimes (Cloudflare Workers, Deno, Vercel Edge)
The Web handler is portable, but the full server is not automatically
zero-adapter. Edge hosts supply bindings and lifetime controls such as
`env`/`waitUntil`, do not expose Node filesystem template loading, and differ
in async-context support. A thin host adapter passes these capabilities into
`ServerContext.platform`; document paths must be resolved to bundled template
content at build time. The core router and renderer must not import Node APIs.

---

## 11. Compiler-Named HTTP Functions (`server/functions/`)

Server functions are a compile-time authoring convenience over Memoized DOM's
existing data APIs and ordinary HTTP routes. They do not introduce a separate
RPC client, protocol, cache, error channel, or Promise-based invocation model.

1. **On the Server**: Every function exported from `server/functions/*.ts` is
   registered as a real HTTP route in `defineServer` under the stable identity
   `/_fn/<module>/<function>`.
2. **In UI builds**: The implementation and its server-only dependency graph
   are replaced by a generated `$fetch` facade. The HTTP verb becomes the
   `method`, parameters become `query` or `body`, and every result keeps the
   data layer's existing `ResolvedValue`/`$track` behavior across client, SSR,
   hydration, pending, error, retry, and cancellation states.
3. **HTTP verb prefix**: An exported function begins with `get`, `post`, `put`,
   `patch`, or `delete`. The prefix selects its ordinary HTTP method without a
   second route declaration.

The exported name is part of the fetch target, but the module-qualified route
is the canonical identity so two modules may safely export the same function
name. A build manifest connects that identity to its server implementation and
its generated UI facade.

```text
                ┌──────────────────────────────────────────────┐
                │          The Complete Unified Loop           │
                └──────────────────────────────────────────────┘

1. Authored Code:
   server/functions/stories.ts
     └── export async function getStories() { return db.stories.findMany(); }
     └── export async function postVote(id: number) { ... }

2. Server Build (defineServer Auto-Registration):
   Mounts real HTTP endpoints in the router index:
     ├── GET  /_fn/stories/getStories  ──► calls getStories()
     └── POST /_fn/stories/postVote    ──► calls postVote(body.id)

3. Generated UI Facades (conceptual output):
   const getStories = () =>
     $fetch('/_fn/stories/getStories');

   const getStory = (id) =>
     $fetch('/_fn/stories/getStory', { query: { id } });

   const postVote = (id) =>
     $fetch('/_fn/stories/postVote', { method: 'POST', body: { id } });

4. One Existing Data Lifecycle:
   • SSR render: the active data runtime sends the request through serverFetch
     and the normal in-memory route/middleware pipeline.
   • Hydration: the existing payload envelope restores settled get* sources
     without a duplicate browser request.
   • Browser navigation/actions: the same facades use standard browser HTTP.
```

### Server Functions Export Middleware

Server functions lower to ordinary method-aware HTTP endpoints at
`/_fn/<module>/<function>`, so they are first-class router citizens: the same
dispatch pipeline, middleware composition, response normalization, and error
policy apply to them as to any declared route. Because every generated
endpoint is publicly addressable by default, middleware is attached through
exports in the functions module itself rather than by editing a separate
route table:

```ts
// server/functions/stories.ts

// Applies to every endpoint registered from this module:
export const middleware = [requireAuth()];

export async function getStories() { ... }
export async function deleteStory(id: number) { ... }
```

* A `middleware` export in a `server/functions/*.ts` module composes in front
  of each endpoint that module registers. Only async functions with a valid
  verb prefix become endpoints; the `middleware` export is recognized by
  name and never treated as a server function.
* A `server/functions/_middleware.ts` module applies to every `/_fn/*`
  endpoint, mirroring the file-routing `_middleware.ts` convention of §5.
* Generated endpoints compose directory middleware first, then module
  middleware, then the function body, following the onion order of §4.
* A `/_fn/*` path may not be declared in `routes`; the namespace is
  reserved, and registering a colliding route is a startup error.

### Generated Artifacts Live Under `.memoized/`

Everything the tooling generates is written under one visible root,
`.memoized/` (gitignored as regenerable output):

* `.memoized/server-functions.d.ts` — the typed `#server-functions` barrel.
  One flat module declaring every server function as
  `ResolvedValue<Awaited<ReturnType<typeof impl.fn>>>` via type-only imports
  of the real implementations. Exported names must be unique across modules;
  a collision is a generation error (`[MMD-S012]`) naming both modules.
* `.memoized/routes.d.ts` — the route table powering `route-to`
  autocompletion (router specification).

Server functions are imported through the `#server-functions` alias, never
through real file paths:

```ts
import { getStory, postVote } from '#server-functions';
```

The alias resolves in two layers:

* **Types (tsc/IDE)**: tsconfig `paths` maps the specifier to the generated
  barrel — relative imports cannot be remapped, which is why the alias is
  mandatory for the colorless types to reach the IDE.

  ```json
  { "paths": { "#server-functions": ["./.memoized/server-functions.d.ts"] } }
  ```

* **Runtime (Vite)**: the adapter resolves the same specifier to a generated
  client barrel that re-exports the in-place facade modules; the server build
  keeps resolving real implementations through the manifest.

Because client code never imports server-function files by path, moving a
function between modules never rewrites client imports.

---

### The Strict HTTP Verb Prefix Matrix

The verb prefix dictates the HTTP method, the argument transport format, caching semantics, and valid call sites:

| Prefix | HTTP Method | Argument Serialization | Caching / Idempotency | Client Lowering | Valid Call Sites |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`get*`** | `GET` | URL query | Existing `$fetch` cache policy | `$fetch('/_fn/...', { query })` $\rightarrow$ `ResolvedValue<T>` | Component Render, Module Scope, Event Handlers |
| **`post*`** | `POST` | JSON body | Non-cacheable by default | `$fetch('/_fn/...', { method: 'POST', body })` $\rightarrow$ `ResolvedValue<T>` | Event Handlers, Callbacks Only |
| **`put*`** | `PUT` | JSON body | Non-cacheable by default | `$fetch('/_fn/...', { method: 'PUT', body })` $\rightarrow$ `ResolvedValue<T>` | Event Handlers, Callbacks Only |
| **`patch*`** | `PATCH` | JSON body | Non-cacheable by default | `$fetch('/_fn/...', { method: 'PATCH', body })` $\rightarrow$ `ResolvedValue<T>` | Event Handlers, Callbacks Only |
| **`delete*`** | `DELETE` | JSON body | Non-cacheable by default | `$fetch('/_fn/...', { method: 'DELETE', body })` $\rightarrow$ `ResolvedValue<T>` | Event Handlers, Callbacks Only |

The table describes lowering, not a second public API. Developers keep calling
the imported function. The generated facade maps its serializable parameters
to the query or request body expected by the existing method-aware `$fetch`
runtime.

There is no generated procedure identifier separate from the URL. For example,
the module/export pair `stories/getStory` becomes the fetch target
`/_fn/stories/getStory`, and its `id` argument becomes the normal `$fetch`
query `{ id }`. Authentication, status codes, headers, caching, validation,
and failures remain HTTP and existing data-runtime concerns.

---

### 1. Authoring: Pure TypeScript with Verb Prefixes

```ts
// server/functions/stories.ts
import { db } from '../db';
import { getServerContext } from '@memoized-dom/server';

// 1. GET function: returns stories (cacheable, replay-safe)
export async function getStories() {
  return db.stories.findMany();
}

// 2. GET function with parameter: (?id=123)
export async function getStory(id: number) {
  return db.stories.findUnique({ where: { id } });
}

// 3. POST function: runs with request context
export async function postVote(id: number) {
  const { locals } = getServerContext();
  if (!locals.user) throw new Error('Unauthorized');
  return db.stories.update({ where: { id }, data: { votes: { increment: 1 } } });
}

// 4. DELETE function
export async function deleteStory(id: number) {
  return db.stories.delete({ where: { id } });
}
```

---

### 2. Consuming in UI: Natural Function Calls

In UI components, developers import and call functions directly with full TypeScript autocomplete:

```tsx
// App.tsx
import { getStories, getStory, postVote } from '#server-functions';

export function StoriesPage() {
  // get* evaluates to ResolvedValue<Story[]> without await
  const stories = getStories();

  return (
    <div>
      <h1>Top Stories</h1>
      {stories.map((story) => (
        <article key={story.id}>
          <h2>{story.title}</h2>
          {/* post* is called inside an event handler */}
          <button onClick={() => postVote(story.id)}>
            ▲ Vote ({story.votes})
          </button>
        </article>
      ))}
    </div>
  );
}

export function StoryDetail({ id }: { id: number }) {
  // Parameterized call: reactively reruns when `id` changes
  const story = getStory(id);

  return (
    <article>
      <h1>{story.title}</h1>
      <p>{story.body}</p>
    </article>
  );
}
```

---

### 2.1 Mutation Results Use the Same Colorless Source Model

A mutation returns `ResolvedValue<T>` like every other generated server
function. `$track` exposes its request lifecycle; the function itself does not
grow `state`, `data`, or `error` properties:

```tsx
let voteResult;

<button onClick={() => {
  voteResult = postVote(story.id);
}}>
  {voteResult && $track(voteResult).pending ? 'Voting…' : 'Vote'}
</button>

{voteResult && $track(voteResult).error && (
  <p>{$track(voteResult).error.message}</p>
)}
```

No `await` is involved. Ignoring the returned source is the concise
fire-and-forget form; retaining it lets authored UI read the result normally
and inspect pending/error/refreshing state through `$track`.

This requires `$fetch` itself to accept `method` and `body`, include them in
request identity, encode JSON bodies consistently, and default non-GET calls
to `cache: false` so repeated mutations are never swallowed by read caching.
The compiler must also own event-created sources long enough for bound results
to update their render readers, then dispose replaced or unreachable sources.
That is an extension of the existing transparent-source lifecycle, not a new
mutation state system.

---

### 3. Compile-Time Diagnostics & Safety Rules

Because the verb prefix is baked into the identifier, the compiler enforces semantic safety without guessing:

#### A. Preventing Non-GET Calls in Component Render (`[MMD-S010]`)
If a developer attempts to call a non-`get*` function inside a component render body:
```tsx
function StoryList() {
  postVote(1); // 💥 COMPILE-TIME ERROR!
  return <div>...</div>;
}
```
The compiler catches it instantly:
`💥 [MMD-S010]: 'postVote' is an HTTP POST function and cannot be invoked during component rendering. Move it inside an event handler (e.g. onClick).`

#### B. Enforcing the Verb Prefix Convention (`[MMD-S011]`)
If an exported function in `server/functions/*` does not begin with an approved HTTP verb:
```ts
// server/functions/users.ts
export async function authenticate() { ... } // 💥 COMPILE-TIME ERROR!
```
The compiler guides the author:
`💥 [MMD-S011]: Server function 'authenticate' must begin with a valid HTTP verb prefix (get, post, put, patch, delete), e.g. 'postAuthenticate' or 'getAuthSession'.`

---

### 4. Code Splitting & Security
* **UI Build**: The bundler completely removes server function bodies and
  server-only imports (`db`, secrets, file systems). It replaces exports with
  small `$fetch` facades backed by the existing data package.
* **Server Build**: Real function implementations are auto-registered in `defineServer` at `/_fn/<module>/<function>`.
* **SSR Render**: When a component calls `getStories()` during SSR, `$fetch`
  routes through the synthesized `serverFetch` and the same middleware/route
  dispatch used by an external request, without a network loopback.

---

### 5. Generated UI Types Preserve Existing Data Semantics

The real server implementation may be an ordinary async TypeScript function.
The generated UI-side facade has the type of the data primitive it uses;
Memoized DOM does not combine a resolved value with a thenable.

`get*` facades return the existing **`ResolvedValue<T>`**:

```ts
declare const resolvedValue: unique symbol;
export type ResolvedValue<T> = T & {
  readonly [resolvedValue]: T;
};
```

Whenever client code imports from `server/functions/*`:
* **`get*` functions** return `ResolvedValue<T>`. Because that is assignable
  to `T`, expressions such as `stories.map(...)`, `stories.length`, and
  `story.title` retain autocomplete and participate in colorless lowering.
* **Mutating functions** also return `ResolvedValue<T>`. Their lifecycle is
  observed through `$track`, exactly like a GET source; calling a mutation
  does not require or imply `await`.
* **Generated mapping** is supplied in place, not through a separate module.
  The compiler's linker marks every exported server function as a
  `transparentSourceFactory` in the module manifest, so a UI build compiles
  the same module identity to its `$fetch` facade — no import rewriting of
  authored relative imports.
* **`#server-functions` is the client-facing import surface.** Client code
  never imports the real files; it imports one generated barrel. The Vite
  adapter resolves `#server-functions` to a re-export barrel over the
  in-place facade modules, so server builds keep the implementations and
  client builds ship only `$fetch` facades.
* **Generated declarations live in `.memoized/`.** The adapter writes
  `.memoized/server-functions.d.ts` — one flat barrel declaring every
  endpoint as `export declare function name(...args: Parameters<typeof
  impl.fn>): ResolvedValue<Awaited<ReturnType<typeof impl.fn>>>` with
  type-only imports of the real implementations. Client imports therefore
  type as `ResolvedValue<T>` (readable as `T`, `$track`-able) while the
  server build keeps the implementation's ordinary async TypeScript types.
  The project's `tsconfig.json` maps the specifier once:
  ```json
  { "compilerOptions": { "paths": {
    "#server-functions": ["./.memoized/server-functions.d.ts"]
  } } }
  ```
  All generated tooling artifacts share the `.memoized/` root (server
  functions today, generated route declarations for the typed `route-to`
  surface alongside). Exported function names must be unique across modules
  because the barrel is one flat module; duplicates fail generation with
  `[MMD-S012]` naming both owning modules.

---

## 12. Engineering Guardrails: Compiler Invariants & Gating Rules

To ensure this zero-ceremony developer experience does not create leaky abstractions, hidden performance traps, or silent type bugs, the framework enforces the following **Compiler Invariants and Runtime Guardrails**:

### Guardrail 1: HTTP Verb Gating & AST Context Disambiguation
The compiler deterministically selects the transport, client lowering, and valid execution boundaries from the function's HTTP verb prefix:

```text
Function Call AST Node: getStories() or postVote()
  │
  ├── 1. get* Functions (HTTP GET)
  │     ├── Allowed in: Component Render, Module Scope, Event Handlers
  │     ├── Lowered to: $fetch('/_fn/<module>/<fn>', { query }) ──► ResolvedValue<T>
  │     ├── Participates in <Group>, <Pending>, <Error> availability gating
  │     └── Settle & Hydration: Bundled into SSR payload and restored without refetching
  │
  ├── 2. post*, put*, patch*, delete* Functions (HTTP Methods)
  │     ├── Allowed in: JSX Event Props (onClick, onSubmit), Callbacks
  │     ├── Lowered to: $fetch('/_fn/<module>/<fn>', { method: '...', body })
  │     ├── Invocation returns: ResolvedValue<T>; lifecycle remains in $track
  │     └── Compiler Check: Strictly prohibited in component render bodies
  │
  └── 3. Compile-Time Diagnostics (FATAL COMPILE ERRORS)
        ├── Non-GET called inside render: postVote() in component body
        │     └── 💥 [MMD-S010]: 'postVote' is an HTTP POST function and cannot be invoked during component rendering.
        └── Missing verb prefix: calculateTotal() in server/functions/*
              └── 💥 [MMD-S011]: Server function 'calculateTotal' must begin with a valid HTTP verb prefix (get, post, put, patch, delete).
```

### Guardrail 2: Concurrency & Waterfall Elimination
When a component performs multiple reads:
```tsx
function ProfilePage() {
  const user = getUser();
  const settings = getSettings();
  const notifications = getNotifications();
}
```
* **The Risk**: Accidentally starting independent sibling requests only after a
  previous one settles.
* **The Compiler Invariant**:
  1. Module and component source descriptors are materialized **in parallel in the same microtask**.
  2. On the client, independent sibling invocations begin in the same render
     pass; transport batching is an optional optimization, not a correctness
     requirement.
  3. On SSR, `dataRuntime.settle()` waits for the current in-flight set and
     repeats until quiescence. Genuine data dependencies may still form a
     waterfall and must remain observable in diagnostics.

### Guardrail 3: Boundary Isolation & Secret Leak Prevention
* **The Risk**: Server-side modules importing ORMs (`db`), environment secrets (`process.env.API_KEY`), or Node builtins (`node:fs`) accidentally leaking into the client JavaScript bundle.
* **The Gating Rule**:
  1. The compiler treats `server/functions/*` as a strict **One-Way Boundary**.
  2. For the client build, the Vite adapter compiles the same module in place
     to its generated `$fetch` facade; the implementation and its transitive
     graph are never resolved into the browser build.
  3. The boundary is enforced at the export side first: `analyzeServerFunctionModule`
     rejects every export that is not a verb-prefixed async function or the
     `middleware` export (`[MMD-S003]`), so a non-function value such as `db`
     cannot exist in a `server/functions/*` module at all.
  4. Defense in depth: because the hard export rule means a non-function
     export cannot exist, an import such as
     ```ts
     import { db } from '../server/functions/stories';
     ```
     fails at the source module's compile as an export violation. If a name
     the manifest did not classify ever reaches a UI build anyway, the Vite
     transform fails closed rather than resolving the implementation module.

### Guardrail 4: Arguments & Return Value Serializability
* **The Risk**: Developers passing non-serializable arguments (DOM nodes, functions, WebSocket handles, class instances with private closures) across the client/server boundary.
* **The Invariant**:
  1. A `get*` facade maps parameters to the existing `$fetch` `Query` shape:
     strings, numbers, booleans, null, undefined, and arrays of those query
     primitives.
  2. A mutating facade maps parameters to the `$fetch` JSON body. The generated
     function form accepts JSON-safe values; direct `$fetch` remains available
     for explicitly authored non-JSON bodies supported by its public type.
  3. Results use the existing response decoder (`application/json`, text, or
     an empty response) and the existing SSR payload serializer. The function
     layer does not add an extended codec for `Date`, `BigInt`, `Set`, `Map`,
     or class instances.
  4. TypeScript types enforce the corresponding boundary:
     ```ts
     type JsonPrimitive = string | number | boolean | null;
     type JsonValue =
       | JsonPrimitive
       | readonly JsonValue[]
       | { readonly [key: string]: JsonValue };
     ```
     Passing a non-serializable type (e.g. `(e: MouseEvent) => void`) triggers an instant TypeScript compile error on the call site.

### Guardrail 5: Preserve One `$fetch` Contract
* **The Invariant**: Generated facades do not invent a universal server-call
  type and do not make colorless values thenable.
  * Every server-function call has the existing `ResolvedValue<T>` behavior,
    including compiler reads, `$track`, pending/error policies, SSR settling,
    and hydration where the call site is permitted during render.
  * Method and body are request descriptor fields. They must participate in
    identity and reactive rebinding just like target, query, headers, key, and
    validation.
  * Non-GET requests default to non-cacheable execution. An explicit cache
    override may be supported only where its replay semantics are clear.
  * A generated facade resolves `$fetch` against the active request-local data
    runtime and must not retain a source from one SSR request globally.
  * The server implementation may use promises internally as normal server
    code. That implementation detail does not become the UI call contract.

### Guardrail 6: Request Context Safety (`getServerContext`)
* **The Invariant**:
  1. `getServerContext()` resolves through a request-context storage capability.
     Node/Bun adapters may use `AsyncLocalStorage`; edge adapters must provide a
     concurrency-safe equivalent or declare the ambient helper unsupported and
     use explicit context injection.
  2. If called outside an active request context (e.g., an unmanaged `setInterval` or orphaned worker), it throws immediately:
     `💥 [MMD-E004]: getServerContext() was called outside of an active HTTP request lifecycle.`
  3. Each external request and derived in-memory dispatch has an isolated
     context lifetime. No process-global mutable fallback is permitted.

### Guardrail 7: Destructuring Rejection on Colorless Sources

**The Problem**:

In colorless data semantics, the compiler represents `const data =
getStories()` through a request-local source descriptor rather than a
materialized synchronous snapshot. Destructuring evaluates its member accesses
immediately when the statement executes, before the source has settled:

```tsx
// 💥 Evaluates immediately before resolution:
const { length, user } = getStories();
const [firstStory] = getStories();
```

Native JavaScript engines evaluate destructuring access immediately upon executing the statement. Because the source has not yet settled or is suspended, `length`, `user`, and `firstStory` evaluate to `undefined` (or throw during array iterator unrolling), breaking reactive tracking.

**The Decision — Reject, Do Not Lower**:

The compiler rejects destructuring on colorless sources with a compile-time
diagnostic. It does not rewrite the pattern into lazy accessors or property
handles. This is deliberate and uniform:

1. **The runtime already solved laziness.** A colorless source is a live
   object whose properties fill in when the request settles. Property access
   on the source (`stories.length`, `stories.map(...)`, `story.title`) is
   naturally lazy and reactive. Destructuring is the one construct that
   copies values out eagerly at declaration time; that makes it an authoring
   error, not a transform opportunity.
2. **No silent semantic rewrites.** Lowering `const { length } = src` into a
   live accessor would quietly change authored JavaScript semantics — a
   `const` whose read changes over time — and would require rewriting every
   downstream reference (aliases, closure captures, exports) with the same
   long tail of edge cases the rest of the compiler already fights. This
   framework diagnoses unanalyzable constructs; it does not redefine `const`
   bindings under the author.
3. **One rule, one contract.** Server-function facades lower to `$fetch`
   calls in UI builds, so both authoring forms share the same contract and
   the same diagnostic. A colorless source cannot be destructured at
   declaration time, regardless of whether it came from a server-function
   facade or a direct `$fetch` call.

#### 1. Rejected Patterns

The diagnostic applies to any destructuring pattern (variable declaration,
assignment expression, or parameter default) whose initializer resolves to a
colorless server-function call or `$fetch` source:

```tsx
// Object destructuring
const { length, user: currentUser = null } = getStories();

// Array destructuring (including holes and nested patterns)
const [firstStory, secondStory] = getStories();
const { profile: { name } } = getMe();

// Rest patterns
const { a, ...rest } = getStories();

// Assignment destructuring
({ length } = getStories());

// Destructuring parameter defaults
function render({ length } = getStories()) { ... }
```

* **Diagnostic Rule**: every rejected pattern above raises the same
  compile-time error:
  `💥 [MMD-S004]: Colorless server function and $fetch sources cannot be destructured. Destructuring copies values at declaration time, before the source settles. Bind the source and read properties at the use site, or destructure inside a settled context.`

#### 2. Allowed Forms

* Plain identifier binding: `const stories = getStories();`
* Property access at the use site: `stories.length`, `stories.map(...)`,
  `story.title`.
* Destructuring a settled plain value, which is the idiomatic path:

```tsx
{stories.map((story) => {
  const { title, votes } = story; // `story` is a settled plain item
  return <article>{title} — {votes}</article>;
})}
```

A future refinement may permit destructuring where the compiler can
statically prove settlement (for example, inside a JSX child gated by the
source's `<Group>`). That settlement-proof analysis is deferred until
diagnostic frequency justifies it; the initial contract is strict rejection.

---

## 13. Comparison with Other Frameworks

| Framework | Route Definition | Server Functions / RPC | Middleware Scoping | SSR Data Bridge | Client Hydration |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Next.js** | App router (`route.ts`) | `'use server'` directive | Single root `middleware.ts` with string matcher | Extended `fetch()` with custom cache engine | RSC payload streaming + client cache |
| **TanStack Start** | `createServerFn()` wrappers | Manual wrapper function boilerplate | Middleware attached to server function | Direct execution | TanStack Query hydration |
| **Remix** | File routes with `loader` / `action` | Route-bound loader/actions | Global `handleRequest` / Express middleware | Direct loader execution | `useLoaderData()` + window payload |
| **SvelteKit** | `+server.ts` routes | Form actions (`+page.server.ts`) | Root `hooks.server.ts` + layout servers | Internal `event.fetch()` | Page data store |
| **Nitro / Nuxt** | `server/routes/`, `server/api/` | Nitro event handlers | `server/middleware/` | `$fetch` with in-memory Nitro dispatch | Payload state hydration |
| **Memoized DOM** | Unified `routes: {}` or file-based | **Plain named HTTP functions lowered to method-aware `$fetch`** | Hierarchical folder & prefix groups (`*`) | In-memory `serverFetch` over identical routes | Colorless module sources (`$fetch`), zero-hook hydration |

---

## 14. Implementation Plan & Next Steps

When ready to implement, the restructuring will proceed along modular boundaries:

1. **`packages/server/src/http-router.ts`**: Portable method-aware dispatcher;
   finish precompiling prefix middleware pipelines and benchmark it against raw
   host handlers.
2. **`packages/server/src/server/middleware.ts`**: Middleware composer and pipeline unwinder.
3. **`packages/server/src/server/document.ts`**: Template loading, `<!--ssr-outlet-->` validation, and streaming concatenation.
4. **`packages/server/src/server/server-fetch.ts`**: In-memory dispatcher connecting `routes` to SSR `@memoized-dom/data`.
5. **`packages/server/src/server/define-server.ts`**: Main entrypoint tying the pieces together.
6. **Server-function manifest**: Build-generated route identities, verb and
   parameter metadata, and server-only registration without importing the
   implementation graph into UI builds.
7. **UI facade emission**: in-place method-aware `$fetch` facades, the
   `#server-functions` runtime barrel, and the generated
   `.memoized/server-functions.d.ts` declaration barrel that preserve the
   current ESTree compiler and data-runtime contracts.
8. **Documentation and Showcase Update**: Updating `examples/ssr-showcase/server.ts` to use `defineServer`.
