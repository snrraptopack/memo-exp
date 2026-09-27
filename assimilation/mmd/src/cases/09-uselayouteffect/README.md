# 09-uselayouteffect (MMD lowering candidate)

Hand-written candidate lowering for `useLayoutEffect` — the compiler
currently rejects it, so this case is the experiment that decides whether
`effect()` is the right target.

## Lowering being tested

| React | MMD candidate |
|---|---|
| `useLayoutEffect(() => setWidth(box.current.getBoundingClientRect().width), [])` | `let width = 0; effect(() => { width = box?.getBoundingClientRect().width ?? 0; })` |

The MMD `effect` phase runs after DOM writes drain — the open question is
whether that lands **before paint** (matching `useLayoutEffect`) or after
(matching only `useEffect`).

## What to verify

1. First painted frame already shows `120` → `effect` is pre-paint →
   `useLayoutEffect` can lower to it.
2. A visible `0` flash → `effect` is post-paint → `useLayoutEffect` needs a
   distinct earlier phase, and this README records the divergence.

## Notes / divergences

_verified in browser — `effect` lands before paint; no 0-flash. `effect()` is a sound lowering target for `useLayoutEffect`._
