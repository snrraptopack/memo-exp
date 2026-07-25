# Benchmarks

Each benchmark is a self-contained suite with its runner, sources, methodology,
latest measurements, limits, and interpretation.

| Suite | Command | Measures |
|---|---|---|
| [`dom`](./dom/) | `bun run bench` | End-to-end list operations in real Chromium |
| [`effects`](./effects/) | `bun run bench:effects` | Production receiver-bounded versus root invalidation |
| [`invalidation`](./invalidation/) | `bun run bench:invalidation` | Dirty-reason mask update-evaluation prototype |
| [`linker`](./linker/) | `bun run bench:linker` | Cross-module compiler/linker throughput |
| [`lifecycle`](./lifecycle/) | `bun run bench:lifecycle` | Production cleanup ownership and entity teardown |
| [`children`](./children/) | `bun run bench:children` | Production component children mount/update overhead |

Numbers are machine-local and must be compared using repeated processes on the
same machine. A mechanism-level benchmark is not evidence of end-to-end
application improvement; each suite README states what is excluded.

The DOM suite owns generated files under `dom/dist/`. Its `build.ts` also
refreshes the tracked compiled component and inline-row sources before each run.
