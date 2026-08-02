# memoized-dom

Analyzed, memoized real-DOM rendering for plain TypeScript + JSX.

Start with:

- `memoized-dom-paradigm.md` for the product and architecture constraints.
- `emission-spec.md` for the normative compiler contract.
- `ref-design.md` for compiler-native DOM refs, forwarding, and teardown.
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
| `@memoized-dom/vite` | Vite 8 graph collection, linked transforms, compiler feedback, and component HMR |

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

Pure module-level control flow can derive exported reactive values:

```tsx
// theme.ts
import { darkMode } from './settings';

export let theme;
if (darkMode) theme = darkTheme;
else theme = lightTheme;
```

The owning module emits a singleton computed entity. Imported sources and
exported results retain canonical cross-module routing, and readers update
only when the selected value changes.

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

Run the multi-module todo application through that adapter:

```bash
bun run example:dev
bun run example:build
bun run example:preview
```

The application under `examples/` imports only authored modules. Vite owns
resolution, graph collection, production bundling, and development reloads.

Static component children use lazy compiler-owned content slots:

```tsx
function Frame(props) {
  return <section>{props.children}</section>;
}

function App() {
  return <Frame><strong>Ready</strong></Frame>;
}
```

JSX may also travel through a named prop when the callee renders that prop as
its sole host content:

```tsx
function Frame({ content }) {
  return <section>{content}</section>;
}

function App() {
  const views = {
    ready: <strong>Ready</strong>,
    waiting: <em>Waiting</em>,
  };
  return <Frame content={views[status]} />;
}
```

The compiler lowers the selected value to a caller-owned mount slot and a
finite conditional region. It does not create a virtual-node value. A prop
cannot be used as both scalar data and JSX content in one linked application.

Reactive side effects use the compiler intrinsic `effect`. Dependencies are
discovered statically; a returned teardown runs before a rerun and when the
owning component unmounts:

```tsx
function App() {
  const sync = () => {
    const connection = connect(activeRoom);
    return () => connection.disconnect();
  };

  if (enabled) effect(sync);

  return <strong>{activeRoom}</strong>;
}
```

Conditional effects use a stable controller. While the condition is false no
callback entity exists; entering creates and runs it, dependency changes rerun
the active callback with teardown first, and leaving tears it down. Module
effects support the same local named and conditional forms as singleton
entities.

Use `cleanup(disposer)` for component-owned resources that are not reactive
effects.

Direct module-scope effects are linked singleton entities. Imported reactive
state participates through its defining-module identity, and the latest
teardown runs during module reevaluation/HMR disposal.

Component-local JSX render values and finite dynamic tags compile through the
same stable DOM regions:

```tsx
const fallback = <p>Waiting</p>;
const Tag = compact ? 'section' : 'article';
const View = detailed ? Details : Summary;
const Host = chooseHost(compact); // finite returns or linked return type

return <Tag>{ready ? <View /> : fallback}</Tag>;
```

Finite intrinsic candidates may come from local helper returns, an imported
helper's string-literal return contract, or a typed intrinsic registry.
Finite linked component candidates may also come from an imported helper or
registry when every candidate component is exported:

```tsx
import { selectView } from './views';

const View = selectView(mode);
return <View value={value} />;
```

JSX-returning local functions are compile-time render helpers. They support
pure return `if`/`switch` flow and may be used directly as a map callback:

```tsx
function renderStatus(status) {
  if (status === 'ready') return <strong>Ready</strong>;
  return <em>Waiting</em>;
}

const renderItem = item => <li key={item.id}>{item.label}</li>;

return <main>
  {renderStatus(status)}
  <ul>{items.map(renderItem)}</ul>
</main>;
```

Static JSX arrays render directly and flatten nested arrays/static spreads.
Conditional entries still use stable conditional regions, while `.map()`
entries use keyed list regions. Mutable runtime JSX arrays are not virtual-node
values; use `.map()` over reactive data instead.

Trusted raw markup can use reactive `innerHTML={markup}`. It is unsanitized and
cannot be combined with compiler-managed children on the same element.

Pure exhaustive component `if`/`switch` calculations participate in the
source-ordered render prelude. JSX early returns, JSX-returning terminal
switches, and chained JSX ternaries lower to stable structural regions; the
component factory is not rerun when a branch changes.

DOM refs use the normal JSX attribute without a wrapper:

```tsx
let input: HTMLInputElement | undefined;
return <input ref={input} />;
```

Mutable refs are assigned once and conditionally cleared on structural
teardown. Callback refs may return cleanup, arrays install several refs in
deterministic order, and components forward ref adapters explicitly. Ordinary
`ref` properties also travel through spreads; no public ref-key API exists.

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

Agent code-health checks should run Fallow from the package being analyzed:

```bash
cd packages/compiler
fallow list
fallow dead-code
fallow health --hotspots --targets
fallow audit --base HEAD~1
```

or simply fallow to get a general issues on all categories

Treat findings as candidates: trace removals, avoid blind auto-fixes, and run
the repository tests and typecheck after edits.
