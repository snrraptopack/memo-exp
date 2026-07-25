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
`resolveImport(specifier, importer)` for
plugin-defined resolution. Cross-file component imports remain unsupported.

Run the Chromium benchmark:

```bash
bun run bench
bun run bench:invalidation
bun run bench:linker
```
