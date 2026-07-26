<!-- Production-runtime receiver-effect benchmark methodology and results. -->

# Receiver-Bounded Effects Benchmark

> Date: 2026-07-25. Bun on Windows. This measures production runtime
> invalidation and guarded update work, not compiler throughput or browser DOM.

Run:

```bash
bun run bench:effects
```

## Question

What does a conservative false positive cost when a pure method call is
bounded to its reactive receiver instead of treated as an unbounded root
effect?

The benchmark registers a root with 1,024 child entities. A subset observes
`items`; the rest are unrelated. Every operation runs `items.filter(Boolean)`
without changing the observed value, then uses either:

- **Bounded:** production `commitWrites()` and the access table.
- **Root fallback:** production `markDirtySubtree()`.

The scheduler and commit drain run normally under a manually pumped scheduler.
Before timing, each strategy is checked for the expected render count and zero
guarded writes. Each process reports the median of nine samples.

## Results

Results are recorded after running three independent processes and taking the
median for each cell.

| Receiver readers | Bounded | Root fallback | Root / bounded |
|---:|---:|---:|---:|
| 1 | 461.2 ns | 602,866.4 ns | 1,307.17x |
| 32 | 11,892.4 ns | 620,337.3 ns | 52.16x |
| 256 | 72,324.3 ns | 697,602.4 ns | 9.65x |

## Interpretation

This suite measures the deliberate cost of the no-method-semantics contract:
all receiver observers evaluate, but their guards perform no writes. It also
shows why a receiver effect must not be promoted to root fallback. Bounded cost
still scales with the receiver's observer count; dirty-reason masks may later
skip independent work inside those selected entities. The result does not
measure the cost of the user method itself, real DOM setters, list
reconciliation, or compiler-selected dirty-reason masks.

## Canonical-Prop Checkpoint

> Date: 2026-07-26. Bun 1.3.14 on Windows.

Graph-linked component props now select the same production bounded route
measured above. A child mutation such as `props.selected.clear()` commits the
caller's canonical key when its origin is known; unresolved shared identities
still use the root fallback. Three new independent processes produced these
per-cell medians:

| Receiver readers | Exact canonical key | Root fallback | Root / exact |
|---:|---:|---:|---:|
| 1 | 2,620.9 ns | 1,489,294.3 ns | 568.23x |
| 32 | 37,442.1 ns | 1,438,366.7 ns | 38.42x |
| 256 | 209,462.4 ns | 1,633,819.4 ns | 7.80x |

Absolute timings varied substantially between processes, so this checkpoint
supports the routing decision, not a claim that the runtime itself became
faster. Vite integration tests verify that linked row and forwarded static
props choose the exact route.
