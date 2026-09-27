# 16-children

`Children.count` + `Children.map` over a `children` prop — mirrors the
compiler's own `compound-kit`/`row-kit` fixtures.

## What to verify

1. Counts read **2**, **0**, **1** — a fragment child counts as *one* in
   React semantics.
2. Every child lands inside an `<li>` with `data-index` — the map wraps
   each child.
3. "none" group renders an empty `<ul>`.

## Expected React semantics being captured

- `Children.count(children)` → specialized per call site — the compiler
  knows each `<ListGroup>`'s static child sequence, so the count is a
  constant after lowering.
- `Children.map(children, (child, i) => <li>{child}</li>)` → the map
  wrapper is also specialized at the call site (`row-kit` exercises the
  index parameter).
- Covered by `react-tests/compound-children.test.ts` + `row-map.test.ts`
  — asserts `Children.count` is fully erased from emitted output.
- `Children.only` / `Children.toArray` are **not** supported kinds — only
  `count` and `map` exist in `react/child-sequences.ts`.
- Non-finite child sequences (e.g. `{condition && <x/>}` spreads of
  unknown arity) are diagnosed: "requires a finite JSX child sequence".
