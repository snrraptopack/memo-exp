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
| `src/analysis.ts` | Stable analysis facade and ordered pass orchestration |
| `src/context.ts` | Stable facade for shared context types and AST utilities |
| `src/effects.ts` | Stable facade for effect discovery and emission |
| `src/emit.ts` | Host JSX DOM emission and structural-region dispatch |
| `src/handlers.ts` | Handler resolution and callback instrumentation |
| `src/linker.ts` | Connected module-graph compilation |
| `src/module-control-flow.ts` | Pure module if/switch computed classification |
| `src/plugin.ts` | Parser-neutral pass ordering and final module rewrite |
| `src/router.ts` | Linked JSX route graph, directive validation, and navigation lowering |

Domain folders keep related implementation details discoverable:

| Folder | Responsibility |
|---|---|
| `src/analysis/` | Module discovery, component validation, read attribution, computeds, instance preludes, and access tables |
| `src/components/` | Prop contracts, content/ref slots, and linker manifests |
| `src/context/` | Compiler data model/context construction and raw AST helpers |
| `src/effects/` | Effect ownership, dependency discovery, invalidation, registration, and rewriting |
| `src/emission/` | Component factories and generated list/conditional/route regions |
| `src/handlers/` | Mutation traversal and commit-routing analysis |
| `src/jsx/` | Ordered attributes, child classification, refs, and namespaces |
| `src/linking/` | Linker graph contracts, module resolution, and cross-module import metadata |
| `src/features/data-sources/` | Transparent-source discovery, analysis, policy, subscriptions, and read lowering |

The top-level analysis, context, emitter, and handler modules intentionally
remain stable facades. Cross-domain callers use those facades; implementation
modules within a domain import their siblings directly.

## Architecture and evolution rules

Model compiler work as an explicit pipeline of domain passes. A pass receives
the compiler context and AST, performs one named responsibility, and leaves the
context in a documented state for the next pass. Top-level modules coordinate
passes and provide stable compatibility exports; they must not grow a second
implementation of domain behavior.

Use a hybrid functional model:

- Keep AST analysis and rewriting as focused functions with explicit inputs.
- Use interfaces and named types for stable data exchanged between phases.
- Use a small class only when an object owns real mutable state and a lifecycle.
- Do not introduce inheritance merely to group helper functions.
- Keep policy decisions separate from AST construction when they can vary
  independently.

Every rule has one owner. Before adding a helper or pass, search the compiler
for the same operation, AST shape, diagnostic, or runtime-helper construction.
Extend or move the existing implementation when it already owns that rule.
Do not copy it into a new domain, facade, frontend, or linker path.

The following are required for current and future development:

- Facades re-export or orchestrate; they do not duplicate implementations.
- Domain modules may import sibling internals, while external callers use the
  domain index or an established top-level facade.
- Shared contracts get one named type instead of repeated inline object shapes.
- Generic AST access and construction belong in `src/ast/`; do not create local
  variants of identifier, literal, field-access, or cloning helpers.
- A new specialized helper stays in its owning domain until a second genuine
  consumer proves a broader abstraction is needed.
- When moving code, move its tests and documentation responsibility with it;
  do not leave a compatibility copy behind.
- Any architectural change must update this README in the same milestone.

Code review should reject duplicated rules even when both copies currently
produce the same output. Parallel implementations drift in diagnostics,
source-location behavior, and runtime semantics.

Shared compiler contracts have canonical owners:

| Contract | Owner |
|---|---|
| `CompilerPath`, `ProgramPath`, `ComponentPath`, and `HelperPath` | `src/context/model.ts` |
| Binding resolution and declaration lookup, including `variableDeclaratorFor` | `src/context/ast.ts` |

Import these contracts through the stable `src/context.ts` facade. Do not
derive local path aliases from `Ctx` or repeat parent-walking binding helpers.

### Analysis pipeline

`src/analysis.ts` is the shallow coordinator for the first compiler pass. It
defines ordering because several analyses consume metadata or normalized AST
produced by earlier stages; it does not own their implementations.

| Module | Responsibility |
|---|---|
| `module-scan.ts` | Linked-import validation and discovery of module state, helpers, and components |
| `render-props.ts` | JSX-carrying component prop discovery, including scalar type exclusions |
| `component-validation.ts` | Component composition edges and structural JSX diagnostics |
| `read-collection.ts` | Module-state reads, list/conditional ownership, and helper-read attribution |
| `computed.ts` | Module computed-state discovery and dependency analysis |
| `instance.ts` | Component-local state and ordered derivation discovery |
| `instance-control-flow.ts` | Replay planning for component-local control flow |
| `component-reads.ts` | Read propagation across render-callback subtrees |
| `component-graph.ts` | Component path expansion and lightweight-list classification |
| `access-table.ts` | Final route table from writes to affected component entities |

Keep dependencies directed from focused discovery/validation modules into the
coordinator. A domain module may record facts on `Ctx`, but pass ordering stays
in `runAnalysis`; do not create a second partial pipeline in a caller.

### Handler analysis model

`src/handlers.ts` owns handler discovery and is the stable entry point used by
components, effects, and callbacks. Mutation analysis is split by concern:

| Module | Responsibility |
|---|---|
| `handlers/analyze.ts` | Reactive-origin tracking and write classification for one callback |
| `handlers/traversal.ts` | Scope-aware handler paths and visitor dispatch |
| `handlers/mutation-targets.ts` | Keyed-list mutation keys and cross-list visibility decisions |
| `handlers/execution-sites.ts` | Execution-aware write guards and final commit insertion |
| `handlers/local-calls.ts` | Reachable local-helper call constraints |

`HandlerPath` is intentionally a class: each path owns its node, parent chain,
scope lookup, and mutable traversal skip state for one walk. This is the kind
of lifecycle-bearing object allowed by the hybrid model. Write policy and AST
rewrites remain functions; do not move them onto the class or create parallel
path wrappers in handler consumers.

### Effect pipeline

The compiler intrinsic `effect()` crosses analysis and emission, but each rule
still has one owner:

| Module | Responsibility |
|---|---|
| `effects/discovery.ts` | Callback resolution, ownership, dependency reads, and effect-site metadata |
| `effects/emission.ts` | Local invalidation conditions, runtime registration, module rewriting, and final ownership rejection |
| `effects.ts` | Compatibility exports only |

Discovery produces `EffectSite` and `ModuleEffectSite` records on `Ctx`;
emission consumes those records. Keep that dependency one-way. Callback
resolution and intrinsic recognition must not be reimplemented in emitters or
handler analysis.

### List emission

List emission separates region/row construction from update scheduling:

| Module | Responsibility |
|---|---|
| `emission/authored-slots.ts` | Authored children/render-value slot construction through injected node and region emitters |
| `emission/component-call.ts` | Nested component props, render slots/callbacks, child identity, and prop replay |
| `emission/host-element.ts` | Intrinsic element creation, attributes/events/refs, direct children, and dynamic DOM writes |
| `emission/text-node.ts` | Text normalization, DOM creation, guarded writes, and transparent-source registration |
| `emission/list-region.ts` | Region setup and selection of callback, component, or inline row strategy |
| `emission/list-component-row.ts` | Component-row factory ABI, prop projection, and lightweight-row updates |
| `emission/list-inline-row.ts` | Inline-row scopes, bindings, registration, and update closure construction |
| `emission/list-update.ts` | Full reconcile versus targeted keyed refresh decisions and emitted update statements |
| `emission/text-node.ts` | Static/dynamic text creation, normalization, guarded slots, and transparent-source registration |
| `lists/targeted-refresh.ts` | Analysis-time dependency discovery consumed by list emission |

`list-update.ts` is the sole owner of reason matching and keyed refresh
selection. Row factories supply metadata to it; they must not construct a
second version of targeted-versus-structural update policy.

### Module linking

| Module | Responsibility |
|---|---|
| `linking/model.ts` | Canonical public options plus internal manifest, export, import, usage, and module-entry contracts |
| `linking/options.ts` | Translation from linker options into per-module compiler options |
| `linking/discovery.ts` | AST manifest discovery, component usage analysis, and linked re-analysis |
| `linking/resolution.ts` | Module ID normalization/resolution and conversion of manifest exports into linked imports |
| `linker.ts` | Fixed-point orchestration, application-root validation, and final connected compilation |

Keep host resolution and alias behavior in `linking/resolution.ts`. Discovery
and compilation consume its resolved entries; they must not grow separate
extension probing or alias matching rules.

### Transparent data-source model

The transparent data-source feature is split by compiler phase:

| Module | Responsibility |
|---|---|
| `discovery.ts` | Imported API recognition and authored source discovery |
| `module-sources.ts` | Module-scope source registration and declaration lowering |
| `component-sources.ts` | Component-local sources, event assignments, and validation |
| `policy-arguments.ts` | Runtime policy arguments and source mount construction |
| `subscriptions.ts` | Dependency metadata and emitted invalidation subscriptions |
| `read-analysis.ts` | Binding identity, site classification, and dependency analysis |
| `read-transforms.ts` | Reusable AST mutations for resolved-value reads and effects |
| `module-read-lowering.ts` | Materializing reads for imported module source references |
| `automatic-sites.ts` | Automatic pending/error render-policy sites and renderer metadata |
| `read-rewriting.ts` | Ordered orchestration of component read lowering |
| `group-analysis.ts` | Shared source origins and component-prop analysis for Group and TSRX |
| `group-policy-components.ts` | Captured-variable analysis and generated presentation components |
| `suspend-directive.ts` | Shared validation and consumption of the compiler-owned `suspend` directive |
| `tsrx-boundaries.ts` | TSRX try/pending/catch metadata and boundary lowering |
| `group-lowering.ts` | JSX Group validation, render-policy lowering, and pass orchestration |
| `index.ts` | Stable public surface for the feature |

The dependency direction is discovery/analysis → transforms → orchestration.
Emission metadata and policy construction are shared domain services. Avoid
imports from a lower-level module back into the coordinator or top-level facade.

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
