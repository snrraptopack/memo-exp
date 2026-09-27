# 08-usesyncexternalstore (MMD lowering)

The routed page renders **both** forms side by side.

## Lowered — what compiled React emits

| React | MMD |
|---|---|
| `const v = useSyncExternalStore(subscribe, getSnapshot)` | `let value = getSnapshot()` + `effect(() => { onChange → Object.is guard → write; subscribe(onChange); onChange(); return unsubscribe; })` |

This bridge exists because React must treat the store as opaque — the only
way it learns about changes is the `subscribe` callback.

## Idiomatic — how a native MMD author writes it

```tsx
import { current, increment } from './store';
function Reader({ name }) {
  return <button onClick={increment}>{name}: {current}</button>;
}
```

No subscribe, no effect, no `Object.is` guard. `current` is a module `let`
— the compiler's access table registers `store.ts#current` readers, and
writes inside `increment()` dirty-mark them across the module boundary.
Verified in the emitted bundle: `_MD.installAccessTable` maps
`store.ts#current` to `IdiomaticReader`, and both writers call
`_MD.commitWrites(["store.ts#current"])`.

The subscribe/effect form is still the right lowering when the store is
*genuinely external* (an npm package outside the compiled graph) — which is
exactly why compiled React needs it.

## Same checklist as the React version

1. All four readers start `0`.
2. Any increment updates all four.
3. B unmount/remount in the lowered section shows the current value.

## Notes / divergences

- Idiomatic section has no show/hide toggle — remount behavior is covered
  by the lowered section's checklist.

_(fill in when verified)_
