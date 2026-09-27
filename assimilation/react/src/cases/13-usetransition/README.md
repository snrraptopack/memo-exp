# 13-usetransition

`startTransition` marks the 300-row list update as non-urgent — the input
echo stays instant while React defers the list re-render; `isPending`
flags during the gap.

## What to verify

1. Type fast — input responds immediately even while the list catches up.
2. **pending…** may flash while the list re-renders (React-only
   affordance; try it — if your machine is too fast it may never appear).
3. The list always ends up showing the latest query — nothing is dropped.

## Expected React semantics being captured

- RFC intent: transitions **run synchronously** in MMD and `isPending`
  lowers to constant `false`. MMD has no concurrent scheduler to defer to —
  the write just happens.
- The semantic contract this preserves: "the update happens, the input
  isn't blocked." What it drops: the pending indicator and the ability to
  interleave — acceptable for code that doesn't *rely* on pending state.
- Compiler status: **diagnosed today**.
