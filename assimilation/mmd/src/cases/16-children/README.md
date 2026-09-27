# 16-children (MMD equivalent)

Two halves, because authored `children` and React `children` are
**different kinds of value**.

## `{children}` — the opaque slot

| React | MMD |
|---|---|
| `{children}` insert | `{children}` insert — identical |

In authored MMD, `children` arrives as an **opaque slot-mount closure**
(`children(_ul, _id, "0")` in the emitted code). You can place it — you
cannot inspect it. `Array.isArray(children)` is `false` even for
multi-child JSX sequences, and `children.map` doesn't exist.

## `items` data prop — the idiomatic count/map

| React | MMD idiomatic |
|---|---|
| `Children.count(children)` | `items.length` — a real derivation |
| `Children.map(children, (child,i) => <li data-index={i}>{child}</li>)` | `items.map((item,i) => <li data-index={i}>{item}</li>)` over `string[]` — a normal list region |

Not an array of elements — an array of *data* (`items={['A','B']}`). JSX
props are enforced as opaque slots: `items={[ <span/>, <span/> ]}` +
`items.map` is rejected at startup (error-log #005) — element-level
introspection doesn't exist in authored MMD, period.

The React lowering works by **call-site specialization**: it statically
knows each `<ListGroup>`'s child sequence, so `Children.count` compiles to
a constant and `Children.map` to a specialized row wrapper. There is no
runtime-introspection lowering — and none is needed, because authored MMD
models wrapped/counted children as *data*, not opaque elements.

## Lowering consequence

`Children.only`/`Children.toArray` have no authored analog and aren't in
the compiler's supported kinds (`count` + `map` only). Dynamic child
sequences are diagnosed — "requires a finite JSX child sequence".

## Errors hit

- `key={...}` on literal JSX is rejected (error-log #004) — `key` exists
  only on map-produced list rows.

## Same checklist as the React version

1. All `<ListGroup>` children render inside the `<ul>` — opaque slots,
   identical DOM to React.
2. `wrapped` section shows count `2` and `data-index` rows — the
   idiomatic array form covering count+map behavior.

## Notes / divergences

- React shows counts `2,0,1`; the MMD twin deliberately omits per-slot
  counts — authored `children` can't be counted (documented above, this
  is the finding).

_(fill in when verified)_