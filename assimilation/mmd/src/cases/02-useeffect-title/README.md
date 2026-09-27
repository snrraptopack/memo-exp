# useeffect-title (MMD lowering)

Hand-lowered equivalent of the React `useEffect` case.

## Lowering demonstrated

| React | MMD |
|---|---|
| `useState(0)` | `let unread = 0` |
| `useEffect(fn, [unread])` | `effect(fn)` — dep array replaced by read tracking |

The compiler sees `unread` is read inside the effect callback and schedules a
re-run on every write. No dependency array is authored.

## Same checklist as the React version

1. Title is `Chat` on mount.
2. **message arrives** → `Chat (N)`.
3. **mark read** → `Chat`.
4. Navigating away tears the effect down; navigating back resumes it.

## Notes / divergences

_verified in browser — matches the React twin._
