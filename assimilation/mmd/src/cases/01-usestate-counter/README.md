# usestate-counter (MMD lowering)

Hand-lowered equivalent of the React `useState` case.

## Lowering demonstrated

| React | MMD |
|---|---|
| `const [count, setCount] = useState(0)` | `let count = 0` |
| `setCount(c => c + 1)` | `count++` (direct write) |
| `setCount(0)` | `count = 0` |
| `const doubled = count * 2` in render body | `const doubled = count * 2` (component-body derivation) |

No setter indirection: the compiler links `count` writes to the text nodes
that read it (and to `doubled`, which replays).

## Same checklist as the React version

1. `count`/`doubled` start at `0`/`0`.
2. **+1** updates both; **-1** decrements; **reset** → `0`/`0`.
3. Rapid clicks lose no updates.

## Notes / divergences

_(fill in when verified)_
