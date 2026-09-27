# 09-uselayouteffect

`useLayoutEffect` — measures a DOM element and writes the measurement to
state *before the browser paints*. If the effect ran post-paint you would
see `0` flash before `120`.

## What to verify

1. On load the measured width shows `120` — never `0`, not even a flash.
2. Reload a few times; watch for a 0-frame.
3. Compare timing against the MMD twin.

## Why this case exists

`useLayoutEffect` is currently **diagnosed** by the assimilation compiler
(`react-tests/assimilation.test.ts` asserts it throws) — there is no
lowering yet. This pair exists to decide what the target should be: if
MMD's post-render `effect` phase runs before paint, `effect()` is a sound
lowering for `useLayoutEffect`; if it runs after paint, the lowering needs
a pre-paint primitive that doesn't exist yet.
