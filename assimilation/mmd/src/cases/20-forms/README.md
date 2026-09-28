# 20-forms (MMD equivalent)

Rewritten against the real primitives (`$forms`, `optimistic`, `$read` internally).
The earlier hand-plumbed stand-in was provisional and wrong — this is the actual
lowering target.

## Lowering demonstrated

| React | MMD |
|---|---|
| `useActionState(async (prev, fd) => …)` | `const form = $forms(fields => …)` — `form.submit`, `form.pending`, `form.errors`, `form.result`/`hasResult` |
| `useOptimistic(msgs, merge)` + `addOptimistic(text)` | `optimistic({ action, apply, reconcile })` — `apply` pushes the pending row and returns a per-op rollback; `reconcile` swaps in the saved row |
| `useFormStatus()` in a nested button | `form.pending` passed as a prop — still no implicit form context, but now a real `FormSource` field, not plumbing |
| `<form action={async fd => …}>` | `<form onSubmit={form.submit}>` — `form.submit` consumes the `SubmitEvent` (preventDefault + FormData incl. submitter) |
| `useActionState`'s returned state | `form.result` / `form.hasResult` — the last committed value |
| action failure channel | `form.errors` — `{ kind: 'parse' \| 'submit', message, path? }` |
| (implicit — `useOptimistic`'s promise) | `$read(promise)` inside `optimistic` turns the plain promise action into a tracked source |

## Structure

```tsx
const sendMessage = optimistic({
  action: (text: string) => postMessage(text),        // plain promise → $read
  apply(text, id) {                                   // runs instantly, per op
    messages.push({ id, text, pending: true });
    return () => { /* rollback — remove only this op's row */ };
  },
  reconcile(saved, _text, id) {                       // swap pending → saved
    messages.splice(index, 1, saved);
    formEl?.reset();                                  // reset on success only
  },
});
const form = $forms((fields: FormData) => sendMessage(String(fields.get('msg'))));
```

Each call to `sendMessage` gets its own operation id — overlapping submits
roll back or reconcile independently (the `Map`-keyed-by-request-id problem
from `docs/05-data.md`, solved by the operation id).

## Same checklist as the React version

1. Submit → row appears instantly with "(sending)", button pending.
2. ~1.2s → row settles, button re-enables, input resets, `last delivered` line
   updates from `form.result`.
3. Rapid submits each track pending independently.

## Notes / divergences

- `useOptimistic`'s *merge function* is replaced by explicit `apply`/`reconcile`
  — MMD keeps the rollback as an authored closure, not a diff.
- `useFormStatus` still needs the explicit prop (no form context), but the
  value is now `form.pending` from `FormSource`, not a hand-managed flag.
- `$forms({ schema, action })` additionally accepts a Standard Schema
  validator — not exercised here (React side has no schema equivalent).

_verified in browser — matches the React twin._
