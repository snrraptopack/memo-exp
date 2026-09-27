# 10-useimperativehandle (MMD lowering candidate)

Candidate lowering for `useImperativeHandle` — the compiler currently
diagnoses it, so this case validates the RFC's proposed shape.

## Lowering being tested

| React | MMD candidate |
|---|---|
| `forwardRef(fn)` + `useImperativeHandle(ref, factory, [])` | ordinary `api` prop box + `effect(() => { api.current = factory(); return () => api.current = null; })` |

- ⚠️ First attempt used `ref={api}` — **wrong**: `ref` on a component
  element is MMD's DOM-root sink, so the child receives a `refAssign`
  wrapper and the parent's box ends up holding the `<label>` DOM node.
  Buttons were dead. Full trail in `error-log.md` #003 — this means the
  real `useImperativeHandle` lowering must route the handle box through a
  non-`ref` prop channel.
- Handle assignment lives in `effect` (post-render, DOM exists) with a
  teardown that clears the box on unmount.

## Same checklist as the React version

1. **clear field** empties the input.
2. **focus field** focuses it.
3. Handle populated by first paint.

## Notes / divergences

_verified in browser — matches the React twin._
