# DOM List Benchmark

> Latest run: 2026-07-25. Real headless Chromium on Windows.

Run:

```bash
bun run bench
```

`build.ts` links and compiles the component-row and inline-row TSX sources,
then esbuild bundles them with the vanilla implementation. Each operation is
the median of seven samples. The table is the median of three independent
Chromium processes.

## Latest Results

| Scenario | Component rows | Inline rows | Vanilla | Component/vanilla | Inline/vanilla |
|---|---:|---:|---:|---:|---:|
| create 1k | 18.1 ms | 28.6 ms | 8.3 ms | 2.18x | 3.45x |
| replace 1k | 17.7 ms | 24.5 ms | 7.6 ms | 2.33x | 3.22x |
| partial update | 0.7 ms | 0.7 ms | 0.4 ms | 1.75x | 1.75x |
| select row | 0.5 ms | 1.8 ms | 0.2 ms | 2.50x | 9.00x |
| swap rows | 1.5 ms | 2.1 ms | 0.1 ms | 15.00x | 21.00x |
| remove row | 1.1 ms | 1.1 ms | <=0.1 ms | noisy | noisy |
| create 10k | 131.1 ms | 196.3 ms | 66.2 ms | 1.98x | 2.97x |
| append 1k to 10k | 26.7 ms | 34.2 ms | 6.2 ms | 4.31x | 5.52x |
| clear 10k | 16.9 ms | 37.7 ms | 3.4 ms | 4.97x | 11.09x |

## Interpretation

The current compiler does not beat vanilla end to end. Component rows are
materially better than inline rows for creation, selection, append, and clear,
which supports retaining component-row specialization. Swap is the largest
relative gap and should be profiled through keyed reconciliation and DOM move
counts. Clear and append are the next high-value paths.

The sub-millisecond cases approach `performance.now()` resolution and should
not be used for fine-grained percentage claims. Any optimization claim needs a
before/after run of this suite plus DOM mutation and heap/GC measurements.
