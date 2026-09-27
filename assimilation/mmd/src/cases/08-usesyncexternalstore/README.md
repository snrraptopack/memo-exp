# 08-usesyncexternalstore (MMD lowering)

Hand-lowered equivalent — mirrors the exact shape `assimilateReactSource`
emits for `useSyncExternalStore`.

## Lowering demonstrated

| React | MMD |
|---|---|
| `const v = useSyncExternalStore(subscribe, getSnapshot)` | `let value = getSnapshot()` + `effect(() => { onChange → Object.is guard → write; subscribe(onChange); onChange(); return unsubscribe; })` |

## Same checklist as the React version

1. Both readers start at `0`.
2. Either button updates both.
3. B unmount/remount shows the current value.
4. Updates during B's absence apply on remount.

## Notes / divergences

- Native MMD could also just read the module's `current` directly — the
  compiler already tracks module-scope state. This file deliberately uses
  the *lowered* form because that's what React source compiles to: the store
  boundary stays opaque, subscription is explicit.

_(fill in when verified)_
