# Experimental TSRX frontend

This directory owns the experimental TypeScript Render Extensions integration.
Nothing outside this boundary should need to understand TSRX-specific AST nodes.

## Pipeline

```text
.tsrx source
  -> @tsrx/core parseModule()
  -> extended ESTree + JSX + TSRX nodes
  -> @tsrx/core analyzeTsrx() target-neutral early errors
  -> lowerTsrxProgram()
  -> ordinary compiler-ready TS-ESTree + JSX
  -> existing Memoized DOM analysis and emission
```

This is direct AST lowering, not TSRX source generation followed by reparsing as
TSX. The compiler core therefore receives the same node dialect it receives from
its normal Yuku frontend.

The default frontend router is strict:

| Extension | Frontend |
|---|---|
| `.js`, `.jsx`, `.ts`, `.tsx`, `.d.ts` | Yuku |
| `.tsrx` | `@tsrx/core` plus direct lowering |

Unknown and virtual module IDs do not use a fallback parser. Pass
`experimentalTsrxEstreeFrontend` explicitly when an extensionless virtual module
contains TSRX.

The TSRX path is isolated from the standard Yuku parser.

## Supported subset

| TSRX surface | Current lowering |
|---|---|
| Ordinary TypeScript and JSX | Preserved as TS-ESTree and standard JSX nodes |
| `function Component() @{ ... }` | Normal function block with setup statements and a final `return` |
| Nested `@if` / `@else if` / `@else` | Conditional expression inside a JSX expression container |
| Root `@if` component output | Ordinary return-oriented `IfStatement` consumed by the component return planner |
| `@for (const item of items)` | `items.map(item => ...)`, reusing Memoized DOM list regions |
| `index name` | Second map callback parameter |
| `key expression` | `key={expression}` on the loop's single root JSX element |
| Loop-local setup | Map callback block ending in a JSX return |
| `@empty` | Conditional expression selecting the map or empty template |
| Root `@switch` | Exhaustive return-oriented `SwitchStatement` consumed by the component return planner |
| `<{expression}>` dynamic tags | A generated component-local selector consumed by the existing finite intrinsic/component candidate planner |
| Scoped `<style>` | Extracted as CSS and native JSX receives TSRX's stable scoped class hash |
| Nested `@{ ... }` statement containers | Inline JSX render calls expanded by the shared render-function planner |
| Pure setup inside `@if`, `@switch`, and `@empty` branches | Inline JSX render calls expanded before shared region planning |


The direct mappings intentionally reuse existing Memoized DOM conditional and
list analysis. They do not introduce parallel TSRX-specific emitters or runtime
regions.

## Intentionally unsupported

These forms fail with compiler diagnostics instead of entering the core as unknown
nodes or receiving guessed semantics:

| Surface | Reason |
|---|---|
| Lazy `&{ ... }` and `&[ ... ]` patterns | Memoized DOM must define their reactive read and write semantics |
| `@try`, `@pending`, and `@catch` | Need explicit suspense, error-boundary, ownership, and cleanup semantics |
| Nested `@switch` | Only root exhaustive switches currently map exactly to the return planner |
| C-style `@for` and `@for (... in ...)` | Existing optimized list semantics are based on iterable `.map()` regions |
| Keyed loop fragments or multiple loop roots | Existing keyed list analysis requires one JSX element carrying `key` |
| Dynamic tags without finite intrinsic or linked-component candidates | Existing compiler semantics require a statically bounded host/component set |
| Server submodules/imports | Need a client/server graph and serialization contract |

Because TSRX remains beta, `@tsrx/core` is pinned to an exact version. Review its
AST and changelog before upgrading.

## Files

- `frontend.ts`: `@tsrx/core` adapter, diagnostics, and strict default extension
  router.
- `lower.ts`: direct extended-AST to compiler ESTree lowering.
- `types.ts`: local structural contracts for TSRX-only nodes.
- `tsrx-core.d.ts`: narrow declaration for the parser API consumed here because
  the current package root does not expose declarations TypeScript resolves.
- `index.ts`: experimental public exports.

## Adding support

1. Define the Memoized DOM semantics first, especially ownership and reactive
   invalidation behavior.
2. Add the TSRX node contract to `types.ts` if needed.
3. Lower the node completely in `lower.ts`; do not add TSRX cases throughout core
   analysis or emission.
4. Verify no TSRX extension node remains after `parseTsrxEstree()`.
5. Add focused frontend tests and, for build behavior, a mixed-extension Vite test.
