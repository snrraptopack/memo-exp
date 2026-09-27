# 07-usereducer (MMD lowering)

The routed page renders **both** forms side by side.

## Lowered — what compiled React emits

| React | MMD |
|---|---|
| `useReducer(add, 2, init)` | `const initialArg = 2; const init = …; let value = init(initialArg)` |
| `dispatch(2)` | `const dispatch = next => { value = add(value, next); }` |

The `dispatch` indirection exists only because React's API has it.

## Idiomatic — how a native MMD author writes it

```tsx
let value = 4;
<button onClick={() => (value = add(value, 2))}>+2</button>
<button onClick={() => (value = 0)}>zero</button>
```

No named `dispatch`, no init ceremony — handlers write the `let` cell
directly. `zero` is just `value = 0`; it doesn't need to route through the
reducer at all.

## Same checklist as the React version

1. Both sections start `4`.
2. **+2** / **-1** / **zero** behave identically in both.

## Notes / divergences

_(fill in when verified)_
