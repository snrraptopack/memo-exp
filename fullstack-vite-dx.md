# Memoized DOM fullstack DX

This document defines the intended fullstack application surface for
Memoized DOM. It replaces the earlier configuration-first proposal.

The central idea is simple:

- Vite declares the client and server module boundaries.
- `serve()` creates the application server and returns the object used to
  compose middleware, HTTP routes, and SSR.
- `mount()` is the only browser bootstrap API. It creates a new application
  or adopts server-rendered output automatically.
- Server functions remain ordinary functions in authored application code.
- Filesystem routes and middleware remain ordinary modules. They do not need
  generated per-file wrappers.

This is a target contract and a clean replacement of the current public
surface. `defineServer()`, `memoizedDomFullstack()`, and direct `hydrate()` are
removed rather than deprecated. Their lower-level router, rendering, and DOM
adoption machinery may be reused internally, but the old exports and
compatibility signatures do not remain public.

## 1. Design goals

The fullstack layer should feel like composing an application, not filling in
a framework configuration object.

The design should provide:

- one visible client/server boundary in Vite;
- one server composition root;
- one browser mounting operation;
- Web-standard `Request` and `Response` at the server boundary;
- plain middleware functions;
- plain server functions with colorless calls;
- literal-path inference for programmatic routes;
- compiler-aware parameter inference for filesystem routes;
- request-local state shared by pages, API routes, and server functions;
- reliable development replacement and error recovery.

The initial API should not expose deployment targets, route-delivery rule
tables, hydration switches, marker switches, document assembly, or separate
page builders. Those are implementation or adapter concerns.

## 2. Vite owns the environment boundary

Vite must know which graph is allowed to contain browser code, which graph is
allowed to contain server code, and which directory contains discoverable
server modules. That information belongs in the Vite plugin because it
affects module resolution and bundling.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';

export default defineConfig({
  plugins: [
    memoizedDom({
      clientEntry: 'src/entry.client.ts',
      serverEntry: 'src/entry.server.ts',
      server: 'src/server',
    }),
  ],
});
```

These options describe module ownership, not application behavior:

| Option | Meaning |
| --- | --- |
| `clientEntry` | Browser bootstrap and root of the client graph. |
| `serverEntry` | Server composition root and root of the server graph. |
| `server` | Server-only convention root for functions and file routes. |

Conventional defaults may allow `memoizedDom()` when those exact files are
present, but the resolved boundary must still be explicit internally. The
plugin must never infer server safety from an import happening not to execute
in the browser.

There is no `target` option in this application contract. Node, Bun, workers,
and other hosts consume the built Web handler through adapters. Selecting a
host must not change routes, middleware, SSR declarations, or server
functions.

There is also no `routeRules` option. Page behavior is composed by the server
application rather than split between application code and Vite config.

### Boundary enforcement

The plugin owns three related checks:

1. Modules beneath `server`, and modules reachable only from `serverEntry`,
   may use server capabilities.
2. The client graph may not import server implementations directly.
3. `#server-functions` resolves to a generated client facade in the client
   graph and to the real implementation or in-memory dispatch in the server
   graph.

Shared application modules can be compiled in both environments. A server
module accidentally entering the client graph is a build error with an import
trace, not a runtime failure or a silently included secret.

## 3. Project shape

```text
index.html
src/
  App.tsx
  entry.client.ts
  entry.server.ts
  server/
    config/
      index.ts
    functions/
      _middleware.ts
      stories.ts
    routes/
      _middleware.ts
      api/
        _middleware.ts
        health.ts
        stories/
          [id].ts
```

Only `entry.client.ts` and `entry.server.ts` are required by the fullstack
model. The contents of the server directory are discovered when present.

`server/config` is the application-wide server contract. It gives server code
one stable place for types and server-only application infrastructure without
turning `serve()` or Vite into a large configuration object.

The only conventionally interpreted export is `ServerTypes` from
`server/config/index.ts`:

```ts
// src/server/config/index.ts
export interface ServerTypes {
  locals: {
    requestId: string;
    user: User | undefined;
  };

  // Optional host bindings. Omit this when the host supplies none.
  platform?: CloudflareEnv;

  // Application-scoped runtime dependencies.
  services: ApplicationServices;
}
```

`locals` describes the mutable, request-owned object created by
`serve({ createLocals })`. `platform` describes host-provided bindings, such
as a worker environment, execution context, or deployment adapter values. It
does not select a deployment target. `services` describes application-scoped
runtime dependencies created once per `serve()` application instance.

The Vite integration discovers the config entry and registers `ServerTypes`
with the normal `@memoized-dom/server` package types. Application files then
use package imports without a relative import back to the config directory:

```ts
import type {
  ServerContext,
  ServerMiddleware,
} from '@memoized-dom/server';
```

With the registration present, `ServerContext['locals']`,
`ServerMiddleware`, `serve()`, and `getServerContext()` all use the configured
`locals` and `platform` types by default. No call-site generic is required.

```ts
// src/server/functions/update-profile.ts
import { getServerContext } from '@memoized-dom/server';

export function postUpdateProfile(input: ProfilePatch) {
  const { locals, platform, services } = getServerContext();

  locals.requestId; // string
  locals.user;      // User | undefined
  platform?.DB;     // typed from CloudflareEnv
  services.database; // typed application service

  return updateProfile(input, locals.user);
}
```

TypeScript cannot discover an application-local type through a package import
on its own. The integration therefore emits one project-wide declaration,
`.memoized/server-config.d.ts`, conceptually shaped like this:

```ts
import type { ServerTypes } from '../src/server/config/index.js';

declare module '@memoized-dom/server/router' {
  interface ServerTypeRegistry {
    application: ServerTypes;
  }
}
```

The generated bridge targets the module that owns `ServerTypeRegistry`;
application code still imports every public type and function from
`@memoized-dom/server`. This is one invisible application-wide bridge, not a
generated module that every route must import. It updates atomically when the
config contract changes.

The bridge is generated during project preparation, Vite startup, and builds;
the language service consumes the same contract. The project template includes
`.memoized/**/*.d.ts`, so ordinary `tsc --noEmit` sees it after preparation.
When `server/config/index.ts` is absent, the package falls back to empty locals
and an unknown platform. Multiple server config entries in one application
are an error rather than declaration-merging into an ambiguous contract.

If an editor was already open when the bridge was first created, the language
service must be notified of the new declaration. Project templates and the
Memoized DOM language service handle this; a manually configured TypeScript
project must include `.memoized/**/*.d.ts`. Seeing
`Record<string, never>` for `getServerContext().locals` means the bridge is not
part of that TypeScript project, not that the route should add a generic.

### What belongs in `server/config`

The folder may hold application-owned server infrastructure in ordinary
modules. For example:

```text
src/server/config/
  index.ts       # ServerTypes only: the framework-recognized contract
  env.ts         # read and validate environment values
  constants.ts   # server-only application constants
  auth.ts        # session/cookie names and authentication policy
  errors.ts      # application error types and response mapping
  services.ts    # typed service or repository construction
```

These are normal application modules and are imported through the server-root
alias instead of deep relative paths:

```ts
import { env } from '#server/config/env';
import { sessionCookie } from '#server/config/auth';
```

Vite resolves this alias from the plugin's `server` option and rejects it in
the client graph. Plain `tsc` also needs the equivalent project mapping; the
project template writes it from the same server root:

```json
{
  "compilerOptions": {
    "paths": {
      "#server/*": ["./src/server/*"],
      "#server-functions": ["./.memoized/server-functions.d.ts"]
    }
  },
  "include": ["src", ".memoized/**/*.d.ts"]
}
```

Useful responsibilities include:

- the `ServerTypes` locals and platform contract;
- typed environment parsing at the server boundary;
- server-only constants and feature policy;
- authentication/session policy shared by middleware and server functions;
- application error classes and error-to-response mapping;
- typed factories for databases, repositories, queues, caches, and mailers;
- host binding types and small helpers that adapt them to application APIs.

The folder is not a second composition root. Routes, middleware ordering, SSR
registration, and request handlers remain in `entry.server.ts` or their
conventional server modules. Secrets should be read at runtime in server-only
modules, not written into `ServerTypes`, and `index.ts` should preferably stay
type-only so registering the contract has no runtime side effects.

The three import surfaces remain deliberately different:

- `@memoized-dom/server` is the framework API, defaulted from the registered
  application types;
- `#server/*` is application-owned server code and is rejected from the client
  graph;
- `#server-functions` is the generated boundary-safe facade that preserves
  function parameters and colorless result types in both environments.

A browser module may use an erased `import type` from a server module, but it
may not import a runtime value from `#server/*`. Types, schemas, and DTOs that
are intentionally owned by both environments should normally live in a
neutral `src/contracts` or `src/shared` directory. Exposing a server operation
to browser code is explicit: export a verb-named function beneath
`server/functions` and import it from `#server-functions`. The framework never
turns arbitrary database or service exports into public client capabilities.

### Runtime services

Long-lived dependencies should not be put in request locals. Define their
type in `ServerTypes`, create them in an ordinary config module, and pass the
factory to `serve()`:

```ts
// src/server/config/services.ts
export interface ApplicationServices {
  database: Database;
  stories: StoryRepository;
  queue: JobQueue;
}

export async function createServices(): Promise<ApplicationServices> {
  const database = await connectDatabase(readDatabaseUrl());
  return {
    database,
    stories: createStoryRepository(database),
    queue: createJobQueue(),
  };
}
```

```ts
// src/entry.server.ts
import { serve } from '@memoized-dom/server';
import { createServices } from '#server/config/services';

const app = serve({ createServices });
```

`createServices` is lazy and runs once for an application instance, including
when multiple first requests arrive concurrently. Every middleware, route,
SSR request, nested in-memory server-function dispatch, and
`getServerContext()` call sees the same typed `context.services` object. A
fresh application evaluation during development creates a fresh service
scope. Request-specific identity, authorization results, and mutable scratch
state still belong in `context.locals`.

## 4. `serve()` is the server composition root

`serve()` performs the small amount of application-wide initialization that
must happen before routes are registered. It returns an application object
with methods for composition.

```ts
// src/entry.server.ts
import { serve } from '@memoized-dom/server';
import { App } from './App';

const app = serve({
  createServices,
  createLocals() {
    return {
      requestId: crypto.randomUUID(),
      user: undefined,
    };
  },

  onError(error, context) {
    console.error(context.request.method, context.url.pathname, error);
    return new Response('Internal Server Error', { status: 500 });
  },
});

app.use(logger, session);

app.get('/api/health', () => ({ ok: true }));

app.ssr(App);

export default app;
```

The returned application exposes a Web-standard request handler. Adapters and
the Vite development server dispatch through `app.fetch(request)`. The
default export is recognized as the application, so normal application code
does not need an extra handler wrapper.

The initial `serve()` options are intentionally limited to request-lifecycle
concerns:

```ts
interface ServeOptions {
  createServices?: () => RegisteredServices | Promise<RegisteredServices>;
  createLocals?: (request: Request) => RegisteredLocals;
  createPlatform?: (request: Request) => RegisteredPlatform | undefined;
  onError?: (
    error: unknown,
    context: ServerContext,
  ) => Response | Promise<Response>;
}
```

Rendering, routes, and middleware are methods because they compose behavior.
They are not nested fields in a large options object.

## 5. Middleware is just a function

Middleware uses the existing request/response shape:

```ts
type ServerMiddleware = (
  context: ServerContext,
  next: () => Promise<Response>,
) => Response | Promise<Response>;
```

It does not require `middleware()`, `provide()`, a class, or a registration
object.

```ts
// src/entry.server.ts
import type { ServerMiddleware } from '@memoized-dom/server';

const logger: ServerMiddleware = async (context, next) => {
  const started = performance.now();
  const response = await next();

  console.log({
    method: context.request.method,
    path: context.url.pathname,
    status: response.status,
    duration: performance.now() - started,
  });

  return response;
};

const session: ServerMiddleware = async (context, next) => {
  const token = context.request.headers.get('authorization');
  context.locals.user = token === null
    ? undefined
    : await readSession(token);
  return next();
};

app.use(logger, session);
```

`context` contains:

```ts
interface ServerContext {
  readonly request: Request;
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  readonly locals: RegisteredLocals;
  readonly platform: RegisteredPlatform | undefined;
  readonly services: RegisteredServices;
}
```

The context object is request-owned. `locals` is deliberately mutable and is
the one shared request state seen by downstream middleware, API handlers, SSR,
and server functions.

### Middleware scopes

There are four useful scopes without introducing four middleware APIs.

Global middleware applies to every request entering the application:

```ts
app.use(logger, session);
```

Path middleware applies to a subtree:

```ts
app.use('/api/*', apiLogger);
```

Route-local middleware is placed before the final handler:

```ts
app.patch(
  '/api/stories/:id',
  requireUser,
  updateStoryRoute,
);
```

Filesystem middleware is exported from `_middleware.ts` or from an endpoint
module:

```ts
// src/server/routes/api/_middleware.ts
import type { ServerMiddleware } from '@memoized-dom/server';
import { apiLogger, requireApiKey } from '../../middleware';

export const middleware = [
  apiLogger,
  requireApiKey,
] satisfies readonly ServerMiddleware[];
```

For a selected endpoint, middleware runs in this order:

1. global `app.use(...)` middleware;
2. matching path-scoped `app.use(path, ...)` middleware;
3. directory `_middleware.ts` files, shallowest first;
4. endpoint-module middleware;
5. route-local middleware;
6. the endpoint handler.

The response unwinds through the same stack in reverse. Calling `next()` more
than once is an error. Returning a response without calling `next()` stops the
chain.

### What middleware typing can and cannot promise

The registered `ServerTypes` contract gives all middleware and handlers one
consistent request-state type. It does not pretend that TypeScript can prove
an arbitrary runtime middleware executed before an independently compiled
file.

Fields populated by middleware should therefore be optional in the shared
`Locals` type unless `createLocals()` always initializes them. A protected
handler performs or calls a runtime assertion before using an optional value:

```ts
export function requireUser(context: ServerContext): User {
  if (context.locals.user === undefined) {
    throw new HttpError(401, 'Authentication required');
  }
  return context.locals.user;
}
```

This is more honest than a provider abstraction that claims cross-module
narrowing which the runtime cannot guarantee.

## 6. Programmatic HTTP routes

Small applications and application-level endpoints can be registered from the
server entry:

```ts
app.get('/api/health', () => ({ ok: true }));

app.get('/api/stories/:id', ({ params }) => {
  return readStory(params.id);
});

app.patch(
  '/api/stories/:id',
  requireUserMiddleware,
  async ({ params, request }) => {
    const input: unknown = await request.json();
    return updateStory(params.id, parseStoryPatch(input));
  },
);
```

The literal route pattern drives normal TypeScript inference. For
`/api/stories/:id`, `params` is `{ readonly id: string }`. Optional, repeated,
and catch-all segments must use the same grammar as the Memoized DOM router
and produce their corresponding parameter types.

The final function is the handler; preceding functions are middleware. Route
patterns and method/path collisions are validated when the application is
composed and again during the production build.

Handler results normalize consistently:

- `Response` is returned unchanged;
- `ReadableStream` becomes a streaming response;
- `string` becomes a text response;
- `undefined` becomes `204 No Content`;
- other serializable values become JSON responses.

Request input is not automatically trustworthy. `request.json()` is
`unknown` until application code validates or parses it. Compile-time types
must not claim to validate data received from the network.

## 7. Filesystem API routes

Larger route sets live beneath `server/routes`:

```text
src/server/routes/index.ts                 -> /
src/server/routes/api/health.ts            -> /api/health
src/server/routes/api/stories/[id].ts      -> /api/stories/:id
src/server/routes/files/[...path].ts       -> /files/*
```

A default export is an implicit GET handler:

```ts
// src/server/routes/api/health.ts
export default function health() {
  return { ok: true };
}
```

Uppercase named exports declare methods:

```ts
// src/server/routes/api/stories/[id].ts
import type { ServerContext } from '@memoized-dom/server';

export function GET(context: ServerContext) {
  return readStory(context.params.id);
}

export async function PATCH(context: ServerContext) {
  const user = requireUser(context);
  const input: unknown = await context.request.json();

  return updateStory(
    context.params.id,
    parseStoryPatch(input),
    user,
  );
}
```

An endpoint module may also export a middleware array:

```ts
export const middleware = [requireUserMiddleware];
```

A file cannot export both a default handler and a named `GET`. Duplicate
method/path registrations across programmatic routes and filesystem routes
are build errors; no source silently replaces another.

### No generated `+types` modules

Routes do not import `route` from `./+types/[id]`, and handlers do not need a
`route(...).handle(...)` wrapper. Those APIs repeat information already owned
by the filesystem and make every ordinary handler depend on generated
neighbor files.

There is a real TypeScript limitation: TypeScript alone cannot infer a
function parameter from the name of the file containing it. Memoized DOM
handles that limitation at the layer which does know the filename:

- the compiler derives the route pattern and exact parameter names;
- the language service supplies route-aware completion and diagnostics;
- the build rejects reads of parameters that do not exist for that file;
- the runtime still passes a plain `ServerContext` object.

An editor using only unextended `tsc` sees the base
`Readonly<Record<string, string>>` parameter type for a file route. Achieving
filename-specific inference in plain `tsc` would require either repeating the
path in source or importing a generated per-file type. This design chooses the
compiler/language-service behavior and keeps authored route modules plain.

Programmatic `app.get()`, `app.post()`, and other verb methods do not have this
limitation because their route pattern is a literal in the same TypeScript
expression.

## 8. Server functions stay colorless

Server functions are named exports beneath `server/functions`. They are
ordinary functions, not values created by a `serverFunction()` wrapper.

```ts
// src/server/functions/stories.ts
import { getServerContext } from '@memoized-dom/server';

export async function getStory(id: number) {
  return database.stories.find(id);
}

export async function patchStory(
  id: number,
  patch: StoryPatch,
) {
  const { locals } = getServerContext();
  const user = locals.user;
  if (user === undefined) {
    throw new HttpError(401, 'Authentication required');
  }
  return database.stories.update(id, patch, user.id);
}
```

The implementation may perform asynchronous work. Application code still
calls it as a plain colorless function:

```ts
import {
  getStory,
  patchStory,
} from '#server-functions';

const story = getStory(42);

patchStory(42, {
  title: 'New title',
});
```

There is no authored `await` at the application call site. The generated
facade preserves the implementation parameters and exposes its result as a
`ResolvedValue`:

```ts
declare function getStory(
  ...args: Parameters<typeof implementation.getStory>
): ResolvedValue<Awaited<ReturnType<typeof implementation.getStory>>>;
```

Consequently these remain TypeScript errors:

```ts
getStory('42');
patchStory(42, { unknown: true });
```

`Awaited` in the declaration only extracts the implementation's result type.
It does not require application code to await the call.

The current verb convention can continue to select transport semantics:

- read-prefixed functions such as `get*` use the read path;
- mutation-prefixed functions such as `post*`, `put*`, `patch*`, and
  `delete*` use mutation paths;
- the compiler rejects unsupported exports and non-transportable arguments.

Server-function middleware uses the same plain middleware contract as every
other request:

```ts
// src/server/functions/_middleware.ts
import type { ServerMiddleware } from '@memoized-dom/server';
import { auditServerFunction } from '../middleware';

export const middleware = [
  auditServerFunction,
] satisfies readonly ServerMiddleware[];
```

Composition is global middleware, matching path middleware, ancestor function
middleware, module middleware, then the function implementation. During SSR,
server-function calls dispatch in memory through the same request context.
In the browser they use the generated transport facade. Both paths share
locals, error normalization, and authorization behavior.

`#server-functions` is justified because it protects the server boundary and
changes the implementation into a colorless client call. That is different
from generating a wrapper import for every filesystem route, which would add
no boundary or runtime capability.

## 9. SSR is an application capability

SSR is selected from the server composition root:

```ts
app.ssr(App);
```

This makes `App` the SSR fallback for application page requests. API routes
and server functions are matched first and never fall through to the page
renderer.

An application can restrict SSR to a path:

```ts
app.ssr('/reports/*', App);
```

It can register distinct page roots when that is genuinely useful:

```ts
app.ssr('/admin/*', AdminApp);
app.ssr('/reports/*', ReportsApp);
```

SSR path matching is deterministic and independent of registration order:
static paths are more specific than parameters, parameters are more specific
than wildcards, and ambiguous registrations are errors. A path-specific SSR
registration wins over an unscoped `app.ssr(App)` fallback.

This API does not create a second page router. Components continue to use the
Memoized DOM router. The path on `app.ssr(path, App)` only decides whether and
which application root the server renders for the incoming document request.

The first public surface has one SSR behavior. It does not expose
`pages.resolve()`, `pages.shell()`, Vite `routeRules`, marker flags, or stream
assembly. Colorless-data settling, payload serialization, structural markers,
and streaming are coordinated by the renderer. Additional policy should only
become public after a concrete application-level need cannot be represented by
data boundaries.

For a request that matches neither an HTTP endpoint nor an SSR registration,
the Vite integration serves the transformed SPA document when a client entry
exists. A server-only deployment returns 404.

## 10. One browser API: `mount()`

Client code always mounts the application in the same way:

```ts
// src/entry.client.ts
import { mount } from '@memoized-dom/runtime';
import { App } from './App';

mount('root', App);
```

There is no application-facing `hydrate()` choice. `mount()` inspects the
target for a compatible Memoized DOM root marker and payload:

- when no server root is present, it creates the application;
- when a compatible server root is present, it adopts that DOM and restores
  its colorless-data payload;
- when adoption detects a mismatch, it disposes partial adoption state,
  clears only that application's owned range, and mounts once from scratch.

Recovery must never leave both the old server tree and a newly mounted tree
in the host. In development it reports the authored mismatch and recovery
path. In production it recovers without exposing compiler internals.

The runtime owns data-runtime initialization and payload restoration before
the compiled root begins reading colorless values. An application should not
need a different bootstrap sequence merely because SSR was enabled on the
server.

## 11. Request routing and ownership

The request pipeline has one unambiguous precedence:

1. Vite or the production asset server handles framework and static assets.
2. Server-function endpoints match their reserved namespace.
3. Programmatic and filesystem HTTP routes are matched.
4. A matching SSR registration renders a page.
5. The client document fallback or a 404 handles the remaining request.

Every stage after asset handling uses the same application request context
and global middleware. Internal SSR dispatch of a server function reuses the
current request's locals and platform instead of creating a second unrelated
request context.

The default export remains portable:

```ts
const response = await app.fetch(request);
```

Node, Bun, workers, tests, and Vite adapters translate their host request into
a Web `Request` and consume the Web `Response`. Host integration does not
leak into application composition.

## 12. Type-safety contract

The design aims for strong types where the information truly exists and
explicit runtime validation where it does not.

### Guaranteed by TypeScript

- `server/config` registers locals and platform types once for the whole
  application;
- `serve()`, `ServerContext`, `ServerMiddleware`, and `getServerContext()` use
  that registered contract through normal `@memoized-dom/server` imports;
- literal `app.get()`, `app.post()`, and other verb-method paths infer their
  parameter object;
- middleware and handler context types agree;
- server-function calls preserve exact parameter and return types;
- `#server-functions` exposes colorless `ResolvedValue<T>` results;
- wrong methods, malformed route literals, and incompatible handlers fail
  during type checking where they can be represented statically.

### Guaranteed by the Memoized DOM compiler and language service

- filesystem path segments determine available route parameters;
- server-only implementations cannot enter the client graph;
- method/path collisions are reported across all route sources;
- invalid file-route exports are reported at their authored locations;
- server-function exports and transportable arguments are validated;
- middleware files are attached only to their intended descendants.

### Guaranteed only at runtime

- authentication and authorization;
- the shape of request bodies, headers, cookies, and external responses;
- middleware actually calling `next()`;
- failures from databases, networks, and user code.

The framework should not add a validation dependency. Applications may use
manual parsers or their chosen Standard Schema-compatible library. Memoized
DOM can preserve the inferred output type once a validator is supplied, but
it must not pretend an unvalidated value is safe.

## 13. Development behavior with Vite

The fullstack Vite integration is one plugin and one development process. It
owns the browser environment, server environment, generated server-function
facade, route discovery, and document transforms.

Client edits must follow these rules:

- a successful compatible edit replaces the existing compiled definition;
- text-only edits invalidate the affected entity and update the mounted DOM;
- a replacement never mounts a second application beside the first;
- an incompatible edit remounts exactly once after disposing the old root;
- a transform error keeps the last successful module active and shows the
  Vite error overlay;
- the next successful edit clears the error and retries replacement without a
  page reload when Vite can safely do so.

Server edits must follow these rules:

- the server environment invalidates the edited module and its affected
  composition graph;
- re-evaluating `entry.server.ts` creates a fresh `serve()` application, so
  routes and middleware are not appended to an old instance;
- route and server-function manifests update atomically;
- a failed server evaluation affects the current request but does not kill
  the development server;
- after a fixing edit, the next request uses the new application without a
  manual restart.

Generated declarations and manifests are written only when their content
changes. Failed generation must not replace a valid artifact with a partial
file.

## 14. Production build

`vite build` builds the client environment and, when `serverEntry` is present,
the server environment. The plugin coordinates their manifests so the server
uses the built client document and asset URLs.

The application does not select a deployment target in `memoizedDom()` or
`serve()`. The result is a client artifact plus a portable Web handler.
Adapters may package those artifacts for a host, but they do not redefine
application routes, middleware, SSR, or server functions.

The production server must not read the source `index.html`. It consumes the
document after Vite HTML transforms and uses the client manifest for emitted
assets. Development and production therefore share document ownership rather
than maintaining separate hand-authored templates.

## 15. Implementation sequence

The public API changes as a clean break. The implementation can still retain
and refactor the working router, renderer, and server-function pipeline where
they already satisfy the new contract.

1. Add the open `ServerTypeRegistry` to `@memoized-dom/server` and generate the
   single application registration from `server/config/index.ts`.
2. Implement `serve()` as a composition facade over the current server
   router and rendering machinery.
3. Let `app.use()`, the HTTP verb methods, and `app.ssr()` produce the internal
   route, middleware, and fallback definitions already consumed by the router.
4. Merge the current compiler plugin and fullstack development plugin behind
   `memoizedDom({ clientEntry, serverEntry, server })`, then remove the
   `memoizedDomFullstack()` export.
5. Teach `mount()` to select creation or adoption, keep any hydration
   implementation as a private runtime detail, and remove the public
   `hydrate()` export.
6. Add filesystem API-route discovery using the same manifest mechanism that
   already discovers server functions.
7. Add compiler and language-service diagnostics for filename-derived route
   parameters without generating per-route imports.
8. Remove `defineServer()` and its public option types after `serve()` covers
   the required behavior. Delete old examples, tests, documentation, and
   compatibility shims in the same change.

There is no deprecation period or legacy mode. Once a replacement is complete,
the previous public API stops exporting. Tests and examples must exercise only
the new contract so unused paths cannot survive accidentally.

The migration should preserve the parts that are already correct:

- the Web `Request`/`Response` router;
- request-local `locals` and platform state;
- ordered middleware with guarded `next()`;
- generated `#server-functions` declarations;
- colorless `ResolvedValue<T>` calls;
- in-memory server-function dispatch during SSR;
- Vite-owned transformation and asset handling.

The purpose of the redesign is not to replace those foundations. It is to
make them feel like one coherent application model instead of several layers
of configuration.
