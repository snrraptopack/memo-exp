# DOM List Benchmark

Run `bun run bench` from the repository root. The build links the component-row
and inline-row TSX sources, bundles them with the vanilla implementation, and
runs each operation in headless Chromium. Each number is the median of seven
samples from one browser process.

The benchmark checks the DOM on fresh 1k and 10k lists before timing:
selecting row 500 must add `danger`, and selecting row 501 must remove it from
row 500 and add it to row 501. This catches invalid timings where a compiled
implementation does no visible selection work.

## Validated selection runs (2026-09-30)

| Run | Rows | Component rows | Inline rows | Vanilla |
|---|---:|---:|---:|---:|
| 1 | 1k | 1.9 ms | 2.6 ms | 0.1 ms |
| 1 | 10k | 19.8 ms | 39.7 ms | 1.0 ms |
| 2 | 1k | 2.0 ms | 2.7 ms | 0.1 ms |
| 2 | 10k | 19.9 ms | 28.4 ms | 0.5 ms |

The previous 0.5 ms component-row selection result was invalid: the selected
class did not change. The access table routed that write to nonexistent
`Row[*]` entities for lightweight component rows. The compiler now routes it
to the owning list, so the DOM updates; both runs above include that work.
Selection still revisits rows across the list. The 10k results show why
`Row[*]` fanout and owner reconciliation remain a performance priority.

These timings vary with browser and machine load. Cases near the timer's
resolution should not support fine-grained percentage claims. Future
optimizations should first preserve the DOM validation and then compare
multiple runs with DOM mutation and heap/GC measurements.
