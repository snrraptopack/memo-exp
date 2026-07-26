# Compiler Layout

The top-level files are orchestration and whole-program passes:

| Path | Responsibility |
|---|---|
| `analysis.ts` | Binding-aware module/component read analysis |
| `context.ts` | Shared analysis facts and canonical identities |
| `emit.ts` | JSX DOM and structural-region emission |
| `linker.ts` | Connected module-graph compilation |
| `plugin.ts` | Babel pass ordering and final module rewrite |

Domain folders keep related implementation details discoverable:

| Folder | Responsibility |
|---|---|
| `components/` | Prop contracts, content slots, and linker manifests |
| `emission/` | Component factory and generated-scope builders |
| `jsx/` | Ordered attributes, child classification, and namespaces |

There are no compatibility forwarding files. When a module changes ownership,
imports should point directly to its domain folder.
