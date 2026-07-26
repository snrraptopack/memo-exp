# Local Collection Ownership Benchmark

> Date: 2026-07-26. Production compiler/runtime output under happy-dom.

Run:

```bash
bun run bench:local-state
```

## Question

What does instance-owned collection routing cost relative to equivalent
module-owned state when a retained component row mutates an item field that is
also observed by an owner derivation?

Both normal TSX applications render 100 keyed rows plus the first item value.
The module form routes through its access table and depth-`-1` computed entity.
The instance form marks the row and parent owner directly, then recomputes its
local derivation in the owner prologue. Every update sample validates both the
row and derived output.

Mount rows time 100 complete mount/unregister/remove operations. Update rows
time 2,000 clicks after 500 warmups. Each process reports the median of seven
samples.

## Results

The table records the median reported value from three independent processes.

| Scenario | Module-owned | Instance-owned | Relative |
|---|---:|---:|---:|
| Mount + unmount | 4,350,883.0 ns | 4,256,380.0 ns | 0.98x |
| Row + owner update | 33,191.8 ns | 25,358.4 ns | 0.76x |

Mount ratios across processes were `0.91x-0.98x`; update ratios were
`0.58x-0.78x`. The result supports no local-ownership penalty in this shape,
not a universal instance-state speedup. The module path pays access resolution
and module-computed propagation; the instance path directly refreshes its
lightweight row and marks its owner.

An initial entity-row implementation measured median process ratios of `1.32x`
for mount and `1.43x` for update. Profiling the generated shape showed that the
entity existed only to retain the owner id. The production compiler now passes
that id as an internal parameter to intrinsically lightweight rows, preserving
cleanup/state safety while avoiding registry and props-box allocation.

## Limits

Happy-dom does not measure browser layout or paint. This is deliberately a
worst-case item write for local routing because owner derivations require both
row and owner invalidation. Scalar-only updates and structural add/remove
operations have different work.
