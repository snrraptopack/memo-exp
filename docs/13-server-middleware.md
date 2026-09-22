# Server middleware

A middleware is a function that wraps the request pipeline:

```ts
import type { ServerMiddleware } from '@memoized-dom/server';

const logger: ServerMiddleware = async (context, next) => {
  const started = Date.now();
  const response = await next();              // run the rest of the pipeline
  console.log(
    `${context.request.method} ${context.url.pathname} → ${response.status} (${Date.now() - started}ms)`,
  );
  return response;
};
```

`(context, next)` — the same `context` handlers get, plus `next()` which
runs everything downstream and resolves to its `Response`. Code before
`next()` runs on the way in; code after runs on the way out. **Don't call
`next()`** and return your own `Response` → the request never reaches the
handler (short-circuit).

Middleware can also write into `context.locals` — downstream middleware
and the handler see it:

```ts
const session: ServerMiddleware = (context, next) => {
  context.locals.user = context.request.headers.get('x-user') ?? undefined;
  return next();
};
```

## On the app instance

```ts
const app = serve({ createLocals: () => ({ user:string | undefined }) });

app.use(logger, session);                          // every request, in order
app.use('/api/admin/*', requireAdmin);             // only matching paths
```

- `app.use(...middleware)` — global, runs for every request in argument
  order.
- `app.use(path, ...middleware)` — a **group**: the path prefix-matches
  (`/api` covers `/api/*`), so the middleware wraps the whole subtree.

```ts
const requireAdmin: ServerMiddleware = (context, next) => {
  if (context.locals.user !== 'admin') {
    return new Response('Forbidden', { status: 403 });   // short-circuit
  }
  return next();
};
```

## On a route

A route's pipeline is `path`, then any number of middleware, then the
handler — always last:

```ts
app.get('/api/admin/stats', requireAdmin, (context) => ({   // GET route
  stats: context.services.database.stats(),                 // + one guard
}));

app.post(
  '/api/stories',
  requireUser,                    // runs first
  validateBody,                   // then this
  async (context) => {            // handler — always the last argument
    return createStory(await context.request.json());
  },
);
```

Route middleware runs after global and group middleware, in listed order —
scoped to that single route, no pattern needed.

## Inside server functions

Two places, no registration needed:

**Module middleware** — a `middleware` export in the function file runs in
front of every endpoint that file registers:

```ts
// server/functions/stories.ts
import type { ServerMiddleware } from '@memoized-dom/server';

const logCalls: ServerMiddleware = (context, next) => {
  console.log(`[fn] ${context.request.method} ${context.url.pathname}`);
  return next();
};

export const middleware = [logCalls];      // wraps getStories, postVote, …

export async function getStories() { /* … */ }
```

**Directory middleware** — a `_middleware.ts` file applies to every
function module in its folder and below:

```ts
// server/functions/admin/_middleware.ts — covers all of functions/admin/*
export const middleware = [requireAdmin];
```

A `_middleware.ts` file **must** export a named `middleware` array — it's
the only thing that file is for.

## Order

Outermost to innermost:

```
app.use global → app.use group → route middleware → _middleware.ts
(ancestor folders, outermost first) → module middleware export → handler
```

Locals written by an earlier layer are visible to all later layers — put
auth/session first, feature middleware after.

Next: [14 — The server `config/` folder](./14-server-config.md)
