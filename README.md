# memoized-dom

Analyzed, memoized real-DOM rendering for plain TypeScript + JSX.

Start with:

- `memoized-dom-paradigm.md` for the product and architecture constraints.
- `emission-spec.md` for the normative compiler contract.
- `architecture-review.md` for current implementation status and priorities.
- `bench/README.md` for benchmark suites and their latest measurements.

Install dependencies:

```bash
bun install
```

Run tests:

```bash
bun run build
bun run test
bun run typecheck
```

The repository is a Bun workspace with independent packages:

| Package | Ownership |
|---|---|
| `@memoized-dom/runtime` | Dependency-free browser registry, routing, regions, lifecycle, and DOM updates |
| `@memoized-dom/compiler` | Babel-based analysis, linking, and TypeScript/JSX emission |
| `@memoized-dom/vite` | Vite 8 graph collection, linked transforms, and conservative full-reload HMR |

Root dependencies are development tools only. Babel dependencies belong to the
compiler package; Happy DOM, Vitest, Puppeteer, esbuild, TypeScript, and type
packages are not runtime dependencies.

Compile a connected graph when reactive state crosses file boundaries:

```ts
import { compileModules } from '@memoized-dom/compiler';

const output = compileModules(modules, {
  aliases: { '@': './src' }, // mirror resolve.alias from Vite
});
```

The default emitted runtime import is `@memoized-dom/runtime`.
All compiler paths emit canonical keys such as
`./src/state.ts#store.selectedId`. `compileModules()` resolves named imports
and exact/receiver-bounded function summaries. Pass
`resolveImport(specifier, importer)` for plugin-defined resolution. Cross-file
component imports retain the linked factory, props, children, cleanup, and
canonical state identity.

For Vite applications, configure the graph entry once and let Vite provide
the real alias and extension resolution:

```ts
import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';

export default defineConfig({
  plugins: [memoizedDom({ entries: 'src/App.tsx', rootId: 'App' })],
});
```

See `packages/vite/README.md` for the adapter and HMR contract.

Static component children use lazy compiler-owned content slots:

```tsx
function Frame(props) {
  return <section>{props.children}</section>;
}

function App() {
  return <Frame><strong>Ready</strong></Frame>;
}
```

Run the Chromium benchmark:

```bash
bun run bench
bun run bench:effects
bun run bench:invalidation
bun run bench:linker
bun run bench:lifecycle
bun run bench:children
bun run bench:components
bun run bench:local-state
bun run bench:jsx
bun run bench:vite
bun run bench:size
```
