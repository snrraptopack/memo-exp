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

## 004 — `key` on literal JSX children

**Code** (`assimilation/mmd/src/cases/16-children/Case.tsx`):

```tsx
<WrappedListGroup title="wrapped-two">
  {[<li key="a">A</li>, <li key="b">B</li>]}
</WrappedListGroup>
```

**Error** (vite dev server, plugin `memoized-dom`):

```
key={...} is only meaningful on list rows: items.map(item => <Row key={item.id} />)
```

**Why it fails**: `key` is not a general element prop in MMD — it exists
only to identify rows inside a `.map` list region. A literal array of JSX
isn't a list region, so `key` has no meaning there.

**Resolution**: removed `key` from the literal array (identity isn't
needed — the array is static). The deeper finding: this case also revealed
that authored `children` is an **opaque slot-mount closure**, not an array
— `Array.isArray(children)` is false and `children.map` doesn't exist.
React's `Children.count`/`Children.map` survive only as call-site
specializations, never runtime introspection.

## 005 — JSX-valued props must be render slots, not data

**Code** (`assimilation/mmd/src/cases/16-children/Case.tsx`):

```tsx
function WrappedList({ title, items }: { title: string; items: unknown[] }) {
  return <ul>{items.map((item, i) => <li data-index={i}>{item}</li>)}</ul>;
}
<WrappedList title="wrapped" items={[<span>A</span>, <span>B</span>]} />
```

**Error** (vite dev server startup, plugin `memoized-dom`):

```
JSX prop 'items' on <WrappedList> is not rendered by the callee; interpolate
that prop in <WrappedList> to declare a render slot
  at assimilation/mmd/src/cases/16-children/Case.tsx:25:7
```

**Why it fails**: props carrying JSX values are opaque render slots — the
callee may only interpolate them (`{items}`). Passing them through `.map`
as data doesn't count as "rendering" — the compiler requires an explicit
slot use. Together with #004 this closes the loop on #16: authored MMD has
**no element-level child introspection at all** — `Children.*` exists only
as React call-site specialization.

**Resolution**: data flows as data — `items={['A','B']}` (`string[]`), and
the component produces the row markup itself:

```tsx
function WrappedList({ title, items }: { title: string; items: string[] }) {
  return <ul>{items.map((item, i) => <li data-index={i}>{item}</li>)}</ul>;
}
```

**Lowering consequence**: `Children.map(children, fn)` can never have an
authored twin that inspects elements — the idiomatic equivalent is always a
data prop + list region. For assimilation, `Children.map` is sound *only*
via call-site specialization (which is what the compiler does).

## 006 — writing a `let` whose initializer reads reactive state (post-merge derived-let rule)

**Code** (`assimilation/mmd/src/cases/08-usesyncexternalstore/Case.tsx`):

```tsx
function LoweredReader({ name }: { name: string }) {
  let value = getSnapshot();          // getSnapshot() reads module `let current`
  effect(() => {
    const onChange = () => {
      const next = getSnapshot();
      if (!Object.is(value, next)) value = next;   // ← write to a derived let
    };
    const unsubscribe = subscribe(onChange);
    onChange();
    return unsubscribe;
  });
  ...
}
```

**Error** (vite dev server startup, plugin `memoized-dom`):

```
cannot write derived 'value' — its initializer reads reactive state; write its source instead
  at assimilation/mmd/src/cases/08-usesyncexternalstore/Case.tsx:10:6
```

**Why it fails**: the merged compiler generalised derivations — a `let`
whose initializer reads reactive state is now a *derived let*: it replays
when the source changes and is read-only for authors (writes must go to
the source). This is the *inverse* of the pre-merge rule that rejected
`let` initializers reading reactive state unless reassigned (see #002) —
the new rule allows the initializer but forbids the writes.

**Important asymmetry**: the exact same shape is still what the React
lowering *emits* for `useSyncExternalStore` — `let value = getSnapshot()`
plus effect-time writes (`assimilation.ts` external-store op) — and all
`state-sources.test.ts` tests still pass. Compiler output is rewritten at
the AST level *after* the authored-binding check runs, so the restriction
applies to handwritten source only. A hand-authored subscription bridge
over an MMD-reactive snapshot can no longer express the lowered shape.

**Resolution**: initialise from a literal and sync inside the effect:

```tsx
let value = 0;              // plain let — init reads no reactive state
effect(() => { … value = next … });
```

The initial literal is never visible — `effect` runs pre-paint (case 09
finding), so `onChange()` installs the real snapshot before first paint.

## 007 — derivation calling a helper that writes a module Map (promise cache)

**Code** (`assimilation/mmd/src/cases/22-suspense/api.ts` + `Case.tsx`):

```ts
// api.ts
const cache = new Map<string, Promise<Message>>();
export function fetchMessage(key: string, ms: number): Promise<Message> {
  let pending = cache.get(key);
  if (pending === undefined) {
    pending = new Promise(/* … */);
    cache.set(key, pending);              // ← write into reactive container
  }
  return pending;
}

// Case.tsx
function Panel({ k, ms, label }) {
  const msg = $read(fetchMessage(k, ms)); // ← derivation calls the helper
```

**Error** (vite dev server, plugin `memoized-dom`):

```
local const 'msg' is a per-instance derivation but calls helper 'fetchMessage' which writes reactive state
```

**Why it fails**: same purity machinery as #002 — the compiler scans through
`fetchMessage` into `api.ts` and sees `cache.set(...)` writing a
module-scope `Map` (a reactive container). A `const` derivation must be
pure; the write can't hide behind a call, even across files.

**Resolution**: the cache exists only for *React's* benefit — `use(promise)`
requires stable promise identity across re-renders. MMD bodies run once per
instance, so the MMD `api.ts` drops the cache entirely and returns a fresh
promise per call. The api files legitimately diverge; documented in both
READMEs.

**Finding**: "memoized promise factory" is itself a React-ism — a
render-stability device that has no purpose under run-once bodies. Where a
shared pending resource IS wanted, `$fetch`'s active-request sharing or an
explicit `$read` source binding is the MMD shape — not a hand cache.

## 008 — `ref={constBox}` on a host element passes the raw object to `mountRef` (silent runtime failure)

**Code** (`assimilation/mmd/src/cases/20-forms/Case.tsx`):

```tsx
export function FormsCase() {
  const formEl = { current: null as HTMLFormElement | null };
  ...
  <form ref={formEl} onSubmit={form.submit}>
```

**Error**: no compile error. Emitted code:

```js
const formEl = { current: null };
const _refDispose = _MD.mountRef(_form, formEl);   // raw box, not adapted
```

`mountRef`'s `mountValue` rejects non-function/non-array values with
`TypeError: ref value must be a callback, an assignable JSX target, or an
array of refs`. The box lands in the *deferred* ref class, so the throw
happens inside a microtask — the page keeps working and the failure is only
observable as "the ref never populated": `formEl.current` stays `null` and
`formEl.current?.reset()` silently no-ops (input didn't reset on submit).

**Why it happens**: `compileRefValue` only wraps a box when
`isObjectRefIdentifier` matches — identifier bound to a `const` declarator
whose init is an object literal with a `current` property. That check
didn't fire here (component-body const classification or the `null as T`
cast init), so the identifier fell through to raw clone — emitting code the
runtime is guaranteed to reject. Neither compile nor mount reported it
loudly.

**Resolution**: use the mutable-sink idiom (same as case 10):

```tsx
let formEl: HTMLFormElement | null = null;
<form ref={formEl}>                    // → refAssign(node => formEl = node)
... formEl?.reset();
```

Verified in emitted code: `_MD.refAssign((_refNode) => { formEl = _refNode; … })`.

**Compiler gap worth fixing**: `ref={X}` on a host element should either
adapt `{current}` boxes or *diagnose* non-adaptable non-function values —
a guaranteed runtime TypeError should never emit silently.

**Resolved (runtime)**: `mountRef`'s `mountValue` now accepts a `{ current }`
box at runtime — the same write + conditional-clear contract as the
compile-time `refAssign` adapter. This covers the case the compiler can
never see: a box carried through a prop (`<Field inputRef={box}>` →
`ref={inputRef}`). Compile-time adaptation stays preferred for provable
module/component-scope boxes because it lands in the eager creation-time
class. The `let` sink idiom remains the recommended authored form.
