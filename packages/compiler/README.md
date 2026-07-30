# Compiler

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

Domain folders keep related implementation details discoverable:

| Folder | Responsibility |
|---|---|
| `src/analysis/` | Computeds, component paths, instance preludes, and access tables |
| `src/components/` | Prop contracts, content/ref slots, and linker manifests |
| `src/context/` | Compiler data model/context construction and raw AST helpers |
| `src/emission/` | Component factories, generated scopes, and list/conditional regions |
| `src/handlers/` | Mutation traversal and commit-routing analysis |
| `src/jsx/` | Ordered attributes, child classification, refs, and namespaces |

The top-level analysis, context, emitter, and handler modules intentionally
remain stable facades. Cross-domain callers use those facades; implementation
modules within a domain import their siblings directly.
