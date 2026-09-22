# Fieldnotes

A tiny expedition journal exercising the fullstack surface documented in
`docs/01`–`16`.

```bash
bun run example:fieldnotes
```

## What each piece demos

| File | Doc |
|---|---|
| `vite.config.ts` — `clientEntry`/`serverEntry`/`server` | 09, 12 |
| `main.ts` — `mount('root', Main)` | 01 |
| `server.ts` — `serve()` options, middleware, `app.get`, `app.ssr` | 10, 11, 13, 09 |
| `server/config/index.ts` — `ServerTypes` | 14 |
| `server/config/services.ts` — `createServices` composing small factories | 10, 14 |
| `server/config/{store,expeditions,notes}.ts` — modular services | 14 |
| `server/functions/expeditions.ts` — `get*`/`post*`/`delete*` + `getServerContext` | 12, 15 |
| `App.tsx` — nested routes, `route-to`, `/*` catch-all | 07 |
| `src/Home.tsx` — `$fetch`, `$track`, `Group`/`Pending`/`Error`, `effect`, `cleanup` | 03, 05, 06 |
| `src/ExpeditionList.tsx` — `getExpeditions` source, `$track` refresh, object-form `route-to` | 07, 12 |
| `src/ExpeditionDetail.tsx` — server-backed `$routed`, `redirectRoute`, optimistic `postNote` with `$track` rollback, `deleteNote`, array ref + focus, `blockNavigation` draft guard | 04, 08, 12, 16 |
| `src/About.tsx` — a plain static route | 07 |

Try it: the detail page's preparation runs on the server (`services` in the
terminal, not the browser console); type a draft note and navigate away to
hit the leave-guard; submit a note containing "spam" to see the tracked
error and optimistic rollback.
