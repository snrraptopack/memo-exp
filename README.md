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
bun run test
bun run typecheck
```

Compile a connected graph when reactive state crosses file boundaries:

```ts
import { compileModules } from './compiler';

const output = compileModules(modules, {
  runtimePath: 'memo-dom',
  aliases: { '@': './src' }, // mirror resolve.alias from Vite
});
```

All compiler paths emit canonical keys such as
`./src/state.ts#store.selectedId`. `compileModules()` resolves named imports
and exact/receiver-bounded function summaries. Pass
`resolveImport(specifier, importer)` for plugin-defined resolution. Cross-file
component imports retain the linked factory, props, children, cleanup, and
canonical state identity.

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
```
