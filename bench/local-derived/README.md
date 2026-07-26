# Local Derived Replay Benchmark

> Production compiler/runtime output under happy-dom.

Run:

```bash
bun run bench:local-derived
```

## Question

Can a component update replay only the local derivations reachable from the
state written by that update, while retaining conservative full replay for
unscoped invalidations?

The generated application has 32 independent instance-state values and 32
corresponding derivations. Each derivation performs 128 deterministic integer
rounds. One button updates the first derivation's dependency; another updates
state read directly by the DOM but by no derivation.

Every process reports the median of seven samples. Each sample measures 1,500
synchronous production updates after 250 warmups and validates the changed DOM
output.

## Baseline

Before dependency-selected replay, both updates replay all 32 derivations.
The table records the per-cell median from three independent processes on
2026-07-26 with Bun 1.3.14 on Windows.

| Update | Baseline |
|---|---:|
| One dependency | 52,206.5 ns |
| Unrelated state | 49,881.7 ns |

The similar costs are the expected failure mode: neither update carries a
dependency reason, so both execute all 32 expensive derivations.

## Selective Replay

After dependency-selected replay, the table records the per-cell median from
three independent processes under the same environment:

| Update | Baseline | Selective | Speedup |
|---|---:|---:|---:|
| One dependency | 52,206.5 ns | 40,243.5 ns | 1.30x |
| Unrelated state | 49,881.7 ns | 30,357.4 ns | 1.64x |

The relevant update replays one derivation; the unrelated update replays none.
Both still execute event dispatch, runtime scheduling, the owner update, and
guarded DOM expressions. Process variance was substantial, so these numbers
support removing unrelated derivation work but do not isolate kernel or DOM
performance.
