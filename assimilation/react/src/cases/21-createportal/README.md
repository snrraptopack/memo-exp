# 21-createportal

`createPortal(jsx, container)` — a component renders DOM into a node
outside the React root (`#portal-host`, a sibling of `#root`), keeping its
own state.

## What to verify

1. The badge button appears at the bottom of the page — outside the
   `<main>` flow.
2. Inspect: the button is a child of `#portal-host`, not `#root`.
3. Clicking it counts — the component keeps live state inside the foreign
   container.
4. Navigate away/back — the badge unmounts cleanly (no orphans).

## Expected React semantics being captured

- `createPortal` is a `react-dom` API — escapes the component's DOM
  ancestry while staying inside React's ownership (state, effects,
  unmount all still work).
- MMD has no portal primitive; components own DOM strictly under their
  parent. The twin demonstrates the manual effect-based equivalent for
  static content and documents where reactive portal content diverges.
