# 14-usedeferredvalue

`useDeferredValue(q)` returns a lagging copy of `q` — the list renders
with the deferred value, so `stale` (`q !== deferred`) is observable while
React catches up.

## What to verify

1. Type fast — input keeps up (it renders `q`), while the list briefly
   shows the *previous* query.
2. **stale…** may flash while deferred lags — same caveat as 13, it needs
   a slow-enough render.
3. List converges to the latest query.

## Expected React semantics being captured

- RFC intent: `useDeferredValue(x)` lowers to **immediate `x`** — MMD has
  no scheduler to defer to, so deferred ≡ current.
- Same contract as useTransition: preserved where code doesn't depend on
  observing the lag (`stale` never true in MMD).
- Compiler status: **diagnosed today**.
