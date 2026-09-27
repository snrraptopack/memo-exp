# 19-useinsertioneffect

`useInsertionEffect` — the CSS-in-JS hook: injects a `<style>` rule early
enough that subsequent effects/layout already see it. Here the effect
injects the rule, adds the class, then *measures* it in the same pass.

## What to verify

1. Marker text renders green + bold — the injected rule is active.
2. `styled at layout-effect time: true` — the rule was measurable by the
   layout effect, proving insertion ran first.
3. Navigate away/back — teardown removes the rule cleanly.

## Findings from the first run (React-side constraint)

The original design measured the marker *inside* the insertion effect —
**that can't work in React**: `useInsertionEffect` fires **before refs
attach**, so `marker.current` is `null`, and `setState` inside it is
dropped (React explicitly forbids updates there). Marker never got styled,
measure read `false`. Rewritten to the real contract: insertion injects
the rule, a static `className` carries it, and a layout effect does the
measuring — React's own intended composition.

## Expected React semantics being captured

- `useInsertionEffect` → `effect()` candidate — same question as `09`
  (pre-paint ordering). The extra guarantee it carries is "before
  layout effects"; MMD has one ordered effect phase, so registration
  order is the ordering.
- Compiler status: **diagnosed today**.
