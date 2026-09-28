# 22-suspense (MMD equivalent)

The honest mapping: React's `<Suspense>` conflates *presentation* (fallback UI)
and *reveal unit* (whole boundary), plus code loading (`lazy`). MMD splits
those into `Group` (presentation) + `suspend` (withholding) + `route`
(code splitting).

## Lowering demonstrated

| React | MMD |
|---|---|
| `use(promise)` in child | `const msg = $read(fetchMessage(k, ms))` — plain promise → tracked source; `{msg.text}` is a read site |
| `<Suspense fallback>` per component | `<Panel suspend>` under `<Group pending={LineSkeleton}>` — each suspended call is its own reveal unit |
| one `<Suspense>` over a subtree | `<section suspend>` — withheld until **all** descendant reads commit |
| `lazy()` | no equivalent — see below |

Plus a third MMD-only section: bare `Group` children with **no `suspend`** —
the skeleton lands at the *read site* only (`fast: loading…` — the label
stays visible). Finer granularity than React can express.

## MMD behavior and open design

- **`api.ts` differs from the React twin** — no promise cache. React needs a
  stable promise identity across re-renders; MMD bodies run once, so `$read`
  gets its promise at creation. The module-`Map` cache was also rejected
  outright (error-log #007): a derivation can't call a helper that writes
  reactive state.
- **`suspend` is first-mount only** — React Suspense can re-suspend a mounted
  tree on updates; MMD never blanks committed UI.
- **`lazy()` remains open** — the current MMD example uses route-level code
  splitting: this page itself is a lazy route chunk. That does not cover a
  lazy component inside an already mounted route. A component-level target
  needs a separate ownership and loading design (error-log #001).

## Checklist

1. Piecemeal section: "fast" panel swaps at ~0.7s, "slow" at ~2.2s — two
   independent skeletons (one per `suspend` call).
2. Atomic section: single block fallback until ~2.2s, then both panels
   appear together.
3. Third section: labels render immediately; only the value slots skeleton —
   `fast: loading…` then `fast: site-fast resolved…`.
4. Error states: not exercised (promises always resolve); `Group` also takes
   an `error` policy — `error.kind === 'promise'` for `$read` rejections.

_The read/reveal checklist was verified in the browser. Component-level
`lazy()` is still an open design question._
