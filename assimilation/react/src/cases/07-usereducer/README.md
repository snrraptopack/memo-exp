# 07-usereducer

`useReducer(reducer, initialArg, init)` — the three-argument form: the
initializer maps `2` → `4` before first render.

## What to verify

1. Starts at `4` (init ran: `2 * 2`), not `2`.
2. **+2** → `6`, `8`, … — dispatch routes through `add(value, next)`.
3. **-1** decrements; **zero** dispatches `-value` → `0`.
4. Two mounts (navigate away/back) each start at `4` — init runs per
   instance.

## Expected React semantics being captured

- `useReducer(reducer, initArg, init)` → `let value = init(initArg)` +
  `const dispatch = next => { value = reducer(value, next) }` — reducer and
  init hoisted as plain `const`s; dispatch is a normal function that writes
  the cell.
- Compiler coverage: `react-tests/state-sources.test.ts` — "lowers useReducer
  into independent MMD state and dispatch writes", including per-instance
  initializer ordering.
