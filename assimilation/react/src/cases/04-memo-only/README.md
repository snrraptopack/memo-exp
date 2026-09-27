# 04-memo-only

`memo` alone — no ref. A memo'd child inside a parent that has unrelated
state. Includes a render counter to expose what memo actually does in React.

## What to verify

1. Child shows `hello (body ran 1×)`.
2. **unrelated parent update** → `tick` increments, child text stays
   `hello`, render count stays `1×` (memo bails — props unchanged).
3. **change prop** → text flips to `world`; React render count goes to `2×`.
4. Repeat: tick keeps incrementing, text toggles.

## Expected React semantics being captured

- `memo(fn)` → erased. In MMD there is nothing to skip: component bodies run
  **once** regardless, so memo's bail-out is already the default behavior.
- Known cosmetic divergence: React's render counter reaches `2×` on prop
  change; the MMD body never re-runs so it stays `1×`. What must match is the
  DOM — fresh text, same node, no lost state.
