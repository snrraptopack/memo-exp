# 05-usememo

`useMemo` with a dependency chain — `label` derives from `doubled` which
derives from `count`, plus an unrelated dep (`name`).

## What to verify

1. Starts `alpha:2` (count=1 → doubled=2).
2. **count +1** → `alpha:4`, then `alpha:6`, …
3. **rename** → `beta:6` — the chained memo sees the *current* doubled.
4. Mixed clicks never produce a stale combination
   (e.g. `alpha:6` after rename is wrong).

## Expected React semantics being captured

- `useMemo(fn, deps)` → an MMD `const` derivation. The dep array is dropped —
  the compiler tracks actual reads, so `doubled` replays iff `count` changes
  and `label` replays iff either source changed.
- Compiler coverage: `react-tests/assimilation.test.ts` asserts the compiled
  package contains the derivation (`doubled = count * 2`) with no `useMemo`
  left in the output.
