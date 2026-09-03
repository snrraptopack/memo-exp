# @memoized-dom/server

Server-side rendering and the application-server composition layer for
memoized-dom. The package ships three tiers, usable independently:

| Tier | Import | What it gives you |
| :--- | :--- | :--- |
| Renderers | `@memoized-dom/server` | Compiled component → HTML / payload / stream, with per-request isolation. |
| Composition | `@memoized-dom/server` | `defineServer`: routes, middleware, document lifecycle, and the in-memory `serverFetch` bridge. |
| Portable router | `@memoized-dom/server/router` | Method-aware Web-standard `Request → Response` dispatcher with no Node dependencies. |

**Request isolation model.** Every render creates a fresh application
runtime, route runtime, and data runtime; kernel state, cleanup, access
tables, and prop boxes never leak between concurrent requests. Effects and
refs are disabled during server rendering.

Prerequisites: a compiled component (`function App(_id, _parent)` produced
by `@memoized-dom/compiler`) and Node 24+.

---

## 1. Renderers

All renderers accept a compiled root component plus `RenderOptions`:

```ts
interface RenderOptions {
  /** 'shell' renders the pending tree immediately; 'resolve' awaits
   *  request-owned data (subject to `timeout`) before serializing. */
  mode?: 'shell' | 'resolve';
  /** Resolve-mode quiescence budget in ms (default 5000). */
  timeout?: number;
  /** Request URL — installed as request-local memory history so compiled
   *  route regions and `route.*` reads resolve against it. */
  url?: string;
  /** Fetch implementation backing the request-local data runtime
   *  (`$fetch`/`$action`). Defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
  /** `true` preserves runtime region anchors (`<!--mmd:r:App-->…<!--/mmd-->`)
   *  and hydration payloads; `false` (renderer default) strips all comments
   *  for clean host-consumable HTML. */
  markers?: boolean;
  /** Inject a document instead of the built-in DOM tier (tests). */
  document?: DocumentLike;
}
```

### `renderToString(component, options): string`

Synchronous string render on the fast StringDocument tier. It cannot await
data, so it always produces the shell form; use an async variant when request
data must settle.

### `renderToStringAsync(component, options): Promise<string>`

Asynchronous string render. `mode: 'resolve'` waits for request-owned data to
become quiescent (bounded by `timeout`) and serializes the resolved UI;
`mode: 'shell'` delegates to `renderToString`.

### `renderToResult(component, options): RenderResult`
### `renderToResultAsync(component, options): Promise<RenderResult>`

The same tiers as above, returning the pieces instead of a finished document
so a custom host can assemble its own HTML:

```ts
interface RenderResult {
  html: string;
  payload: RenderPayload;   // { version: 1, state?: SerializedDataState }
  scriptTag: string;        // ready-to-embed <script type="application/mmd+json">
}
```

### `renderToReadableStream(component, options): ReadableStream<Uint8Array>`

Ordered, settled streaming — the document prefix can flush while the
application settles; this is **not** out-of-order suspense streaming. In
`resolve` mode the stream emits the resolved application body followed by the
payload script tag (when `markers: true`); in `shell` mode the pending UI is
emitted immediately and no late replacement protocol is implied. `StreamOptions`
adds `signal?: AbortSignal`, which aborts the render and all request-owned
data work.

```ts
import { renderToReadableStream } from '@memoized-dom/server';
import { createDocumentStream, htmlResponse } from '@memoized-dom/adapters';

const body = renderToReadableStream(App, {
  url: request.url,
  markers: true,
  mode: 'resolve',
});
return htmlResponse(createDocumentStream({ prefix, body, suffix }));
```

### `renderWithDom(component, options): RenderedDom`
### `renderWithDomAsync(component, options): Promise<RenderedDom>`

The LinkeDOM reference tier — a real server DOM for parity testing or callers
that need live nodes:

```ts
interface RenderedDom {
  document: Document;        // the server document that produced the output
  html: string;
  nodes: readonly Node[];
  runtime: ApplicationRuntime; // caller-owned: dispose after inspection
}
```

### Serialization helpers

* `escapeJsonForScriptTag(json)` — escapes `<`, `>`, `&` for safe script-tag
  embedding.
* `createPayloadScriptTag(rootId, payload)` — builds the
  `application/mmd+json` script tag `hydrate` reads on the client.
* `syncBooleanAttributes(node)` — normalizes boolean attributes
  (`checked`, `disabled`, …) after DOM-tier renders.

---

## 2. Document composition

Helpers behind `defineServer`'s document lifecycle, public for custom hosts:

```ts
import {
  SSR_OUTLET,
  splitDocumentTemplate,
  loadDocumentTemplate,
  composeDocumentStream,
} from '@memoized-dom/server';

// Exactly one <!--ssr-outlet--> marker is required; missing or duplicated
// markers throw at load time, never per request.
const template = splitDocumentTemplate(templateHtml);
// → { prefix: '…<div id="root">', suffix: '</div>…</body></html>' }

loadDocumentTemplate(new URL('./index.html', import.meta.url)); // Node convenience

// Stream prefix + application body + suffix; cancelling the composed stream
// cancels the application render.
composeDocumentStream({ prefix: template.prefix, body, suffix: template.suffix });
```

---

## 3. Portable HTTP router — `@memoized-dom/server/router`

A Web-standard dispatcher with no Node dependencies (edge-safe). Rendering
and filesystem discovery deliberately live above this layer.

```ts
import { createServerRouter } from '@memoized-dom/server/router';

const router = createServerRouter({
  // Method-aware routes. `handler` receives a ServerContext; returning an
  // object/array serializes to JSON, a string to text/plain, a Response
  // passes through untouched, a ReadableStream wraps in a Response, and
  // `undefined` becomes 204.
  routes: [{
    method: 'GET',                       // or an array of methods
    path: '/users/:id',
    middleware: [requireAuth],           // route-level, runs last
    handler: (context) => ({ id: context.params.id }),
  }],

  // Onion middleware: global first, then prefix groups shallow→deep, then
  // route middleware. Any layer may short-circuit by returning a Response.
  middleware: [logger],
  groups: [{ path: '/api/*', middleware: [apiLimiter] }],

  createLocals: (request) => ({ traceId: readTrace(request) }),
  createPlatform: (request) => detectPlatform(request),

  // Handles paths with no HTTP route — the page-render seam.
  fallback: (context) => renderPage(context),

  // One error boundary for handler throws and render failures.
  onError: (error, context) => new Response('Internal Server Error', { status: 500 }),
});
```

### `ServerContext`

```ts
interface ServerContext<TLocals, TPlatform> {
  readonly request: Request;   // untouched Web Request — never mutated or subclassed
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  readonly locals: TLocals;    // one instance per request, shared through the onion
  readonly platform: TPlatform | undefined;
}
```

### `ServerMiddleware`

```ts
type ServerMiddleware<TLocals, TPlatform> = (
  context: ServerContext<TLocals, TPlatform>,
  next: () => Promise<Response>,
) => Response | Promise<Response>;
```

Calling `next()` more than once from one layer throws.

### Behavior contract

* **Static routes** are indexed by method + pathname; **dynamic** (`:param`)
  and wildcard paths use the router matcher — the same pattern language as
  the client router.
* **`HEAD`** falls back to the `GET` handler and the body is stripped.
* **`OPTIONS`** is answered automatically with `204` and an `Allow` header;
  unknown methods on known paths return **`405` + `Allow`**.
* **`/_fn/*` is reserved** for generated server functions; declaring a
  colliding route throws at startup, and ambiguous method tables
  (`GET` vs `get`) are rejected during construction.

### `ServerRouter`

```ts
interface ServerRouter<TLocals, TPlatform> {
  fetch(request: Request): Promise<Response>;          // external entry
  dispatch(request, options?): Promise<Response>;      // in-memory dispatch —
                                                       // reuses locals/platform
  matches(pathname: string, method: string): boolean;
  allowedMethods(pathname: string): readonly string[];
}
```

`dispatch` with inherited `locals`/`platform` is the seam the SSR data bridge
uses; handlers stay oblivious to whether a request arrived over the network
or in memory.

### Server functions — `createServerFunctionRoutes`

Converts the compiler-generated server-function manifest into ordinary
router routes:

```ts
import { createServerFunctionRoutes } from '@memoized-dom/server/router';

const routes = createServerFunctionRoutes([{
  id: 'stories/getStory',
  method: 'GET',
  path: '/_fn/stories/getStory',
  parameters: [{ name: 'id', optional: false, queryKind: 'number' }],
  handler: (id) => db.story(id),
}]);
```

Argument decoding is strict: unknown query or body fields, missing required
parameters, and malformed values return `400` with a descriptive message;
GET parameters are coerced per `queryKind` (`string`, `number`, `boolean`,
and arrays), mutation parameters arrive as the JSON body fields.

---

## 4. `defineServer` — the composition layer

One declarative block that ties the router, page renderer, generated server
functions, middleware, and the SSR data bridge together. Returns a standard
Web handler, so hosting is trivial:

```ts
// Bun
export default { port: 3000, fetch: server };
// Node
http.createServer(createNodeHandler(server)).listen(3000);
// Vite dev (HMR included)
memoizedDomFullstack({ entry: 'server.ts' });
```

```ts
import { defineServer } from '@memoized-dom/server';
import { App } from './App';

const server = defineServer({
  // Root compiled UI component — rendered for page fallthrough.
  app: App,

  // Page template: exactly one <!--ssr-outlet-->, validated at definition.
  // `document` is a filesystem path (Node); `documentTemplate` carries
  // preloaded content for filesystem-less hosts. Providing neither with an
  // `app` throws at definition, not on the request path.
  document: new URL('./index.html', import.meta.url),

  // Global middleware runs for pages, API routes, and webhooks alike.
  middleware: [logger(), session()],

  routes: {
    // 1. Bare handler = implicit GET; object/array → Response.json().
    '/api/stories': () => STORIES,

    // 2. Method-aware object form with per-method middleware.
    '/api/stories': {
      GET: () => STORIES,
      POST: { middleware: [requireAuth()], handler: createStory },
    },

    // 3. Middleware-only keys become prefix groups. They run for matched
    //    API routes AND for page fallthrough — page protection without a
    //    second mechanism.
    '/admin/*': { middleware: [requireAuth()] },
  },

  // Generated server-function routes (see §5) mount in the same router.
  serverFunctions,

  // Page render policy. Defaults shown; every field is optional.
  render: {
    mode: 'resolve',     // settle request data before flush ('shell' = pending tree)
    markers: true,       // hydration anchors + application/mmd+json payload
    timeout: 10_000,     // resolve quiescence budget
    delivery: 'stream',  // ordered streaming ('buffer' renders fully first)
  },

  // Default ResponseInit for rendered HTML pages.
  init: { headers: { 'cache-control': 'public, max-age=5, stale-while-revalidate=60' } },

  createLocals: (request) => ({ requestId: readTrace(request) }),
  createPlatform: (request) => undefined,

  // Fetch capability for cross-origin requests during SSR.
  fetch: globalThis.fetch,

  onError: (error, context) => {
    console.error(`[${context.request.method} ${context.url.pathname}]`, error);
    return new Response('Internal Server Error', { status: 500 });
  },
});

export default server;
```

### Request flow

```text
Request → global middleware → prefix groups (shallow → deep) → route middleware → handler
         ↘ no matching route → page fallthrough: prefix middleware → SSR render policy
```

An authenticated page request renders `App` through the configured policy;
an unauthenticated one short-circuits in middleware and never executes a
render. Non-GET page requests receive `405` + `Allow: GET, HEAD`.

### The in-memory `serverFetch` bridge ("one data source")

During SSR, colorless `$fetch` calls from application code are dispatched
**in-process** through the same route table, middleware, response
normalization, and error policy as external requests:

* Same-origin targets matching a route (or a known path with a different
  method) never touch the network — zero loopback, zero duplicated mock
  handlers.
* Relative targets resolve against the parent request URL; cross-origin
  targets use the `fetch` option.
* Child dispatches inherit request `locals` and `platform`, and a depth
  guard fails recursive dispatch cycles with a useful error.
* The browser hits the same routes over real HTTP; hydration restores
  settled sources from the payload without refetching.

### `getServerContext()`

Reads the active request context from middleware, handlers, or server-function
bodies without threading it through every call:

```ts
import { getServerContext } from '@memoized-dom/server';

export async function postVote(id: number) {
  const { locals } = getServerContext<{ user?: User }>();
  if (!locals.user) throw new Error('Unauthorized');
  return db.vote(id, locals.user.id);
}
```

Throws immediately when no request lifecycle is active (unmanaged timers,
orphaned workers) — there is no process-global fallback.

### `installServerFunctions(routes)` (adapter hook)

The Vite fullstack dev plugin calls this on the handler whenever the
generated server-function table changes, so HMR can swap routes without
re-creating the handler identity. Application code never calls it.

---

## 5. Rendering-policy notes

* `mode: 'shell'` + `markers: true` is valid — the client hydrates a pending
  shell and its data runtime resolves sources in the browser.
* `markers: false` emits no payload; pairing it with a hydrating client entry
  is a configuration error for the Vite plugin to catch, not a silent
  runtime mismatch.
* `renderWithDom*` is a testing/parity tier, deliberately **not** part of the
  `render` policy block.
* `RenderOptions` used directly keeps the library defaults (`markers: false`,
  sync renderers cannot settle); only `defineServer` defaults to resolved,
  marker-ful, streaming pages.
