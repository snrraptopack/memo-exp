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
runtime with the compiled application. The complete todo JavaScript payload is
only slightly larger in gzip terms than the standalone full-surface runtime.

## Latest Measurement

Windows x64, Bun 1.3.14, esbuild 0.28.1, 2026-07-26:

| Artifact | Raw | Gzip | Files |
|---|---:|---:|---:|
| Production runtime graph | 13,747 B | 5,855 B | 2 |
| Externalized compiler artifact | 87,175 B | 24,131 B | 1 |
| Externalized Vite adapter | 4,270 B | 1,938 B | 1 |
| Vite todo browser bundle | 16,954 B | 6,127 B | 1 |

The prior todo bundle observed before the package split was 34.6 KiB raw.
The current figure is produced by Vite over authored source through the public
adapter; no checked-in generated modules or manual esbuild step are involved.
Against the immediately previous manual bundle (`27,515 B` raw, `7,292 B`
gzip), Vite reduces this application by about 38% raw and 16% gzip.
