# Benchmarks

`bun run bench:size:html` builds stable authored fixtures through the production
Vite HTML pipeline and reports HTML, all emitted JavaScript and separately
compressed sizes in `bench/package-size/dist/html/results.{json,md}`. Static
and larger composed static pages must emit zero JS assets. Interactive fixtures
remain alongside them so static pruning cannot hide the current runtime cost.
The mixed fixtures compare one and sixty static cards around the same counter,
including the ordinary JS-entry DOM-creation build of each authored graph.

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
| [`components`](./components/) | `bun run bench:components` | Same-file versus linked component runtime/compiler cost |
| [`local-state`](./local-state/) | `bun run bench:local-state` | Module versus instance collection row ownership |
| [`local-derived`](./local-derived/) | `bun run bench:local-derived` | Dependency-selected component-local derivation replay |
| [`jsx`](./jsx/) | `bun run bench:jsx` | Specialized versus ordered-spread authored JSX paths |
| [`router`](./router/) | `bun run bench:router` | Cached, warm-varied, construction, and runtime routing paths |
| [`package-size`](./package-size/) | `bun run bench:size` | Built package and real todo browser bundle size |
| [`frameworks`](./frameworks/) | `bun run bench:frameworks` | Current framework update-completion scenarios |
| [`octane`](./octane/) | `bun run bench:octane` | Pinned upstream js-framework and keyed-reorder suites, including memoized-dom |
| [`application`](./frameworks/application/) | `bun run bench:application` | Structured cross-framework application workflows |

Numbers are machine-local and must be compared using repeated processes on the
same machine. A mechanism-level benchmark is not evidence of end-to-end
application improvement; each suite README states what is excluded.

The DOM suite owns generated files under `dom/dist/`. Its `build.ts` also
refreshes the tracked compiled component and inline-row sources before each run.
