# 06-usecallback

`useCallback` with a dependency — the closure must observe the *current*
`step`, so a stale `[step]` version would add the wrong amount.

## What to verify

1. `+ step` adds 1 while step is 1.
2. **raise step** → step becomes 2; the next `+ step` click adds **2**, not 1
   (the callback was recreated with the new dep).
3. **reset step** → back to adding 1.
4. `count` accumulates correctly through all of it.

## Expected React semantics being captured

- `useCallback(fn, deps)` → a plain function in MMD. Component bodies run
  once, so "referential stability across re-renders" is automatic; the
  closure reads live state at call time, which matches a fresh `[step]`
  closure — no memoization machinery needed.
- Compiler coverage: `react-tests/assimilation.test.ts` asserts no
  `useCallback` survives in compiled output.
