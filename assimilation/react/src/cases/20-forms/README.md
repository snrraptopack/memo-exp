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

- `useOptimistic(state, mergeFn)` → `optimistic({ action, apply, reconcile })`
  from `@memoized-dom/utils` — apply returns a per-operation rollback,
  reconcile swaps the pending row for the saved one (keyed by operation id).
- `useActionState` → `$forms` from `@memoized-dom/data` — owns
  `submit`/`pending`/`errors`/`result`; the action's plain promise is wrapped
  in `$read` internally.
- `useFormStatus` → form-context pending read → the twin passes
  `form.pending` as a prop (MMD has no implicit form context — same lesson
  as `11-usecontext`, but now a real `FormSource` field).
- `action={}` on `<form>` is a React-19 idiom; MMD uses
  `onSubmit={form.submit}` which preventDefaults and builds the `FormData`.
