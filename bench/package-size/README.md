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

The benchmark fails if the Todo browser JavaScript exceeds 29,000 B raw or
10,000 B gzip. It also rejects hydration, HMR, and Node host markers in that
browser output.

The live measurements printed by `bun run bench:size` are authoritative; the
budget intentionally leaves a small margin for application-level evolution.
