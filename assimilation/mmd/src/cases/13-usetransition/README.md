# 13-usetransition (MMD lowering candidate)

MMD lowering: **the transition runs synchronously and
`isPending` is constant `false`**.

## Lowering being tested

| React | MMD candidate |
|---|---|
| `const [pending, startTransition] = useTransition()` | `const pending = false` — writes happen directly |
| `startTransition(() => setQ(v))` | `q = v` — the write itself, no wrapper |
| `useMemo(() => makeRows(q), [q])` | `const rows = makeRows(q)` |

## What this means behaviorally

React defers the list render so the input stays instant *and* exposes
`pending`. MMD does the work synchronously on each keystroke — the input
may hitch if the list is genuinely slow, and `pending…` **never shows**
(`false` is a literal here, mirroring the emitted lowering).

The checklist difference is intentional: MMD uses its synchronous write and
commit behavior. `pending…` never appears. The shared outcome being checked
is that **the list lands on the final value**.

## Same checklist as the React version

1. Typing updates the list to the latest query — nothing dropped.
2. `pending…` never appears — expected divergence.

## Notes / divergences

- React may flash "pending…"; MMD does not. This is the chosen MMD behavior.
  A package that uses pending state for visible UI needs migration review so
  the team understands the changed presentation.

_verified — list converges; `pending…` never shows (documented divergence, MMD has no scheduler)._
