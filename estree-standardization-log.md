# Memoized DOM ESTree standardization — implementation log

Status: complete
Last updated: 2026-09-01

This file records reproducible repository state. A feature is only marked
complete after its relevant build and tests pass.

## Current architecture

```text
source file
  -> extension frontend
       .js/.jsx/.ts/.tsx/.d.ts -> Yuku
       .tsrx                   -> @tsrx/core + direct ESTree lowering
       custom/virtual          -> explicitly injected EstreeFrontend
  -> compiler-owned ESTree analysis and transforms
  -> structural TypeScript erasure
  -> Esrap JavaScript and source-map emission
```

The compiler core receives plain ESTree/TS-ESTree programs. It does not receive
parser paths, scopes, traversal contexts, or parser-specific builders. The Vite
graph collector uses the same injected frontend boundary for import discovery;
it does not use the bundler's parser as a second compiler frontend.

## Completed migration work

- Compiler-owned nodes, visitor keys, traversal, cloning, lexical scopes,
  bindings, references, parent metadata, transforms, builders, and predicates.
- Handler, mutation, component, list, router, linker, and emission passes run on
  compiler-owned ESTree contracts.
- Public string and linked-module compilation parse through an
  `EstreeFrontend`, transform one program shape, erase TypeScript structurally,
  and print through Esrap.
- Standard extensions use Yuku by default. Parser language is inferred from the
  clean filename and can still be overridden explicitly.
- `.tsrx` is routed to an isolated frontend. Its supported extension nodes are
  lowered completely before compiler analysis.
- TSRX support currently includes template function bodies, nested/root `@if`,
  iterable `@for` with index/key/empty branches, root `@switch`, and scoped CSS
  extraction. Unsupported semantics fail with diagnostics.
- Extracted CSS flows through `CompiledSource`, linked module results, and Vite
  virtual CSS modules, including CSS-only HMR invalidation.
- The previous compiler frontends, traversal/runtime adapters, output adapter,
  shims, package dependencies, and root lockfile entries were removed.
- Generated names use compiler-owned scope information.
- List source analysis is structural. There is no promoted array-topology
  channel and no method/function allowlist.
- Compiler source has no explicit `any` annotations or assertions.

## Frontend contract

`EstreeFrontend` is intentionally small:

```ts
interface EstreeFrontend {
  readonly name: string;
  parse(source: string, options?: ParseEstreeOptions): ParsedEstree;
}
```

`createExtensionEstreeFrontend()` composes strict extension routes. Unknown or
extensionless IDs do not silently fall back to a parser; callers must inject the
appropriate frontend. This lets another parser or template language be added
without changing compiler analysis or emission.

## Verification recorded in this batch

- Root TypeScript typecheck: passed.
- Full workspace build and declaration emission: passed.
- Full root suite: 100 files, 629 tests passed.
- Focused regression suite: 20 files, 170 tests passed.
- Language-service suite: 1 file, 10 tests passed.
- Vite adapter suite: 1 file, 8 tests passed.
- Adapter, data, router, and server package suites: 16 files, 130 tests passed.
- Live Chrome example corpus: 19 examples passed, including Hacker News,
  class todo, Octopulse, TSRX todo, and the multi-file TSRX board.
- Octopulse Vite production build: passed (26 modules transformed).
- Frontend benchmark: Yuku parsed 250 modules at a median 2625.54 ms,
  approximately 95.2 parses/second on this machine.
- `git diff --check`: passed (line-ending notices only).
- Compiler source contains no explicit `any` annotations or assertions.
- Compiler and Vite source contain no Babel or OXC imports. Rolldown, which is
  the workspace bundler, owns transitive `@oxc-project/types` lockfile entries;
  these are not compiler frontends or compiler dependencies.

## Final gates

```sh
bun run typecheck
bun run build
bun run test:root
bun run test:vite
bun run bench:frontends
rg -n "@babel|oxc-parser" packages/compiler/src packages/compiler/package.json package.json bun.lock
rg -n "(:|<|\\bas)\\s*any\\b|\\bany\\[\\]" packages/compiler/src --glob "*.ts"
git diff --check
```

Dependency searches must be empty. The explicit-`any` search may match prose
containing the English word “any”; executable annotations and assertions must
remain absent.
