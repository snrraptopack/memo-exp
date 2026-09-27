# usestate-counter

Exercises `useState` with an updater function, a direct set, and a derived
value computed during render.

## What to verify

1. `count` and `doubled` both start at `0` / `0`.
2. **+1** updates both displayed values; **-1** decrements; **reset** returns
   to `0`/`0`.
3. Rapid clicks: no missed updates (updater form `setCount(c => c + 1)`).
4. Only the two numbers change in the DOM — nothing else re-renders visibly
   (compare with MMD's selective updates).

## Expected React semantics being captured

- `useState(init)` → per-instance reactive cell with setter.
- Updater form receives the latest committed value.
- `doubled` is recomputed on every render; in MMD it is a `const` derivation
  replayed on `count` writes.
