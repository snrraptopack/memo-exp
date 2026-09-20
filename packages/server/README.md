# @memoized-dom/server

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

app.route('GET', '/api/health', () => ({ ok: true }));
app.route('GET', '/api/stories/:id', ({ params }) => {
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
app.route('PATCH', '/api/stories/:id', requireUser, async (context) => {
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

## Renderers

Renderers accept a compiled root component and `RenderOptions`:

```ts
interface RenderOptions {
  mode?: 'shell' | 'resolve';
  timeout?: number;
  url?: string;
  fetch?: typeof globalThis.fetch;
  markers?: boolean;
  document?: DocumentLike;
}
```

- `renderToString()` renders a synchronous shell.
- `renderToStringAsync()` can await request-owned data in `resolve` mode.
- `renderToResult()` and `renderToResultAsync()` also return the payload and
  ready-to-embed payload script.
- `renderToReadableStream()` returns ordered application streaming.
- `renderWithDom()` and `renderWithDomAsync()` provide the LinkeDOM reference
  tier for parity tests and callers that need live nodes.

```ts
import { renderToResultAsync } from '@memoized-dom/server';

const result = await renderToResultAsync(App, {
  url: request.url,
  mode: 'resolve',
  markers: true,
});

result.html;
result.payload;
result.scriptTag;
```

`markers: true` preserves runtime anchors and emits the serialized data
payload used by `mount()` when it adopts server-rendered output.

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
