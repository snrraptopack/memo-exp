# 13-usetransition (MMD lowering candidate)

Candidate lowering per the RFC: **the transition runs synchronously and
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

The honest checklist difference: if React shows `pending…` while typing
and MMD never does, that's the documented divergence — not a bug, the
absence of a concurrent scheduler. The equivalence being verified is that
**the list always lands on the final value**.

## Same checklist as the React version

1. Typing updates the list to the latest query — nothing dropped.
2. `pending…` never appears — expected divergence.

## Notes / divergences

- React may flash "pending…"; MMD cannot. Documented, not a defect —
  packages that *depend* on pending state are exactly where this lowering
  is unsound (RFC says it's "intentional only where a package does not
  rely on pending/deferred behavior").

_verified — list converges; `pending…` never shows (documented divergence, MMD has no scheduler)._
