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
| create 1k | 20.4 ms | 29.0 ms | 7.8 ms | 2.62x | 3.72x |
| replace 1k | 18.1 ms | 23.8 ms | 7.9 ms | 2.29x | 3.01x |
| partial update | 0.7 ms | 0.6 ms | 0.3 ms | 2.33x | 2.00x |
| select row | 0.5 ms | 1.4 ms | 0.2 ms | 2.50x | 7.00x |
| swap rows | 1.6 ms | 2.0 ms | 0.1 ms | 16.00x | 20.00x |
| remove row | 0.9 ms | 1.1 ms | <=0.1 ms | noisy | noisy |
| create 10k | 139.7 ms | 205.0 ms | 65.8 ms | 2.12x | 3.12x |
| append 1k to 10k | 24.5 ms | 38.7 ms | 7.2 ms | 3.40x | 5.38x |
| clear 10k | 17.1 ms | 39.4 ms | 3.5 ms | 4.89x | 11.26x |

## Interpretation

The current compiler does not beat vanilla end to end. Component rows are
materially better than inline rows for creation, selection, append, and clear,
which supports retaining component-row specialization. Swap is the largest
relative gap and should be profiled through keyed reconciliation and DOM move
counts. Clear and append are the next high-value paths.

The sub-millisecond cases approach `performance.now()` resolution and should
not be used for fine-grained percentage claims. Any optimization claim needs a
before/after run of this suite plus DOM mutation and heap/GC measurements.
