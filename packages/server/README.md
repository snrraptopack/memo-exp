# @memoized-dom/server

This project does not support legacy APIs. All packages and consumers must use the current APIs. Do not add compatibility shims, deprecated aliases, or fallback paths for superseded APIs.

Server rendering, application composition, and a portable Web-standard router
for Memoized DOM.

| Surface | Import | Purpose |
| :--- | :--- | :--- |
| Application and renderers | `@memoized-dom/server` | `serve()`, request context, SSR renderers, and document helpers. |
| Portable router | `@memoized-dom/server/router` | Method-aware `Request` to `Response` dispatch with no Node request API. |

Every render creates isolated application, route, and data runtimes. Effects,
cleanup tables, prop boxes, and request data do not leak between concurrent
requests.

## Application composition

`serve()` creates the application object used for middleware, routes, and SSR:

```ts
import { serve, type ServerMiddleware } from '@memoized-dom/server';
import { createServices } from '#server/config/services';
import { App } from './App';

const logger: ServerMiddleware = async (context, next) => {
  const started = performance.now();
  const response = await next();
  console.log(context.request.method, context.url.pathname, response.status,
    performance.now() - started);
  return response;
};

const app = serve({
  createServices,
  createLocals() {
    return {
      requestId: crypto.randomUUID(),
      user: undefined,
    };
  },
  onError(error, context) {
    console.error(context.url.pathname, error);
    return new Response('Internal Server Error', { status: 500 });
  },
});

app.use(logger);
app.use('/api/*', apiMiddleware);

app.get('/api/health', () => ({ ok: true }));
app.get('/api/stories/:id', ({ params }) => {
  return readStory(params.id);
});

app.ssr(App);
// Or scope a root: app.ssr('/reports/*', ReportsApp);

export default app;
```

`app.fetch(request)` is the portable host boundary. Vite dispatches to it in
development; other adapters can expose it through Bun, Node, or a worker host.
The fullstack Vite integration supplies the transformed HTML document used by
registered SSR roots.

HTTP endpoints use `app.get()`, `app.post()`, `app.put()`, `app.patch()`,
`app.delete()`, `app.head()`, and `app.options()`. Literal paths preserve exact
parameter inference, and middleware may precede the final handler on every
verb method.

### Middleware

Middleware is an ordinary function:

```ts
type ServerMiddleware = (
  context: ServerContext,
  next: () => Promise<Response>,
) => Response | Promise<Response>;
```

Global middleware uses `app.use(middleware)`. Path middleware uses
`app.use('/api/*', middleware)`. Route-local middleware precedes the final
handler:

```ts
app.patch('/api/stories/:id', requireUser, async (context) => {
  const input: unknown = await context.request.json();
  return updateStory(context.params.id, parseStoryPatch(input));
});
```

The passed `context` is the source of request state in middleware and route
handlers. `getServerContext()` exists for server-function bodies and deeper
helpers that do not receive the context argument; handlers should not receive
a context and then look it up again.

### Application-wide server types

The Vite integration discovers `<server>/config/index.ts`:

```ts
export interface ServerTypes {
  locals: {
    requestId: string;
    user?: User;
  };
  platform?: PlatformBindings;
}
```

It generates one project declaration that registers this contract. Normal
imports from `@memoized-dom/server` then default `ServerContext`,
`ServerMiddleware`, `serve()`, and `getServerContext()` to those application
types. No generic or relative config import is needed.

```ts
import { getServerContext } from '@memoized-dom/server';

export function currentUser() {
  return getServerContext().locals.user;
}
```

Other config modules can hold server-only environment parsing, authentication
policy, errors, constants, binding adapters, and service factories. Import
those application modules through `#server/config/*`. Routes and middleware
ordering remain part of the `serve()` composition root.

`createServices` may asynchronously connect a database and construct
repositories, queues, or caches. It runs lazily once per application instance,
and the result is exposed as typed `context.services` everywhere in the
request pipeline. Request-specific data remains in `context.locals`.

### Route preparation during SSR

Components use `$routed` when authentication, redirects, or route-owned data
must be ready before the destination renders:

```tsx
import { $routed, redirectRoute } from '@memoized-dom/router';

export function ReportPage() {
  const page = $routed(({ params, locals, services, signal }) => {
    if (!locals.user) return redirectRoute('/login');

    return services.reports.loadPage(params.reportId, locals.user.id, {
      signal,
    });
  });

  return <h1>{page.report.title}</h1>;
}
```

`serve()` supplies the same request-owned `request`, `locals`, `platform`, and
application `services` used by middleware and HTTP handlers. The callback
therefore should not call `getServerContext()` again. A routed redirect becomes
an HTTP redirect before any destination HTML is streamed.

The application handler prepares the initial route before creating its
component tree. Successful routed results and the JSON-safe keys of the
preparation's plain `state` object are included in the SSR payload. The
browser's normal `mount()` call restores them before hydration; application
code does not initialize a route-data runtime manually.

Direct callers rendering an application that contains `$routed` must use
`render()` or `renderToReadableStream()`. `renderToString()` is synchronous
and has no preparation phase.

## Renderers

Renderers accept a compiled root component and `RenderOptions`:

```ts
interface RenderOptions {
  mode?: 'shell' | 'resolve'; // resolve: await request data before output
  timeout?: number;           // soft settle budget; pending UI is serialized
  deadline?: number;          // hard budget; the render rejects with TimeoutError
  signal?: AbortSignal;       // aborts preparation and data work
  url?: string;
  fetch?: typeof globalThis.fetch;
  markers?: boolean;
}
```

- `render()` prepares the route, settles data in `resolve` mode, and returns
  the HTML, payload, ready-to-embed payload script, and settlement.
- `renderToString()` synchronously renders a shell.
- `renderToReadableStream()` returns ordered application streaming; cancelling
  the stream aborts the render.

```ts
import { render } from '@memoized-dom/server';

const result = await render(App, {
  url: request.url,
  mode: 'resolve',
  markers: true,
  signal: request.signal,
});

result.html;
result.payload;
result.scriptTag;
result.settlement; // { status: 'shell' } | { status: 'complete' | 'timeout', settleMs }
```

`markers: true` emits the hydration markers and the serialized data and
routed-preparation payload used by `mount()` when it adopts server-rendered
output.

The LinkeDOM correctness oracle lives on its own entry so production servers
never load it: `renderWithDom()` from `@memoized-dom/server/dom` returns live
nodes and a caller-owned runtime for parity tests.

## Document composition

Document helpers remain public for custom hosts:

```ts
import {
  composeDocumentStream,
  loadDocumentTemplate,
  splitDocumentTemplate,
} from '@memoized-dom/server';

const template = splitDocumentTemplate(html); // one <!--ssr-outlet-->
const fromDisk = loadDocumentTemplate(new URL('./index.html', import.meta.url));
const stream = composeDocumentStream({
  prefix: template.prefix,
  body: applicationStream,
  suffix: template.suffix,
});
```

## Portable router

`@memoized-dom/server/router` exposes the lower-level dispatcher used by the
application layer:

```ts
import { createServerRouter } from '@memoized-dom/server/router';

const router = createServerRouter({
  routes: [{
    method: 'GET',
    path: '/api/stories/:id',
    handler: ({ params }) => readStory(params.id),
  }],
});

const response = await router.fetch(request);
```

It validates route patterns, supports method-aware matching and `HEAD`
fallback, orders middleware with guarded `next()`, normalizes handler results,
and produces `404`, `405`, and `Allow` responses consistently.

`createServerFunctionRoutes()` converts compiler-generated function manifests
into the same route representation. During SSR, same-origin server-function
requests dispatch through this router in memory and inherit the active locals
and platform; browser calls use the generated transport facade.
