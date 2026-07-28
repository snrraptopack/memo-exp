# Compiler

The top-level files are orchestration and whole-program passes:

| Path | Responsibility |
|---|---|
| `src/analysis.ts` | Binding-aware module/component read analysis |
| `src/context.ts` | Shared analysis facts and canonical identities |
| `src/emit.ts` | JSX DOM and structural-region emission |
| `src/linker.ts` | Connected module-graph compilation |
| `src/module-control-flow.ts` | Pure module if/switch computed classification |
| `src/plugin.ts` | Babel pass ordering and final module rewrite |

Domain folders keep related implementation details discoverable:

| Folder | Responsibility |
|---|---|
| `src/components/` | Prop contracts, content slots, and linker manifests |
| `src/emission/` | Component factory and generated-scope builders |
| `src/jsx/` | Ordered attributes, child classification, and namespaces |

There are no compatibility forwarding files. When a module changes ownership,
imports should point directly to its domain folder.
