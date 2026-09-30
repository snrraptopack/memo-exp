# Package Size

This suite measures the built production runtime graph, the externalized
compiler and Vite adapter artifacts, and the bundled multi-module todo
example. For split ESM graphs it follows static imports and sums each file's
raw and gzip size.

Run package builds, then run the size benchmark. The benchmark builds the real
Vite todo application into its own isolated output before measuring it:

```bash
bun run build
bun run bench:size
```

The compiler figure excludes its external parser dependencies. The Vite
adapter excludes Vite and the compiler package. The todo figure is the useful
browser check: compiler and development tooling must not appear in it.

The runtime is reported as separate client, hydration, HMR, and server graphs.
They are not added to the todo figure: Vite rebundles and recompresses the
client runtime with the compiled application.

These are three different numbers:

- the runtime client graph excludes hydration and Node host integration;
- the hydration and server graphs are explicit opt-in boundaries;
- a production application retains only the runtime closure reached by its
  generated calls;
- an application bundle includes that closure plus generated application code
  and authored dependencies.

Gzip sizes are not additive, so the package graph gzip sizes must not be
reported as the runtime's contribution to an application bundle.

The benchmark fails if the Todo browser JavaScript exceeds 30,000 B raw or
11,000 B gzip. The current measurement is 29,869 B raw and 10,850 B gzip
(2026-09-30, with cached row text and routed-reader batching). Before this
optimization iteration it was 29,577 B raw and 10,742 B gzip: the changes add
292 B raw and 108 B gzip to this application.
It also rejects hydration, HMR, and Node host markers in that
browser output.

The live measurements printed by `bun run bench:size` are authoritative; the
budget intentionally leaves a small margin for application-level evolution.

## Canonical key interning estimate

After building an application, run:

```bash
bun run bench/package-size/interning-estimate.ts <assets-directory>
```

The script estimates how much replacing canonical state-key text with short IDs
could save. It substitutes matching text in the final JavaScript chunks and
recompresses them.
It does not produce runnable code or include the dictionary and runtime support
that a real implementation would need.

On 2026-09-30, the todo bundle had 10 distinct keys and 26 occurrences. The
hypothetical substitution saved 521 B raw and 37 B gzip. Fieldnotes had 8 keys
and 61 occurrences across 10 chunks; it saved 1,096 B raw and 74 B gzip.
These small gzip savings do not currently justify adding an integer-key
protocol. The runtime also uses dotted-path prefix matching, independently
installed module fragments, and string keys at API boundaries; an actual
implementation must preserve those behaviors and measure its full cost.
