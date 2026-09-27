# 19-useinsertioneffect (MMD lowering candidate)

| React | MMD candidate |
|---|---|
| `useInsertionEffect(cb, [])` | `effect(cb)` — inject rule + measure in the same pass |

## What to verify

1. Marker is green/bold on first paint (companion to `09`'s finding —
   `effect` lands before paint).
2. `styled during first effect: true` — MMD's `effect` runs **after refs
   attach**, so unlike React it *can* touch `marker` and measure in the
   same pass — it does more than an insertion effect is allowed to do.

## The semantic gap this exposed

React's `useInsertionEffect` is strictly **pre-ref-attach, pre-layout** —
no refs, no setState, style injection only. MMD has a single post-render
phase where refs already exist. Two consequences for lowering:

- Style injection + measurement are both safe under `effect()`.
- React code that *relies* on pre-ref timing (e.g. assuming refs are null,
  or state updates being inert) has no MMD analog — it's also a React anti-
  pattern, so `effect()` remains a sound target for the documented use.

## Same checklist as the React version

Green marker, `true` measurement, clean teardown.

## Notes / divergences

_(fill in when verified)_
