# React Package Assimilation RFC — React as a Compiler Dialect

Status: draft for debate
Audience: compiler, vite plugin, language-service, and testing contributors

## Goal

Memoized DOM compiles selected React-authored npm packages into native
Memoized DOM output. React is treated as a **source dialect the compiler
understands** — not a runtime to shim and not a transpile target. The shipped
bundle contains no React: no reconciler, no hook dispatcher, no `react` or
`react-dom` module.

```ts
memoizedDom({
  react: {
    packages: ['@radix-ui/react-dialog'],
  },
});
```

```tsx
import { Dialog } from '@radix-ui/react-dialog';

<Dialog.Root>
  <Dialog.Trigger>Open</Dialog.Trigger>
</Dialog.Root>
```

No wrapper, no island, no separate React root.

## Non-goals

- **React as a user authoring mode.** The dialect exists only for opted-in
  package graphs. Users do not write, and are not taught, React APIs; the
  React semantic table is unreachable from application code.
- **A runtime compatibility layer.** No fake `react` module executes at
  runtime. This is a deliberate trade: runtime shims (the `preact/compat`
  model) cover React's whole API surface including unanticipated usage, at
  the cost of a permanent second runtime. Assimilation pays zero runtime
  cost but covers only the semantic subset with compilation rules — coverage
  is binary per package: it compiles, or it emits diagnostics.
- **React's execution model.** Rerender-ordering assumptions, Suspense
  semantics, RSC packages, React internals/Fiber dependencies, custom
  renderers, and React DevTools integration are permanently out of scope.

## Core architecture: dialect-aware compilation

The pipeline is single-pass over a uniform internal representation. There is
no intermediate "MMD-flavored AST" and no desugaring pass.

```
opted-in React package source
        ↓
ordinary parser → standard ESTree
        ↓                       (React source is ordinary JS + JSX;
semantic analysis, dialect='react'   the parser never needs to know)
        ↓
useState() recognized AS state binding
useEffect() recognized AS effect entity
forwardRef()/memo() recognized AS wrappers
        ↓
the same internal entities hand-written MMD produces
        ↓
normal linking + analysis + emission
        ↓
native Memoized DOM output
```

### Per-module dialect, uniform IR below

Module dialect is selected by package identity, never by user opt-in per
file:

```ts
compileModules(graph, {
  dialectOf: (moduleId) =>
    allowlistedPackages.some((pkg) => moduleId.startsWith(pkg.root))
      ? 'react'
      : 'mmd',
});
```

By link time every module has compiled to the same entities; an assimilated
component and a hand-written component are indistinguishable to the linker,
the runtime, SSR, and hydration.

### Analysis-level recognition, not lowering

The semantic analyzer consults a dialect recognition table. For the `react`
dialect, call shapes map directly onto existing internal concepts:

| React source                      | Compiled entity                        |
| --------------------------------- | -------------------------------------- |
| `useState(init)`                  | component-local reactive cell + setter |
| `useMemo(fn, deps)`               | derivation                             |
| `useCallback(fn, deps)`           | stable function                        |
| `useEffect`/`useLayoutEffect`     | effect entity                          |
| `useRef(init)`                    | persistent local/ref storage           |
| `useImperativeHandle`             | ref exposure                           |
| `createContext`/`useContext`      | context entity                         |
| `forwardRef(fn)`                  | ref-forwarding component               |
| `memo(fn)`                        | erased / compile-time annotation       |
| `react`/`react/jsx-runtime` JSX   | MMD element representation             |

Recognizing the original call site — rather than rewriting it into MMD
syntax — preserves fidelity (dep arrays, initializer thunks, generics) and
keeps diagnostics in the user's vocabulary: "conditional `useState` at
module X line N" rather than an error emitted from generated code.

### Diagnostics on unsupported semantics

Coverage is per-semantic, not per-package-name. A React construct with no
recognition rule produces a compiler diagnostic at the call site, aimed at
the developer who opted the package in:

```
@radix-ui/react-dialog: unsupported react semantic 'useSyncExternalStore'
  at node_modules/@radix-ui/react-dialog/dist/index.js:412
```

There is no graceful-degradation path; an unsupported semantic blocks the
package at build time.

## Package resolution and graph expansion

The linker currently resolves only relative specifiers; it has no
`node_modules` handling. Assimilation adds:

- an allowlist-aware resolver that maps bare specifiers for opted-in
  packages to their package root, then expands the module graph through the
  package's internal imports;
- a policy for transitive imports: another allowlisted React package →
  assimilated; non-React dependencies → treated as ordinary external
  imports unless they themselves need assimilation;
- `requireApplicationRoot: false` for package graphs (no `mount()` root
  exists in library code — the option already exists for this reason).

### Input formats

Packages ship source in three forms:

- **Source / unminified TS or JSX** — parsed directly.
- **Transpiled ESM dist** — `jsx(...)`/`React.createElement(...)` call-form.
  Structured enough to analyze without a JSX parser; the analyzer
  recognizes element-construction calls.
- **Minified bundles** — out of scope. Documented hard constraint.

## Hard semantic work items

Ordered by how many packages they gate:

1. **`children` introspection** — `React.Children.*`, `cloneElement`,
   `isValidElement`, `Children.only`. These operate on element descriptors,
   not DOM nodes; the dialect needs an element-descriptor representation at
   its boundary before DOM emission. The largest single design piece.
2. **`createContext`/`useContext`** across module boundaries, including
   Provider subtrees and compound-component patterns.
3. **Portals** — `createPortal` needs a mount-point contract in the runtime.
4. **Event normalization** — `onChange` ≈ DOM `input`, capture variants,
   `onDoubleClick`, focus/blur delegation. A mapping table covers most of
   it; the remainder is documented behavioral difference.
5. **Controlled/uncontrolled props** — `value`+`onChange` and
   `defaultValue` patterns.
6. **`useImperativeHandle` + `forwardRef`** — imperative ref exposure.
7. **Hook discipline diagnostics** — conditional hooks, hooks after early
   return, hooks in callbacks. Illegal in React too, but real packages
   occasionally depend on subtleties; diagnostics must be precise.

### Transitive non-React dependencies

Assimilation covers React semantics, not arbitrary runtime ecosystems.
MUI, for example, is blocked less by React semantics than by Emotion
(`styled`, `ThemeProvider`, the `css` prop), Popper, and
`react-transition-group`. "Zero React" is guaranteed; "zero extra runtime"
is not. Per package, decide whether a transitive dep is compiled, kept as
an external runtime dependency, or disqualifying.

## Coverage report (build first)

Before committing to named package support, build the tool that makes
coverage measurable: point the linker at a package with
`requireApplicationRoot: false` and the `react` dialect, walk its module
graph, and report every React API it touches with counts and coverage
status.

- Drives phase order by real-world API frequency rather than guesses.
- Doubles as the user-facing error when an opted-in package hits an
  unsupported semantic.
- Doubles as a corpus generator for tests (below).

## Testing strategy

Three layers, extending the existing dense-corpus approach:

1. **Syntactic density per recognition rule** — every surface spelling of
   each API: named/aliased imports, `React.useState` member access,
   namespace imports, non-destructured tuple results, ignored results,
   `jsx()`/`createElement` call-form, wrapped calls.
2. **Harvested real-world corpus** — fixtures generated from actual API
   usage patterns in target packages' source, so the corpus reflects what
   npm code really looks like rather than imagined usage.
3. **Behavioral parity fixtures** — assimilated component compiled and
   driven against DOM assertions (state updates, effect cleanup, ref
   timing, context propagation), reusing the `compileFixture`/`expectParity`
   harness style. Emphasis on hook composition and interaction — isolated
   spellings are easy; interactions are where assimilation bugs live.

## Types shim (deferred)

Not needed for compilation — the compiler strips types and never reads
`.d.ts`. Needed eventually for typed props on assimilated components.

- Real `@types/react` is **not** an option: it declares a global `JSX`
  namespace whose `ElementClass`/`LibraryManagedAttributes` contracts
  conflict with `compiler/src/jsx-types.ts`'s global `JSX`.
- The shim is a small types-only package (`@memoized-dom/react-types`)
  declaring `module 'react'` with React's type vocabulary defined in terms
  of MMD types — `FC<P>` as the MMD component signature, `ReactNode` as the
  MMD child type, `Ref`/`RefCallback` as MMD ref types — and deliberately
  no global `JSX` declarations.
- Until it exists: `skipLibCheck` lets assimilated components degrade to
  loosely-typed usage without breaking user builds.

## Phased rollout

| Phase | Semantics                                   | Unlocks                          |
| ----- | ------------------------------------------- | -------------------------------- |
| 1     | JSX, props, spread, `memo`, `forwardRef`    | icon/SVG libraries, simple kits  |
| 2     | `useState`, `useMemo`, `useCallback`,       | hooks-only packages              |
|       | `useEffect`, `useRef`                       |                                  |
| 3     | `createContext`/`useContext`, controlled    | compound-component libraries     |
|       | props, imperative refs                      |                                  |
| 4     | portals, layout effects, external stores    | Radix-class headless primitives  |
| 5     | remainder per coverage-report frequency     | design systems, charts, motion   |

Each phase ships real value — phase 1 alone is a demoable feature.

## Fit with the current codebase

Already-landed enablers:

- `EstreeFrontend` seam (`compiler/src/compile.ts`) — pluggable input
  formats, precedent in the TSRX frontend;
- `resolveImport` hook + whole-module-graph linker
  (`compiler/src/linking/model.ts`);
- `diagnoseModules` — the diagnostics path used by the language service;
- `requireApplicationRoot` on `CompileModulesOptions` — compiling graphs
  without a `mount()` root;
- `packages/css` precedent for a compiler-owned language surface.

New infrastructure required:

- `node_modules` resolution for allowlisted packages in the linker;
- `dialectOf` (or equivalent) plumbed into semantic analysis;
- the React semantic-recognition table;
- the coverage-report tool;
- `@memoized-dom/react-types` types shim (deferred).

## Prior art

- **Builder.io Mitosis** — JSX-as-interchange-format compiling to multiple
  frameworks; validates the two-stage approach.
- **`preact/compat`** — the opposite strategy (runtime aliasing). Ours
  avoids the double-runtime tax at the cost of binary coverage.
- **Qwik `qwikify$`** — island wrapping, explicitly not this design.
