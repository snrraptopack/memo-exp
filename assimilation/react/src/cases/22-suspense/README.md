# 22-suspense (React 19)

Three suspension shapes in one page:

1. **Piecemeal** — two sibling `<Suspense>` boundaries, each wrapping a
   `use(promise)` panel (0.7s vs 2.2s): the fast panel lands while the slow
   one still shows its fallback.
2. **Atomic** — one `<Suspense>` wrapping both panels: nothing appears until
   the slowest read resolves, then both at once.
3. **Lazy** — `lazy(() => delay(900).then(() => import('./LazyBadge')))` —
   the *component code* itself suspends behind the same boundary.

`use(promise)` reads the promise; `api.ts` caches by key because React
requires a *stable* promise across renders — a fresh promise per render
would suspend forever.

## What to verify

1. On load: piecemeal section shows "loading fast…" then "loading slow…";
   fast resolves ~0.7s, slow ~2.2s — independently.
2. Atomic section shows ONE fallback, then both panels appear together ~2.2s.
3. Lazy badge mounts ~0.9s after "loading chunk…".
4. On re-navigation the lazy chunk is cached — no fallback flash.

## Expected React semantics being captured

- `<Suspense fallback>` = boundary-scoped atomic reveal; sibling boundaries
  reveal independently.
- `use(promise)` = per-read suspension into the nearest boundary.
- `lazy()` = code-loading suspension — same boundary, different resource.

## The MMD mapping (see twin)

| React | MMD |
|---|---|
| `use(promise)` | `$read(promise)` — a tracked source; `{msg.text}` is the read site |
| `<Suspense fallback={F}><C/></Suspense>` | `<Group pending={F}><C suspend/></Group>` |
| sibling `<Suspense>` boundaries | `suspend` per component call |
| atomic boundary over subtree | `<section suspend>` inside `Group` |
| `lazy(import)` | **no twin** — MMD code-splits at `route` boundaries only |
