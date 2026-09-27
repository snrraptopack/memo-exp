# memo-forwardref (MMD lowering)

Hand-lowered equivalent of the React `memo` + `forwardRef` + `useRef` case.
This is what `unwrapReactComponentWrappers` + `assimilateReactSource` emit.

## Lowering demonstrated

| React | MMD |
|---|---|
| `memo(fn)` | `fn` — wrapper erased, no runtime entity |
| `forwardRef(({label}, ref) => …)` | `function FancyInput({ label, ref })` — ref param folds into the props pattern as `ref: forwardedRef` |
| `useRef<HTMLInputElement \| null>(null)` | `const input = { current: null }` |
| `<FancyInput ref={input} />` | `<FancyInput ref={input} />` — `ref` is a normal prop in MMD |
| `{visible ? <C/> : null}` | same ternary — MMD conditional child region |

## Same checklist as the React version

1. Label `A`, `clicks` `0`; **check** → `INPUT`.
2. **inside** → `1`; **rename** → labels update to `B`, `<label>` DOM node
   retained, `clicks` stays `1`.
3. **toggle** off → **check** → `none`; toggle on → `INPUT` again.

## Notes / divergences

_verified in browser — matches the React twin._
