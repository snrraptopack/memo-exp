# React source assimilation into MMD

Status: working design for `feat/react-assimilation-rewrite`.

## Goal

Compile supported React-authored source and ordinary MMD source together into
one MMD application. React imports can appear in app modules or selected
packages. They are source forms; the shipped application does not load React or
run a React reconciler.

Migration changes the browser entry to MMD's root contract:

```ts
import { mount } from '@memoized-dom/runtime';
import { App } from './App';

mount('root', App);
```

`createRoot` is diagnosed. `mount` gives the compiler the application root and
its identity. A component below that root may use supported React imports and
MMD constructs in the same module. MMD semantics govern the result: component
bodies run once per instance, local derivations update from their sources, and
effects have MMD ownership and cleanup. React rerender timing and scheduling
are not promised.

## Proof before lowering

The root [`assimilation/`](assimilation/README.md) lab contains paired,
runnable React and hand-authored MMD cases. The React app is a reference for
the source API. The MMD app is an executable candidate for the code the
compiler should produce. Its case README records the translation and any
observable divergence. Run both apps and compare their behavior before
implementing a new lowering rule:

```bash
bun run assimilation:react  # :5173
bun run assimilation:mmd    # :5174
```

Then add an isolated `react-tests/` fixture that compiles real React source
through the same MMD compiler, asserting emitted operations and DOM behavior.
The normal root compiler suite excludes these fixtures. A passing MMD lab case
proves only that its *target* is expressible; it does not mean the React API is
already translated. The lab matrix tracks both statuses separately.

When an MMD target cannot express a behavior, record the attempted source and
error in [`assimilation/error-log.md`](assimilation/error-log.md). Decide
whether to extend ordinary MMD or diagnose the React form. Do not add a second
compilation mode to hide the gap.

## Compiler path

There is one parser, linker, analysis, emitter, and runtime. React calls are
identified by their imported bindings, not by a file-wide dialect switch:

```text
MMD source + React-authored source
  → parse and link modules
  → specialize supported linked hooks and child call sites
  → unwrap memo/forwardRef component declarations
  → normalize component declarations
  → rewrite recognized React calls into MMD source operations
  → ordinary MMD analysis and emission
  → MMD runtime
```

The source rewrite happens in `packages/compiler/src/react/assimilation.ts`
through `analysis/prepare.ts`. Wrapper discovery also runs while building the
linker manifest. The `react.packages` option selects dependencies to bring
into the source graph; it does not select a React execution mode. Supported
React imports in an app module need no package opt-in.

Diagnostics should name the original API and source location. A recognized
import used in an unsupported shape is rejected during compilation. We do not
leave a runtime React import or silently reinterpret an unsupported call.

## Current translation boundaries

The [lab matrix](assimilation/README.md#matrix) is the detailed status source.
The current direction is:

| Source form | MMD target or boundary |
| --- | --- |
| `useState`, `useReducer` | local `let` cell and write function |
| `useMemo`, `useCallback` | derivation or stable function; dependency arrays do not define MMD invalidation |
| `useEffect`, `useLayoutEffect`, `useInsertionEffect` | owned `effect()` operations, with phase ordering where implemented |
| `useRef`, `createRef` | `{ current }` box and MMD ref attachment |
| `memo`, `forwardRef` | wrapper erased; forwarded ref becomes an MMD prop/ref path |
| `useSyncExternalStore` | subscription effect updating a local cell; see the authored-source limitation in error log #006 |
| `useId` | stable per-instance allocation; a native entity-derived ID remains a possible improvement |
| `Children.count`, `Children.map` | bounded link-time caller specialization, not runtime child introspection |
| `use(promise)`, `Suspense` | `$read` and `Group`/`suspend` for the supported source shape |
| `useActionState` | `$forms` for the supported direct form |
| `useTransition`, `useDeferredValue` | current synchronous/identity translations are behaviorally divergent |
| `createContext`, `useContext` | diagnosed; no ancestry-scoped MMD context primitive yet |
| `createPortal` | diagnosed; no MMD portal ownership primitive yet |
| `lazy` component values | diagnosed; route-level code splitting is a different capability |
| `Children.only`, `Children.toArray`, `cloneElement`, `createElement` | diagnosed; MMD has no general element-value API |
| `react/jsx-runtime` `jsx`/`jsxs`/`jsxDEV` calls | diagnosed; compile JSX source before that transform |

Some paired cases intentionally show an idiomatic MMD equivalent that cannot
be generated from the React source today. For example, prop drilling reproduces
one `useContext` example but is not a general translation for nested providers.
Likewise, manually moving DOM for a portal example is not a compiler-owned
portal primitive.

## Package and type work

Opted-in packages must be resolved as source graphs, including their internal
imports. Test them as authored modules under `react-tests/fixture/` and, when
appropriate, as installed npm packages. Unsupported transpiled JSX runtime
calls and minified bundles are not accepted as if they were JSX source.

Before claiming support for a named package, collect its actual imported React
API uses, unsupported source shapes, and transitive dependencies. The coverage
report remains work to build. A package may also depend on another runtime
system, such as a CSS-in-JS engine; React elimination alone does not translate
that dependency.

The compiler strips TypeScript types, but typed application development will
need a React vocabulary mapped to MMD component and ref types. A dedicated
types-only shim remains deferred; it should avoid a conflicting global JSX
namespace.

## Acceptance rule

For each new React form: write its React and MMD pair, run the MMD target,
document differences, implement source translation through the shared
compiler, and verify a compiled React fixture in the DOM. If the MMD target
does not exist, improve MMD itself or give a precise diagnostic. This keeps
mixed authoring on one semantic path.
