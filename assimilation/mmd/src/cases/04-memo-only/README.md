# 04-memo-only (MMD lowering)

Hand-lowered equivalent of the React `memo` case — memo erases, so the MMD
version is just a plain component.

## Lowering demonstrated

| React | MMD |
|---|---|
| `const Label = memo(function Label…)` | `function Label(…)` — wrapper erased |
| `useRef(0)` render counter | `let renders = 0; renders += 1` — body runs once |
| `useState` parent state | `let tick` / `let text` |

## Same checklist as the React version

1. `hello (body ran 1×)` on mount.
2. **unrelated parent update** → tick increments, child text/node untouched.
3. **change prop** → text flips to `world`.

## Notes / divergences

- **Expected and documented**: React's render counter reaches `2×` after the
  prop change; MMD shows `1×` forever because component bodies run once by
  construction — memo's bail-out is the default, which is exactly why erasing
  it is safe. Verify DOM text + node retention instead of the count.

_(mark verified once checked in the browser)_
