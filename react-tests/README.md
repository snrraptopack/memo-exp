# React assimilation tests

Run this suite separately with `bun run test:react`. The normal root Vitest
configuration excludes `react-tests/`.

`fixture/` contains source files as a package author and an MMD app would write
them. Put a local package under `fixture/<package-name>/`, import it by its bare
name from an app fixture, and add the name to `compileFixture({ packages: [...] })`.
The harness collects the reachable files, calls `compileModules` with real
module identities, emits the linked graph under the ignored `out/` directory,
and lets tests import and mount the result in happy-dom. Application files can
mix React imports with ordinary MMD constructs in the same module. A
selected installed npm package can use the same `packages` list; its files resolve from
`node_modules`.

The browser entry remains an authored MMD `mount(target, App)` call. React root
APIs are outside the migration source subset. The ref fixture lowers
`useRef` into an instance box. MMD's DOM ref compiler accepts the box for
direct and component-forwarded sinks, including conditional cleanup and remount.

Assert the emitted translation and the chosen **MMD behavior**. DOM tests
should cover updates, independent instances, cleanup, and ownership where the
package needs them. A package passing source recognition alone is not a claim
that it works in the DOM.

`lab-lowering.test.ts` compiles selected authored files directly from
`assimilation/react/src/cases/` and drives their MMD output in the DOM. It
currently checks derived chains, callback captures, immediate deferred values,
and host attributes. The text-input event assertions expose a current gap:
React-authored `onChange` remains MMD's native `change` event, while the
handwritten MMD twin uses `onInput` for per-keystroke updates. The full MMD lab
compile test validates source acceptance only; it does not test every React
case's behavior.

The compound child fixture exercises the first bounded child-sequence
observation: `Children.count(children)` in a package component. The linker
reads each known caller's JSX children, passes the count as a scalar component
input, and leaves the actual children in MMD's caller-owned mount slot.
Fragments count as one child. A sole `null` children value counts as zero;
`null` in a child array counts as one. An unknown child expression is diagnosed
at the caller.

The row fixtures compile package `Children.map` wrappers around individual
caller-owned render slots. Tests cover stateful child content, fragments,
component children, empty nodes, callback indexes, a package wrapper
component, package state, and changing props. A single caller-owned
`items.map(item => <JSX />)` child also lowers through MMD's keyed list and
render callback path. The dynamic fixtures grow and shrink the caller list,
check retained DOM identity, and update a package-owned wrapper through state
and props. The dynamic callback must return one JSX element. Its collection
source remains an ordinary MMD reactive input, including property paths such
as `state.items`. The React pass only adapts `Children.map` around the
caller-owned row. The package wrapper may have an intrinsic root or a
top-level package component root exposed through a named export.
Both `export { Name } from './module'` and unambiguous
`export * from './module'` barrels work. The component keeps its children slot
and live props.

An intrinsic wrapper can also contain a top-level package component. Each
dynamic row mounts its own component instance, retains its state across keyed
list updates, and receives live package props.

Other unknown child shapes diagnose.
