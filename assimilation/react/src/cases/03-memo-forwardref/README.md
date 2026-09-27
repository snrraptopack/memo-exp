# memo-forwardref

Exercises `memo`, `forwardRef`, and `useRef` together — the wrapper-declaration
form (`const X = memo(forwardRef(fn))`) plus a DOM ref crossing a component
boundary.

## What to verify

1. `FancyInput` shows label `A`, an `<input>`, and a `0` counter button.
2. **check** → `seen` becomes `INPUT` (the ref reached the real `<input>`
   inside `FancyInput`).
3. **inside button** → `clicks` becomes `1` — internal `useState` works inside
   a wrapped component.
4. **rename** → `Badge` and `FancyInput` labels both update to `B`, and the
   `<label>` element is *retained* (not remounted — `clicks` stays `1`,
   proving memo's erase doesn't affect identity/state).
5. **toggle** off → `FancyInput` unmounts; **check** → `seen` = `none`
   (ref slot cleared). **toggle** on + **check** → `INPUT` again.

## Expected React semantics being captured

- `memo(fn)` → erased; MMD components already update selectively, memo adds
  nothing.
- `forwardRef((props, ref) => …)` → `ref` becomes a normal prop binding;
  `<FancyInput ref={box}>` passes the caller's ref through.
- `useRef(null)` → `{ current: null }` box; cleared when the owning region
  unmounts.
