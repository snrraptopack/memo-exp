# Dirty-Reason Mask Prototype Benchmark

> Date: 2026-07-25. Real headless Chromium. This benchmark evaluates an
> architecture prototype; production compiler/runtime behavior is unchanged.

Run:

```bash
bun run bench:invalidation
```

## Question

Can a per-entity dirty-reason bitmask profitably gate local derivations and
dynamic slot groups before existing value guards run?

The compared strategies are:

- **Current:** every local derivation and dynamic expression in the entity's
  update path is evaluated; value guards suppress unchanged writes.
- **Masked:** compiler-known reason bits skip unrelated derivations/expression
  groups; evaluated values still pass through the same guards.

Each strategy pair is executed operation-by-operation first and the benchmark
throws if their observable checksums differ. Timings are median nanoseconds per
update from 11 samples. The table below is the median of three independent
Chromium processes.

## Results

| Scenario | Current | Masked | Relative |
|---|---:|---:|---:|
| `filter(2k)`, unrelated write | 85,099 ns | 17.1 ns | 4,976x faster |
| 32 slots, unrelated dependency group | 123.0 ns | 41.5 ns | 2.96x faster |
| 32 slots, relevant dependency group | 137.7 ns | 141.0 ns | 0.98x |
| 32 slots, all groups relevant | 137.3 ns | 134.3 ns | 1.02x |
| Single cheap slot, relevant | 22.2 ns | 25.1 ns | 0.88x |

The `filter(2k)` source-write case was intentionally excluded from the summary:
both variants must allocate and filter, and independent-process results ranged
from 1.28x to 3.09x in favor of the masked closure due to JIT/GC variation.
There is no architectural reason to credit masks for that work. The relevant
overhead signal comes from the allocation-free slot scenarios.

## Interpretation

Masks have a large payoff when they prevent expensive unrelated work and a
moderate payoff when they skip a group of cheap expressions. They do not help
when every dependency group must run. For a one-slot/one-source component, the
prototype bookkeeping costs about 12%.

This argues for compiler-selected dual-mode emission:

1. Keep the current unconditional update plus value guards for a single cheap
   dependency group.
2. Emit a scalar reason mask when a component has independent groups or an
   expensive local derivation (`filter`, `map`, `reduce`, grouping, sorting,
   user calls).
3. Group expressions by dependency set; do not spend one bit per DOM slot.
4. Retain value guards after mask checks because "source was written" does not
   mean "derived/DOM value changed."
5. Retain `Set<EntityId>` for dynamic entity scheduling. Bits describe reasons
   within a stable entity, not live list instances globally.
6. Use one unsigned 32-bit word for the common case and a segmented/fallback
   form only for components exceeding 32 dependency groups.

## Limits and next measurement

This microbenchmark deliberately excludes access-table routing, scheduling,
list reconciliation, and real DOM writes so it can isolate update evaluation.
It establishes that the mechanism has a plausible and measurable payoff; it
does not establish end-to-end framework improvement.

The next proof should implement compiler-only closure masks behind an option,
compile representative applications, and run the existing four-way Chromium
benchmark plus dedicated cases containing:

- unrelated writes beside a 1k/10k filter;
- chained local derivations;
- 1, 8, 32, and 64 dependency groups;
- batched writes to one versus several groups;
- list-row instances with and without local derivations;
- DOM mutation counts and heap/GC sampling.
