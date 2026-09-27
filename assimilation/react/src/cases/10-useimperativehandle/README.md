# 10-useimperativehandle

A child exposes `{ focus(), clear() }` up through `ref` via
`useImperativeHandle`; the parent calls those methods from its own buttons.

## What to verify

1. Type text in the field, click **clear field** — input empties (parent
   drove a child-internal DOM node).
2. **focus field** moves focus into the input.
3. The parent's handle is populated *after* mount — clicking immediately on
   load works, so the handle must be set by the first painted frame.

## Expected React semantics being captured

- RFC intent: `useImperativeHandle(ref, factory)` lowers to an `effect`
  that assigns `ref.current = factory()` — handle exists post-render.
- The `ref` itself is the same `{ current }` box as `forwardRef` — already
  verified in `03-memo-forwardref`.
- Compiler status: **diagnosed today** (`react.*` uses outside the accepted
  hook set throw). This pair is the lowering spec.
