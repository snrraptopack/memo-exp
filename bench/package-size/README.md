# Package Size

This suite measures the built production runtime graph, the externalized
compiler artifact, and the bundled multi-module todo example. For split ESM
graphs it follows static imports and sums each file's raw and gzip size.

Run package builds and the todo bundle first:

```bash
bun run build
bun run examples/build-todo.ts
npx esbuild examples/entry.ts --bundle --outfile=examples/dist/bundle.js
bun run bench:size
```

The compiler figure excludes its external Babel dependencies. The todo figure
is the useful browser check: compiler and development tooling must not appear
in it.

## Latest Measurement

Windows x64, Bun 1.3.14, esbuild 0.28.1, 2026-07-26:

| Artifact | Raw | Gzip | Files |
|---|---:|---:|---:|
| Production runtime graph | 13,747 B | 5,855 B | 2 |
| Externalized compiler artifact | 86,469 B | 23,921 B | 1 |
| Todo browser bundle | 27,515 B | 7,292 B | 1 |

The prior todo bundle observed before the package split was 34.6 KiB raw. The
current 26.9 KiB bundle is about 22% smaller; this is a size result, not a
runtime-throughput claim.
