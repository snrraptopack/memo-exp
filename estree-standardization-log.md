# Memoized DOM ESTree standardization - implementation log

Status: active development  
Last verified: 2026-09-01

This log records verified repository state. It does not treat planned work as
completed work.

## Current status

| Area | State | Verified result |
|---|---|---|
| Pure AST toolkit (`src/ast`) | Working foundation | Focused AST/frontend suites: 38 passing tests; root TypeScript typecheck passes |
| Explicit `any` in compiler source | Removed | No explicit `any` annotations or assertions remain in executable compiler TypeScript |
| ESTree frontend | Working boundary | OXC parses ESTree/TS-ESTree; Esrap prints it with comments and source maps |
| Compiler analysis migration | Advanced, incomplete | Binding-aware discovery, effects, data-source lowering, plugin mutation, and handler-write analysis now consume ESTree scope/parent metadata |
| Babel removal | Not complete | Direct `@babel/traverse` use and runtime `@babel/types` use are gone; Babel core still owns the public parser/plugin/generator boundary and Babel types remain transitional type-only annotations |
| ESTree emission | Working, types transitional | Production builders and predicates create/recognize plain ESTree nodes; the legacy Babel plugin receives one output-only dialect adaptation |

## Audit correction

The first version of this log marked the AST foundation complete and claimed
passing tests before that state was reproducible. During the 2026-08-30 audit:

- `src/ast/types.ts` was syntactically malformed, so the focused suite could not
  load and the repository typecheck failed.
- `tests/ast-standardization.test.ts` contained two `as any` assertions.
- `transformAst` mutated the input tree even though its API promised a pure
  transformation.
- `findNode` skipped only the first matching subtree and could later replace the
  result with another match.
- Scope bindings had a `references` field, but reference collection was not
  implemented.

Those issues are now fixed and covered by the focused test suite.

## Delivered foundation

The toolchain-independent AST directory contains no Babel imports and no
explicit `any` types:

- `types.ts`: ESTree/JSX node contracts used by the migration.
- `builders.ts`: plain-object ESTree factories, predicates, and deep cloning.
- `walk.ts`: visitor-key traversal with parent, field, and array-index context.
- `scope.ts`: program/function/block/loop/catch scopes, bindings, shadow lookup,
  identifier references, and node parent/key/index metadata.
- `transform.ts`: immutable replace, remove, and array-splice transformations.
- `parser.ts`: OXC adapter producing one ESTree/TS-ESTree shape with locations.
- `printer.ts`: Esrap adapter preserving comments and producing source maps.
- `index.ts`: toolkit exports.

The foundation is intentionally called "working" rather than "complete ESTree
coverage": additional syntax nodes must be added as compiler modules encounter
them, especially newer class/module syntax and the chosen TypeScript ESTree
frontend's extensions.

## Compiler logic migration started

The following production paths now use the shared ESTree walker instead of
hand-written `@babel/types.VISITOR_KEYS` recursion:

- state and instance-state read detection in `context/ast.ts`;
- compiler-generated identifier reservation in `identifiers.ts`;
- alias-origin discovery in `mutation-analysis.ts`;
- component parameter type-syntax traversal in `components/props.ts`;
- targeted list dependency analysis in `lists/targeted-refresh.ts`;
- finite TypeScript string-candidate analysis in `analysis/type-candidates.ts`;
- component-subtree and render-callback read folding in
  `analysis/component-reads.ts`;
- JSX host-event discovery in `jsx/events.ts`;
- committed-local helper call classification in `handlers/local-calls.ts`;
- inline callback JSX discovery in `components/callback-props.ts`;
- runtime binding-pattern cloning in `analysis/runtime-pattern.ts`;
- component ref-prop scanning in `components/ref-props.ts`;
- static list-source classification in `lists/source-shapes.ts`;
- static derived-list discovery in `lists/static-derived.ts`; and
- module computed-state analysis in `analysis/computed.ts`; and
- first-pass component export discovery in `components/manifest.ts` and
  parser-neutral parameter shaping in `components/prop-shape.ts`; and
- mutable DOM-ref binding classification in `jsx/refs.ts`; and
- intrinsic lifecycle call and shared-helper binding resolution in
  `lifecycle.ts`; and
- compiler-wide collision-free identifier allocation in `identifiers.ts`; and
- list JSX-subtree discovery and map-site diagnostic boundaries in
  `lists/map-site.ts`; and
- calculated-list receiver replacement and ordered declaration insertion in
  `lists/calculated-sources.ts`; and
- top-level component declaration normalization in
  `components/declarations.ts`; and
- conditional-site diagnostics in `conds.ts`;
- render-callback root/discovery analysis in
  `components/render-callbacks.ts`;
- lightweight component eligibility in `analysis/component-graph.ts`; and
- route-region component-path typing in `emission/route-region.ts`;
- binding-write violation indexing in `ast/scope.ts`; and
- module control-flow derivation analysis in `module-control-flow.ts`; and
- conditional JSX sibling folding and standalone replacement in
  `jsx/conditional-directives.ts`.

The real analysis pipeline now builds and refreshes the parser-neutral scope
index on `Ctx`. Binding-aware passes can migrate incrementally through
`astBindingAt` without requiring a Babel `NodePath` at the lookup site.

`lists/targeted-refresh.ts`, `analysis/type-candidates.ts`, and
`analysis/component-reads.ts`, plus `jsx/events.ts`, have no direct Babel import.
`handlers/local-calls.ts`, `analysis/runtime-pattern.ts`,
`components/ref-props.ts`, `lists/source-shapes.ts`,
`lists/static-derived.ts`, and `analysis/computed.ts` are also fully Babel-free.
Frontend tests now feed OXC TS-ESTree directly into real compiler type, JSX,
handler-call, component-prop, static-list, computed-state, and runtime-pattern
analysis, plus linker component discovery, while the existing Babel pipeline
parity tests remain green. The other migrated paths still accept Babel node
types at their current boundary and therefore remain transitional.

## Standalone frontend checkpoint

The compiler now depends on `oxc-parser` and `esrap` for its new boundary.
The focused frontend suite verifies:

- TSX parses without a Babel AST conversion;
- OXC emits standard `Literal` nodes;
- comments and source locations survive printing;
- Esrap produces a non-empty source map;
- trees can mix parsed nodes with nodes from the ESTree builders;
- printed output reparses successfully;
- parse diagnostics are available through returning and throwing APIs;
- handler call classification and component prop-reference matching operate
  directly on OXC-produced nodes;
- static primitive lists and self-contained method chains are recognized from
  OXC's standard `Literal` nodes;
- computed analysis discovers scalar and dotted store reads directly from
  OXC-produced expressions; and
- cloned TS-ESTree binding patterns have runtime-only annotations removed
  without modifying the parsed input; and
- exported component contracts and delegated events are discovered directly
  from an OXC-produced program; and
- imports, destructured/default/rest parameters, block shadowing, references,
  and parent metadata are indexed from OXC TS-ESTree; and
- generated identifiers reserve every authored OXC identifier while retaining
  the established output naming sequence; and
- render-callback JSX roots are resolved through OXC parent metadata; and
- exhaustive module control-flow derivations are discovered directly from OXC
  bindings, declaration order, reads, and write violations.

This boundary is not yet wired into the public `compile` function. The existing
Babel path remains the compatibility oracle while transformations migrate.

## ESTree traversal checkpoint

The remaining production `@babel/traverse` dependency was removed from handler
analysis. Handler locals, lexical scopes, nested execution sites, assignments,
updates, deletes, and call effects now use the shared ESTree scope and parent
indexes. Mutation sites retain object identity only at the temporary live-tree
boundary, using the compiler-owned overwrite primitive rather than `NodePath`
replacement.

Compiler source now has zero direct `@babel/traverse` imports and no executable
`NodePath` types. Effects, linked-JSX inspection, plugin program mutation,
data-source discovery/lowering, transparent-read rewriting, and handler-write
analysis all run through compiler-owned traversal and mutation services.

The keyed-list method-name whitelist and its topology-only invalidation channel
were removed. Proven direct item writes still use the changed-key journal;
opaque receiver calls and structural writes conservatively perform a full
reconcile. The runtime no longer exposes the unused topology-only reconcile
argument.

## Parser-neutral transform checkpoint

The compiler now exposes an internal whole-program transform that accepts a
plain ESTree program container, runs the real analysis and emission pipeline,
and returns strict ESTree for Esrap. The temporary Babel builder output is
normalized at this boundary (`StringLiteral`/`NumericLiteral`/`NullLiteral`
and `ObjectProperty` become their ESTree equivalents). This normalization is a
transition aid; replacing the remaining Babel node builders and types is still
required before dependency removal.

The complete transform is covered with both OXC and Yuku TSX programs. Both
frontends feed the same compiler-owned scope, analysis, mutation, and emission
logic and produce byte-identical Esrap output. The Babel compatibility plugin
retains its staged visitor timing only as a frontend adapter while the public
compile/linker boundary is migrated.

`yuku-parser` is a root development dependency used for cross-frontend tests
and the Node benchmark, not a compiler package dependency. On Node 24.19.0,
the representative 80-component TSX parse benchmark measured:

| Frontend | Median parses/second | Relative elapsed time |
|---|---:|---:|
| Yuku | 123.5 | 1.00x |
| Babel | 51.7 | 2.39x |
| OXC | 33.7 | 3.66x |

These numbers are local measurements rather than an architectural choice: the
cross-frontend equality test is the portability gate, and parser speed can be
re-measured independently with `bun run bench:frontends`.

The compiler-owned cloner now serves every production clone site, including
shallow-clone substitution passes. All 410 `t.cloneNode` calls across 32
compiler modules were removed, so OXC/Yuku `Property` and `Literal` subtrees no
longer cross a Babel cloning API during analysis or emission.

Compiler-owned visitor keys, walking, binding-pattern extraction, identifier
validation/normalization, value conversion, and comment inheritance now serve
the remaining production passes. There are no calls to Babel's `VISITOR_KEYS`,
`traverseFast`, `getBindingIdentifiers`, `isValidIdentifier`, `toIdentifier`,
`valueToNode`, or `inheritsComments` utilities.

All production AST builders and predicates now resolve through the
compiler-owned ESTree factory. Generated literals use standard `Literal` nodes,
object members use `Property`, and optional members retain ESTree optional
semantics. There are no remaining `t.<builder>()` or `t.is*()` calls in compiler
source. Every `@babel/types` import is type-only; the temporary factory exposes
those type signatures only until the compiler's public node contracts migrate.
The legacy Babel plugin converts strict ESTree literals/properties/optional
members only at its generator boundary, while the OXC/Yuku path remains strict
ESTree throughout. Linker discovery and analysis transformations now disable
unused Babel code generation.

Transitional Babel node annotations are now isolated behind
`ast/compiler-types.ts`; production analysis, mutation, and emission modules no
longer import `@babel/types` directly. The compatibility module and the ESTree
factory are the only remaining type-level references, providing one controlled
replacement point for the next type-shape pass.

## Babel boundary inventory

The compiler package still declares these five dependencies:

- `@babel/core`
- `@babel/plugin-syntax-jsx`
- `@babel/plugin-transform-typescript`
- `@babel/traverse`
- `@babel/types`

At this checkpoint, compiler source files still import `@babel/types` only for
transitional type annotations, while Babel core/plugin declarations remain at
the public frontend boundary. Removing the package dependencies before
replacing those node types, parsing, TypeScript erasure, and code generation
would break the compiler. No compiler source file imports `@babel/traverse`.
Component/ref,
conditional-region, render-callback, and list-region emission now share the
central component-path boundary instead of importing the traversal package.
The shared identifier allocator no longer needs a Babel program scope, and
calculated list normalization no longer uses NodePath traversal or replacement.
Lifecycle callback discovery and cleanup lowering now use the ESTree walker
and scope index instead of NodePath traversal.
Component return planning now collects returns and checks hoist barriers with
the ESTree walker, including direct OXC `Literal` empty-branch coverage.
Component prop-origin collection now traverses raw JSX and resolves module and
owner bindings through the ESTree lexical index.
Instance control-flow replay now uses ESTree binding identity, violation
ownership, parent metadata, and raw referenced-read traversal. The scope index
is refreshed immediately after normalization so later analysis sees replaced
nodes.
Opaque-volatility propagation is now fully Babel-free: imports, local helper
returns, assignments, arguments, declarations, and rendered roots all use the
ESTree scope and parent indexes.
Component factory emission now receives the central component-container type
without importing NodePath directly.
Structural JSX emission now shares that same container boundary, and its local
binding-name scan uses the ESTree walker instead of Babel `traverseFast`.
Handler and lifecycle helper resolution now use ESTree function-scope ownership
and binding declarations instead of component NodePath scopes.
The shared mutation alias tracker now accepts a parser-neutral lexical-scope
contract, with direct OXC alias-chain provenance coverage.
Interprocedural helper summaries now traverse raw ESTree and resolve parameter,
alias, module-store, nested-helper, and receiver effects through the ESTree
scope index.
Instance state, ref exclusion, local-helper derivation summaries, opaque-use
classification, and ordered derivation discovery now use raw ESTree. Derived
nodes are copied with the parser-neutral cloner so OXC `Literal` nodes remain
valid.
Parser-neutral parent-field replacement/removal primitives now back component
JSX-value normalization. Alias expansion, structured collection selection,
declaration removal, and JSX-container unwrapping run directly on OXC trees.
JSX render-function validation, parameter/local substitution, map callback
conversion, call replacement, and helper declaration removal now use ESTree
bindings, visitor keys, and mutation metadata, including OXC literal arguments.
Router graph discovery, nested-route ownership, compiler-attribute erasure, and
`route-to` lowering now use raw ESTree JSX traversal and direct attribute
mutation, including OXC string literals.
Dynamic component import installation, candidate propagation, binding/history
resolution, finite tag selection, and JSX replacement now run on ESTree scope
and mutation metadata, with direct OXC tag lowering coverage.
SSR module-state cell discovery, import-specifier removal, read replacement,
and assignment/update lowering now use ESTree bindings and raw parent fields.
Generated cell shells accept OXC child nodes without Babel builder validation.
Its final `scope.crawl()` is a temporary synchronization bridge for downstream
passes.
Module import/function discovery now has a parser-neutral ESTree pass with
direct OXC coverage. The Babel frontend currently attaches mutation/diagnostic
paths to those raw discovery results; that adapter remains to be removed.
Component render-prop inference, JSX/component validation, composition graph
discovery, store-read classification, inline/nested row attribution,
conditional-region attribution, helper-read folding, and the final component
read collector now traverse raw ESTree and resolve lexical ownership from the
shared scope index.
Scope consumers now distinguish declaration ownership from binding kind, so a
function parameter whose declaration owner is a component cannot be mistaken
for the component function itself. Helper summaries also rebuild the ESTree
index after a transformed helper body replaces indexed nodes.
Compiler-generated dynamic-component imports are queued through the shared
header rather than inserted ahead of live Babel traversal paths. JSX collection
spread flattening and nested TypeScript literal wrappers in SSR cell defaults
are covered by the full behavior suite.

## Migration order

The original plan put ESTree builder replacement before the frontend/emitter
boundary. That order is unsafe: Babel builders produce Babel literal node kinds
such as `StringLiteral`, while strict ESTree builders produce `Literal`. Mixing
the two dialects inside Babel's generator is not a valid stable boundary.

The verified migration order is therefore:

1. Finish AST coverage and semantic tests as each production pass needs it.
2. Move read-only analysis and traversal modules to `BaseNode`, `Scope`, and
   pure predicates.
3. Introduce a standalone ESTree parse/generate entrypoint and keep parser
   adaptation at the package edge. **Boundary delivered; compile integration is
   in progress.**
4. Move transformations to `transformAst` and remove `NodePath` mutation.
5. Move emission to ESTree builders once output is consumed by an ESTree
   generator.
6. Delete Babel adapters, shims, imports, package dependencies, and lockfile
   entries only after parity tests pass through the standalone entrypoint.

## Compiler-owned node contracts

The production passes no longer import or alias `@babel/types`. Their shared
`compiler-types` boundary is now defined entirely from compiler-owned ESTree
nodes, with explicit structural extensions for TypeScript syntax that analysis
must inspect before type stripping. Babel AST and path values are converted
through `unknown` only inside the remaining legacy frontend shell; those casts
are temporary adapter boundaries, not types consumed by the domain engine.

The contract migration also standardizes string-named imports/exports and
optional-chain construction without introducing method or function-name
allowlists. Compiler typecheck, package build, and the focused AST/frontend,
semantic-conformance, source-map, and diagnostic suites pass (5 files,
65 tests).

## Verification commands

```sh
bun run typecheck
bunx vitest run tests/ast-standardization.test.ts
bunx vitest run tests/estree-frontend.test.ts
bun run test:root
bun run --cwd packages/compiler build
```

Verified through 2026-08-31:

- TypeScript typecheck passed.
- Focused AST/frontend suites passed: 2 files, 38 tests.
- Handler, render-prop, render-function, render-callback, indexed-map, and
  delegated-event regressions passed: 6 files, 29 tests.
- Calculated, nested, opaque-derived, gated, and targeted-list regressions
  passed: 5 files, 18 tests.
- Computed, evaluation-metadata, emission-golden, diagnostic, and frontend
  semantic regressions passed: 5 files, 59 tests.
- Runtime-pattern, indexed-list, nested-list, render-callback, and
  render-function regressions passed: 5 files, 26 tests.
- Static-derived, calculated-list, gated-map, and list regressions passed:
  6 files, 34 tests.
- Linker discovery, linked dynamic-component, delegated-event, render-prop,
  and render-function regressions passed: 6 files, 30 tests.
- AST/frontend, DOM-ref, and emission regressions passed: 4 files, 44 tests.
- Cleanup, callback-boundary, effect, and linker-lifecycle regressions passed:
  6 files, 41 tests.
- Identifier, golden-emission, diagnostics, linker-lifecycle, list, and ref
  regressions passed: 5 files, 33 tests.
- Indexed/nested/calculated-list and callback regressions passed: 5 files,
  16 tests.
- Calculated/gated/indexed/nested/opaque-derived/targeted-list regressions
  passed: 6 files, 24 tests.
- Component-expression, golden-emission, effect, and linker-lifecycle
  regressions passed: 4 files, 43 tests.
- JSX, conditional-effect, and delegated-event regressions passed: 3 files,
  17 tests.
- Render-callback, list, linked-component, delegated-event, router, golden,
  and linker-lifecycle regressions passed: 8 files, 47 tests.
- Module-control-flow, computed, golden, and diagnostic regressions passed:
  4 files, 39 tests.
- Conditional-directive, nested/mixed conditional, hydration, effect, and
  golden regressions passed: 6 files, 34 tests.
- Indexed-list, nested-conditional, render-callback, DOM-ref, and router
  regressions passed: 5 files, 21 tests.
- AST/frontend, return-control-flow, diagnostics, golden-emission, and
  component-expression regressions passed: 6 files, 59 tests.
- AST/frontend, prop-origin, linker, render-prop, and transparent-data
  regressions passed: 7 files, 63 tests.
- AST/frontend, instance/module control-flow, diagnostics, and golden-emission
  regressions passed: 6 files, 63 tests.
- AST/frontend, opaque-volatility, derived-reactivity, data integration, and
  semantic regressions passed: 7 files, 75 tests.
- Component emission, component-expression, DOM-ref, and render-callback
  regressions passed: 4 files, 32 tests.
- AST/frontend, callback, render-callback, delegated-event, lifecycle, cleanup,
  effect, and core component regressions passed: 9 files, 84 tests.
- AST/frontend, mutation, callback, delegated-event, lifecycle, and opaque
  regressions passed: 7 files, 59 tests.
- AST/frontend, helper-summary, derivation, effect, opacity, evaluation, and
  performance-codegen regressions passed: 12 files, 126 tests.
- Local-state, derivation, opacity, control-flow, transparent-data, diagnostics,
  DOM-ref, and emission regressions passed: 9 files, 90 tests.
- AST/frontend, JSX collection, render-function, component-expression,
  diagnostics, and emission regressions passed: 8 files, 73 tests.
- AST/frontend, render-function, collection, component-expression, callback,
  render-prop, diagnostics, and emission regressions passed: 10 files, 83 tests.
- AST/frontend, router JSX/runtime, diagnostics, and emission regressions
  passed: 6 files, 63 tests.
- AST/frontend, dynamic-tag, linked-component, semantic, diagnostics, and
  emission regressions passed: 8 files, 91 tests.
- AST/frontend, SSR cell-lowering/isolation, diagnostics, and emission
  regressions passed: 6 files, 67 tests.
- Component discovery, render-prop, row-read, conditional-read, linked dynamic
  component, JSX collection, helper-handler, and SSR cell-lowering regressions
  passed after rebuilding the compiler package.
- Full root suite passed: 99 files, 614 tests.
- Compiler package build passed, including Rolldown bundling and declaration
  emission.

The final Babel-removal gate is:

```sh
rg -n "@babel|NodePath|VISITOR_KEYS" packages/compiler
rg -n "(:|<|\\bas)\\s*any\\b|\\bany\\[\\]" packages/compiler/src --glob "*.ts"
```

Both searches must have no executable-code matches before the migration is
declared complete.
