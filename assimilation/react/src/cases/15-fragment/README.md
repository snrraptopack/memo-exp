# 15-fragment

`<>` inside `<dl>` — the pair of `dt`/`dd` must be direct children of the
`dl`, so the fragment must contribute *no* DOM node of its own.

## What to verify

1. Rendered list looks identical in both apps.
2. Inspect: `dl` has exactly four children — two `dt`, two `dd`. No
   wrapper `div`/`span`/comment markers that break `dl > dt` semantics.
3. React DevTools shows `Fragment` — the MMD DOM should show nothing at
   all between them.

## Expected React semantics being captured

- `<>…</>` → MMD's native fragment support — contributes zero DOM nodes.
- Note: `<React.Fragment>` (member tag) is **diagnosed** — only the bare
  `<>` syntax lowers. Bare `<>` in authored MMD is already in use by the
  `07`/`08` page wrappers.
