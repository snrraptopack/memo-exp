# Fullstack demo

One small application exercising the `serve()` application layer: middleware,
API routes with method dispatch and prefix-group protection, server functions
with their own middleware, and colorless SSR data through the in-memory
dispatch bridge.

## Run

```bash
bun run example:fullstack
```

Then open http://localhost:5173/.

## What to look at

| Concern | Where |
| :--- | :--- |
| Application-wide locals contract | `server/config/index.ts` |
| Lazy app-scoped database/service setup | `server/config/services.ts` |
| Global + typed middleware, request locals | `server.ts` (`logger`, `session`, `createLocals`) |
| Bare route (implicit GET, JSON normalization) | `server.ts` → `/api/health` |
| Method-map route (POST-only, 405 otherwise) | `server.ts` → `/api/echo` |
| Prefix-group protection | `server.ts` → `/api/admin/*` |
| Server functions + module middleware + `getServerContext()` | `server/functions/stories.ts` |
| Colorless module source (SSR-settled, payload-hydrated) | `App.tsx` → `stories` |
| Reactive component-local source (request rebinding) | `App.tsx` → `StoryDetail` |
| Compiler-gated mutation + `$track` lifecycle | `App.tsx` → `postVote` |

## Walkthrough with curl

```bash
# Bare route
curl localhost:5173/api/health

# Method map: this 405s with an Allow header (only POST exists)
curl localhost:5173/api/echo
curl -X POST localhost:5173/api/echo

# Prefix-group protection: 403 without the header
curl localhost:5173/api/admin/stats
curl -H 'x-admin: yes' localhost:5173/api/admin/stats

# Generated server functions are ordinary HTTP endpoints
curl 'localhost:5173/_fn/stories/getStory?id=2'
curl -X POST localhost:5173/_fn/stories/postVote \
  -H 'content-type: application/json' -d '{"id":1}'
# Mutating server function guarded by its own context check
curl -X POST localhost:5173/_fn/stories/deleteStory \
  -H 'content-type: application/json' -d '{"id":3}'          # rejected
curl -X POST localhost:5173/_fn/stories/deleteStory \
  -H 'content-type: application/json' -H 'x-admin: yes' -d '{"id":3}'

# The page itself: resolved SSR + hydration payload
curl localhost:5173/ | grep -o 'mmd:r:App\|application/mmd+json'
```

Watch the server log: `[http]` lines come from the global middleware, `[fn]`
lines from the server-function module middleware — including when SSR
dispatches `/​_fn/stories/getStories` **in memory** while rendering `/`, with
no network loopback.
