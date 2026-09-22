# @memoized-dom/vite

Vite 8 integration for compiler-linked Memoized DOM applications. One plugin
owns the client compiler graph and, when configured, the server boundary,
server-function facade, SSR document, and development request dispatch.

```ts
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

There is no separate fullstack plugin. `serverEntry` tells Vite where the
server graph begins, and `server` identifies the application-owned server
root used for conventions and boundary checks. A client-only application only
needs `clientEntry`.

```ts
memoizedDom({ clientEntry: 'src/main.ts' });
```

The client entry contains the application `mount()` call. The server entry
default-exports the application returned by `serve()`:

```ts
import { serve } from '@memoized-dom/server';
import { App } from './App';

const app = serve({
  createLocals: () => ({ requestId: crypto.randomUUID() }),
});

app.get('/api/health', () => ({ ok: true }));
app.ssr(App);

export default app;
```

## Server config contract

When present, `<server>/config/index.ts` exports the application-wide server
types:

```ts
export interface ServerTypes {
  locals: {
    requestId: string;
    user?: User;
  };
  platform?: PlatformBindings;
  services: ApplicationServices;
}
```

The plugin generates `.memoized/server-config.d.ts`. That declaration merges
the application contract into the server type registry, so normal imports
from `@memoized-dom/server` automatically carry these types:

```ts
import {
  getServerContext,
  type ServerMiddleware,
} from '@memoized-dom/server';

const session: ServerMiddleware = async (context, next) => {
  context.locals.user = await readSession(context.request);
  return next();
};

export function getCurrentUser() {
  const context = getServerContext();
  return context.services.users.find(context.locals.user);
}
```

No call-site generic or relative import from `config` is needed. TypeScript
projects must include `.memoized/**/*.d.ts`; generated project templates do
this automatically. If an editor shows `Record<string, never>` for `locals`,
the generated declaration is not loaded by that TypeScript project.

Plain TypeScript resolution also needs the server alias mapping (Vite handles
the runtime/build side):

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

Only `ServerTypes` has framework meaning. Other files beneath
`server/config` are ordinary server-only application modules and are a good
home for environment parsing, authentication policy, error types, constants,
host-binding adapters, and typed service factories. Import them with the
server-root alias:

```ts
import { env } from '#server/config/env';
import { createServices } from '#server/config/services';
```

Routes, middleware ordering, handlers, and SSR registration do not belong in
the config folder; compose them through the `serve()` application.

An application-scoped service factory can perform asynchronous startup once:

```ts
// src/server/config/services.ts
export async function createServices() {
  const database = await connectDatabase(env.DATABASE_URL);
  return { database, stories: createStoryRepository(database) };
}

// src/entry.server.ts
import { serve } from '@memoized-dom/server';
import { createServices } from '#server/config/services';

const app = serve({ createServices });
```

The result is available as typed `context.services` in middleware, routes,
SSR, and server functions. Per-request state stays in `context.locals`.

## Server boundaries

- `@memoized-dom/server` is the framework API carrying registered app types.
- `#server/*` resolves application-owned modules under the configured server
  root and is rejected from the client graph.
- `#server-functions` is the generated colorless facade. It preserves each
  function's parameters and resolved return type without exposing its server
  implementation to the browser.

Erased `import type` declarations may refer to server modules. Runtime value
imports from `#server/*` are intentionally rejected in the client graph.
Shared DTOs and schemas should live in a neutral application directory; a
browser-visible operation must be an explicit server function imported from
`#server-functions`.

## `$routed` compilation and transport

`$routed` is the router's authored route-preparation intrinsic. The same Vite
plugin produces its client and server forms; there is no route-loader plugin or
endpoint configuration to add.

```tsx
import { $routed, redirectRoute } from '@memoized-dom/router';
import { reports } from '#server/repositories/reports';

export function ReportPage() {
  const page = $routed(({ params, locals, signal }) => {
    if (!locals.user) return redirectRoute('/login');
    return reports.loadPage(params.reportId, locals.user.id, { signal });
  });

  return <h1>{page.report.title}</h1>;
}
```

For a server-backed preparation, the plugin:

1. keeps the callback and its `#server/*` dependencies in the server graph;
2. erases that callback body and those server imports from client output;
3. registers the extracted preparation with the generated server application;
4. installs the internal `/_memoized/routed` transport beside generated
   server-function routes; and
5. forwards only the preparation ID, destination URL/params, and JSON-safe
   application-owned `state` values from the browser.

The server attaches the real request, typed locals, platform, and services at
dispatch time. Those capabilities never enter the client bundle or transport
payload. Universal preparations that use only fields such as `params`,
`query`, `signal`, and `state` retain their callback in both environments and
do not generate a server round trip.

The callback must remain inline, synchronous, and assigned to a
component-local `const`. Return a service or server-function result directly;
the router settles it before navigation commits. See
`packages/router/README.md` for the complete authored and navigation contract.

## Development replacement

The adapter compiles connected module graphs and caches output per Vite
environment. During an edit it recompiles before notifying the browser,
invalidates every generated module whose output changed, and keeps generated
modules as self-accepting HMR boundaries. A failed transform leaves the last
successful graph active; the next successful edit sends a recovery update so
Vite can clear its overlay and replace the mounted definition.

Server requests load the current server entry through Vite's SSR environment.
Re-evaluation creates a fresh `serve()` application, preventing routes and
middleware from accumulating across edits. Generated declarations and
server-function manifests are replaced only after successful generation.

Restart the Vite process after changing or rebuilding this plugin itself;
Vite does not hot-replace its own plugin hooks.

## Commands

```bash
bun run --cwd packages/vite test
bun run --cwd packages/vite bench
```
