# 07-usereducer (MMD lowering)

Hand-lowered equivalent of the React `useReducer` case — mirrors what
`assimilateReactSource` emits for the 3-arg form.

## Lowering demonstrated

| React | MMD |
|---|---|
| `useReducer(add, 2, init)` | `const initialArg = 2; const init = …; let value = init(initialArg)` |
| `dispatch(2)` | `const dispatch = next => { value = add(value, next); }` |

`dispatch` is a plain const function; the reducer runs inside it and the
result writes the `let` cell — same dirty-marking as `useState`'s setter.

## Same checklist as the React version

1. Starts `4` — initializer ran.
2. **+2** / **-1** / **zero** all route through `add`.
3. Remount starts at `4` again.

## Notes / divergences

_(fill in when verified)_
