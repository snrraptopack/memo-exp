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
| Mount + unmount | 6,055,452.0 ns | 6,282,052.0 ns | 1.04x |
| Row + owner update | 46,050.1 ns | 35,104.9 ns | 0.76x |

Mount ratios across processes were `0.98x-1.06x`; update ratios were
`0.60x-0.84x`. The result supports no meaningful local-ownership penalty in this shape,
not a universal instance-state speedup. The module path pays access resolution
and module-computed propagation; the instance path directly refreshes its
lightweight row and marks its owner.

These measurements include the local-derived dual-mode checkpoint. This
one-source owner retains unconditional replay and bare `markDirty(id)`, so the
reason channel adds no generated dependency checks to this application.
Absolute happy-dom timings moved substantially from the prior run; only the
same-process relative result is interpreted.

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
