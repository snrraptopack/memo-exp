# 14-usedeferredvalue (MMD lowering candidate)

Candidate lowering per the RFC: **`useDeferredValue(x)` → immediate `x`**.

## Lowering being tested

| React | MMD candidate |
|---|---|
| `const deferred = useDeferredValue(q)` | `const deferred = q` — a derivation, always current |
| `const stale = q !== deferred` | `const stale = q !== deferred` — always `false` |

## What this means behaviorally

`deferred` is a `const` derivation — it replays the moment `q` changes, so
`stale` can never be true. The `stale…` badge is dead code by
construction, exactly as the RFC's identity lowering predicts. In React it
may flash; in MMD it never does — documented divergence, same class as
`useTransition`'s `isPending`.

## Same checklist as the React version

1. List converges to the latest query.
2. `stale…` never appears — expected divergence.

## Notes / divergences

_verified — list converges; `stale…` never shows (documented divergence — identity lowering)._
