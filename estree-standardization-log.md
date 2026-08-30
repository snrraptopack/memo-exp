# Memoized DOM ESTree standardization - implementation log

Status: active development  
Last verified: 2026-08-30

This log records verified repository state. It does not treat planned work as
completed work.

## Current status

| Area | State | Verified result |
|---|---|---|
| Pure AST toolkit (`src/ast`) | Working foundation | Foundation/frontend suites: 17 passing tests; root TypeScript typecheck passes |
| Explicit `any` in compiler source | Removed | No explicit `any` annotations or assertions remain in executable compiler TypeScript |
| ESTree frontend | Working boundary | OXC parses ESTree/TS-ESTree; Esrap prints it with comments and source maps |
| Compiler analysis migration | Started | Shared traversal paths and finite type-candidate analysis accept ESTree |
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
  and identifier references.
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
  `analysis/component-reads.ts`; and
- JSX host-event discovery in `jsx/events.ts`;
- committed-local helper call classification in `handlers/local-calls.ts`;
- inline callback JSX discovery in `components/callback-props.ts`; and
- runtime binding-pattern cloning in `analysis/runtime-pattern.ts`; and
- component ref-prop scanning in `components/ref-props.ts`; and
- static list-source classification in `lists/source-shapes.ts`; and
- module computed-state analysis in `analysis/computed.ts`.

`lists/targeted-refresh.ts`, `analysis/type-candidates.ts`, and
`analysis/component-reads.ts`, plus `jsx/events.ts`, have no direct Babel import.
`handlers/local-calls.ts`, `components/ref-props.ts`, and
`lists/source-shapes.ts`, plus `analysis/computed.ts`, are also fully Babel-free.
Frontend tests now feed OXC TS-ESTree directly into real compiler type, JSX,
handler-call, component-prop, static-list, and computed-state analysis while the
existing Babel pipeline parity tests remain green. The other migrated paths
still accept Babel node types at their current boundary and therefore remain
transitional.

## Standalone frontend checkpoint

The compiler now depends on `oxc-parser` and `esrap` for its new boundary.
The focused frontend suite verifies:

- TSX parses without a Babel AST conversion;
- OXC emits standard `Literal` nodes;
- comments and source locations survive printing;
- Esrap produces a non-empty source map;
- trees can mix parsed nodes with nodes from the ESTree builders;
- printed output reparses successfully; and
- parse diagnostics are available through returning and throwing APIs; and
- handler call classification and component prop-reference matching operate
  directly on OXC-produced nodes; and
- static primitive lists and self-contained method chains are recognized from
  OXC's standard `Literal` nodes; and
- computed analysis discovers scalar and dotted store reads directly from
  OXC-produced expressions.

This boundary is not yet wired into the public `compile` function. The existing
Babel path remains the compatibility oracle while transformations migrate.

## Babel boundary inventory

The compiler package still declares these five dependencies:

- `@babel/core`
- `@babel/plugin-syntax-jsx`
- `@babel/plugin-transform-typescript`
- `@babel/traverse`
- `@babel/types`

At this checkpoint, 60 compiler source files still directly import or declare a
Babel module. Removing the package dependencies before replacing parsing,
scope/path services, and code generation would break the compiler.

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
- Focused AST/frontend suites passed: 2 files, 17 tests.
- Handler, render-prop, render-function, render-callback, indexed-map, and
  delegated-event regressions passed: 6 files, 29 tests.
- Calculated, nested, opaque-derived, gated, and targeted-list regressions
  passed: 5 files, 18 tests.
- Computed, evaluation-metadata, emission-golden, diagnostic, and frontend
  semantic regressions passed: 5 files, 59 tests.
- Full root suite passed: 98 files, 581 tests.
- Compiler package build passed, including Rolldown bundling and declaration
  emission.

The final Babel-removal gate is:

```sh
rg -n "@babel|NodePath|VISITOR_KEYS" packages/compiler
rg -n "(:|<|\\bas)\\s*any\\b|\\bany\\[\\]" packages/compiler/src --glob "*.ts"
```

Both searches must have no executable-code matches before the migration is
declared complete.
