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
| 2 | 0.3 KiB | 28.0 ms | 76.4 ms | 38.2 ms | 2.42x |
| 8 | 1.1 KiB | 88.8 ms | 201.0 ms | 25.1 ms | 2.18x |
| 16 | 2.3 KiB | 112.1 ms | 327.0 ms | 20.4 ms | 2.78x |

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

The R17 conservative-provenance checkpoint produced mixed linked medians versus that
run: `121.8`, `241.8`, and `453.4` ms. The 2- and 16-module cases were slower
while the 8-module case was slightly faster; 16-module linked samples ranged
from `353.9` to `464.4` ms across processes. This supports no optimization
claim and reinforces the dependency-worklist priority above.

The R19 bounded-effect summary checkpoint serializes exact, receiver-bounded,
and structured parameter-relative effects. Linked medians were `130.7`,
`329.7`, and `543.8` ms; process ranges were `130.5-133.7`, `322.3-342.6`,
and `531.6-577.4` ms. Absolute times rose from R17, but prelinked medians rose
similarly. Normalized linker overhead is now `3.10x`, `2.62x`, and `3.14x`
versus R17's `3.32x`, `2.63x`, and `3.30x`. This supports no speedup or
regression claim; it records the cost after changing the summary contract.

The R22 component-graph checkpoint adds component export discovery, placement
edges, and one final graph traversal. Linked process ranges were `64.5-87.6`,
`193.8-204.0`, and `312.0-334.5` ms for 2/8/16 modules. The corresponding
prelinked baselines also fell substantially from the R19 run. Normalized
overhead is now `2.42x`, `2.18x`, and `2.78x`; these measurements show no R22
regression but do not isolate or support a speedup claim. Cross-file factory
runtime parity is measured separately in `bench/components/README.md`.

The 2026-07-26 canonical-prop checkpoint adds caller-side prop provenance
collection and one topological propagation over the existing component graph.
Three independent processes produced these per-cell medians:

| Modules | Prelinked | Linked graph | Linked/module | Overhead |
|---:|---:|---:|---:|---:|
| 2 | 61.7 ms | 150.3 ms | 75.2 ms | 2.83x |
| 8 | 154.4 ms | 375.9 ms | 47.0 ms | 2.45x |
| 16 | 222.3 ms | 708.8 ms | 44.3 ms | 3.19x |

The benchmark graph does not pass mutable state through props, so this measures
the unconditional collection cost but does not isolate it from parser,
fixed-point, dependency-version, or machine variance. The result supports no
speedup or regression claim. A dedicated dependency-worklist implementation
still needs an A/B run against this checkpoint.
