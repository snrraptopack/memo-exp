# 08-usesyncexternalstore

Two `useSyncExternalStore` readers on one module-scope store. The store is
deliberately *not* React state — updates only reach components through
`subscribe`/`getSnapshot`.

## What to verify

1. Both readers show the same starting value `0`.
2. Clicking **either** reader (store +1) or **store -1** updates *both*
   readers — external writes propagate to all subscribers.
3. Uncheck **show B** → B unmounts (unsubscribed). Recheck → B remounts and
   immediately shows the *current* value, not a stale snapshot.
4. Updates while B is unmounted are picked up on remount.

## Expected React semantics being captured

- `useSyncExternalStore(subscribe, getSnapshot)` →
  `let value = getSnapshot()` + an `effect` that subscribes an `onChange`
  which re-reads the snapshot and writes the cell only when
  `!Object.is(value, next)`.
- Compiler coverage: `react-tests/state-sources.test.ts` — mount-time
  subscribe, both readers update, teardown unsubscribes, and a change that
  lands between first read and subscription is not missed.
