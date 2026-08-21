# Compiler

Requires Node.js 24.11 or newer. The compiler uses Babel 8, whose supported
Node.js range does not include Node 20 or earlier Node 24 releases.

Public compilation APIs:

- `compile(source, options)` returns JavaScript and keeps the allocation-light
  legacy path.
- `compileDetailed(source, options)` returns `{ code, map }` with authored TSX
  in `sourcesContent`.
- `compileModulesDetailed(modules, options)` returns linked `output`, one map
  per module in `maps`, component `metadata`, and root metadata derived from an
  ordinary entry module's top-level `mount(target, Component)` call.

The top-level files are orchestration and whole-program passes:

| Path | Responsibility |
|---|---|
| `src/analysis.ts` | Analysis orchestration, JSX validation, and read attribution |
| `src/context.ts` | Stable facade for shared context types and AST utilities |
| `src/emit.ts` | Host JSX DOM emission and structural-region dispatch |
| `src/handlers.ts` | Handler resolution and callback instrumentation |
| `src/linker.ts` | Connected module-graph compilation |
| `src/module-control-flow.ts` | Pure module if/switch computed classification |
| `src/plugin.ts` | Babel pass ordering and final module rewrite |
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

Projects that do not already include the compiler's global JSX declarations can
load the published directive types with `"types": ["@memoized-dom/compiler/jsx"]`
in `tsconfig.json`. TypeScript then checks the slash-prefixed surface shape;
the compiler/language service performs the stronger application-graph checks.
