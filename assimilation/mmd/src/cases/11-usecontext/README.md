# 11-usecontext (MMD equivalent — prop drilling)

There is **no context primitive in authored MMD today** — `createContext`/
`useContext` are diagnosed by the compiler and no intrinsic exists. This
twin uses prop drilling, which is the correct behavioral equivalent.

## What the twin demonstrates

| React | MMD |
|---|---|
| `createContext('light')` default | `theme="light"` literal on the outside `<Leaf>` |
| `<Provider value={theme}>` boundary | `theme` prop passed explicitly `UseContextCase → Middle → Leaf` |
| `useContext(Theme)` implicit read | `{ theme }` prop destructure |

The outside-provider leaf gets the literal `'light'` — matching React's
default-value semantics and proving the value isn't ambient.

## Why prop drilling and not module state

A module-scope `let theme` would work for *this* demo (single provider),
but breaks under two providers with different values — the same thing that
makes it context in React. Prop drilling keeps per-subtree scoping
correct. Documenting this so the future context entity knows what it must
beat: implicit plumbing with per-provider scope.

## Same checklist as the React version

1. Inside leaf tracks toggles; outside leaf stays `light`.
2. Updates propagate through `Middle` without `Middle` rendering it
   directly.

## Notes / divergences

_verified in browser — matches the React twin._
