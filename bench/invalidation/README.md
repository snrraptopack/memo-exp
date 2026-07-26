# Dirty-Reason Mask Prototype Benchmark

> Date: 2026-07-25. Real headless Chromium. This benchmark evaluates a bitmask
> representation prototype. Production currently uses scalar/Set numeric
> reasons for structurally selected component-local derivation graphs.

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
| `filter(2k)`, unrelated write | 91,257 ns | 21.7 ns | 4,118x faster |
| 32 slots, unrelated dependency group | 151.8 ns | 45.1 ns | 3.31x faster |
| 32 slots, relevant dependency group | 164.0 ns | 168.4 ns | 0.97x |
| 32 slots, all groups relevant | 162.3 ns | 176.3 ns | 0.92x |
| Single cheap slot, relevant | 41.1 ns | 32.4 ns | 1.27x |

The `filter(2k)` source-write case was intentionally excluded from the summary:
both variants must allocate and filter, and independent-process results ranged
from 1.39x to 3.04x in favor of the masked closure due to JIT/GC variation.
There is no architectural reason to credit masks for that work. Relevant-path
behavior is better isolated by the allocation-free slot scenarios, although
the smallest nanosecond-scale case remains noisy.

## Interpretation

Masks have a large payoff when they prevent expensive unrelated work and a
moderate payoff when they skip a group of cheap expressions. They do not
produce a repeatable win when every dependency group must run.

The single-slot case is too small for a stable conclusion: an earlier
three-process set measured the masked form about 12% slower, while the latest
set measured it faster and one process in that set was slower. This benchmark
therefore supports skipping substantial unrelated work, not universal masks or
a precise cheap-path overhead claim.

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

The production R25 implementation now follows points 1-5 without adopting the
bitmask representation. It emits no reason channel when every exact local
source reaches every derivation. Selective graphs use one numeric scalar or a
Set of batched reasons and retain ordinary value guards. End-to-end
happy-dom measurements are recorded in `bench/local-derived/README.md`.

## Limits and next measurement

This microbenchmark deliberately excludes access-table routing, scheduling,
list reconciliation, and real DOM writes so it can isolate update evaluation.
It establishes that the mechanism has a plausible and measurable payoff; it
does not establish end-to-end framework improvement.

The next proof should A/B a bitmask branch against the production scalar/Set
representation, compile representative applications, and run the existing
three-way Chromium benchmark plus dedicated cases containing:

- unrelated writes beside a 1k/10k filter;
- chained local derivations;
- 1, 8, 32, and 64 dependency groups;
- batched writes to one versus several groups;
- list-row instances with and without local derivations;
- DOM mutation counts and heap/GC sampling.
