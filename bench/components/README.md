# Cross-File Component Benchmark

> Date: 2026-07-25. Production compiler/runtime output under happy-dom.

Run:

```bash
bun run bench:components
```

## Question

Does graph-linked component composition add runtime work over the same
component declarations compiled in one file, and what does graph linking cost
the compiler?

Both variants author normal TSX and produce the same `App/Child` entity shape.
The linked form leaves a normal ES import between its two generated modules;
there is no runtime component adapter.

Mount samples perform 2,000 mount, insertion, subtree unregister, and removal
operations. Update samples perform 50,000 compiled local-state clicks. Runtime
rows are medians of 11 samples. The compiler row compares one same-file
transform with a two-module `compileModules()` graph and reports the median of
seven alternating samples.

## Results

The table records the median reported value from three independent processes.

| Scenario | Same file | Linked modules | Relative |
|---|---:|---:|---:|
| Mount + unmount | 25,327.9 ns | 25,080.4 ns | 0.99x |
| Local text update | 8,896.3 ns | 9,219.4 ns | 1.04x |
| Compile application graph | 33.2 ms | 135.7 ms | 4.09x |

Mount ratios across processes were `0.90x-0.99x`; update ratios were
`0.85x-1.04x`. These runs support runtime parity, not a linked-component
speedup. The generated linked call uses the same factory ABI as the same-file
call and has no adapter.

Compiler ratios ranged from `3.27x-6.58x`. The linked input contains two
modules rather than one and `compileModules()` currently discovers, repeatedly
analyzes to a fixed point, and finally transforms the graph. This result
reinforces the cached-facts/dependency-worklist priority in `bench/linker`;
component composition does not justify a separate runtime optimization.

## Limits

Happy-dom isolates generated JavaScript and registry overhead but does not
measure browser layout or paint. The compiler comparison intentionally has
different module counts: it records total application compilation latency,
not per-module transform parity. See `bench/linker` for graph scaling.
