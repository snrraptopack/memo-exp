# Package Size

This suite measures the built production runtime graph, the externalized
compiler and Vite adapter artifacts, and the bundled multi-module todo
example. For split ESM graphs it follows static imports and sums each file's
raw and gzip size.

Run package builds and the real Vite todo application first:

```bash
bun run build
bun run example:build
bun run bench:size
```

The compiler figure excludes its external Babel dependencies. The Vite
adapter excludes Vite and the compiler package. The todo figure is the useful
browser check: compiler and development tooling must not appear in it.

The standalone runtime figure includes its full public production surface,
flattened by the package build into one shared implementation chunk plus its
entry. It is not added to the todo figure: Vite rebundles and recompresses the
runtime with the compiled application.

These are three different numbers:

- the standalone runtime graph is the complete public feature surface;
- a production application retains only the runtime closure reached by its
  generated calls;
- an application bundle includes that closure plus generated application code
  and authored dependencies.

Gzip sizes are not additive, so the standalone runtime gzip size must not be
reported as the runtime's contribution to an application bundle.

## Latest Measurement

Windows x64, Bun 1.3.14, esbuild 0.28.1, 2026-07-30:

| Artifact | Raw | Gzip | Files |
|---|---:|---:|---:|
| Production runtime graph | 16,747 B | 6,813 B | 2 |
| Externalized compiler artifact | 188,923 B | 50,398 B | 1 |
| Externalized Vite adapter | 4,270 B | 1,938 B | 1 |
| Vite todo browser bundle | 32,248 B | 8,891 B | 1 |

The prior todo bundle observed before the package split was 34.6 KiB raw.
The current figure is produced by Vite over authored source through the public
adapter; no checked-in generated modules or manual esbuild step are involved.
