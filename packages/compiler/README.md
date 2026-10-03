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
| `src/analysis/prepare.ts` | Shared normalization and analysis preparation for manifests and final emission |
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
| `src/planning/` | Target-independent render contracts produced before backend emission |
| `src/handlers/` | Mutation traversal and commit-routing analysis |
| `src/jsx/` | Ordered attributes, child classification, refs, and namespaces |
| `src/linking/` | Linker graph contracts, module resolution, and cross-module import metadata |
| `src/features/data-sources/` | Transparent-source discovery, analysis, policy, subscriptions, and read lowering |

The top-level analysis, context, emitter, and handler modules intentionally
remain stable facades. Cross-domain callers use those facades; implementation
modules within a domain import their siblings directly.

## Architecture and evolution rules

Component return structure is now planned before any component factory is
replaced. `planComponentRendering()` consumes normalized component paths and
receives exact expression-source contracts from `planExpressionSources()` and
authored primitive-pull plans from `planComponentPulls()`, component placement
from `planComponentPlacements()`, structural replay from `planRegionReplays()` and
list semantic inputs from `planComponentListSites()`, then
returns a read-only `ModuleRenderPlan`: component identity/source, direct or
branched JSX returns, semantic source queries, placement, replay, region shapes
and list-site queries. DOM operations,
runtime identifiers and factory ABI belong to `emitDomComponents()`, which
consumes that plan; the DOM component
emitter no longer discovers JSX return control flow. Unsupported returns in a
later component are diagnosed before an earlier component is emitted.

These are partial phase boundaries, not a complete target-neutral IR. Plans refer
to AST nodes owned by this compilation; backend emission consumes those nodes.
Exact slot-source queries no longer read `Ctx`: owner/unknown sources, derivation
roots and callee proof inputs are captured before backend mutation. Emission
maps the resulting source names to runtime reasons. Other expression,
provenance and ownership facts still share `Ctx`, and several
normalization passes still lower runtime calls. The remaining migration and
phase invariants are documented in `docs/compiler-architecture.md`.

Primitive pull plans capture initializer/write dependencies and authored
completion before emission. After lowering handlers, the backend supplies
publication decisions and consumes finalized pull queries for both DOM slots
and derivation replay. Those queries no longer consult mutable `Ctx` or authored
write ASTs. Primitive syntax is shared with list allocation proofs; lexical
eligibility remains specific to each proof.

Placement plans capture row bindings/key paths, local or linked collection
ownership, external inputs, local-effect presence and route ownership. Route
selector analysis batches imported aliases before factory emission. The backend
consumes these facts and attaches runtime IDs; factory ABI, structural regions
and cleanup policy remain backend decisions.

Structural replay contracts capture lexical fixed-position list proofs, module
index eligibility, canonical keys and conditional owner roots/volatility. Their
queries do not consult mutable `Ctx`. Nested rows, branches, routes and content
slots inherit the same lexical contract; clones retain conservative list proofs.
DOM lowering still chooses runtime reasons/operations.

List callback syntax/substitution and conditional branch normalization now have
pure source contracts prepared through `ComponentRegionShapes` after shared
lowering. Normalized row and branch content is planned before factory emission;
cloned attribute/slot content uses the same normalizers on demand. The shared
analysis adapter applies explicit callback source replacements. Nested factories
inherit shapes, replay facts and list semantic inputs through `RegionSourcePlans`,
keeping backend slots/statements fresh. Region identities and mutation journals
retain their existing adapters.

List source/target/key queries use captured roots, state kinds, static-derived
initializers, linked component names and prop references. Shared read collection
and DOM list emission use one semantic planner. The backend allocates occurrence
IDs and applies the explicit callback normalization replacement. Cloned calls
retain conservative source validation; nested lists require explicit parent
ownership. Already lowered async-helper recognition remains a documented
normalization dependency rather than a complete semantic async representation.

Mutation-journal discovery and handler lowering share one indexed-item write
parser. Candidate paths are captured once per component; they do not establish
plain-data or lexical safety on their own. Handler routing retains those checks
before journaling a key. DOM list emission uses frozen unique-source journal
snapshots through `ComponentListSites.mutationFor`, tied to the original map
call. Clones remain unproven and independent consumers disable the journal.
Shared discovery still allocates journal binding/reason names through its
existing adapter; separating that allocation and publication is further work.

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

Module-list content targeting preserves static item indices through the access
table into each reader's pending dirty reasons. Direct list readers can replay
only those rows; an ordinary/full reason or a different source forces ordinary
reconciliation. Reasons are not a shared consumable mutation set, and generic
object-prop equality is unchanged.

The proof currently requires a non-exported, unreassigned module array of closed
flat scalar records, non-escaping item references, and immutable scalar-field
or identity keys. Structural operations, dynamic indices, nested/aliased objects,
unknown consumers, async handlers, and execution-aware effect writes retain
conservative routing. Authored assignments are neither wrapped nor evaluated
again. After initial reconciliation, compiler-proven content updates pass the
fixed-position guarantee to `refreshIndices`, avoiding a collection-wide identity
scan: list refresh reads only the targeted positions. Initial mounting, hydration,
and length mismatches still reconcile. Calls retain content-safe reconciliation:
a method property name cannot prove that retained rows were not mutated. This
bounds a targeted list refresh by the number of targets without turning method
recognition into a language or purity whitelist.

The same closed-record proof can now waive identity and key scans during a broad
list replay, including an opaque pull. The compiler passes a fixed-position
guarantee to `reconcile`; every retained row still receives its ordinary content
refresh. This does not memoize opaque row reads or skip their calls/coercions.
Creation still validates all keys. Hydration, length changes and interrupted
general frames retain ordinary reconciliation. Callback preludes, escaped or
replaced items, accessors, structural operations and mutable keys cannot receive
the guarantee.

Component-owned arrays of closed flat scalar records can also journal executed
indices from canonical increasing `for` loops: one `let` counter, a nonnegative
integer literal start, `< items.length` or a bounded integer literal limit,
and `++` or `+=` with a positive integer literal stride. The counter cannot
have other writes, the collection cannot escape or change shape, and key fields
remain immutable. Only executed item writes add keys to the existing owner
journal; skipped branches schedule no refresh, while broader dirty reasons
retain full reconciliation. Module-owned dynamic indices still use ordinary
routing. Opaque producers, mutable/dynamic bounds, hidden cross-row reads,
setters, aliases and unsupported loop shapes keep the conservative path.
Identifier and quoted string keys on literal records are equivalent for this
proof. Arithmetic/comparison field reads remain reads; assignment patterns,
updates, deletes and loop targets prevent a read-only item proof.

Later field assignments may compute their new value from the same addressed
record's own primitive fields. The compiler checks the actual collection and
index bindings: a literal module index or a proven owner loop counter must
identify the same row on both sides. Arithmetic, bitwise, comparison, logical,
conditional and template expressions preserve this proof when every operand is
primitive. For example, `items[i].label = items[i].label + '!'` can use the same
targeted path as `+=` on a closed list. Other-row reads, unknown fields/calls,
getters, object/Symbol/BigInt operands, key writes and escaped storage retain
ordinary reconciliation. Reads outside such assignments remain conservative.
Direct `eval` or dynamic scope disables the closed-list proof: string-driven
access can install setters or escape records without visible source references.

Closed arrays can be initialized directly or through a stable local synchronous
factory that only returns a fresh array literal. Function declarations and
`const` function/arrow expressions qualify when every parameter is an unmodified
identifier and every supplied argument is a proven primitive literal expression.
Record fields may combine those parameters with literals through primitive
arithmetic, bitwise, comparison, logical/conditional, template and unary
expressions. Authored later writes must independently
preserve the plain scalar shape. Shared returned arrays, imported/opaque calls,
other factory statements, defaults/rest/destructuring, async/generator functions,
getters, spreads, nested values and captured field values retain existing
conservative routing or derived-state diagnostics. The proof checks lexical
bindings and fresh allocations; it does not infer purity from a function name.

Straight-line factory bodies may also declare primitive `const` values and name
the fresh literal array through `const` aliases before returning it. Every array
reference must be another closed alias or the final return. Calls, writes,
property reads, control flow, destructuring, shared arrays and escapes reject
the proof. This extends literal producer support; imported/dynamic generators
and later structural replacements still retain ordinary reconciliation.

Array elements may also call a stable local record factory. The same closed
factory proof requires a fresh object literal, primitive arguments/fields and
unmodified identifier parameters; straight-line primitive constants and object
aliases are allowed. Every object reference must be a closed alias or the final
return. Each call's arguments are checked in its caller's lexical scope, while
the returned fields are checked against the factory's own parameters and locals.
Captured values, shared records, imported/opaque factories, getters, spreads,
computed/duplicate fields, nested values and escaped objects keep the fallback.
The proof does not replace or reevaluate authored factory calls. Indexed-fill
loops remain unproven: a fresh array alone cannot prevent inherited index setters
from observing assignments or changing its shape.

Dynamic text updates in list rows normalize the expression on every replay and
compare it with a compiler-owned string slot before writing `Text.data`. The creation path
still seeds through `setTextData`, which also handles adopted server text. This
reduces DOM reads during broad list refreshes; it does not make those refreshes
key-targeted or change the conservative list-method fallback.

Private local component rows that read only one named props field, such as
`props.item`, can use the existing positional lightweight row ABI. The
`components/private-row-props.ts` pass requires every call to be a direct keyed
map row supplying precisely that field. It checks lexical bindings and excludes
exports, factory escapes, whole-envelope reads or writes, receiver calls/tags,
defaults, computed fields, spreads, extra props, member tags, lifecycle/child-component shapes,
dynamic scope and hot compilation. Proven local rows can use this ABI even when
linking supplied their row metadata; public/imported contracts retain their
existing representation. Record getters, mutations and opaque calls still replay
through the ordinary conservative path. The next prop value is evaluated before
replacing the retained row's captured binding.

List callbacks also retain synchronous expression statements before their final
JSX return, such as logging or calling an inspection helper. They run once before
the row's creation and once per row replay; their reads participate in routing.
These callbacks retain full reconciliation instead of narrower keyed/content
refreshes, because unknown calls do not prove that other rows can be skipped.
Existing assignment, update, and async render-expression restrictions still apply.

### Opaque pull precision

Volatile components keep polling unknown values. Within an owner that already
has exact dirty reasons, primitive local slots can ignore a pull-only reason
when their initializers and every later write remain proven primitive. Future
writes must belong to instrumented boundaries whose authored operations prove
normal completion. Unknown calls, getters, external reassignment, dynamic scope
and potentially throwing callbacks keep the wildcard fallback.

The proof runs after handler emission. Mixed pull/write batches still open the
slots and calculations for the actual writes; a full update opens every gate.
Ordinary primitive identifier derivations use the same proof to skip pull-only
replay, preserving source order. Adjacent calculations group only when their
dependencies and pull policies both match. Destructuring, custom replays,
structural regions and unknown expressions retain conservative replay.

Control-flow results remain conservative even when their assigned values are
primitive: an opaque condition can select a different value during a pull.
Derived values and DOM slots depending on those results retain pulls too.

Linked function summaries carry an optional `opaqueReads` flag independently
of routed reads and write effects. Nested helpers and explicit re-export aliases
preserve that flag. Imported read-only opaque helpers therefore retain volatile
controls and registered component rows without inventing unbounded writes.
Captured opaque receiver mutations and calls retain conservative effects and
cannot be replayed as pure control calculations.

Pure `if`/`switch` calculations can have only opaque inputs. Control analysis
attributes those inputs by lexical binding, including captures inside visible
component and module helpers, and marks their owner volatile even when JSX
contains no direct opaque read. Partial controls retain initializer resets.
Property keys and shadowed parameters do not contribute captured reads;
side-effectful setup controls stay outside replay. Visible helpers that write
reactive or opaque inputs are diagnosed rather than replayed as calculations.

Volatile component rows retain registered entities and the normal factory ABI,
including through linked exports, so their independent pulls and disposal work
without requiring a parent-list update.

Component-scope helpers are instrumented without row-scope updater identifiers.
Conservative commits retain the current component owner alongside the fallback
root, including callbacks that run later or owners mounted outside that root.

### List-method optimization candidates

`src/lists/mutation-shapes.ts` centralizes method names considered for list
optimization: `map`, `push`, `pop`, `unshift`, `shift`, `splice`, `reverse`,
`sort`, `fill`, and `copyWithin`. **This is not a whitelist of supported
JavaScript methods.** An absent name does not produce an unsupported-method
error; it retains existing conservative receiver-effect routing. Existing
independent language restrictions, such as writes to read-only state, still apply.

The list analysis imports this table for compiler-owned JSX `map` and for
recognizing `push` candidates while proving that targeted writes remain valid
after fresh flat records are appended. A recognized call is still routed as a
content-capable receiver effect. JavaScript permits an own or inherited method
to replace `Array.prototype.push`, so spelling alone cannot authorize skipping
retained-prefix validation or row replay.

Structural labels remain candidates, not implemented specializations.
Adding a name alone cannot authorize an optimization. Receiver provenance,
overrides, callbacks, argument effects, and mixed writes must be proven safe.
Names are neither purity guarantees nor permission to skip invalidation.
Unknown calls can mutate retained content; the table introduces no new errors
and does not change the existing fallback implementation.

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
| `module-list-targets.ts` | Closed module-array proof for static-index content invalidation |
| `computed.ts` | Module computed-state discovery and dependency analysis |
| `instance.ts` | Component-local state and ordered derivation discovery |
| `instance-control-flow.ts` | Replay planning for component-local control flow |
| `component-reads.ts` | Read propagation across render-callback subtrees |
| `component-graph.ts` | Component path expansion and lightweight-list classification |
| `access-table.ts` | Final route table from writes to affected component entities |

Keep dependencies directed from focused discovery/validation modules into the
coordinator. A domain module may record facts on `Ctx`, but pass ordering stays
in `runAnalysis`; do not create a second partial pipeline in a caller.

Both linker manifest analysis and final emission call `prepareProgramAnalysis`
before consuming analysis facts. Conditional directives and external reactive
imports must therefore be normalized identically in metadata and generated code.
Cached module inputs retain comments alongside the AST, source, and extracted CSS.

### JavaScript semantics and regression coverage

Successful compilation emits JavaScript, including when TypeScript assertions
are nested. Ambient declarations are erased. Runtime namespaces, enums, import
assignments, export assignments, and constructor parameter properties require
lowering that is not currently implemented and receive explicit diagnostics.
The same applies to runtime decorators and TypeScript auto-accessor properties.

Instrumented callbacks retain a straight-line `write; notify` hot path. Return
expressions are evaluated into a hygienic temporary before notification. More
complex early returns lower through a compiler-generated completion label so
authored `finally` blocks finish before notification without wrapping callbacks
in exception-handling control flow. As elsewhere in the R5 contract, an
exceptional exit does not notify.
Direct effect writes retain per-site execution flags. Equality checks may read
only plain bindings or proven, non-escaping object literals' own data properties;
unknown member assignments preserve setter/proxy behavior and conservatively
invalidate the root because setters may mutate other state.

`tests/compiler-semantic-regressions.test.ts` executes emitted JavaScript without
a TypeScript loader and checks completion order, lexical scopes, accessors,
proxies, comments, and metadata parity. Extend semantic tests alongside codegen
snapshots when adding a new lowering or optimization.

### Handler analysis model

`src/handlers.ts` owns handler discovery and is the stable entry point used by
components, effects, and callbacks. Mutation analysis is split by concern:

| Module | Responsibility |
|---|---|
| `handlers/analyze.ts` | Callback cloning, origin setup, AST visitor dispatch, and finalization orchestration |
| `handlers/write-routing.ts` | Stateful per-handler origin classification and scoped write-routing decisions |
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

The compiler intrinsic `$effect()` crosses analysis and emission, but each rule
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
| `lists/map-site.ts` | Map source/callback validation and deterministic list-site identity |
| `lists/row-derivations.ts` | Row-local derivation discovery, shadowing checks, and AST substitution |
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

## Structural ownership and list teardown

Component factories register their structural regions for cleanup with the
component owner. Unregistering that owner disposes its lists and conditional
regions, including mount refs owned by lightweight component rows without their
own entity record. Separate cleanup registrations allow later owned regions to
finish when an earlier region reports a failure.

Proven lightweight inline rows and a subset of lightweight component rows own
DOM only. The compiler emits an additional `createListRegion()` flag so complete
clear/replacement and unmount skip empty cleanup scans. Successful DOM-only
suffix range removal also skips disposal scans; failed/unavailable ranges retain
individual node cleanup. Refs, child ownership, effects, render slots, spreads,
unknown render calls, callback preludes, dynamic scope and HMR keep the ordinary
cleanup path. Lightweight component rows are not automatically DOM-only: they
can still own mount refs. Their ownership proof is captured before emission and
preserved as optional `listResourceFree` component metadata across imports and
explicit import-then-export aliases.

Component re-exports now retain their canonical component identity, props and
ownership facts. Discovery seeds component aliases before strict JSX analysis,
so application-before-barrel input order does not turn a known component into
an unknown dynamic tag. Re-export-from syntax retains its existing diagnostic.

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
