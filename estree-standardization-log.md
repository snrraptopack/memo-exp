# Memoized DOM ESTree standardization - implementation log

Status: active development  
Last verified: 2026-08-30

This log records verified repository state. It does not treat planned work as
completed work.

## Current status

| Area | State | Verified result |
|---|---|---|
| Pure AST toolkit (`src/ast`) | Working foundation | Foundation/frontend suites: 23 passing tests; root TypeScript typecheck passes |
| Explicit `any` in compiler source | Removed | No explicit `any` annotations or assertions remain in executable compiler TypeScript |
| ESTree frontend | Working boundary | OXC parses ESTree/TS-ESTree; Esrap prints it with comments and source maps |
| Compiler analysis migration | Started | Multiple type, JSX, handler, list, prop, and computed passes accept ESTree |
| Babel removal | Not complete | Babel remains the parser, `NodePath`/scope provider, and generator boundary |
| ESTree emission | Not started | Existing emitters still create Babel-dialect nodes |

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

## Babel boundary inventory

The compiler package still declares these five dependencies:

- `@babel/core`
- `@babel/plugin-syntax-jsx`
- `@babel/plugin-transform-typescript`
- `@babel/traverse`
- `@babel/types`

At this checkpoint, 57 compiler source files still directly import or declare a
Babel module. Removing the package dependencies before replacing parsing,
scope/path services, and code generation would break the compiler.
Of those files, 27 still import or declare `@babel/traverse`. The shared
identifier allocator no longer needs a Babel program scope, and calculated
list normalization no longer uses NodePath traversal or replacement. Its final
`scope.crawl()` is a temporary synchronization bridge for downstream passes.

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

## Verification commands

```sh
bun run typecheck
bunx vitest run tests/ast-standardization.test.ts
bunx vitest run tests/estree-frontend.test.ts
bun run test:root
bun run --cwd packages/compiler build
```

Verified on 2026-08-30:

- TypeScript typecheck passed.
- Focused AST/frontend suites passed: 2 files, 23 tests.
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
- Full root suite passed: 99 files, 594 tests.
- Compiler package build passed, including Rolldown bundling and declaration
  emission.

The final Babel-removal gate is:

```sh
rg -n "@babel|NodePath|VISITOR_KEYS" packages/compiler
rg -n "(:|<|\\bas)\\s*any\\b|\\bany\\[\\]" packages/compiler/src --glob "*.ts"
```

Both searches must have no executable-code matches before the migration is
declared complete.
