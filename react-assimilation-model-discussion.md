# React assimilation through the MMD model

Status: discussion, not an implementation plan or compatibility promise.

Implementation observations below describe the archived
`feat/react-assimilation` experiment at commit `0b4df8a`. This rewrite branch
starts from `main`, without that experiment's React lowering. Archived files
can be inspected with `git show 0b4df8a:<path>`.

The question here is: **what does React-authored package code mean after it is
compiled as MMD?** MMD does not try to execute React's render loop. The source
package is a different authoring dialect. Its constructs should be classified
by the MMD operation they express, then compiled into that operation when the
translation is well-defined. A React API name alone does not establish that
the package can be assimilated.

This inventory uses the current [React reference](https://react.dev/reference/react)
and [React DOM reference](https://react.dev/reference/react-dom) to find source
forms, including forms absent from the archived `react/semantics.ts`. They are an
inventory of inputs, not the target behavior. MMD's own authoring contract
comes from [the starter](docs/01-start.md), [state](docs/02-state.md),
[effects](docs/03-effects-and-cleanup.md), [refs](docs/04-refs.md),
[data](docs/05-data.md), [Group](docs/06-group.md),
[routing](docs/07-routing.md), [the router API](docs/08-router-api.md),
[SSR](docs/09-ssr.md), [server functions](docs/12-server-functions.md),
[route preparation](docs/16-routed.md), [the guide](guide.md), and the
implementation cited below. The remaining `docs/` guides define server
request, middleware, configuration, and context lifetimes. Those are host
boundaries rather than component-local React API targets.

## 1. What an MMD author writes

```tsx
export function Counter({ step }: { step: number }) {
  let count = 0;
  const doubled = count * 2;
  let button: HTMLButtonElement | undefined;

  effect(() => {
    document.title = String(count);
  });

  return (
    <button ref={button} onClick={() => count += step}>
      {count} / {doubled}
    </button>
  );
}
```

The component call initializes one instance. `count` is an instance-owned JS
binding; the assignment in the handler is the write. `doubled` is a replayable
derivation. The text expressions are DOM slots. `effect` is an owned
post-render synchronization process. `button` is a DOM ref slot. The component
body is **not** called again for each change. See
[instance analysis](packages/compiler/src/analysis/instance.ts),
[effect discovery](packages/compiler/src/effects/discovery.ts), and
[component emission](packages/compiler/src/emission/component.ts).

Other authoring forms follow the same rule:

| Authored MMD form | Meaning |
| --- | --- |
| Module `let`, mutable object/array/Map/Set, imported helper | Shared JS state; linked reads and writes route updates across files. |
| Component `let` or mutable `const` object | Per-instance state in the factory closure. |
| Top-level component `const x = expression` | Ordered derivation replayed when its proven inputs change. |
| Pure top-level `if`/`switch` assigning values | Replayable control-flow derivation. |
| JSX host element and expression | Create real nodes once; guarded writes update dynamic text/attributes/properties. |
| `<Child prop={x}>...</Child>` | Stable child entity, mutable props box, and lazy caller-owned `children` mount slot. |
| JSX condition or supported JSX return branches | Owned conditional region; changing branch disposes its subtree. |
| `{items.map(x => <Row key={x.id} ... />)}` | Keyed list region with persistent row identity. |
| Handler, async continuation, reachable helper | Ordinary JS write plus compiler-emitted invalidation for its known write set. |
| `effect(fn)` / `cleanup(fn)` | Reactive post-render process / one-time instance teardown. |
| `ref={slot}` or `ref={callback}` | DOM assignment or node setup with region-owned disposal. |
| `$fetch`, `$track`, `Group`, `suspend` | Transparent data source, request control, and MMD presentation/read boundaries. |
| `route`, `route-to`, reactive `route` snapshot | Compiler-owned URL regions and navigation; route declarations and destinations are linked across the app. |
| `$routed(prepare)` in a routed component | Navigation-owned preparation before mount; may run on the server and transport a serializable result. |
| `get*` server function / mutating `post*` etc. | A transparent reactive read source / event- or effect-owned mutation across the server boundary. |

These are source-language constraints, not general JavaScript semantics. For
example, `const view = <Panel />` is a compile-time render alias, not an
arbitrary runtime element object; a mutable array of JSX is not a virtual
tree. Nested children are a mount channel owned by the caller, not data that
the callee can freely inspect. See [R21 and R29](emission-spec.md) and
[JSX value normalization](packages/compiler/src/components/jsx-values.ts).

## 2. How MMD lowers that code

The useful boundary is **authored syntax → analyzed meaning → emitted work**.

1. The linker resolves the connected module graph and supplies import,
   component, prop, and read/write facts. The parser supplies ESTree.
   [Linker](packages/compiler/src/linker.ts),
   [compile entry](packages/compiler/src/compile.ts).
2. Preparation normalizes recognized component/JSX forms. Analysis discovers
   module and instance state, derivations, effects, structural regions,
   component reads, and static write routing.
   [Preparation](packages/compiler/src/analysis/prepare.ts),
   [analysis coordinator](packages/compiler/src/analysis.ts).
3. Each component becomes a factory with an initialization/DOM-creation path
   and an `update` closure. It registers an entity under a stable hierarchical
   ID. Dynamic slots guard DOM writes using previously written values.
   [Component emitter](packages/compiler/src/emission/component.ts),
   [host emitter](packages/compiler/src/emission/host-element.ts),
   [text emitter](packages/compiler/src/emission/text-node.ts).
4. Compiler-instrumented writes mark only relevant entities when analysis can
   bound the effects. Parents push changed props into child boxes; lists and
   conditions own their nested lifetimes. The runtime drains render work before
   effects. [Write routing](packages/compiler/src/handlers.ts),
   [access table](packages/compiler/src/analysis/access-table.ts),
   [kernel](packages/runtime/src/kernel.ts),
   [props](packages/runtime/src/props.ts),
   [effects](packages/runtime/src/effect.ts).

Conceptually, `useState` need not become a runtime hook. It can become the
same instance binding and instrumented setter that MMD would generate for a
`let` assignment. `useMemo` need not maintain a React hook cache if its value
can become an MMD derivation. The target is the **MMD meaning**, including its
different update and lifecycle rules.

## 3. Translation categories

The categories below describe target mechanisms. Several React APIs collapse
to the same category. "Archived" describes the earlier feature branch's approach,
not a claim that every package use of the API works.

| MMD target category | React source forms | MMD interpretation | Archived assimilation / gap |
| --- | --- | --- | --- |
| **Instance state and writes** | `useState`, `useReducer`; state setters and updater functions | Local binding initialized once; setter performs an analyzable assignment and invalidation. | Lowered to `let` and setters in archived `packages/compiler/src/react/hooks.ts`. Destructured tuple/call-position restrictions remain. |
| **Derived values and stable closures** | `useMemo`, `useCallback`, `memo`, `PureComponent` | Replay a derivation or retain a closure where MMD's dependency analysis says it is needed; component update selection is MMD-owned. | `useMemo` callback is unwrapped, `useCallback` becomes its callback, `memo` is erased. Class `PureComponent` is absent. The source expression's legal position and identity uses need analysis. |
| **Owned processes and teardown** | `useEffect`, `useLayoutEffect`, `useInsertionEffect`, `useEffectEvent`, `useImperativeHandle` | `effect` or `cleanup` owned by a component/region; reads determine MMD invalidation. DOM setup/ref exposure needs a defined phase. | First three lower to ambient `effect`; imperative handle lowers to an effect. Distinct timing and `useEffectEvent` have no MMD target contract yet. Dependency arrays are intentionally not MMD dependencies. |
| **Refs and DOM access** | `useRef`, `createRef`, `forwardRef`, callback/object `ref` | Persistent non-reactive instance storage; host ref assignment/callback; explicit forwarding via props. | `useRef` and wrapper `forwardRef` are lowered. General `createRef`, ref identity and callback replacement forms need inventory. See [MMD refs](docs/04-refs.md). |
| **External state source** | `useSyncExternalStore`; library-specific store hooks | Subscribe an instance to an opaque external source and invalidate MMD readers when its snapshot changes. | A snapshot cell plus effect is emitted. This should be one recognized external-source operation rather than a special case per store library. [External reactivity](packages/compiler/src/external-reactivity.ts) is related. |
| **Ancestry-scoped value** | `createContext`, `useContext`, provider, consumer | Read a value from an owner/lexical ancestor and invalidate consumers when the provided value changes. | Descriptors, provider overrides and runtime context boxes exist in archived `packages/compiler/src/react/context.ts` and `packages/runtime/src/context.ts`; `<Context.Consumer>` is unsupported. |
| **Structural DOM region** | JSX, fragments, conditional children, keyed arrays, `Children` traversal when statically resolvable | Host/component creation, conditional region, list region, or lazy child mount slot. | Ordinary JSX and factory calls are lowered. General element-valued arrays, child inspection, and cloning exceed MMD's present render-alias/slot model. |
| **Dynamic component selection** | `createElement(type, props)`, `jsx(type, props)`, `lazy`, polymorphic `as`, component registries | Choose a finite intrinsic/component target and mount the corresponding MMD region, or diagnose when target cannot be bounded. | Factory calls become JSX; [dynamic-tag analysis](packages/compiler/src/jsx/dynamic-tags.ts) handles some finite candidates. Route-exclusive imported components can already be chunked, but that is tied to `route` sites; it is not general `lazy` lowering. |
| **Async read/presentation boundary** | `use(promise/context)`, `Suspense`, `lazy`, `useActionState`, `useOptimistic`, form actions | A proven transparent source may use `$fetch`-style reads and `Group`/`suspend`. A navigation-owned operation may instead use `$routed` before mount. Async actions need their own mutation ownership. An arbitrary Promise is not automatically any of these. | Mostly absent/diagnosed. Existing [data source](packages/compiler/src/features/data-sources/), [Group](docs/06-group.md), and [route preparation](docs/16-routed.md) are distinct possible targets, chosen only from source/ownership facts. |
| **Route and request scope** | React packages that read URL/navigation state, load code or data on navigation, or rely on request-local caches | MMD has reactive `route`, compile-time `route` regions, pre-mount `$routed` preparation, and request-owned SSR state. | There is no generic translation from arbitrary package navigation/request conventions. The linker must prove the host boundary before treating these as MMD route work. |
| **Scheduling priority and visibility** | `useTransition`, `startTransition`, `useDeferredValue`, `Activity`, `ViewTransition`, `addTransitionType`, `flushSync` | MMD may execute ordinary writes and commit; a pending/deferred/hidden state requires an explicit MMD scheduler or region contract. | Transition callbacks run synchronously and deferred values become their input. This is an intentional MMD translation only where a package does not rely on pending/deferred behavior. `Activity`/view transitions are absent. `commit()` is MMD's sync flush primitive. |
| **Identity, diagnostics, tooling** | `useId`, `useDebugValue`, `Profiler`, `StrictMode`, `act`, `captureOwnerStack` | Stable MMD entity-derived ID, or development/test metadata with no production DOM operation. | `useId` marker and `useDebugValue` erasure exist. Remaining APIs should be classified as tooling-only or rejected according to whether a package observes their results. |
| **Renderer/host entry** | `createRoot`, `hydrateRoot`, `renderTo*`, `prerender*`, portals, resource preload APIs | Root mount/hydration/SSR belongs to the MMD host. Portal needs an owned DOM relocation target. Preload calls belong to host/resource policy. | React root/server renderer calls are diagnosed. Portal/preload contracts are absent. An assimilated component library normally should not invoke a React root. |
| **Host DOM protocol** | `onChange`, capture events, controlled `value`/`checked`, `defaultValue`, `dangerouslySetInnerHTML`, form `action`, refs | Translate props/events into MMD's host DOM setters, events, and lifecycle. | Some generic JSX handling exists; a React DOM prop/event inventory and source-specific normalization are still needed. This is distinct from hook support. |

The official references list [hooks](https://react.dev/reference/react/hooks),
[components](https://react.dev/reference/react/components),
[other APIs](https://react.dev/reference/react/apis),
[legacy element APIs](https://react.dev/reference/react/legacy),
[React DOM](https://react.dev/reference/react-dom), and
[React DOM form hooks](https://react.dev/reference/react-dom/hooks). Newer
surfaces such as [`useOptimistic`](https://react.dev/reference/react/useOptimistic)
and [`<ViewTransition>`](https://react.dev/reference/react/ViewTransition)
are included because a table limited to the archived semantic names would
hide them.

### API names hidden or misclassified by the archived table

Comparing the official reference with
the archived `REACT_API_SURFACES` in `packages/compiler/src/react/semantics.ts` exposes work
that an inventory built from that table alone would miss:

| Inventory result | Examples | Category to investigate |
| --- | --- | --- |
| No entry in the table | `useEffectEvent`, `createRef`, `Component`, `PureComponent` | Owned process/event closure, persistent ref, or class component model. |
| No entry in the table | `<Activity>`, `<ViewTransition>`, `addTransitionType` | Region visibility and scheduling/animation. |
| No entry in the table | `cacheSignal`, `captureOwnerStack`, `browser` | Cache/request lifetime, development metadata, or server-only resource policy. |
| No entry in the table | `react-dom` resource APIs (`prefetchDNS`, `preconnect`, `preload`, `preloadModule`, `preinit`, `preinitModule`), `react-dom/static` APIs, server stream/resume variants | Host/build/SSR boundary rather than component lowering. |
| Classified as a supported *category* without a matching general lowering | `lazy` is labeled `component-wrapper`, while wrapper normalization handles `memo` and `forwardRef`; `isValidElement` uses a DOM-node test | Dynamic import/component region; element-value flow. A category flag is too coarse to certify either API. |
| Listed under a source module that does not own the public API | `useFormStatus` and `createPortal` appear under `react`; their documented entry point is `react-dom` | Keep source-module identity in recognition, coverage, and diagnostics. |

The table also already names but rejects `Children`, `cloneElement`,
`Suspense`, `use`, `useOptimistic`, `useActionState`, and React DOM root/server
entry points. These are visible gaps; the rows above are the less visible
ones. The source references are the official
[React API](https://react.dev/reference/react),
[legacy API](https://react.dev/reference/react/legacy),
[React DOM](https://react.dev/reference/react-dom), and
[static renderer](https://react.dev/reference/react-dom/static) indexes.

## 4. What collapses, and what does not

### Good collapse candidates

- `useState`, `useReducer`, and simple custom state hooks all describe an
  **instance binding plus writes**. A setter is source syntax for a write.
- `useMemo`, calculations in custom hooks, and ordinary React render-local
  calculations can become **MMD derivations** when the compiler can prove
  replay and ownership. They do not need separate runtime caches merely
  because they arrived through different APIs.
- `useEffect`, subscription hooks, imperative handles, and callback ref setup
  all ask for an **owned process with disposal**. Their source forms differ,
  but the MMD target should be specified once, including execution phase.
- `useContext` and `useSyncExternalStore` are both **reads of externally
  changing values**, with different source discovery and ownership. They can
  share the downstream invalidation/read model without pretending they have
  the same provider/subscription protocol.
- JSX, `jsx/jsxs`, and `createElement` all construct **render intent**. Parsing
  differences should disappear before host/component/region planning.

### Boundaries that cannot be collapsed by spelling alone

- **Element as a value.** React's `createElement` produces a description
  before any DOM exists. MMD's JSX aliases are compile-time render sites and
  `children` is a lazy mount channel. `Children.*`, `cloneElement`,
  `isValidElement`, arbitrary element arrays, and escaped elements must be
  addressed as a *source-level element-value flow* problem. Possible
  solutions are static specialization for a bounded flow, a compiler-owned
  descriptor passed only across assimilated boundaries, or a diagnostic.
  The archived `isValidElement` → `instanceof Node` rule classifies DOM nodes,
  not source elements; it should not stand as the general translation.
  [React's element description](https://react.dev/reference/react/createElement)
  makes the distinction explicit.
- **Hook function boundaries.** A custom hook is a reusable declaration of
  instance-owned state/processes. Cloning its source into every caller is one
  possible implementation, but the analysis must preserve lexical bindings,
  return control flow, ownership, and source locations. The archived
  hook inliner (`packages/compiler/src/react/custom-hooks.ts`) and
  cross-module materializer (`packages/compiler/src/react/hook-sources.ts`)
  encode these separately. A hook summary or specialization plan could let
  the linker reason about the declaration before rewriting its AST.
- **Scheduling/async behavior.** MMD's ordinary synchronous write plus commit
  is a legitimate translation for code that only needs eventual UI update.
  It does not produce a meaningful `isPending`, deferred snapshot, hidden
  preserved subtree, or Suspense reveal by itself. The compiler must know
  whether those outputs are used before accepting the translation.
- **Preparation versus ordinary async work.** `$fetch` is a reactive value
  source; `Group` selects presentation at read sites; `suspend` delays a first
  mount; `$routed` runs for a matched route before mounting and can execute on
  the server. A `get*` server function yields a read source, while a mutating
  server function is called from an event/effect/deferred callback. These are
  different ownership and timing contracts, even though all can involve a
  Promise. The [data](docs/05-data.md), [Group](docs/06-group.md),
  [server-function](docs/12-server-functions.md), and
  [route-preparation](docs/16-routed.md) guides make those boundaries clear.
- **Host ownership.** React roots, portals, DOM form actions, and streaming
  renderer APIs operate at host boundaries. They should not be silently
  reinterpreted as component-local state or JSX.

## 5. Where the archived assimilation crosses the model

The [RFC](react-assimilation-rfc.md) describes recognition that yields common
compiler entities. The archived preparation order in
`packages/compiler/src/analysis/prepare.ts`
instead lowers element factories, providers, wrappers, hooks, and then element
factories again before ordinary MMD analysis. This turns phase order and AST
shape into part of the translation. A hook can introduce JSX after an earlier
JSX pass; a source construct can be accepted by one normalization and become
leftover JSX or an unsupported component parameter later.

The archived coverage report (`packages/compiler/src/react/coverage.ts`) answers
"were all referenced API names classified as supported?" Its `covered` bit
does not answer "can this package be translated into MMD?" because component
shapes, call positions, element-value escapes, host props, and target behavior
are not checked there. Coverage should report these as distinct dimensions.

This is a modeling issue rather than an argument for React runtime behavior.
Even when MMD deliberately chooses a different result, the compiler should
make **one explicit translation decision** and propagate it through linking,
analysis, emission, diagnostics, and package coverage.

## 6. Proposed answers before a rewrite

These are recommended engineering decisions for discussion. They retain the
MMD runtime and its authoring semantics. They do not require a React render
loop or a general runtime virtual tree.

### 6.1 One analyzed translation plan, then one lowering

Build a per-module **assimilation plan** before mutating the AST. The linker
resolves the package's live imports/exports and binding identities first. A
React source analyzer records operations such as `InstanceState`,
`Derivation`, `OwnedProcess`, `RefSlot`, `ExternalSource`, `ContextChannel`,
`RenderValue`, and `HostOperation`, each with source location, lexical owner,
and captured bindings. Validation either proves the MMD target or reports the
specific missing operation. One lowering consumes the validated plan and
feeds the existing MMD analysis/emitter. A new core compiler seam is warranted
only where ordinary MMD syntax cannot express the operation.

This need not be a wholesale rewrite of the MMD compiler. It is a stable
contract **above** it. Manifest discovery and final emission should reuse the
same plan. React passes should not re-recognize their own generated AST, rely
on a later pass to find a marker, or run a second factory/JSX sweep because
another pass inserted source syntax. The initial rewrite milestone is a small
vertical slice, not migration of every API in one change.

### 6.2 Element values are compile-time render plans with an escape limit

Represent an assimilated element as a symbolic `RenderValue` during analysis:
host/component choice, props, key/ref, children, and owner. It can be a direct
element, fragment, conditional, known collection, or caller-owned child slot.
`createElement` and JSX produce the same plan. `cloneElement` merges a proven
plan's props; `Children.map` transforms a proven sequence; `isValidElement`
tests the known source-value kind. The result is lowered into MMD host,
component, list, conditional, or slot emission. It need not allocate a runtime
React element object.

The linker must be able to specialize a package component with the child
shape supplied by its caller, including a caller in an MMD module. If a render
value escapes into mutable arbitrary data, an unknown function, an unresolved
dynamic import, or a public runtime return, reject that flow at its origin.
Finite dynamic tag candidates can use MMD's existing dynamic-tag regions;
unbounded targets diagnose. This is a deliberate package-coverage limit. It
also replaces the `isValidElement` DOM-node shortcut with a source-level rule.

### 6.3 Custom hooks are linker-visible templates

Analyze a custom hook once as a template of local state, derivations, owned
processes, returned values, and lexical captures. At each statically known
call site, specialize the template into the calling component's instance with
hygienic names and source provenance. Valid top-level call expressions can be
linearized into temporaries before specialization; the source need not be
restricted to one declarator spelling. Recursive or dynamically selected hooks
remain diagnostics.

An exported hook is compile-time metadata for the linker. Its import and call
should disappear from emitted JS after specialization. Do not emit a throwing
runtime export as the ordinary cross-module protocol. Captures of source
module bindings must keep their canonical source-module identity; do not copy
arbitrary module initializers into each caller. If a capture cannot be kept
live or bounded, diagnose that capture rather than approximate its value.

### 6.4 Make translation policy explicit per *use*, not per API name

Use four outcomes in the plan and coverage report:

| Outcome | Meaning | Example |
| --- | --- | --- |
| **MMD operation** | Source form has an established MMD target. | `useState` → instance binding/write; `useMemo` → derivation; ordinary JSX → DOM/region plan. |
| **MMD replacement** | The chosen MMD meaning is intentionally different and documented. | `memo` erased because MMD owns update selection; effect dependencies come from MMD read analysis; a transition call may run as an ordinary callback. |
| **Needs a target operation** | The source demands a concept MMD has not defined. | General portal ownership, preserved hidden activity, a pending action state, or an unbounded element value. |
| **Rejected source form** | Its flow/host use is outside the supported dialect. | Dynamic hook call, escaping element object, React root creation inside a package. |

The outcome must be checked at a use site. For example, translating
`useTransition` to an ordinary call also defines `isPending` as always false
under MMD; that is a *replacement*, not full transition support. Likewise,
`useDeferredValue(x)` may be immediate `x` under MMD. The report should say
so instead of marking an entire `transition` category simply "supported."

Effect phase is a separate decision: MMD `effect` runs after render work.
`useLayoutEffect` and `useInsertionEffect` should either carry an explicit
MMD phase policy or be rejected until one exists; their name alone must not
make them equivalent to ordinary `effect`. For context, prefer a compiler-owned
scope channel passed through component and slot ownership, with provider
writes invalidating statically known consumers or, conservatively, the owned
region. Prototype that against lists and forwarded children before retaining
the archived runtime subscriber sets. This keeps context aligned with MMD's
compile-time dependency model as far as the dynamic provider tree permits.

### 6.5 Gate packages on translation evidence

Report four separate results for the **reachable** package graph:

1. **Vocabulary:** every imported React/React DOM source use is identified.
2. **Translation:** every live use has an outcome, owner, and MMD target or a
   source-location diagnostic; element and hook flows are checked.
3. **Emission:** the linked graph builds without residual React imports,
   throwing hook stubs, or leftover JSX.
4. **MMD behavior:** interaction, cleanup, list identity, context propagation,
   and external-source tests assert the *chosen MMD behavior*. SSR/hydration
   tests apply where the package is used on those paths.

Only the fourth result justifies saying a package works for its tested uses.
The tests should compare against the authored MMD contract, not a React
runtime oracle. Keep reports per live export/use path so a package with one
unsupported export need not obscure a supported one after pruning.

### First rewrite slice

Use five source shapes: a stateful custom hook crossing modules, a compound
component that inspects known children, a finite dynamic element factory, an
external-store hook, and a provider crossing a component/slot boundary. For
each, record the plan, lower once, and test the generated MMD behavior. These
cases exercise all three hard representations without adding another
API-specific preparatory pass. Once they hold, extend the API table by target
operation rather than by package name.

## 7. Rewrite checkpoint

The rewrite now selects React source by opted-in package identity and validates
one translation plan before changing a module AST. The instance category covers
direct `useState` and `useReducer` bindings. Derived values and stable closures
cover direct `useMemo` and `useCallback`; an owned process covers direct
`useEffect`. `useSyncExternalStore(subscribe, getSnapshot)` uses one MMD
instance binding and owned subscription. It reads the snapshot again after
subscribing to close the mount-time gap, compares with `Object.is`, and disposes
the returned subscription with the owner. Its third server-snapshot argument
is diagnosed until an SSR target operation is specified.

The linker now specializes a bounded exported custom hook across package files
before manifest discovery. Its direct, top-level tuple call becomes statements
owned by the caller component; fresh lexical names prevent collisions when a
component calls the hook twice. The ordinary React operation plan then lowers
those statements to MMD. The hook definition and import disappear from emitted
JavaScript. A bare module import still evaluates the hook's source module so
its other top-level effects keep their ESM meaning. A source-module capture,
local call, reexport, or unsupported call
shape gets a diagnostic rather than a runtime stub. This initial template form
requires named React API imports, plain positional parameters, and a final
tuple of local bindings. Captures with canonical source identity, general
return flow, and MMD application callers still need a linker contract.

The independent [React test suite](react-tests/README.md) compiles authored
package files through the linker and exercises DOM updates, separate instances,
effect cleanup, reducer dispatch, external notifications, subscription
disposal, and linked custom-hook specialization. Named package reexports now
link through the shared compiler for ordinary exports. The current proof
covers those source shapes, not a whole installed library. Render-value
inspection/escape, general context, and host DOM protocol translation remain
open. The first-slice cases above remain the acceptance target for the broader
rewrite.
