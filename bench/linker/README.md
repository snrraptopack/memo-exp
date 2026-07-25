# Cross-Module Linker Benchmark

> Date: 2026-07-25. Bun on Windows. This measures compiler throughput, not
> application runtime.

Run:

```bash
bun run bench:linker
```

The generated graph contains one state module and one importing TSX view per
pair. Every state module exports a scalar, a module computed, and a mutator.
Every view imports all three through the Vite-style `@` alias.

Each process reports the median of seven alternating samples. The table below
is the median of three independent processes.

| Modules | Source | Prelinked transforms | Linked graph | Linked/module | Overhead |
|---:|---:|---:|---:|---:|---:|
| 2 | 0.3 KiB | 30.7 ms | 105.8 ms | 52.9 ms | 3.53x |
| 8 | 1.1 KiB | 79.5 ms | 245.2 ms | 30.7 ms | 3.08x |
| 16 | 2.3 KiB | 138.5 ms | 411.4 ms | 25.7 ms | 2.97x |

The prelinked baseline parses and transforms the same sources with `compile()`,
stable module IDs, and the same canonical import metadata supplied directly.
It isolates the graph discovery and summary-linking cost.

## Interpretation

The linker currently pays roughly three transforms' worth of additional work:

1. discover local exports and imports;
2. rerun whole-module analysis until summaries converge;
3. run the final linked transform.

The cost scales approximately linearly in this shallow graph, but reparsing
unchanged modules on every fixed-point pass is unnecessary. The next compiler
optimization should cache parsed AST/module facts and use a dependency
worklist: reanalyze only importers whose exported summary can change. This
benchmark is the baseline for that work; correctness must remain covered by
`tests/r15.test.ts`.
