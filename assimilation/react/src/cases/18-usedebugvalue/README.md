# 18-usedebugvalue

`useDebugValue` labels a custom hook for React DevTools — zero DOM
effect. The correct lowering is **erasure**.

## What to verify

1. Counter increments normally — identical DOM in both apps.
2. The only difference lives in DevTools (React shows the `even`/`odd`
   label on `useParity`); MMD has no analog and needs none.

## Expected React semantics being captured

- `useDebugValue(x)` → erased. RFC classifies it as development metadata
  with no production DOM operation.
- Compiler status: **diagnosed today** (not in the accepted hook set).
  Note this React version uses a *custom hook* — which is itself
  diagnosed for hooks generally ("custom hook … ownership is not
  implemented"), so the lowering test here is aspirational until hook
  calls land inside custom functions.
