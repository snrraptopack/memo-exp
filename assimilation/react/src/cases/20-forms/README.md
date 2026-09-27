# 20-forms (React 19)

Three intertwined APIs in one real form:

- `useActionState` — form action → committed message list
- `useOptimistic` — the row renders instantly with `pending` before the
  action resolves
- `useFormStatus` — nested `SubmitButton` reads the form's pending state
  without props

## What to verify

1. Type a message, **send** — it appears **immediately** with "(sending)"
   and the button reads "sending…" / is disabled.
2. ~1.2s later "(sending)" disappears and the button re-enables — the
   action committed.
3. The input resets after submit.
4. Rapid submissions each track their own pending state.

## Expected React semantics being captured

- `useOptimistic(state, mergeFn)` → the optimistic write is just a second
  state channel in MMD terms — see the twin: it's a normal `let` write.
- `useActionState` → `let` list + async handler writing on resolve.
- `useFormStatus` → form-context pending read → the twin passes a plain
  prop (MMD has no implicit form context — same lesson as `11-usecontext`).
- `action={}` on `<form>` itself is a React-19 idiom; MMD uses `onSubmit`
  + `preventDefault`.
