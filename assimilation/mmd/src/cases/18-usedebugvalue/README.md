# 18-usedebugvalue (MMD lowering)

| React | MMD |
|---|---|
| `useDebugValue(n % 2 === 0 ? 'even' : 'odd')` | *nothing* — erased |

The twin is the React component minus the devtools label. Behaviorally
identical; verification is that nothing observable changes.

## Same checklist as the React version

1. Counter increments.

## Notes / divergences

_(fill in when verified)_
