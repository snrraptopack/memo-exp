# Error log

Compiler errors hit while hand-lowering cases. Each entry keeps the producing
code, the exact error, and how it was resolved — these become diagnostics or
supported forms later.

## 001 — dynamic JSX tag fed by a route map lookup

**Code** (`assimilation/mmd/src/App.tsx`):

```tsx
const routes = {
  '01-usestate-counter': UseStateCounter,
  '02-useeffect-title': UseEffectTitle,
  // …
};

export function App() {
  let route = location.hash.replace(/^#\/?/, '');
  // hashchange listener writes `route` …

  const Case = (routes as Record<string, typeof CaseIndex>)[route] ?? CaseIndex;
  return (
    <main>
      <Chrome />
      <hr />
      <Case />
    </main>
  );
}
```

**Error** (vite dev server, plugin `memoized-dom`):

```
 dynamic JSX tag 'Case' has no finite string or linked-component candidates
  at assimilation/mmd/src/App.tsx:47:7
```

**Why it fails**: a dynamic tag needs a *finite, statically discoverable*
candidate set. `routes[route]` is a computed member lookup — the compiler
can't enumerate which components the selector may pick, and `??` /
`LogicalExpression` initializers aren't traversed for candidates.

**Resolution**: switched both apps to their ecosystem's official router —
MMD's compiler-owned `route` / `route-to` attributes (real URL paths), React's
`react-router-dom` `<Routes>/<Route>` — same path table on both sides. React's
runtime `routes[route]` component dispatch has no MMD lowering; there is no
dynamic component type to lower to.

## 002 — `++` update inside a per-instance `const` derivation

**Code** (`assimilation/mmd/src/cases/12-useid/Case.tsx`):

```tsx
let nextFieldId = 0;

function Field({ label }: { label: string }) {
  const id = `field-${nextFieldId++}`;   // ← update inside a derivation
  return (
    <p>
      <label for={id}>{label}</label>{' '}
      <input id={id} />
    </p>
  );
}
```

**Error** (vite dev server, plugin `memoized-dom`):

```
local const 'id' is a per-instance derivation but contains an update (++/--) to reactive state
  at assimilation/mmd/src/cases/12-useid/Case.tsx:3:0
```

**Why it fails**: `const` bodies must be pure — a `useId` lowering that
bumps a module counter *inside* the derivation is rejected. There is also a
deeper semantic trap even if it compiled: `id` would read reactive module
`nextFieldId`, so every later mount would replay it — all fields would
collapse onto the newest id.

**Attempts that also failed** (each a distinct compiler rule):

```tsx
nextFieldId++;
let id = `field-${nextFieldId}`;
// → " let 'id' is never reassigned and its initializer reads reactive
//    state; use const for derived values"

function allocFieldId() { nextFieldId++; return `field-${nextFieldId}`; }
const id = allocFieldId();
// → " local const 'id' is a per-instance derivation but calls helper
//    'allocFieldId' which writes reactive state"
```

The compiler scans *through* helpers — the write can't be hidden behind a
call. `const` demands purity; `let` demands a real reassignment whose init
doesn't read reactive state. "Snapshot a mutable source once at init" is
deliberately unwritable as a derivation — which is correct, since the
derivation form is semantically broken anyway (replay collapses all ids).

**Resolution**:

```tsx
function Field({ label }: { label: string }) {
  let id = '';
  id = allocFieldId();                    // statement reassignment — allowed
```

`let` + a genuine statement-level write satisfies both rules, and the value
is a stable snapshot, never replayed. The ceremony is the finding: `useId`
needs an entity-derived intrinsic (component instance id) so this pattern
disappears — confirmed by all three rejections, each closing a different
incorrect shortcut.

## 003 — `ref` attr on a component sinks the DOM root, not the prop value

**Code** (`assimilation/mmd/src/cases/10-useimperativehandle/Case.tsx`):

```tsx
function Field({ label, ref: api }) {          // expecting the box
  effect(() => { api.current = { focus(){…}, clear(){…} }; });
  return <label>{label}: <input ref={input} /></label>;
}
<Field label="Name" ref={api} />               // api = { current: null }
```

**Error**: no compiler error — it *compiles*. Runtime is silently wrong:
`focus field`/`clear field` buttons do nothing. Emitted code shows why:

```js
ref: _MD.refAssign(node => { api.current = node; })   // caller side
let { label, ref: api } = _props[0];                  // child gets the
                                                       // refAssign wrapper
```

The caller's `ref` attr is consumed by MMD's ref machinery as a
**root-node sink** — `api.current` receives the child's DOM `<label>`, and
the prop delivered to the child is the `refAssign` *callback*, not the box.
The child's `api.current = {focus, clear}` writes onto the wrapper
function; the parent's box ends up holding a DOM node (`.focus()` no-ops on
`<label>`, `.clear` is `undefined`).

**Why it matters for assimilation**: `forwardRef` survived this in `03`
only because its `ref` prop is *re-forwarded* into another `ref=` attr —
callback refs compose transitively. `useImperativeHandle` reads/writes the
box itself, so it needs the raw value — `ref` on a component element can
never deliver that.

**Resolution**: pass the handle box as an ordinary prop:

```tsx
function Field({ label, api }) { … api.current = {…} … }
<Field label="Name" api={api} />
```

**Lowering consequence**: `useImperativeHandle(ref, factory)` cannot reuse
the `ref` attribute channel — the compiler must route the handle box
through a differently-named internal prop (or a dedicated handle slot),
because `ref` is owned by DOM-root sinking on both host and component
elements.
