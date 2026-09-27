# 11-usecontext

`ThemeContext.Provider` wraps `Middle`, which wraps `Leaf` — `Leaf` reads
the theme two layers down without props. A second `Leaf` outside the
provider reads the *default* value.

## What to verify

1. Inside-provider leaf shows `light` initially; the outside leaf always
   shows `light` (the default).
2. **toggle theme** → inside leaf flips to `dark`; outside leaf stays
   `light`. This is what makes it context, not module state.
3. Toggle back and forth — inside leaf tracks every change.

## Expected React semantics being captured

- The essential behavior: a value flows to descendants of the provider
  subtree only, and updates propagate.
- Compiler status: **diagnosed today** — `createContext`/`useContext` throw
  "no MMD translation". RFC targets an ancestry-scoped read entity
  (archived `react/context.ts` + `runtime/context.ts` exist but are not in
  the current pipeline).
- MMD twin uses **prop drilling** — the only correct equivalent today.
