# Compiler

Requires Node.js 24.11 or newer. Standard JavaScript and TypeScript modules are
parsed by Yuku, while all compiler analysis and emission operates on ESTree.

Public compilation APIs:

- `compile(source, options)` returns JavaScript and keeps the allocation-light
  legacy path.
- `compileDetailed(source, options)` returns `{ code, map, css? }` with authored
  source in `sourcesContent`.
- `compileModulesDetailed(modules, options)` returns linked `output`, one map
  per module in `maps`, optional extracted `css`, component `metadata`, and root
  metadata derived from an ordinary entry module's top-level
  `mount(target, Component)` call.

The top-level files are orchestration and whole-program passes:

| Path | Responsibility |
|---|---|
| `src/analysis.ts` | Analysis orchestration, JSX validation, and read attribution |
| `src/context.ts` | Stable facade for shared context types and AST utilities |
| `src/emit.ts` | Host JSX DOM emission and structural-region dispatch |
| `src/handlers.ts` | Handler resolution and callback instrumentation |
| `src/linker.ts` | Connected module-graph compilation |
| `src/module-control-flow.ts` | Pure module if/switch computed classification |
| `src/plugin.ts` | Parser-neutral pass ordering and final module rewrite |
| `src/router.ts` | Linked JSX route graph, directive validation, and navigation lowering |

Domain folders keep related implementation details discoverable:

| Folder | Responsibility |
|---|---|
| `src/analysis/` | Computeds, component paths, instance preludes, and access tables |
| `src/components/` | Prop contracts, content/ref slots, and linker manifests |
| `src/context/` | Compiler data model/context construction and raw AST helpers |
| `src/emission/` | Component factories and generated list/conditional/route regions |
| `src/handlers/` | Mutation traversal and commit-routing analysis |
| `src/jsx/` | Ordered attributes, child classification, refs, and namespaces |

The top-level analysis, context, emitter, and handler modules intentionally
remain stable facades. Cross-domain callers use those facades; implementation
modules within a domain import their siblings directly.

## Experimental TSRX frontend

Files ending in `.tsrx` are parsed by the official `@tsrx/core` parser and
lowered directly to the ordinary TS-ESTree/JSX consumed by the compiler. The
`.js`, `.jsx`, `.ts`, `.tsx`, and `.d.ts` extensions explicitly select Yuku; the
TSRX path is isolated from the standard parser. Unknown extensions must provide a frontend
explicitly instead of being interpreted through a fallback parser.

The experimental lowering currently supports statement-container function
bodies, `@if`, `@for (... of ...)` with `index`, `key`, and `@empty`, root
`@switch`, finite dynamic intrinsic/component choices, and scoped style
extraction. The implementation is isolated under `src/ast/tsrx` so extension
nodes never enter the compiler's analysis or emission passes. See the repository
`tsrx.md` for conceptual JSX equivalents and the exact host-profile matrix.

Lazy destructuring, `@try`/`@pending`/`@catch`, nested statement containers,
branch-local setup, style expressions, and dynamic selectors without provable
finite candidates currently produce explicit diagnostics. They need Memoized
DOM-specific reactivity or runtime semantics before they can be lowered safely.

The public `createExtensionEstreeFrontend()` utility creates a strict extension
map for specialized frontends. Virtual or extensionless modules must select a
frontend explicitly; TSRX callers can use `experimentalTsrxEstreeFrontend`.

## Compiler-owned routing

`route` and `route-to` are compiler properties, similar to `key`: they are
available on JSX elements but are not ordinary runtime props. Route declarations
must be static slash-prefixed fragments. The compiler composes each declaration
with its nearest route-bearing JSX ancestor, validates the connected module graph,
emits one manifest, and lowers each declaration to an anchored route-selected DOM
region.

Because the compiler sees the whole linked graph, it rejects undeclared
destinations, non-terminal catch-alls, ambiguous patterns, and missing, extra, or
duplicate route parameters. These same diagnostics are exposed through
`diagnoseModules`, Vite, and `@memoized-dom/language-service`.
The structured diagnostic includes an authored start and end location when the
frontend supplies a node range, allowing editor integrations to highlight the
offending expression or JSX attribute precisely.

Projects that do not already include the compiler's global JSX declarations can
load the published directive types with `"types": ["@memoized-dom/compiler/jsx"]`
in `tsconfig.json`. TypeScript then checks the slash-prefixed surface shape;
the compiler/language service performs the stronger application-graph checks.

## Compiler-owned conditional branches

`if`, `else-if`, and `else` are compiler properties for readable sibling
branches. Formatting whitespace and JSX comments do not break a chain, more
than one `else-if` is allowed, and `else` is optional:

```tsx
<p if={status === 'pending'}>Loading...</p>
<p else-if={status === 'error'}>Could not load.</p>
<StoryList else />
```

The compiler removes the properties and lowers the chain to one stable
conditional region. An `else-if` or `else` without a preceding branch is a
compile error. The conditions stay reactive; switching branches updates only
the owned region rather than rerunning the component factory.
