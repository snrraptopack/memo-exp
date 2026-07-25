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
| 2 | 0.3 KiB | 33.1 ms | 121.8 ms | 60.9 ms | 3.32x |
| 8 | 1.1 KiB | 95.6 ms | 241.8 ms | 30.2 ms | 2.63x |
| 16 | 2.3 KiB | 140.8 ms | 453.4 ms | 28.3 ms | 3.30x |

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

The compiler-wide identifier-hygiene checkpoint added one source-tree
reservation walk per final transform. Compared with the previous linked medians
(`105.8`, `245.2`, and `411.4` ms), the new linked results are mixed within
process noise (`103.3`, `249.0`, and `404.1` ms). These measurements support no
performance claim in either direction; collision correctness is covered by
`tests/r16.test.ts`.

The R17 opaque-provenance checkpoint produced mixed linked medians versus that
run: `121.8`, `241.8`, and `453.4` ms. The 2- and 16-module cases were slower
while the 8-module case was slightly faster; 16-module linked samples ranged
from `353.9` to `464.4` ms across processes. This supports no optimization
claim and reinforces the dependency-worklist priority above.
