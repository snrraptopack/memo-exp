# Component Children Benchmark

> Date: 2026-07-25. Production compiler/runtime output under happy-dom.

Run:

```bash
bun run bench:children
```

## Question

What mount and hot-update overhead does one compiler-owned component children
slot add over equivalent direct JSX?

The runner compiles both applications before timing:

```tsx
// direct
return <button>{count}</button>;

// slotted
return <Frame><button>{count}</button></Frame>;
```

Both buttons increment component-local state through a compiled click handler.
The scheduler is synchronous. Observable text is verified after every measured
update sample.

Mount samples perform 2,000 complete mount, DOM insertion, unregister, and DOM
removal operations. Update samples perform 50,000 clicks against one mounted
instance. Each process reports the median of 11 samples. The table records the
median direct and slotted time from three independent processes.

## Results

| Scenario | Direct | One children slot | Relative |
|---|---:|---:|---:|
| Mount + unmount | 21,430.3 ns | 30,741.4 ns | 1.43x |
| Local text update | 8,129.2 ns | 8,408.7 ns | 1.03x |

Mount ratios from the three processes ranged from 1.25x to 1.61x. The wrapped
form intentionally creates one additional host node, component entity, props
box, slot function, and linked update closure.

Update ratios ranged from 0.94x to 1.07x, so these runs support a near-parity
conclusion, not a children-slot speedup. Once mounted, the extra generated hot
path is one null check and one function call before the same guarded text write.

## Limits

Happy-dom is deterministic enough to isolate generated JavaScript overhead but
is not a browser rendering engine. The mount row includes DOM and entity
registry work; the update row includes event dispatch and a text-node write.
This suite does not measure lists, conditionals, nested component updates,
layout, paint, memory retention, or GC. End-to-end browser claims still require
the real Chromium DOM suite.
