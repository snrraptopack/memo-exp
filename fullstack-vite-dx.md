# Memoized DOM fullstack application contract

This document defines the final developer experience for Memoized DOM
applications built with Vite. Where the current implementation differs, the
implementation must move toward this contract.

The application model supports two page-delivery forms:

- SPA: the browser mounts the application.
- SSR: the server renders the application and the browser hydrates it.

SSR supports two colorless-data modes:

- `resolve`: wait for request-owned data before completing the page.
- `shell`: send the immediate pending UI and continue data work in the
  browser.

There are no additional application-facing page-delivery profiles, hydration
switches, marker switches, or delivery switches. SSR always hydrates. SPA
never hydrates server-rendered application HTML because none is produced.

## 1. Runtime boundary

Memoized DOM has one application model with two optional environments:

```text
client environment -> browser application
server environment -> Web-standard application handler
```

The server entry always exports this portable contract:

```ts
(request: Request) => Response | Promise<Response>
```

Node, Bun, worker runtimes, serverless platforms, and custom backends consume
the same handler. Changing the host does not change application components,
routes, middleware, server functions, or `$fetch` calls.

## 2. One Vite plugin

Memoized DOM exposes one Vite plugin for development, builds, and preview:

```ts
import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';

export default defineConfig({
  plugins: [memoizedDom()],
});
```

The plugin configures `appType`, compiler environments, HMR, server-module
discovery, development dispatch, production output, and production preview.
Applications never add `memoizedDomFullstack()`.

## 3. Project convention

```text
index.html
src/
  entry.client.ts
  entry.server.ts
  App.tsx
  server/
    functions/
    routes/
```

The options are:

| Option | Default | Responsibility |
| :--- | :--- | :--- |
| `clientEntry` | The single module script in `index.html`, otherwise `src/entry.client.ts` | Browser bootstrap. |
| `serverEntry` | `src/entry.server.ts` when present | Server composition root and Web handler. |
| `server` | `src/server` | Convention root for server functions and file API routes. |
| `target` | `'node'` when a server entry exists | Production server build target. |
| `routeRules` | `{}` | Per-route SSR mode overrides. |

Projects can override the paths:

```ts
export default defineConfig({
  plugins: [
    memoizedDom({
      clientEntry: 'src/entry.client.ts',
      serverEntry: 'src/entry.server.ts',
      server: 'src/server',
      target: 'node',
      routeRules: {
        '/reports': { mode: 'shell' },
        '/dashboard/*': { mode: 'shell' },
      },
    }),
  ],
});
```

`routeRules` keys come from the compiler-generated route graph. Omitted routes
use `resolve`. A parent rule is inherited by nested routes; a nested rule can
override it with its own mode.

If `index.html` contains multiple application module scripts, `clientEntry` is
required. The plugin never guesses between multiple entries.

`serverEntry` and `server` are intentionally different. `serverEntry` executes
the application server. `server` is a directory inspected for generated
server modules.

## 4. SPA applications

A project without `serverEntry` is a pure SPA. Its client entry mounts the
compiled application:

```ts
import { mount } from '@memoized-dom/runtime';
import { App } from './App';

mount('root', App);
```

Vite builds only the client environment and produces browser assets.

A project can also use SPA page delivery while retaining a server for APIs and
server functions. Its `serverEntry` exports `defineServer()` without `app`:

```ts
export default defineServer({
  middleware: [logger, session],
  routes: {
    '/api/health': () => ({ ok: true }),
  },
});
```

The adapter serves the Vite document as the page fallback. API routes and
server functions still enter the Web handler. The client entry continues to
use `mount()`.

SPA delivery is selected once for the application. It is not repeated in
`routeRules`.

## 5. SSR applications

An SSR server entry passes the compiled application to `defineServer`:

```ts
// src/entry.server.ts
import { defineServer } from '@memoized-dom/server';
import type { ServerMiddleware } from '@memoized-dom/server/router';
import { App } from './App';

interface Locals {
  requestId: string;
  user?: string;
}

const logger: ServerMiddleware<Locals> = async (context, next) => {
  const response = await next();
  console.log(
    context.request.method,
    context.url.pathname,
    response.status,
  );
  return response;
};

const session: ServerMiddleware<Locals> = (context, next) => {
  context.locals.user = context.request.headers.get('x-user') ?? undefined;
  return next();
};

export default defineServer<Locals>({
  app: App,
  middleware: [logger, session],
  createLocals: () => ({ requestId: crypto.randomUUID() }),
  routes: {
    '/api/health': () => ({ ok: true }),
    '/api/stories/:id': {
      GET: ({ params }) => ({ id: params.id }),
      POST: ({ params }) => ({ updated: params.id }),
    },
  },
});
```

No render block is required. SSR defaults to `resolve`.

The client entry hydrates the server document:

```ts
import { hydrate } from '@memoized-dom/runtime/hydrate';
import { createDataRuntime, setActiveDataRuntime } from '@memoized-dom/data';
import { App } from './App';

setActiveDataRuntime(createDataRuntime());

hydrate('root', App, {
  recover: true,
  onRecover(error) {
    console.error('[HYDRATION-MISMATCH]', error.message);
  },
});
```

SSR always emits the structural markers and serialized colorless-data payload
needed by `hydrate()`. These are runtime transport details, not application
configuration.

### SSR mode

The complete application can select shell mode in `defineServer`:

```ts
export default defineServer({
  app: App,
  render: {
    mode: 'shell',
  },
});
```

Specific routes can override the application default in the Vite config:

```ts
memoizedDom({
  routeRules: {
    '/reports': { mode: 'shell' },
    '/reports/:reportId': { mode: 'resolve' },
  },
});
```

The only route rule is:

```ts
interface RouteRule {
  mode: 'shell' | 'resolve';
}
```

`resolve` waits for request-owned colorless sources to settle. It uses the
server timeout owned by the runtime. `shell` returns the pending tree
immediately and hydration continues its colorless work in the browser.

Streaming, buffering, markers, payload encoding, and document assembly remain
runtime and adapter mechanics. They are not route configuration.

### Coordinated route transitions

Routing, route code, and colorless data share one compiler-owned transition.
Applications do not declare a second loader graph beside `$fetch` or generated
server functions.

The route manifest records the component module for each route and the
colorless sources discovered beneath that route. On client navigation the
runtime starts the target route transition, loads its client chunk when it is
not already present, and starts its discovered data work with the navigation's
abort signal.

The route's existing mode defines when the visible branch changes:

- `resolve` keeps the current route visible until the target chunk and its
  request-owned initial data settle, then commits the route once;
- `shell` commits the target route as soon as its chunk is available, while
  the target's nearest `Group` policies present pending and failed data at the
  exact consumption sites.

Superseding navigation aborts only the obsolete transition. Shared requests
whose identities are still consumed by the new route remain alive. A rejected
transition never leaves a partially mounted target branch or changes the
current URL without a corresponding rendered route.

SSR uses the same route manifest and mode. It does not maintain separate
server loaders, duplicate source declarations, or a second cache identity.
The production client manifest maps route modules to chunks and preload
dependencies, so navigation never downloads unrelated route code.

## 6. Server entry responsibilities

`serverEntry` is the composition root for application-wide server behavior:

- `app` selects SSR page delivery; omitting it selects SPA page delivery.
- `middleware` runs globally for pages, manual APIs, file APIs, and server
  functions.
- `routes` contains manual HTTP routes and prefix middleware groups.
- `render.mode` selects the default SSR data mode.
- `createLocals`, `createPlatform`, `fetch`, and `onError` configure the common
  request lifecycle.

Vite configuration never accepts middleware or route handlers. Vite locates,
compiles, and packages code; `defineServer` composes its server behavior.

## 7. Server directory

The `server` option identifies the convention root:

```text
src/server/
  functions/
    _middleware.ts
    stories.ts
  routes/
    _middleware.ts
    api/
      health.ts
      stories/
        [id].ts
```

### Server functions

Files under `server/functions` expose named server functions. Names and
arguments lower to HTTP endpoints under `/_fn/*`. Client imports use the
generated `#server-functions` facade; implementations never enter the client
bundle.

Middleware composition is:

1. `defineServer.middleware`;
2. ancestor `functions/_middleware.ts` files from shallow to deep;
3. module-level `middleware`;
4. the server-function handler.

Server functions use the same `$fetch` resources and `$track` lifecycle as
ordinary requests. They do not introduce a separate RPC state system.

### File API routes

Files under `server/routes` map their path to an HTTP pathname:

```text
src/server/routes/api/health.ts          -> /api/health
src/server/routes/api/stories/[id].ts    -> /api/stories/:id
src/server/routes/index.ts               -> /
src/server/routes/files/[...path].ts     -> /files/*
```

A default export is an implicit GET handler:

```ts
// src/server/routes/api/health.ts
export default function health() {
  return { ok: true };
}
```

Named uppercase exports define explicit methods:

```ts
// src/server/routes/api/stories/[id].ts
export function GET({ params }: ServerContext) {
  return readStory(params.id);
}

export function PATCH({ params, request }: ServerContext) {
  return updateStory(params.id, request);
}
```

A file cannot combine a default handler with a named `GET`. A module can
export `middleware` for its handlers. A directory `_middleware.ts` exports
middleware for descendant route files.

Manual routes, file routes, and server functions enter the same portable
router. Duplicate method-and-path registrations are build errors. No source
silently overrides another.

## 8. Generated route declarations

The compiler already knows every route pattern, parent relationship, source
module, and parameter segment. The Vite integration writes this graph to
`.memoized/routes.d.ts` alongside
`.memoized/server-functions.d.ts`.

For routes `/`, `/docs/:slug`, and `/story/:storyId`, the generated file has
this shape:

```ts
// .memoized/routes.d.ts
export {};

declare module '@memoized-dom/vite' {
  interface MemoizedDomRouteMap {
    '/': { params: Record<string, never> };
    '/docs/:slug': { params: { slug: string } };
    '/story/:storyId': { params: { storyId: string } };
  }
}

declare module '#routes' {
  export type RoutePattern =
    keyof import('@memoized-dom/vite').MemoizedDomRouteMap;

  export type RouteParams<Path extends RoutePattern> =
    import('@memoized-dom/vite').MemoizedDomRouteMap[Path]['params'];
}

declare global {
  namespace JSX {
    interface RouteRegistry {
      '/': { params: Record<string, never> };
      '/docs/:slug': { params: { slug: string } };
      '/story/:storyId': { params: { storyId: string } };
    }
  }
}
```

`@memoized-dom/vite` exports the empty merge target
`MemoizedDomRouteMap`. `routeRules` derives its keys from this interface. The
compiler JSX types derive `route` and `route-to` from `JSX.RouteRegistry`.

The declarations provide:

- completion and stale-key errors in `routeRules`;
- completion for `route` patterns;
- parameterless destination completion for string `route-to`;
- exact `path` and `params` typing for object-form `route-to`;
- `RoutePattern` and `RouteParams<Path>` type-only imports from `#routes`.

The language service also reads the owning route ancestry at each component
site. Inside a component mounted beneath `/story/:storyId`, it completes
`route.params.storyId` and reports parameter reads that do not exist on that
route. Runtime `route.params` remains a plain immutable object; contextual
typing does not require a new route object or a stringly accessor API.

The project template includes `.memoized/**/*.d.ts` and maps `#routes` and
`#server-functions`. Applications never edit generated files.

Route declarations regenerate atomically during startup, build, and route
graph HMR. The language service consumes the same route manifest for precise
diagnostics while TypeScript reloads the declaration file.

Only declarations and build metadata live in `.memoized`; routing does not
read this directory at runtime.

## 9. Document ownership

Vite owns the application document in a Vite application.

For SPA delivery, Vite serves its transformed document and the client entry
mounts the application.

For SSR delivery, the Memoized DOM plugin runs Vite's HTML transforms and
provides the transformed document to the server handler. The handler renders
the application into its outlet. This preserves the Vite client, HMR, other
HTML plugin transforms, and development asset URLs.

During production, the client environment builds first. The server environment
receives the built document and client manifest through generated virtual
modules. The server never loads the source `index.html` and never emits stale
source asset paths.

`defineServer` receives an adapter-installed document provider through a
handler-local internal hook. The Vite development integration and generated
production server entry install it before handling requests. No process-global
document state is used.

A Vite SSR entry therefore omits `document`:

```ts
export default defineServer({
  app: App,
  middleware,
  routes,
});
```

Direct non-Vite users continue to provide `document` or `documentTemplate`.
API-only and SPA-backend handlers do not require an SSR document provider.

## 10. Development behavior

`vite` starts the complete application:

- the client graph runs in the browser environment;
- the server graph runs in Vite's server environment when present;
- Vite owns module transformation, CSS, browser assets, and HMR;
- generated server-function and file-route manifests install automatically;
- remaining HTTP requests enter the server Web handler;
- SPA page fallback remains under Vite document handling;
- SSR page fallback renders through `defineServer`;
- route graph changes regenerate route declarations;
- compiler errors retain authored file, line, column, and source frame;
- compiler diagnostics appear through the project language service while the
  developer types, not only after Vite transforms the module;
- development-only inspection events expose route transitions, colorless
  request identities, and entity dirty causes without entering production
  bundles.

Development uses Vite's environment runner rather than making
`ssrLoadModule()` the application architecture. Server edits invalidate the
server environment and do not require restarting the development process.

Every page render is request-contained. A component or data error before HTTP
bytes are committed enters `defineServer.onError` and produces its returned
response. An error after a streaming response has committed terminates only
that response, reports the authored stack through Vite, disposes all
request-owned route/data/render state, and leaves the development server able
to serve the next request. Vite never exits because one application render
failed.

## 11. Production build

`vite build` builds the complete Memoized DOM application. The plugin
configures Vite's application builder internally; users do not run separate
client and SSR build commands.

For an SPA, the result contains only `dist/client`.

For a fullstack SPA or SSR application, the build order is:

1. Compile the connected route and server-module manifests.
2. Generate route and server-function declarations.
3. Build the client environment and asset manifest.
4. Build the server environment against the built document and client
   manifest.
5. Let the selected target package the Web handler and client assets.
6. Write the Memoized DOM deployment manifest.

The default Node output is:

```text
dist/
  client/
    index.html
    assets/
  server/
    entry.js
  memoized-dom.json
```

`dist/server/entry.js` exports the application Web handler as its default
export. It is importable without Vite and contains no development runtime.

The deployment manifest contains deployment facts without duplicating Vite's
asset manifest:

```ts
interface MemoizedDomBuildManifest {
  version: 1;
  kind: 'spa' | 'fullstack-spa' | 'ssr';
  target: 'node' | 'bun' | 'worker';
  clientDirectory: string;
  clientDocument: string;
  serverEntry?: string;
  serverFunctionCount: number;
  fileRouteCount: number;
}
```

The build summary is:

```text
memoized-dom build
  client           dist/client
  server           dist/server/entry.js
  target           node
  server-functions 6
  api-routes       4
```

## 12. Production preview

`vite preview` runs the built application locally through the selected
adapter. It serves `dist/client`, imports `dist/server/entry.js` when present,
and uses the same request precedence as deployment.

Preview never falls back to Vite development transforms or
`ssrLoadModule()`. It is a production-artifact verification tool, not the
recommended public production server.

## 13. Adapter contract

Adapters own platform integration, not application semantics.

An adapter provides:

- Vite environment conditions and build target;
- packaging of the server Web handler;
- host request/response conversion;
- stream backpressure and abort propagation;
- safe browser-asset and public-file serving;
- the production-preview launcher;
- deployment metadata required by its platform.

An adapter never redefines routing, middleware, server functions, `$fetch`, or
SSR modes.

### Node

Node is the first and default fullstack target. Its adapter converts Node HTTP
to Web `Request` and `Response`, preserves streaming behavior, serves built
browser assets, and exposes the handler for custom servers:

```ts
import { createServer } from 'node:http';
import app from './dist/server/entry.js';
import { createNodeHandler } from '@memoized-dom/adapters/node';

createServer(createNodeHandler(app)).listen(3000);
```

A reverse proxy or CDN can serve `dist/client` and forward the remaining
requests to the same handler.

### Bun

Bun consumes the Web handler directly and packages the same client artifacts
and manifest for `Bun.serve`.

### Worker runtimes

The worker target emits a filesystem-free server bundle. Documents and route
manifests are embedded build artifacts. Node built-ins are rejected during
compilation.

### Custom backends

A custom backend imports `dist/server/entry.js` and mounts its Web handler in
its own lifecycle. The official launcher is never required.

## 14. Request flow

The deployment adapter handles requests in this order:

1. fingerprinted client assets;
2. public files;
3. application Web handler;
4. SPA document fallback when `defineServer` has no `app`.

The Web handler dispatches:

1. `defineServer.middleware`;
2. matching manual prefix middleware;
3. file-route or server-function directory middleware;
4. module and method middleware;
5. the matched HTTP handler;
6. SSR page rendering when no HTTP route matches and `app` is configured.

Generated endpoint names are routing identities, not authorization. Global,
directory, module, route, and method middleware can authenticate a request and
populate typed request locals. A server function or API route performs its
authorization decision from those locals before protected work. Mutating
cookie-authenticated endpoints apply the application's origin and CSRF policy;
all external input is validated before reaching domain code. Production
documentation includes these conventions and does not present a custom header
as a complete security example.

## 15. Diagnostics

The application fails early when:

- a configured entry or server directory does not exist;
- the HTML document contains ambiguous client entries;
- a server implementation enters the client graph;
- a server entry does not export a Web handler;
- a file route exports conflicting handlers;
- manual and discovered routes collide by method and path;
- client and server builds discover different server-function manifests;
- `routeRules` names a route absent from the compiler graph;
- an SSR mode is not `shell` or `resolve`;
- a Vite SSR handler has no installed transformed document;
- a server build references an untransformed source document;
- an adapter target imports unsupported platform modules;
- client and server outputs overwrite the same artifact.

Every diagnostic includes the responsible config field or authored file,
line, column, and source frame whenever source location exists.

## 16. Production validation

The production contract is tested with package-owned temporary fixtures.
Tests never depend on examples.

The Node integration suite:

1. Creates SPA, fullstack-SPA, and SSR fixtures.
2. Builds them with `vite build`.
3. Inspects client output for server-only imports and secrets.
4. Inspects server entries and deployment manifests.
5. Imports the emitted server handler without Vite.
6. Starts a real `node:http` process through the Node adapter.
7. Opens the built application in a real browser.
8. Verifies SPA mounting.
9. Verifies resolved SSR before hydration.
10. Verifies shell SSR and browser continuation.
11. Hydrates and updates reactive state.
12. Navigates parameterized and nested routes without document navigation.
13. Executes GET and POST server functions over real HTTP.
14. Exercises manual and file API routes.
15. Verifies middleware order, locals, errors, and method handling.
16. Verifies rapid overlapping mutations and request identity behavior.
17. Asserts that the browser loads built hashed assets only.
18. Asserts zero hydration mismatches, page errors, unhandled rejections,
    canceled successful operations, Vite development imports, and source URLs.
19. Throws during initial and settled SSR rendering, verifies the configured
    error response when headers are uncommitted, and verifies that the same
    process serves a healthy request afterward.
20. Navigates rapidly across lazy `resolve` and `shell` routes, verifies stale
    transitions are aborted without duplicate requests, and verifies that
    unrelated route chunks are not downloaded.
21. Exercises authenticated and rejected server functions through the same
    middleware and request-local contract used in deployment.

The rendering matrix is:

| Application | Mode | Assertion |
| :--- | :--- | :--- |
| SPA | Not applicable | Browser mounts into the Vite document. |
| Fullstack SPA | Not applicable | APIs use the server handler and pages mount in the browser. |
| SSR | Resolve | Server returns settled UI and hydration payload. |
| SSR | Shell | Server returns pending UI and the browser continues colorless work. |

After Node passes, the same behavior runs on Bun. The worker suite verifies a
filesystem-free bundle and runtime-specific conditions.

## 17. Implementation sequence

### Phase 1: application configuration

- Rename `entries` to `clientEntry`.
- Add `serverEntry`, `server`, `target`, and typed `routeRules`.
- Fold fullstack development into `memoizedDom()`.
- Remove `memoizedDomFullstack()` before the next public release.
- Detect SPA, fullstack SPA, and SSR from the server entry contract.

### Phase 2: route declarations and server discovery

- Expose linked compiler route metadata to the Vite layer.
- Generate `.memoized/routes.d.ts` and refresh it atomically.
- Type `routeRules`, `route`, `route-to`, and `#routes` from one route map.
- Feed route ancestry to the language service for contextual `route.params`
  completion and diagnostics.
- Resolve server functions from `${server}/functions`.
- Generate file API routes from `${server}/routes`.
- Compose directory and module middleware.
- Merge generated routes with manual `defineServer.routes`.
- reject route and method collisions.

### Phase 3: document and SSR mode

- Keep markers and payload encoding internal to SSR hydration.
- Validate and inherit `shell` or `resolve` route rules.
- Isolate pre-commit and post-commit render failures per request.
- Keep Vite alive after streamed render failures and retain authored stacks.
- Install Vite-transformed documents through the handler-local adapter hook.
- Preserve `document` and `documentTemplate` for non-Vite use.

### Phase 4: Node production build

- Configure Vite's client and server application environments.
- Build the client before the server.
- Emit the importable Node Web handler and deployment manifest.
- Run the artifacts through `vite preview` and the Node adapter.
- Pass the complete Node production browser suite.

### Phase 5: coordinated route loading

- Emit route-module and colorless-source transition metadata from the linked
  compiler graph.
- Split route component modules through the client manifest without a second
  application-facing loader API.
- Apply `resolve` and `shell` consistently to SSR and client navigation.
- Abort superseded transitions without canceling still-consumed requests.
- Expose route transition and request-identity inspection in development.

### Phase 6: portability

- Run the production contract on Bun.
- Emit and test a filesystem-free worker bundle.
- Verify a custom backend consuming only the Web handler and manifest.

### Phase 7: performance and polish

- Measure client assets, route chunks, server bundle size, startup time, and
  first-response latency from production artifacts.
- Generate preload directives from the client manifest and rendered route
  modules.
- Keep route navigation from loading unrelated client chunks.
- Document SPA-to-SSR migration as adding `app: App` to the server entry and
  replacing `mount()` with `hydrate()` in the client entry.

## 18. Resulting developer experience

The workflow is:

```text
vite          -> client/server development with HMR
vite build    -> client assets, optional server handler, deployment manifest
vite preview  -> real built artifacts through the selected adapter
```

Application authors use:

- component-local and nested `route` declarations;
- typed `routeRules` only for SSR routes that use non-default data readiness;
- `$fetch` and generated `#server-functions` imports for unified data access;
- `defineServer` for global middleware, manual APIs, SSR selection, and
  request context;
- `server/functions` for named server functions;
- `server/routes` for filesystem API routes;
- one Vite plugin for development, build, and preview;
- one portable Web handler for every deployment target.

The application does not maintain separate development and production
architectures.
