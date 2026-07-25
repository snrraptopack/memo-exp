# Lifecycle Ownership Benchmark

> Date: 2026-07-25. Production Bun runtime. Latest measurements are recorded
> after the implementation and verification commands are complete.

Run:

```bash
bun run bench:lifecycle
```

## Question

What teardown overhead does explicit component-owned cleanup add to the real
entity kernel?

The suite creates 20,000 entities per sample. Setup and disposer allocation
happen outside the timed interval. It measures:

- flat roots, which call `unregister` once per entity;
- one 20,000-child subtree, which uses one `unregister` traversal;
- zero, one, and four synchronous disposers per entity.

Each process reports median nanoseconds per removed entity from 11 samples
after one warmup. `Bun.gc(true)` runs before each timed interval to keep
unrelated garbage collection out of teardown. Disposers update an observable
checksum so the engine cannot erase their work. The table records the median
of three independent process medians.

## Results

| Scenario | Teardown / entity | Relative to same-shape baseline |
|---|---:|---:|
| Flat, no cleanup | 957.5 ns | 1.00x |
| Flat, 1 disposer | 1,761.3 ns | 1.84x |
| Flat, 4 disposers | 1,834.1 ns | 1.92x |
| Subtree, no cleanup | 940.9 ns | 1.00x |
| Subtree, 1 disposer | 1,615.2 ns | 1.72x |
| Subtree, 4 disposers | 1,780.2 ns | 1.89x |

The first disposer adds roughly 0.7-0.8 microseconds per removed entity on this
machine. Four disposers remain below 1.9 microseconds total teardown per entity;
the owner-table lookup and drain setup dominate these tiny disposer bodies.
This cost occurs on unmount/list removal, not on ordinary update commits.

## Limits

This isolates synchronous entity teardown. It excludes DOM removal, timer and
listener host costs, callback execution while mounted, compilation, scheduling,
and asynchronous disposal. The benchmark quantifies lifecycle cost; cleanup is
correctness and resource ownership work, not an expected rendering speedup.
