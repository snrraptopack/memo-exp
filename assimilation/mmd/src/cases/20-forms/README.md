# 20-forms (MMD equivalent) — PROVISIONAL

> **This twin is a stand-in, not a verified equivalent.** It approximates the
> *visible* lifecycle with hand-written DOM/state plumbing, but that is not an
> MMD-native form/action model. A proper MMD form API is planned; revisit this
> case when it lands and rewrite the twin + this README against the real
> lowering.

## Lowering demonstrated

| React | MMD |
|---|---|
| `useOptimistic(msgs, merge)` + `addOptimistic(text)` | `messages = [...messages, {text, pending:true}]` — the optimistic write is just a write |
| `useActionState` + `sendMessage(fd)` | `let messages` + async `onSubmit` handler; the awaited resolve writes back over the pending row |
| `useFormStatus()` in a nested button | `pending` prop — no implicit form context (same as `11`) |
| `<form action={async fd => …}>` | `<form onSubmit={async e => { e.preventDefault(); … }}>` |

## What's wrong with this approximation

- It reduces the action/optimistic model to "a `let` write plus a pending
  flag" — that loses React's real contract (two channels with automatic
  reconciliation, rollback on failure, action-scoped pending).
- There is no MMD form/action primitive underneath it, so the shape is
  plumbing, not lowering.

## Checklist (reference only — pair is not verified)

1. Submit → row appears instantly with "(sending)", button pending.
2. ~1.2s → row settles, button re-enables.
3. Input resets. Rapid submits each track pending.

## Notes / divergences

_(fill in when verified)_
