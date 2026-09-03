# Memoized DOM Server Architecture & DX Specification

**Status**: Draft RFC v0.2 — architecture review, no API implemented

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
* `@memoized-dom/data` already supplies request-local `$fetch`/`$action`
  runtimes, quiescent settling, serialized state, and the compiler-facing
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
  document: './index.html',

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
`$action`, forms, and webhook semantics undefined.

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

export function App() {
  return (
    <div>
      <h1>Stories</h1>
      <Group source={stories}>
        <Pending>
          <div class="skeleton">Loading stories...</div>
        </Pending>
        <Error>{(err) => <div class="error">{err.message}</div>}</Error>
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
Hydration automatically pairs with the state payload generated by `defineServer`:

```ts
import { hydrate } from '@memoized-dom/runtime/hydrate';
import { App } from './App';

// Automatically extracts <script type="application/mmd+json" data-mmd-root="App">
// Restores data cache and adopts server DOM without refetching
hydrate('root', App);
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
   are replaced by a generated facade. `get*` facades use `$fetch`; mutating
   facades use `$action`. Both therefore keep the data layer's
   existing client, SSR, hydration, pending, error, retry, and cancellation
   behavior.
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
     $action('/_fn/stories/postVote', { method: 'POST' })({ id });

4. One Existing Data Lifecycle:
   • SSR render: the active data runtime sends the request through serverFetch
     and the normal in-memory route/middleware pipeline.
   • Hydration: the existing payload envelope restores settled get* sources
     without a duplicate browser request.
   • Browser navigation/actions: the same facades use standard browser HTTP.
```

---

### The Strict HTTP Verb Prefix Matrix

The verb prefix dictates the HTTP method, the argument transport format, caching semantics, and valid call sites:

| Prefix | HTTP Method | Argument Serialization | Caching / Idempotency | Client Lowering | Valid Call Sites |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`get*`** | `GET` | URL query | Existing `$fetch` cache policy | `$fetch('/_fn/...', { query })` $\rightarrow$ `ResolvedValue<T>` | Component Render, Module Scope, Event Handlers |
| **`post*`** | `POST` | JSON body | Mutation | `$action('/_fn/...', { method: 'POST' })(input)` $\rightarrow$ `ActionResult<T>` | Event Handlers, Callbacks Only |
| **`put*`** | `PUT` | JSON body | Idempotent replacement | `$action('/_fn/...', { method: 'PUT' })(input)` $\rightarrow$ `ActionResult<T>` | Event Handlers, Callbacks Only |
| **`patch*`** | `PATCH` | JSON body | Partial mutation | `$action('/_fn/...', { method: 'PATCH' })(input)` $\rightarrow$ `ActionResult<T>` | Event Handlers, Callbacks Only |
| **`delete*`** | `DELETE` | JSON body | Idempotent deletion | `$action('/_fn/...', { method: 'DELETE' })(input)` $\rightarrow$ `ActionResult<T>` | Event Handlers, Callbacks Only |

The table describes lowering, not a second public API. Developers keep calling
the imported function. The generated facade maps its serializable parameters
to the query or action input expected by the existing data runtime.

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
import { getStories, getStory, postVote } from '../server/functions/stories';

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
  small `$fetch`/`$action` facades backed by the existing data package.
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
* **Mutating functions** return the existing `ActionResult<T>` immediately.
  Their `state`, `data`, and `error` are the action channel; calling a mutation
  does not require or imply `await`.
* **Generated mapping** is supplied by the server-function virtual module and
  its declaration output. The server build keeps the implementation's real
  TypeScript type; the UI build sees its generated data-facade type.

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
  │     ├── Lowered through: $action('/_fn/<module>/<fn>', { method: '...' })
  │     ├── Invocation returns: existing ActionResult<T> state/data/error channel
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
  2. For the client build, the bundler substitutes a generated virtual module;
     the implementation and its transitive graph are never resolved into the
     browser build.
  3. If a client component attempts to import a non-function export:
     ```ts
     import { db } from '../server/functions/stories';
     ```
     The compiler emits a fatal compile-time diagnostic:
     `💥 [MMD-S003]: Only async functions may cross the client boundary from server/functions/. Variable 'db' cannot be imported into client code.`

### Guardrail 4: Arguments & Return Value Serializability
* **The Risk**: Developers passing non-serializable arguments (DOM nodes, functions, WebSocket handles, class instances with private closures) across the client/server boundary.
* **The Invariant**:
  1. A `get*` facade maps parameters to the existing `$fetch` `Query` shape:
     strings, numbers, booleans, null, undefined, and arrays of those query
     primitives.
  2. A mutating facade maps parameters to the existing `$action` JSON body.
     The generated function form accepts JSON-safe values; developers needing
     `FormData`, binary bodies, or another explicit transport can use `$action`
     directly.
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

### Guardrail 5: Preserve `$fetch` and `$action` Contracts
* **The Invariant**: Generated facades do not invent a universal server-call
  type and do not make colorless values thenable.
  * A `get*` call has the existing `ResolvedValue<T>` behavior, including
    compiler reads, pending/error policies, SSR settling, and hydration.
  * A mutating call has the existing `ActionResult<T>` behavior. Its request
    lifecycle is observable through action state and errors, even when the
    developer ignores the returned result.
  * A generated facade resolves `$fetch`/`$action` against the active data
    runtime. It must not retain an action created from one SSR request in a
    process-global module cache. Any descriptor cache must be owned by the
    request-local data runtime.
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

### Guardrail 7: Destructuring Lowering & Lazy Property Binding

**The Problem**:

In colorless data semantics, the compiler represents `const data =
getStories()` through a request-local source descriptor rather than a
materialized synchronous snapshot. When developers perform object or array
destructuring at declaration time:

```tsx
// 💥 Evaluates immediately before resolution:
const { length, user } = getStories();
const [firstStory] = getStories();
```

Native JavaScript engines evaluate destructuring access immediately upon executing the statement. Because the source has not yet settled or is suspended, `length`, `user`, and `firstStory` evaluate to `undefined` (or throw during array iterator unrolling), breaking reactive tracking.

**The Invariant & Transform Rule**:

The compiler intercepts any `VariableDeclarator` whose initializer resolves to a colorless server function call or source and decomposes the destructuring pattern into hoisted identifier bindings backed by lazy accessors.

#### 1. Object Destructuring Lowering

```tsx
// Source code authored by developer
const { length, user: currentUser = null } = getStories();
```

*Transformed Client Output:*

```ts
const _src_stories = getStories();

// Compiler transforms downstream references to getters, or defines reactive accessor properties:
const length = _MDD.prop(_src_stories, 'length');
const currentUser = _MDD.prop(_src_stories, 'user', null);
```

#### 2. Array Pattern Lowering

Array destructuring is rewritten to index-based property handles to avoid executing `Symbol.iterator` on an unsettled reactive proxy:

```tsx
// Source code authored by developer
const [firstStory, secondStory] = getStories();
```

*Transformed Client Output:*

```ts
const _src_stories = getStories();
const firstStory = _MDD.prop(_src_stories, 0);
const secondStory = _MDD.prop(_src_stories, 1);
```

#### 3. Rest Property Diagnostic (`...rest`)

JavaScript rest destructuring (`const { a, ...rest } = getStories()`) requires exhaustive enumeration of object keys (`Object.keys`), which cannot be known statically ahead of resolution.

* **Diagnostic Rule**: If the compiler detects an object rest element (`RestElement`) on an unsettled server function source, it raises a compile-time error:
  `💥 [MMD-S004]: Rest patterns (...rest) cannot be destructured directly from colorless server function calls. Consume properties individually or pass the source directly to a <Group> or accessor.`

---

## 13. Comparison with Other Frameworks

| Framework | Route Definition | Server Functions / RPC | Middleware Scoping | SSR Data Bridge | Client Hydration |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Next.js** | App router (`route.ts`) | `'use server'` directive | Single root `middleware.ts` with string matcher | Extended `fetch()` with custom cache engine | RSC payload streaming + client cache |
| **TanStack Start** | `createServerFn()` wrappers | Manual wrapper function boilerplate | Middleware attached to server function | Direct execution | TanStack Query hydration |
| **Remix** | File routes with `loader` / `action` | Route-bound loader/actions | Global `handleRequest` / Express middleware | Direct loader execution | `useLoaderData()` + window payload |
| **SvelteKit** | `+server.ts` routes | Form actions (`+page.server.ts`) | Root `hooks.server.ts` + layout servers | Internal `event.fetch()` | Page data store |
| **Nitro / Nuxt** | `server/routes/`, `server/api/` | Nitro event handlers | `server/middleware/` | `$fetch` with in-memory Nitro dispatch | Payload state hydration |
| **Memoized DOM** | Unified `routes: {}` or file-based | **Plain named HTTP functions lowered to existing `$fetch` / `$action`** | Hierarchical folder & prefix groups (`*`) | In-memory `serverFetch` over identical routes | Colorless module sources (`$fetch`), zero-hook hydration |

---

## 14. Implementation Plan & Next Steps

When ready to implement, the restructuring will proceed along modular boundaries:

1. **`packages/server/src/server/router.ts`**: Pure routing trie supporting exact paths, `:param` captures, and `*` prefix groups.
2. **`packages/server/src/server/middleware.ts`**: Middleware composer and pipeline unwinder.
3. **`packages/server/src/server/document.ts`**: Template loading, `<!--ssr-outlet-->` validation, and streaming concatenation.
4. **`packages/server/src/server/server-fetch.ts`**: In-memory dispatcher connecting `routes` to SSR `@memoized-dom/data`.
5. **`packages/server/src/server/define-server.ts`**: Main entrypoint tying the pieces together.
6. **Server-function manifest**: Build-generated route identities, verb and
   parameter metadata, and server-only registration without importing the
   implementation graph into UI builds.
7. **UI virtual modules**: Typed `$fetch`/`$action` facades that preserve the
   current ESTree compiler and data-runtime contracts.
8. **Documentation and Showcase Update**: Updating `examples/ssr-showcase/server.ts` to use `defineServer`.
