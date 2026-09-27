# 06-usecallback (MMD lowering)

Hand-lowered equivalent of the React `useCallback` case.

## Lowering demonstrated

| React | MMD |
|---|---|
| `useCallback(() => setCount(c => c + step), [step])` | `const advance = () => { count += step; }` |

The closure reads `step` live at call time — identical outcome to React
recreating the callback when `[step]` changes. No dep array, no memo slot.

## Same checklist as the React version

1. `+ step` adds current step (1 at first).
2. **raise step** → subsequent clicks add the new step.
3. **reset step** → back to 1.

## Notes / divergences

- This lowering **is** the idiomatic form — a plain closure over `let`
  state is what a native author writes. No separate idiomatic block needed.

_(fill in when verified)_
