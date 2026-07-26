# memoized-dom — Emission Spec

> **Status:** Normative reference for the compiler (M5). This document defines,
> rule by rule, what code the compiler emits for any valid source. The Babel
> plugin (frontend #1) and any future oxc frontend (frontend #2) are both
> *implementations of this spec* — if emitted output disagrees with this
> document, the plugin is wrong, not the document.
>
> Companion document: `memoized-dom-paradigm.md` (the *why*). This is the *what*.
>
> **For agents/contributors:** do not invent emission behavior not covered here.
> If you hit an uncovered pattern, emit the defined fallback and add the pattern
> to §10 (open decisions).

---

## 1. Source language model

Users write **plain TypeScript + JSX**. No imports, decorators, hooks, or
framework primitives are required to make the paradigm work.

```tsx
let selectedId: number | null = null;   // module-level shared state

function Counter() {
  let count = 0;                        // component-local state
  return (
    <button onClick={() => count++}>
      count: {count}
    </button>
  );
}
```

The mental model the user holds: *"I assign variables; the UI updates."*
Everything below exists to make that sentence true.

## 2. Terminology

| term | meaning |
|---|---|
| **entity** | a mounted component instance: `{ id, parent, render }` in the runtime registry |
| **`$` (slot cache)** | per-instance object holding the previous value of every dynamic slot |
| **slot** | one dynamic expression in JSX (text interpolation, attribute, class condition, style) |
| **write-set** | state paths an execution scope may have changed |
| **access table** | the compile-time `readers` map: variable → entity-id patterns |
| **exact effect** | a state path directly proven to change |
| **bounded effect** | a conservative write boundary attached to a known receiver/argument path |
| **unbounded effect** | an effect with no finite state receiver/argument boundary → root-subtree commit |
| **root-subtree commit** | dirty the root entity and all descendants (Imba-equivalent fallback) |

## 3. Emission rules

### R0 - Generated identifiers are hygienic

Every compiler-owned lexical binding is allocated through one Babel
scope-aware UID allocator initialized from the original program. The allocator
reserves user identifiers from the entire source tree, including nested
callbacks, before emission begins. This covers the runtime namespace, factory
parameters, props boxes, update functions, slot caches, temporaries, DOM nodes,
child results, regions, row parameters/entries, computed temporaries, handler
return temporaries, and hoisted write sets.

Names in the examples below (`id`, `update`, `$t`, `text0`, `WRITES_0`, and so
on) are semantic labels, not literal output requirements. Property keys,
runtime entity paths, and canonical state keys remain stable strings.

### R1 — Components become entities

Every function/component compiles to a factory taking `(id, parent)` that
registers an entity whose `render` is the **update branch only**.

```tsx
function Counter() { let count = 0; return <button>count: {count}</button>; }
```

emits (skeleton):

```js
function Counter(id, parent) {
  let count = 0;
  const $ = {};
  /* R2 creation branch … */
  function update() { /* R4 update branch … */ }
  register({ id, parent, render: update });
  return button;
}
```

- Entity ids are **hierarchical paths**: `App`, `App/Header`, `App/List/Row[3]`.
- The compiler generates ids from the lexical nesting path + list keys (R7).
- **Invariant: parents register before children** (runtime M4 requirement).

### R2 — JSX becomes a creation branch with cached nodes

JSX compiles to direct DOM creation, run once per instance. Every node that an
update write can touch is stored in a local variable (or on `$`).

```tsx
<button class="btn">count: {count}</button>
```

creation branch:

```js
const button = document.createElement('button');
button.className = 'btn';               // static: set once, NEVER revisited
button.append('count: ');
const t1 = document.createTextNode('');
button.appendChild(t1);                 // t1 = slot node for {count}
```

- Static attributes/children are emitted once and never touched again.
- No virtual nodes, no clone, no template instantiation.

### R3 — Dynamic expressions become numbered slots

Each dynamic expression in a component gets a stable scalar cache binding
(`$s0`, `$s1`, … in source order). A shared `$t` temporary evaluates each
expression once. Emission is inline; compiled hot paths do not call runtime
setter helpers or perform string-keyed cache lookups.

Slot kinds and their setters (runtime `setters.ts`):

| source pattern | setter |
|---|---|
| `{expr}` in text position | `setText($, key, textNode, expr)` |
| `attr={expr}` | `setAttr($, key, el, 'attr', expr)` |
| `class={expr}` (whole) | `setClassName($, key, el, expr)` |
| `class:list` with `cond` | `setClass($, key, el, 'name', cond)` |
| `style:prop={expr}` | `setStyle($, key, el, 'prop', expr)` |
| value/checked on inputs | `setProp($, key, el, 'value', expr)` |

### R4 — Creation and update share one inline guard

Creation emits the same inline guard used by the update closure. A fresh cache
binding is `undefined`; DOM defaults already represent `undefined`, null, and
boolean text correctly, while every other initial value enters the guarded
write.

```js
let $s0, $t;
const update = () => {
  if ($s0 !== ($t = `count: ${count}`)) {
    $s0 = $t;
    text0.data = String($t);
  }
};
const text0 = document.createTextNode('');
if ($s0 !== ($t = `count: ${count}`)) {
  $s0 = $t;
  text0.data = String($t);
}
```

**Invariant (M1):** the value cache is always in sync with what was written.
Creation and update compute the value with the same expression and guard.

### R5 — Handlers emit the production form: body + commitWrites

Event handlers compile to a direct closure: the user's body, then a routing
call with a **hoisted static write-set** (analysis in §4).

```tsx
<button onClick={() => count++}>
```

emits:

```js
const WRITES_1 = ['./app.tsx#count'];    // hoisted to module/component scope

button.onclick = () => {
  count++;
  commitWrites(WRITES_1);
};
```

- No per-event array allocation, no wrapper closures beyond the one handler.
- Identical sorted write-sets share one hoisted constant module-wide.
- Writes in async continuations and nested timer/promise callbacks commit in
  their own function scope. Component-local helpers reachable from a handler
  are analyzed transitively.
- A handler with no recognized write still invalidates its nearest entity:
  component, list row, or conditional region. This preserves the
  event-triggered rendering contract without widening to the mounted root.
- Receiver and argument effects that can be attached to a known state path are
  bounded and routed through the access table (§4.4).
- Only an effect with no finite state boundary is `UNBOUNDED` (§4.4) and emits
  a root-subtree commit.

### R6 — Shared state stays plain; access table is emitted per module

Module-level `let`/`const` used by components is left untouched — plain JS.
The compiler additionally emits, once per module:

```js
installAccessTable(
  {
    readers: {
      './state.ts#selectedId': ['App/SelectList/Row[*]', 'App/Header/Badge'],
      './state.ts#filter': ['App/Footer'],
    },
    params: {                       // see §5 — may be empty at launch
      './state.ts#selectedId': [
        { pattern: 'App/SelectList/Row[{payload.id}]', via: 'payload' },
      ],
    },
  },
  'App',
);
```

- `readers` values are **exact ids** or `*` wildcard patterns (one segment).
- The runtime resolver treats `readers` as the over-approximating superset and
  `params` as the precise subset (§5). At launch, `params` may be omitted and
  resolution uses `readers` only; the FORMAT must accept `params` from day one.

### R7 — Array `.map()` in JSX becomes a list region

```tsx
<ul>{items.map(item => <Row item={item} />)}</ul>
```

emits a `createListRegion` call anchored inside the `<ul>`:

```js
const region = createListRegion(ul, `${id}`,
  (item, rowId) => Row(rowId, id, item),
  (item) => item.id,                // key fn if derivable, else identity
);
function update() { region.reconcile(items); }
```

- Row entity ids: `${listId}/Row[${key}]`.
- The keyed reconciliation semantics (LIS moves, fragment batching, subtree
  teardown) are runtime behavior — the compiler only emits the region wiring.
- If the map callback transforms items (`items.map(i => ({...i}))`), key
  derivation fails → identity keys + dev-mode warning.

### R8 — Conditionals become anchored regions (DECIDED — §10.1)

`{cond ? <A/> : <B/>}` and `{cond && <A/>}` in **direct JSX child position**
compile to a conditional region. The region is its own entity; branches are
NOT entities (L1 bans components inside branches, so there is nothing to
unregister on a swap).

```tsx
<div>{loggedIn ? <b>hi</b> : <i>bye</i>}</div>
```

emits:

```js
const when0 = createCondRegion(
  div0,
  `${id}/when0`,                    // region entity id
  () => (loggedIn ? 0 : 1),         // pick: branch index
  [
    () => { /* branch factory: own $ slots, own update; returns { nodes, update } */ },
    () => { /* else branch */ },
  ],
);
register({ id: `${id}/when0`, parent: id, render: when0.update });
```

Semantics:

- The region entity is registered as a child of the owner. **All** state
  reads inside the conditional — condition AND both branches — are attributed
  to the region's patterns (`<ownerPath>/when<n>`, `<ownerPath>/when<n>/*`),
  so any write to them dirties the region, not the owner. Branch handlers
  therefore always route through the table (never `markDirty(id)` — the
  owner's update does not touch the region).
- `update()`: re-evaluate `pick()`. Same branch → run the branch's guarded
  update closure. Different branch → remove the old branch's nodes, run the
  new branch factory, insert before the anchor comment (`when:<id>`).
- `{cond && <A/>}` is a ternary with an empty else branch; a `null`/`false`
  branch is empty. Text branches are rejected (use a text interpolation).
- A swap DESTROYS branch DOM state (focus, scroll, `<details>`). Retaining
  detached branches is a post-L1 option (cache both, like list rows).
- L1 bans: components inside branches, lists inside branches, conditionals
  inside list rows, conditionals in attribute position. Each is a clear
  compile error.

### R9 — Nested component calls are id-stable

A child component call site emits: compute the child id from the lexical path;
if `registry.has(childId)` skip re-creation (entity persists — state survives
parent re-render), else invoke the child factory. The parent never reconciles
child identity — the id *is* the identity.

### R10 — Props flow down through a mutable props box (DECIDED, implemented in R10/test m9)

**Lifts the last mount-time ban:** prop expressions may read module state
(previously §L1 threw "props are mount-time"). Props become a second write
channel into the child — no VDOM, no subscriptions, the same guarded-setter
machinery as state.

**Props box.** At call sites the compiler wraps positional props in ONE
array: `Row(childId, id, [todo, sel])` — matched **by name** against the
callee's declared params, never by JSX attribute order (unknown attribute
names are a compile error; missing declared props pass `undefined`). The
component declaration is
rewritten (user signatures unchanged): `function Row(item, sel)` becomes
`function Row(id, parent, __p)` with prologue `let item = __p[0], sel = __p[1];`
(L1: component params must be plain identifiers — no destructuring/defaults
yet). The box is registered per entity (`registerProps(id, __p)`).

**Re-push.** Any prop expression that reads state makes the PARENT re-push
inside its own update closure: `MD.setProps(childId, [expr...])` — the full
array (static positions recompute to equal values and cost one `Object.is`).
Prop-expression reads count as parent reads, so the parent updates exactly
when a pushed value can change. `setProps` shallow-compares per index;
unchanged → no dirty, zero work. Changed → mutate box in place +
`markDirty(childId)`.

**Child update.** The child's update closure first re-syncs its locals
(`item = __p[0]; …`), then runs its guarded setters — so a retained child
receives new prop values with the same no-op-if-equal guarantees as state.

**Cascading commit.** `setProps` runs inside the parent's update, which runs
inside a commit — so `commit()` becomes a bounded drain loop (depth-sorted
batches, up to 100 passes, then a cycle error). This replaces the old
"marks during render wait a frame" note. `scheduleCommit` is suppressed
while a commit is in progress (reentrancy guard) — marks just join the
current drain.

**List rows.** A component row's entry gains `updateProps(item)` —
`setProps(rowId, [expr...])` re-pushing item-derived props on every reconcile
that retains the row (M5.5's `update` stays for inline rows). Item-field
mutations and item replacement both reach the row.

**Dead letters & cleanup.** `setProps` on an unmounted id is a no-op; the
props box is dropped on unregister via the M5.6 registry listener.

**Deliberately unchanged:** child reads are NOT added to the access table —
routing to the child happens through `markDirty` from `setProps`, keeping
the table purely about module state.

### R12 — Component-local state stays in the instance closure

Top-level component `let`/`var` bindings and mutable `const` collections or
plain objects are per-instance state. The factory runs once per instance, so
these bindings naturally persist in its closure. Their writes always emit
`markDirty(id)`; they never enter the app-wide access table.

Instance bindings shadow same-spelled module bindings. Analysis follows Babel
binding identity, not identifier text. A component prop is also a local
binding: assigning or mutating it outside the keyed-row rule is a compile
error rather than a write to same-named module state.

### R13 — Module derivations are ordered computed entities

A module-level `const x = <expression referencing reactive module state>` is
rewritten to `let` and paired with a depth-`-1` computed entity. Source writes
dirty that entity through the normal access table; it recomputes before normal
readers and calls `commitWrites(['x'])` only when `computedChanged(old, next)`
reports a change. Chained module computeds therefore settle in commit passes
without a runtime dependency graph.

`computedChanged` uses `Object.is` for primitives and element-wise equality for
distinct arrays containing only primitives. Mutable object/function
references, arrays containing them, and derivations returning the same array
instance propagate conservatively because identity cannot reveal an in-place
field or structural change.

Detection is by reactive binding reference, including collection/object
literals. Mutating a source inside its derivation, assigning a computed, or
using `await`/`yield` is a compile error.

### R14 — Per-instance derivations recompute in the owner update

A top-level component `const` whose initializer references a prop, instance
state, module state, or an earlier local derivation is a per-instance
derivation. It is rewritten to `let`, initialized during creation, and
reassigned in source order at the start of `update()`:

```tsx
function Counter(value) {
  let count = 1;
  const total = count + value;
  return <button onClick={() => count++}>{total}</button>;
}
```

```js
let count = 1;
let total = count + value;
const update = () => {
  value = __p[0];          // R10 prop resync first
  total = count + value;   // R14 derivation next
  // guarded DOM/child writes last
};
```

No computed entity, access-table key, change-propagation write, or subscription
is emitted. The owning instance is already the exact invalidation unit, so
recomputing its local derivations is both simpler and cheaper. Local derivation
writes/mutations and async initializers are compile errors.

### R20 - Factory callbacks and explicit cleanup are entity-owned

A component may start callback-based work directly in its factory. The
callback receives its own normal-exit invalidation, without requiring an event
handler wrapper:

```tsx
function Clock() {
  let time = Date.now();
  const interval = setInterval(() => {
    time = Date.now();
  }, 1000);
  cleanup(() => clearInterval(interval));
  return <time>{time}</time>;
}
```

The compiler lowers the ownership call and instruments the callback:

```ts
const interval = setInterval(() => {
  time = Date.now();
  MD.markDirty(id);
}, 1000);
MD.cleanup(id, () => clearInterval(interval));
```

`cleanup(disposer)` is valid only during direct component-factory execution.
It accepts one synchronous disposer. Teardown runs descendants before owners
and each owner's disposers in reverse registration order. All disposers run
even when one throws; errors are reported after the subtree is fully removed.

Callback discovery is independent of API and method names. Inline functions
and visible function references passed to calls or constructors during factory
setup are analyzed in their own execution scopes. This covers timers, promise
callbacks, DOM listeners, observers, and application subscriptions without a
compiler-maintained lifecycle API list. Cancellation remains explicit:

```ts
cleanup(subscribe(receive));
cleanup(() => window.removeEventListener(...));
```

Callbacks retained during module initialization also receive commits.
Module-state writes use canonical access-table keys because no component id
owns them. Their lifetime is module/application-owned, so component `cleanup`
does not apply.

### R21 - Component children become lazy caller-owned content slots

Nested component JSX is passed through the reserved `children` prop:

```tsx
function Frame(props) {
  return <section>{props.children}</section>;
}

function App() {
  let count = 0;
  return <Frame>
    <button onClick={() => count++}>{count}</button>
  </Frame>;
}
```

The caller emits one stable mount function. The callee invokes it with the
real host node only if it renders `{props.children}` (or positional
`{children}`). Child creation is therefore lazy: a callee that omits its slot
does not create hidden DOM, entities, subscriptions, or cleanup registrations.

The mounted content has its own closure of node variables, scalar guards, and
an update function. The lexical caller's update invokes that function
directly. Module reads in the slot still route to the caller, instance writes
still dirty the caller, and nested components retain caller-owned entity ids.
The slot is a compiler-owned DOM insertion channel, not a runtime dependency
or VDOM node.

Current slot contract:

- object-prop components use `function Frame(props)` and
  `<host>{props.children}</host>`;
- positional components declare `children` and use
  `<host>{children}</host>`;
- a slot may be rendered or forwarded once and must be the sole child of its
  host insertion element;
- authored slot content supports host JSX, dynamic text, nested components,
  lists, conditionals, event handlers, and forwarding through another static
  component;
- an explicit `children={...}` prop cannot compete with nested children.

### R22 - Cross-file components keep caller identity and defining-file analysis

`compileModules()` links a component import to the component factory compiled
in its defining module:

```tsx
// Row.tsx
export function Row(props) {
  return <li>{props.item.title}</li>;
}

// App.tsx
import { Row as TodoRow } from '@/Row';
export function App() {
  return <TodoRow item={selected} />;
}
```

The emitted ES import remains unchanged for the host bundler. The call uses the
normal factory ABI and a caller-derived id:

```js
TodoRow(id + '/TodoRow', id, [{ item: selected }]);
```

The linker carries declared prop order/object-prop shape to the call site, so
cross-file prop matching has exactly R10 semantics. Nested JSX children remain
lazy R21 slots owned by the lexical caller. Cleanup and callback resources
remain owned by the entity created in the defining factory.

Access routing stays static and precise across the file boundary. During graph
linking, each component declaration receives every live placement pattern
derived from its callers. The defining module emits its state-reader fragment
against those caller paths; aliases therefore affect entity suffixes but never
state identity. Local descendants inherit the linked parent placements.

Keyed component rows use the same rule. Their linked placement is
`<caller>/<list>/Row[*]`; row mode, key path, and canonical collection key are
supplied to the defining compilation so entity/lightweight ABI selection and
key-write fallback remain consistent.

- Named imports, named default function exports, import aliases, configured
  path aliases, and host-resolved modules are linkable.
- A component cannot be mounted both statically and as a keyed row.
- Cross-module recursive component graphs are compile errors.
- Namespace component imports and unresolved external JSX factories are
  rejected: the compiler cannot prove their factory ABI.

### R23 - Instance collections and async named helpers keep their ownership boundary

An ordered collection view declared in a component factory may be an R7 list
source. It remains instance state:

```tsx
function App() {
  let todos = [{ id: 1, title: 'a' }];
  return <ul>{todos.map(todo =>
    <Row key={todo.id} item={todo} />
  )}</ul>;
}
```

List analysis records the source locality as `instance`; it does not register
the binding in the module-state map and does not serialize an access key.
Assignments and receiver calls on local scalars, plain objects, arrays, or
constructor-created objects dirty the owner directly. This includes `Map`,
`Set`, `WeakMap`, `WeakSet`, and user-defined instances without a type or
method-semantics list. Ordered list views may be arrays/static object paths or
synchronous local derivations such as
`Array.from(map)`, `[...set]`, and `Object.entries(store)`. The owner update
recomputes those views before reconciliation.

An item write in a component row refreshes the row and dirties the list owner:
the owner may have local derivations or need to re-establish key identity.
Stateful/structural rows use their entity parent id. Intrinsically lightweight
rows receive the owner id as an extra compiler-internal factory argument and
retain their allocation-free row ABI.

A named function declaration directly inside a component is a legal event
handler, equivalent to a component-local function expression. Resolution uses
the lexical Babel binding, never text-only lookup.

Async named helpers have two completion boundaries without generated
`try/finally`:

- the event call site refreshes immediately after invocation, reflecting
  synchronous pre-`await` writes such as `loading = true`;
- the async helper commits on normal function completion, reflecting writes
  performed after suspension.

For module helpers, both commits route the helper's canonical summarized write
set. For instance helpers, both target the nearest owning entity. Rejection or
throw behavior remains governed by the normal-exit-only R5 contract.

### R24 - Authored JSX retains JavaScript and DOM semantics

Component props may use defaults and destructuring in the parameter or in
ordered top-level body declarations:

```tsx
function Child({ value: current = 0, nested: { label } = {}, ...rest }) {
  return <output>{current}:{label}:{rest.extra}</output>;
}

function Other(props) {
  const { value = 0 } = props;
  const doubled = value * 2;
  return <output>{doubled}</output>;
}
```

The mutable props box remains the source of truth. Every update replays
parameter projections, body projections, and dependent local derivations in
source order before guarded child/DOM writes:

`props box -> parameter bindings -> body projections -> local derivations -> DOM`

Projected bindings are compiler-read-only. Aliases, nesting, object/array
patterns, property defaults, whole-parameter defaults, and object rest retain
ordinary JavaScript semantics. Closed object patterns reject unknown static
JSX props; generic `props` bindings and object rest accept them. R22 manifests
serialize this same contract across modules.

Fragments emit real `DocumentFragment` creation branches. Child operations are
inserted in authored source order, including list/conditional anchors. A
fragment component or lightweight keyed row snapshots all root nodes before
insertion so reconciliation owns the complete root range.

Spread-bearing host and component calls preserve JavaScript source-order
overrides by constructing one ordered object. Component objects are projected
onto the callee's R10 contract. Hosts use `patchDomProps`; hosts without
spreads retain specialized inline scalar guards. Explicit events after the
final spread remain compiler-instrumented. An event supplied by an unresolved
spread receives a conservative normal-completion root fallback and no
generated exception wrapper.

DOM values follow authored JSX conventions:

- class strings, nested arrays, and conditional objects normalize for HTML or
  SVG;
- style strings and objects are diffed, camelCase keys are hyphenated, custom
  properties use `setProperty`, and finite numbers receive `px` except for
  unitless properties;
- IDL properties and aliases such as `tabIndex`, `htmlFor`, and
  `crossOrigin` use DOM-aware assignment/removal;
- `<svg>` and SVG-only roots use `createElementNS`; descendants inherit SVG
  until `<foreignObject>`, and names such as `strokeWidth` map to canonical
  SVG attributes.

Nested children on a keyed component row create one lazy R21 slot per runtime
row. Its owner base is the row id, preventing sibling entity collisions. On
retention, the row factory first replaces its captured item binding, then
re-pushes callee props and updates mounted caller content. Stateful callee
locals survive item mutation/replacement while both views observe the current
item.

## 4. Read/write analysis

The compiler builds the access table by walking component bodies. Analysis is
syntactic and binding-aware, with summaries for module function declarations
and reachable component-local function/arrow helpers. It uses no type checker.

### 4.1 Reads

An identifier is a **read** of a component if it appears in that component's
update-branch expressions (JSX expressions, conditions, attribute values),
transitively through local derivations:

```tsx
const total = items.reduce(...);   // reads: items
<span>{total}</span>               // reads: total → transitively items
```

### 4.2 Recognized writes

| pattern | write-set |
|---|---|
| `x = v`, `x += v`, `x -= v`, … | `[x]` |
| `x++`, `x--`, `++x` | `[x]` |
| `store.prop = v`, `delete store.prop` (static key) | `[store.prop]` |
| `receiver.anyMethod(...)` | bounded to `[receiver]` |
| `Object.assign(store, { static: value })` | `[store.static]` |
| local alias of any recognized target | preserves the target provenance |
| visible helper parameter effect | append its relative path to the caller argument |
| multiple of the above in one handler | union |

### 4.3 Locality classification

- **Local write**: target is component-local state (declared inside the same
  component) → route: dirty the origin entity only. No table entry needed.
- **Shared write**: target is module-level or outer-scope → route via table.

### 4.4 Bounded and unbounded effects

The compiler does not classify method names. Every method call on a reactive
receiver emits a bounded receiver effect:

```ts
items.push(x);             // bounded: items
items.filter(fn);          // bounded: items
store.items.custom();      // bounded: store.items
```

This is conservative but scoped. The access table invokes only observers of
the receiver path. Their value guards suppress unchanged DOM writes. A pure
method therefore costs reader update evaluation, not a root render or
unconditional DOM work. Future dirty-reason masks may skip independent work
inside those readers without changing this effect contract.

Visible helper summaries retain module paths and structured parameter-relative
paths. For example, `function mutate(target) { target.value++ }` called as
`mutate(store)` produces `store.value`. A direct reactive root passed to
unknown code is bounded to that root for mutations completed in the analyzed
call scope. Passing `items.length` passes its resulting value, not the `items`
reference, and does not imply an `items` effect.

Imprecise paths remain bounded whenever their root is known:

- `store[key] = value` → `store`
- `Object.assign(store, dynamicPatch)` → `store`
- ambiguous aliases/destructuring with identifiable source roots → those roots
- row-item receiver calls -> the row, or its collection view when the key may change

`markDirtySubtree(rootId)` is reserved for calls/summaries whose effects cannot
be attached to any finite receiver, argument, instance, row, or state root.
Unresolved imported functions are the current common case. Factory-started or
externally retained future callbacks remain lifecycle work; a commit after the
current call cannot make an unknown future mutation observable.

### 4.5 Analysis boundary

Current analysis is binding-aware across local aliases and module helper
summaries, including top-level function declarations and function/arrow
variables. It keeps exact paths where provable and otherwise chooses the
narrowest receiver/root boundary it can identify. Payload-parametrized patterns
(§5) remain the precision mechanism for non-lexical row targets.

### 4.6 Cross-module state

**Language fact:** ES modules forbid reassigning an imported binding
(`import { x } from './state'; x = 5` → error). Cross-file shared state
therefore takes exactly two shapes, and the linker design must handle both.

**Shape 1 — state objects (primary pattern):**

```ts
// state.ts
export const store = { selectedId: null as number | null, filter: '' };
// component.ts
import { store } from './state';
store.selectedId = item.id;   // legal: property mutation, not rebinding
```

Linked table keys become canonical **module-qualified property paths**
(`./state.ts#store.selectedId`). `compileModules()` resolves named import
aliases to their defining export before serialization.

**Shape 2 — exported mutator functions:**

```ts
// state.ts
let selectedId: number | null = null;
export function setSelected(id: number) { selectedId = id; }
// component.ts
import { setSelected } from './state';
onClick={() => setSelected(item.id)}
```

The write is hidden behind a cross-file call. The compiler resolves it via
**function summaries**: compiling `state.ts` records `setSelected → writes
selectedId`; compiling the importer resolves the call through the summary.
Linked summaries propagate exact, bounded, and parameter-relative effects
through imported helper chains. An unresolved external import is unbounded
(→ root-subtree commit — correct, merely unscoped).

**Canonical variable ids:** all table keys are module-qualified
(`./state.ts#store.selectedId`), because two modules may both declare `count`.
Each compiled file emits a table **fragment**; the runtime merges installed
fragments app-wide. `compileModules()` is the graph/link API. It accepts a
segment-prefix `aliases` map (for example Vite's `@`) or a host
`resolveImport(specifier, importer)` hook. R22 uses the same graph identities
and resolver for component factories and their caller-derived placements.

## 5. Parametrized patterns (designed now, implemented in L2)

Purpose: collapse wildcard over-approximation (`Row[*]` wakes 1000 rows to
change 2) into precise routing.

Format in the access table (`params` key, R6):

```js
params: {
  selectedId: [
    // When the write's payload provides `id`, dirty exactly these instances
    // INSTEAD of the wildcard superset in `readers`.
    { pattern: 'App/SelectList/Row[{payload.id}]' },
    { pattern: 'App/SelectList/Row[{prev.selectedId}]' },  // L2: resolver state
  ],
}
```

Resolver semantics (runtime, L2):

1. `handle`/`commitWrites` receives the payload (event object or explicit arg).
2. If every written variable has a `params` entry resolvable from the payload,
   dirty exactly the interpolated ids (+ exact readers from `readers`).
3. If any interpolation fails (missing field, dead id) → fall back to the
   `readers` wildcard superset. If that is absent → root-subtree.
4. The chain never fails upward beyond correctness: interpolation failure
   degrades precision, never correctness.

**Day-one requirement:** the resolver MUST accept the `params` key (and ignore
it if unimplemented) so the table format is stable from the first release.

## 6. The commit contract (what emission relies on)

Emission assumes these runtime behaviors (already implemented & tested):

- `commitWrites(writes)` routes via the table; dedupes into the frame's dirty set.
- Commit renders the dirty set parent-before-child (numeric depth sort).
- Setter guards make any over-dirtied entity's render nearly free (~1µs).
- Dead letters (dirtying unmounted ids) are silent no-ops.

## 7. Correctness invariants (test-enforced)

1. **Cache sync:** `$` always mirrors the last written value (R4). Violation
   produces spurious or missing DOM writes.
2. **Parent-first registration:** parents register before children (R1).
3. **Id stability:** entity ids never change across re-renders; list row ids
   travel with their key across reorders (R7).
4. **Fallback completeness:** every handler routes somewhere — table, local, or
   root-subtree. No handler may render the UI stale because analysis succeeded
   *partially* and silently dropped a write.
5. **No runtime graph:** emitted code never creates subscription lists,
   observer sets, or read-tracking proxies. The table is data.

## 8. Worked example A — counter (complete)

Source:

```tsx
export function Counter() {
  let count = 0;
  return <button onClick={() => count++}>count: {count}</button>;
}
```

Emission:

```js
export function Counter(id, parent) {
  let count = 0;
  let $s0, $t;

  const update = () => {
    if ($s0 !== ($t = count)) {
      $s0 = $t;
      text.data = String($t);
    }
  };
  register({ id, parent, render: update });

  const button = document.createElement('button');
  button.append('count: ');
  const text = document.createTextNode('');
  if ($s0 !== ($t = count)) {
    $s0 = $t;
    text.data = String($t);
  }
  button.appendChild(text);
  button.onclick = () => {
    count++;
    markDirty(id); // R12: exact owner, no access-table routing
  };
  return button;
}
```

No access-table entry or write-set constant is emitted for `count`: it is an
instance binding and only this closure can read or write it.

## 9. Worked example B — select list (shared state, parametrized)

Source:

```tsx
let selectedId: number | null = null;
let items: Item[] = [];

function App() {
  return (
    <div>
      <Badge />
      <ul>{items.map(item => <Row item={item} />)}</ul>
      <Footer />
    </div>
  );
}

function Badge() {
  return <span>{selectedId === null ? 'none' : `selected: ${selectedId}`}</span>;
}

function Row({ item }: { item: Item }) {
  return (
    <li
      class={selectedId === item.id ? 'selected' : ''}
      onClick={() => { selectedId = item.id; }}
    >
      {item.label}
    </li>
  );
}
```

Access table emission:

```js
installAccessTable(
  {
    readers: {
      selectedId: ['App/Badge', 'App/ul/Row[*]'],
      items: ['App/ul'],
    },
    params: {
      selectedId: [
        { pattern: 'App/ul/Row[{payload.item.id}]' },   // L2
      ],
    },
  },
  'App',
);
```

Row handler emission:

```js
li.onclick = () => {
  selectedId = item.id;
  commitWrites(WRITES_selectedId, { item });   // payload available for L2 params
};
```

At L1, a click dirties `App/Badge` + all live `Row[*]` ids; guards no-op the
unchanged rows. At L2, it dirties the badge + the two affected rows.

## 10. Open decisions

1. ~~R8 conditional emission shape~~ **RESOLVED (R8):** anchored conditional
   region, entity-scoped at the region level; branches are factory thunks
   with their own slot caches, not entities. Detached-branch retention is a
   post-L1 option.
2. **`prev.*` resolver state** (L2 parametrized patterns needing "previous
   value", e.g. the previously-selected row): does the runtime track last
   values per variable, or does the compiler emit explicit prev-capture in
   handlers? Leaning: compiler emits prev-capture — keeps the runtime dumb.
3. **Bundler graph adapters:** §4.6 state and mutator imports have
   canonical identities. R22 now links imported factories, graph paths, and
   entity-id composition; production bundlers still need graph adapters.
4. **Dev-mode event log:** production emission omits it (R5); dev builds may
   wrap handlers with the provenance log (current `handle()` in events.ts).

---

## 11. Known limitations (living list)

> **How to use this section:** every entry is a confirmed gap in the *current
> implementation* (not the design). When a limitation is fixed, **delete its
> entry** — this section must always reflect the present state. Resolved
> batches are noted in §11.6 for history.
>
> Last full audit: R24 (compiler probes + compiled runtime execution).

### 11.2 L1 source-language limits (by design — clear compile errors)

- Conditional-region limits (R8 shipped): no components or lists inside
  branches, no conditionals inside list rows, no nested conditionals inside
  branches, no text branches (use an interpolation), direct JSX child only.
- Children slots can be rendered or forwarded once as the sole host child.
- Components must be top-level `function` declarations (no arrows); exactly
  one top-level JSX return per component.
- Lists inside list rows; components inside inline rows.
- Recursive components — guarded with an explicit compile error (cycle
  detection in path enumeration); needs lazy creation to support.
- A component used both statically **and** as a list row — explicit compile
  error (split it in two); supporting both usages needs pattern union.

### 11.3 Handler / analysis semantics not yet covered

- `try/catch/finally` in handlers — commits are inserted before `return`s and
  at scope end; an exception mid-handler skips the commit (writes before the
  throw stay uncommitted). Exception-path semantics require a separate design
  and performance decision.
- R14 rejects direct writes in local derivations, but does not yet fold a
  component-local helper's write summary into derivation purity checking.
- Over-invalidation note: a scope's commit fires even when its writes were
  skipped by an `if` — safe direction, absorbed by setter guards.

### 11.4 Runtime / DOM / lifecycle gaps

- Namespace context does not cross the component factory ABI. An SVG component
  should currently return `<svg>` or an SVG-only root such as `<g>`/`<path>`;
  ambiguous roots such as `<title>` are HTML unless nested directly under an
  authored SVG host.
- No mount hook or effect primitive. `cleanup(disposer)` owns synchronous
  component teardown; async disposer promises are not awaited.
- A factory that registers cleanup and then throws before entity registration
  leaves that registration orphaned. Factory exception teardown needs a
  separate decision; event handlers remain free of generated `try/finally`.
- No priority lanes. `commit()` is the synchronous flush-now API.

### 11.5 Multi-module, scale & engineering

- `compileModules()` is an in-memory graph API; no Vite/esbuild adapter feeds
  resolved source graphs into it yet.
- `rootId` collisions across modules; table-install ordering vs. mount order —
  untested.
- Identity-keyed lists of duplicate primitives (`[1, 2, 2]`) throw on
  duplicate keys — document or add index fallback.
- No source maps, no Vite plugin/packaging, no HMR story, no dev/prod build
  split, no userland testing story.
- Benchmarks pending: parametrized-pattern re-run in the compiler era;
  compile-time perf on large modules.

### 11.6 Resolved (history)

- **R24 (authored JSX semantics, packages/compiler/src/components +
  packages/compiler/src/emission + packages/compiler/src/jsx +
  packages/runtime/src/dom-props.ts + packages/runtime/src/dom-values.ts,
  tests/r24-jsx.test.ts):** prop patterns/defaults replay from their props box;
  fragments preserve ordered roots; host/component spreads preserve override
  order; class/style/DOM/SVG mappings use DOM-aware patching; keyed component
  rows own one current-item children slot per runtime row.
- **R23 (instance collections and async named helpers,
  packages/compiler/src/lists.ts + packages/compiler/src/handlers.ts +
  tests/r23-local-state.test.ts):** component-owned
  arrays/object paths and ordered views derived from Map, Set, or objects
  reconcile in the owner without entering module access tables; WeakMap and
  WeakSet scalar derivations use the same owner invalidation. Lexical named
  handlers resolve directly. Async helpers expose
  pre-await event writes and normal-completion continuation writes.
- **R22 (cross-file component graph,
  packages/compiler/src/component-linker.ts +
  tests/r22-components.test.ts):** named/default imported factories retain
  caller ids, defining-file state readers, prop shape, lazy children,
  callback commits, cleanup ownership, and keyed-row mode across aliases.
  Recursive and mixed static/row graphs fail during linking.
- **R21 (lazy component children slots,
  packages/compiler/src/components/children.ts +
  tests/r21-children.test.ts):** static component children mount only where
  the callee renders its reserved slot. Guarded updates remain linked to the
  lexical owner; nested components, lists, conditions, events, forwarding,
  and cleanup retain their existing compiler/runtime contracts.
- **R20 (explicit cleanup and setup callbacks,
  packages/compiler/src/lifecycle.ts + packages/runtime/src/cleanup.ts,
  tests/r20-cleanup.test.ts):** direct factory timers,
  listeners, constructors, subscriptions, and visible local helpers receive
  callback-owned normal-exit commits. `cleanup(disposer)` lowers with the
  hygienic entity id and runs on root or keyed-row subtree teardown.
  Module-initialization callbacks table-route canonical state writes.
- **R19 (receiver-bounded effects,
  packages/compiler/src/helper-summaries.ts +
  packages/compiler/src/handlers.ts + packages/compiler/src/linker.ts,
  tests/r19.test.ts):** method names
  no longer encode mutation semantics. Every reactive receiver method call is
  conservatively bounded to that receiver and routed only to its observers;
  guarded updates absorb pure-call false positives. Visible helpers preserve
  structured parameter-relative paths through local and cross-module calls.
  Dynamic store paths and identifiable alias/destructuring roots remain
  bounded. Root-subtree invalidation is reserved for genuinely unbounded
  summaries such as unresolved imported functions.

- **R18 (scoped event-boundary invalidation,
  packages/compiler/src/handlers.ts + packages/compiler/src/emit.ts,
  tests/r18.test.ts):** an event handler with no recognized
  write no longer becomes a no-op invalidation boundary. It dirties its
  nearest registered component, inline row, or conditional region; lightweight
  rows invoke their local updater. The guarded update branch absorbs unchanged
  values. Known shared/local writes retain their existing precise routing.

- **R17 (conservative mutation correctness,
  packages/compiler/src/mutation-analysis.ts +
  packages/compiler/src/helper-summaries.ts +
  packages/compiler/src/handlers.ts, tests/r17.test.ts):**
  local aliases retain binding-aware provenance; mutable reassignment and
  destructuring stay conservative; `delete` and static `Object.assign` emit
  exact keys; mutable state passed to calls or helper parameters cannot go
  stale. R19 subsequently narrowed identifiable conservative effects from
  root-subtree fallback to receiver/root routing.

- **Post-M5.10 review batch (packages/runtime/src/access.ts +
  packages/runtime/src/list.ts + packages/compiler/src/analysis.ts +
  packages/compiler/src/emit.ts, tests/m58.test.ts):** three real-world
  correctness fixes
  on top of M5.10. (1) `resolveWrites` payload routing now implements spec §5
  as written: dotted payload paths (`{payload.item.id}`) resolve segment-wise,
  exact (non-wildcard) readers are kept alongside the precise ids, and ANY
  interpolation failure — missing field, `prev.*` resolver state, absent
  params entry — falls back to the `readers` superset instead of returning a
  partial garbage dirty set (was a silent-stale-UI path). (2) Props are
  matched BY NAME against the callee's declared params at every call site
  (static children and list rows, entity and lightweight); positional
  matching silently misaligned props whenever JSX attribute order differed
  from declaration order. Unknown attribute names are now a compile error,
  which also turns events-on-component-tags from a silent prop into an
  actionable message. (3) Object-prop detection accepts type aliases
  (`props: RowProps`), not just inline literals, and the lightweight-row
  eligibility traversal is memoized per component.

- **M5.10 (lightweight listed component rows,
  packages/compiler/src/analysis.ts + packages/compiler/src/emit.ts +
  packages/compiler/src/handlers.ts, tests/m58.test.ts):** a list-only
  component with no local `let`/`var` state and no nested entity/region shape
  now emits as a `ListEntry` factory. It keeps guarded DOM updates and keyed
  reconciliation but allocates no row registry entity or props box. Shared
  reads invalidate the list owner, whose reconcile refreshes retained row
  closures; item-local handler writes call that closure directly. Stateful or
  structurally complex rows deliberately retain the existing entity path.
- **L2 table-format compatibility (packages/runtime/src/access.ts,
  tests/m58.test.ts):**
  `AccessTable` accepts deferred `params` patterns now, preserving the public
  format while payload-aware precision remains a later resolver increment.

- **R12 (instance state, compiler analysis+handlers+emit,
  tests/r12.test.ts):**
  top-level let/var of a component body is INSTANCE state — one factory
  closure per instance, readable only by that instance (children get it via
  R10 props re-push, nested rows via M5.5 resync). Writes are therefore
  ALWAYS a bare markDirty(id), never table routing; instance names shadow
  same-named module state in their component.
- **R13 (auto-detected computeds — option B, no wrapper):** a module-level
  `const x = <state derivation>` becomes a computed: the compiler rewrites
  the declaration to a let, and registers a
  depth-(-1) entity `'<root>/$computed/<module>#x'` that recomputes on source-key
  writes and commits 'x' downstream ONLY when the value changed
  (`computedChanged`: Object.is primitives, element-wise distinct primitive
  arrays, conservative mutable references). Intermediate writes whose derived
  primitive value does not change produce zero downstream renders. Chains (computed
  reading computed) work; writes/mutations TO a computed are compile
  errors; computeds are valid R7 list sources; recompute renders BEFORE any
  reader via the explicit-depth support in register (depth -1).
- **R13.1 (reference-based detection — the whitelist was wrong):** detection
  is now exactly "the initializer REFERENCES an already-declared state
  variable (directly or through an analyzable local helper) and is never
  reassigned". The PURE_METHODS whitelist is removed — the set of allowed
  callees is unbounded (Array/String/Math/Object/JSON, lodash, date-fns,
  user helpers…), so no whitelist can be complete, while the set of
  dangerous SYNTAX is bounded and enumerable. Arbitrary method calls,
  unknown/imported/global functions, `new`, tagged templates, and
  local-mutating callbacks (`reduce((acc, t) => { acc.push(t); … }, [])`,
  `(s, t) => (s += t.n, s)`) are all fine. Rejected forms are direct
  assignments/updates to non-locals, calls to module helpers known to perform
  direct state writes, and await/yield. Receiver-method purity is an
  author-owned derivation contract; the compiler has no method-name table.
  Such consts are compile ERRORS with the specific reason, never silent
  plain consts (read collection no longer early-exits on impure).
  Non-determinism (Date.now/Math.random) and side effects are the author's
  responsibility — recompute runs on every source write and
  `computedChanged` gates what propagates (same contract as Vue computed /
  Svelte $:). NOTE: computeds remain MODULE-level — they cannot see R12
  instance state (factory closures); per-instance computeds are future work
  (per-instance computed entity parented under the instance id).
- **M5.8 (structural-path cost, packages/runtime/src/list.ts +
  packages/runtime/src/kernel.ts):** CDP profiling
  of the todo bench showed 40% of steps are STRUCTURAL (remove/insert), and
  the slow path paid 3 maps + 5 arrays per reconcile. Now: ONE record map
  per region (`{e, id, pos}` replaces cache + keyToRowId + prevIndex +
  nextIndex), pooled LIS buffers, scratch buffers swapped with live ones
  (zero allocation in steady state), and the shape fast path compares item
  REFERENCES (no key-fn calls per row per step). undirty gates on set size.
  Heap sampling confirms ~zero runtime allocation per step — remaining GC
  is the bench harness's own strings/objects.
- **M5.9 (inline guarded writes, packages/compiler/src/emit.ts):** the slot
  cache object
  (`$["s0"]`) is gone. Dynamic slots are per-scope locals (`let $s0, …`)
  and every dynamic write is an INLINE guard emitted by the compiler:
  `if ($s0 !== ($t = expr)) { $s0 = $t; text0.data = … }` — no runtime
  setter call, no string-key lookup; the whole row update stays in one
  inlinable function (Imba-style compiled output). Also: IDL-property
  attributes (checked, value, disabled, …, DOM_PROP_ATTRS) write the DOM
  property instead of the attribute — faster and semantically right; this
  also cut the todo bench to 2.20 DOM mutations/step, exactly matching
  Imba/Svelte. The runtime setters remain as the public hand-written API.
  Results: todo bench 37.7k → 50k ops/sec @100 (gap 2.7x → 1.9x),
  ~1.7x @6; structural update-every-10th 81ms → ~33ms (tied best),
  create 1k on par with Imba 2 / Solid.
- **R11 (row-local item writes — parametrized precision WITHOUT runtime
  payloads, packages/compiler/src/context.ts +
  packages/compiler/src/handlers.ts + packages/compiler/src/emit.ts +
  packages/compiler/src/analysis.ts, tests/m10.test.ts):** a handler inside a
  list row
  that writes a field of the row's ITEM (todo.done = …) used to produce no
  commit at all (item params are foreign to module state). But the write
  is visible ONLY to that row's DOM — item data reaches rows through
  reconcile/props, never through the table — and the compiler knows the
  row statically, so the commit is a plain `markDirty(rowId)` (inline) /
  `markDirty(id)` (component row): no routing, no wildcard, no sibling
  renders. Key-field writes change row identity → structural fallback (a
  normal source-array write → reconcile re-keys); dynamic item paths
  (todo[k] = …) and disagreeing multi-site key fns fall back the same way;
  mutators on item fields (todo.tags.push(…)) are row-local too. This
  supersedes the §5 runtime-payload plan for the common case: precision is
  achieved at compile time with zero runtime machinery. (§5's payload
  form remains the design for writes whose target row is NOT lexical —
  e.g. one row dirtying a sibling by id.)
- **M5.7 (render-path constant factors, packages/runtime/src/list.ts +
  packages/runtime/src/kernel.ts,
  tests/m57.test.ts):** two costs remained after M5.6 — (a) every reconcile
  rebuilt two full key→index maps even when nothing structural could have
  changed, and (b) a row dirtied through the table (Row[*]) AND resynced by
  its parent's reconcile rendered TWICE per commit. Now: reconcile opens
  with a shape fast path (same length + same key at every position → skip
  all map building and LIS, straight to row sync); row ids are computed
  once per key (keyToRowId) instead of re-concatenated per frame; and the
  commit keeps ids in the dirty set until the moment they render, so the
  list resync cancels the row's pending turn via the new public
  `undirty(id)`. Cascade semantics (R10 drain) unchanged — marks added
  mid-render still reach a later pass. dom-reconciler-bench: 88.2k →
  103.6k ops/sec at n=6 (+17%), ~+5-8% at n=100; structural bench
  unchanged (swap/remove best-in-class).
- **R10 (props-down reactivity, packages/runtime/src/props.ts + cascading
  commit in packages/runtime/src/kernel.ts + compiler props box,
  tests/m9.test.ts):** the mount-time
  props ban is LIFTED — state-reading props (on static children and on list
  rows) compile and stay live. Props are boxed in one mutable array per
  entity (`Row(id, parent, [a, b])`; user signatures unchanged); the parent
  re-pushes state-reading props inside its update (`setProps`, shallow-
  compare no-op); the child's update re-syncs locals from the box; commit()
  is now a bounded drain loop so pushed children render in the SAME commit.
  Component rows re-push + force-dirty on every retaining reconcile (the
  box can hold a same-reference object whose fields mutated — the M5.5
  case). Note: the `Owner/*` covering pattern may still render children on
  unrelated parent writes (§11.3 over-approximation, safe direction).
- **M5.6 (constant-factor sprint, packages/runtime/src/access.ts +
  packages/runtime/src/kernel.ts + packages/runtime/src/list.ts,
  tests/m56.test.ts):** per-commit routing cost eliminated — `resolveWrites`
  previously re-matched every wildcard pattern against every live id on every
  commit (O(patterns × ids); a generation-keyed cache didn't help because row
  add/remove bumps the generation on exactly those steps). Now matchKeys is
  cached permanently per write key, wildcard expansions are maintained
  INCREMENTALLY via a kernel registry listener (O(patterns) per register/
  unregister, O(1) per commit), and full resolutions are version-cached.
  `reconcile` gained the pure-content fast path (no add/remove, order kept →
  zero structural work, LIS skipped) and fused index bookkeeping. `commit()`
  is documented as the public flush-now API (the flushSync equivalent).
  dom-reconciler-bench: 61.9k → 88.2k ops/sec at n=6 (+42%), 19.0k → 36.9k
  at n=100 (+94%); the gap to Imba 2 converged to ~2.8x at both scales.
- **M5.5 (retained-row resync + member-path list sources,
  tests/m55.test.ts):** rows read their item (a factory param), not module
  state, so mutating a retained row's item fields was invisible — the list
  region now re-runs a reused row's guarded `update()` on every reconcile
  (DOM touched only on actual change; required by the dom-reconciler-bench
  contract "sync no matter how the models changed"). List sources may now be
  static store paths: `{store.todos.map(…)}` (read/write key = dotted path,
  region suffix = last segment). Exported state (`export const store = …`)
  is scanned as state. Drove the bench integration; also the fix that makes
  `checkImplementation` pass.
- **R8 (conditional regions, packages/runtime/src/cond.ts +
  packages/compiler/src/conds.ts +
  tests/m8.test.ts):** `{cond ? <A/> : <B/>}`, `{cond && <A/>}`,
  `{cond || <A/>}` in direct JSX child position compile to anchored
  conditional regions per §R8 — the region registers as its own entity
  (`<owner>/when<n>`), all condition+branch reads attribute to its patterns,
  branch handlers route through the table. Same-branch updates run the
  branch's guarded closure; swaps rebuild DOM but keep module state.
  Whitespace handling is now React-compatible (edge spaces dropped only
  when they come from line breaks).
- **M5.4 (mutable const roots, tests/m54.test.ts):** arrays and
  constructor-created objects classify as mutable state; mutations invalidate
  their bounded readers while rebinding is a compile error ("cannot reassign
  mutable const root") instead of a runtime TypeError; R7 lists accept const
  arrays; `var` classifies as `let`;
  update-expressions on non-let bindings are compile errors.
- **M5.3 (silent-miscompile batch, 9 items, tests/m53.test.ts):**
  1. early `return` in a writing scope skipped its commit → commits are now
     inserted before *every* return of the scope (and at scope end);
  2. member-chain mutators (`store.items.push(x)`) emitted no commit and
     polluted the table → root-aware mutator classification was introduced;
     R19 later replaced method classification with bounded receiver effects;
  3. read/write path granularity mismatch → the resolver now matches
     segment-wise: a write hits readers at equal, descendant, or ancestor
     dotted paths;
  4. lists inside repeated children misrouted rows → row patterns expand
     repeated ancestors (`App/Tag[*]/items/Row[*]`);
  5. multi-parent components routed to one instance → `parents` is a set;
     path enumeration walks all parents;
  6. `key` on a non-row child silently misaligned props → compile error;
  7. module-level functions were all assumed components → JSX-content
     classification; helpers get interprocedural read/write **summaries**
     (module-local §4.6 shape 2); module-level functions can be referenced
     directly as handlers (table-routed commits, never `markDirty(id)`);
  8. state-reading props on static children went silently stale → compile
     error (props are mount-time at L1);
  9. `{null}`/`{true}` rendered as text → static falsy children are skipped;
     `setText` coerces null/undefined/booleans to `''`.

---

*End of spec. Implementation order for M5: R1–R6 + R7 (lists) with L1 analysis;
R8 after decision 10.1; §5 params accepted-but-ignored from the first release.*
