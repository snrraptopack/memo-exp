# The Paradigm: Analyzed Memoized DOM

> **Status:** Design spec. This document is the single source of truth for what we are
> building and why. Future agents/contributors: read this fully before writing code.
> Do not introduce VDOM, signals, or user-facing state primitives — they are
> explicitly out of scope (see Non-Goals). `effect` and `cleanup` are
> compiler-owned lifecycle/synchronization intrinsics, not state containers.

---

## 1. Vision

Build a web UI framework (compiler + runtime) that rivals VDOM frameworks (React)
and signal-based frameworks (Solid, Vue Vapor, Svelte 5) in performance, while
giving the user a radically simpler mental model:

> **The user writes plain components with plain variables and plain event handlers.
> They assign a variable; the UI updates. No imports, no decorators, no hooks,
> no `createSignal`, no `useState`, no `memo()`, no dependency arrays.**

All of the machinery — node caching, invalidation, scheduling, dependency
information — lives **entirely inside the compiler and the runtime**, invisible
to the user.

## 2. The Paradigm in One Sentence

> **Memoized real-DOM rendering (à la Imba) where callback-triggered re-render is
> scoped by compile-time read/write analysis, so the runtime re-renders only the
> component instances that can observe what an event changed — never the whole tree.**

Imba proved that memoized DOM + event-triggered full re-render is fast enough to
beat most frameworks. We keep their proven core and remove its one bluntness:
re-rendering from the mounted root on every event.

## 3. Design Constraints (non-negotiable)

1. **Zero required reactive-state primitives.** The user imports nothing to make
   variables or JSX reactive. No `signal()`, no `emit()`, no `cached()`, no
   `commit()` in user code. Optional compiler intrinsics such as `effect()` and
   `cleanup()` express lifecycle ownership, not reactive state.
2. **No runtime dependency graph.** No subscription lists, no observer sets, no
   read-tracking proxies in the hot path. Dependency information is computed at
   **compile time** from the AST.
3. **Never worse than Imba.** Any code the compiler cannot analyze falls back to
   root-scoped commit (Imba's behavior). The paradigm degrades gracefully, never
   breaks.
4. **Real DOM nodes only.** No virtual tree, no diffing pass. The DOM write *is*
   the reconciliation.
5. **Compiler-first.** Anywhere a choice exists between runtime cleverness and
   compile-time knowledge, the compiler wins.

## 4. The Six Mechanisms

Mechanisms 1–4 are borrowed from Imba (production-proven). Mechanism 5 is our
contribution and the reason the framework exists. Mechanism 6 is the explicit
external-synchronization escape hatch made possible by the same static layer.

### 4.1 Split creation / update branches (compiler)

Every component's render compiles into two branches:

- **Creation branch (runs once per instance):** creates real DOM nodes, sets all
  static attributes once, and closes over nodes plus scalar slot caches, then
  never runs again.
- **Update branch (runs on re-render):** executes *only* the dynamic writes.

Conceptual compiler output:

```js
function Counter(id, parent) {
  let number = 0;
  let $s0, $t;
  const update = () => {
    if ($s0 !== ($t = number)) {
      $s0 = $t;
      text.data = String($t);
    }
  };
  register({ id, parent, render: update });
  const text = document.createTextNode('');
  update(); // seeds the scalar cache and initial DOM value
  return text;
}
```

### 4.2 Value-cached setters (compiler)

Every dynamic DOM write is guarded by a comparison against the previously written
value. If the value is unchanged, the DOM is not touched:

```js
if ($.c !== isReady) el.classList.toggle('ready', ($.c = isReady));
```

### 4.3 Keyed instance cache in loops (runtime)

`for` loops cache created subtrees **per item by reference/identity**. Iterating
the same items again reuses cached subtrees; reordering *moves* existing nodes
(`appendChild` on an attached node relocates it — no clone, no event re-binding,
no lost focus/video/`<details>` state). Identity travels with the item.

### 4.4 Event-triggered batched commit (runtime)

- After any DOM event is handled, a re-render is scheduled.
- Scheduling is deduped and batched to the next animation frame: 1000 triggers →
  1 render pass.
- Async functions and nested callbacks commit at the lexical scope where each
  write actually runs, including continuations after `await`.
- Rationale: virtually all state changes in a UI originate from user interaction,
  so the event system is the natural invalidation source — no subscriptions.

### 4.5 Origin-scoped commit via static read/write analysis (compiler + runtime) — OUR LAYER

Imba stops at 4.4 and re-renders from the root because it cannot know what
changed. We can know — the compiler already saw every read and write.

**At compile time**, for each component the compiler emits a static access entry:

```
Component: CartList
  READS:  [items, filter]
  WRITES: []

Component: Row
  READS:  [items, selectedId]
  WRITES: [selectedId]        // via its click handler

Handler: Row#onClick
  ORIGIN: Row
  WRITES: [selectedId]
```

**At runtime**, each mounted instance carries an internal hierarchical keyed ID
(e.g. `App/CartList/Row[item-42]`), generated by the compiler/runtime — never
seen by the user. Handlers are wrapped so the runtime knows the origin instance
and the handler's static write-set.

When an event fires:

1. User handler runs (plain assignments — no interception in the common case).
2. Runtime reads the handler's static write-set: e.g. `[selectedId]`.
3. Static table lookup: which components READ those variables?
   → `Row[*]`, `Header/cartBadge`.
4. Resolve to live instances → **dirty set** (a `Set<string>` of IDs).
5. Next animation frame: re-render **exactly** the dirty set. Each re-render runs
   the update branch, where value-cached setters no-op anything unchanged.

Per-event cost drops from Imba's O(entire tree) to
**O(components that read what changed)**, with the same tiny constant per
component.

### Fallback rule

If the compiler cannot prove an exact write, it first finds the narrowest
finite boundary it can name. A call on `store.items` or a dynamic write through
`store[key]` is bounded to that receiver/root and routed only to its observers.
The compiler does not classify method names; false positives are absorbed by
guarded update closures. Only write effects with no identifiable receiver,
argument, instance, row, or state root fall back to a root-scoped commit.

### 4.6 Component-owned post-render effects (compiler + runtime)

JSX and ordinary variable updates require no primitive. Work that intentionally
synchronizes reactive values with an external system uses `effect`:

```tsx
function Presence(roomId) {
  effect(() => {
    const connection = connect(roomId);
    return () => connection.disconnect();
  });

  return <output>{roomId}</output>;
}
```

The compiler discovers the callback's immediate module, prop, local-state, and
local-derivation reads. It emits static routing to a child effect entity; no
runtime read tracking or dependency array exists. Render/computed entities
drain first, then effects. A returned disposer runs before rerun and on
unmount.

Direct effect writes use compiler-generated per-site execution flags. Only
write/call sites that actually ran commit. This lets a conditional feedback
effect stabilize while the existing bounded cascade guard still reports a
genuine unconditional loop. `cleanup(disposer)` remains the non-reactive
factory-resource ownership form.

Reactive values passed to unknown APIs in the direct effect body are read-only
inputs. Passing `count` to `console.log`, `send`, or another external API
subscribes the effect to `count` but does not claim that the API mutated it.
Hidden mutation through such an argument intentionally does not propagate;
direct writes, reactive receiver methods, and writes summarized through visible
helpers remain compiler-owned mutation paths.

## 5. Internal Entity Model (runtime, invisible to user)

Each schedulable component, computed, or reactive effect is an entity:

```ts
type Entity = {
  id: string;                 // "App/CartList/Row[item-42]"
  parent: string | null;
  children: Set<string>;
  depth: number;
  phase?: 'render' | 'effect';
  render: (reasons?) => void; // component update, computed, or effect callback
};
```

Component state, DOM nodes, slot caches, and local derivations stay in the
factory closure. Keeping them out of the registry makes the hot entity record
small and lets JavaScript engines optimize direct lexical access.

Entities whose local dependency graph has independent groups may receive
compiler-generated numeric dirty reasons. Reasons only select closure-local
derivation replay; an absent reason means full replay. They do not expose
state to the registry or change component identity.

Reactive effect entities use the reserved `owner/$effects/index` namespace and
are parented to their component owner. Their registry callback owns only the
latest returned disposer; dependencies remain static access-table data or
compiler-emitted owner invalidations.

Properties:

- **IDs are stable across reorders** because list identity is keyed by item
  (Mechanism 4.3). A moved row keeps its ID, state, cache, and nodes.
- **Child state survives parent updates for free**: static child factories run
  only during creation; later parent updates re-push changed props into the
  existing child entity.
- **Component children are lazy content slots**: the caller emits a mount
  function and the callee chooses its host insertion point. Mounted content
  keeps caller-owned scalar guards and a directly linked update closure; no
  element-description tree or runtime subscription is created.
- **State is private**: component-local state remains in one factory closure.
  Only that instance can address it, so local writes dirty the owner directly.

## 6. The Commit Cycle (precise)

```
USER EVENT (click / input / keydown / ...)
  │
  ├─ 1. compiler-wrapped handler records ORIGIN entity id
  ├─ 2. user handler code runs (plain assignments)
  ├─ 3. runtime: writeSet = staticTable[handler].writes
  │      for each var in writeSet:
  │        readers = staticTable.readersOf(var)     // component patterns
  │        resolve patterns → live instance ids      // Row[*] → Row[item-42], ...
  │        dirtySet.add(...ids)
  │      if writeSet contains OPAQUE → dirtySet = { ROOT }
  │
  ├─ 4. schedule frame (deduped; multiple events merge into one pass)
  │
  └─ 5. on animation frame, bounded drain:
         while dirtySet is not empty:
           if any render/computed entity is pending:
             run those parent-before-child
           else:
             run pending effect entities
           writes/cascaded props join the same dirty set
         dirtySet.clear()
```

**Async handlers:** the compiler inserts a commit after the writes in each
function scope. A write after `await` commits in that continuation; a timer or
promise callback commits inside that callback. This is more precise than
committing the handler's full write-set again when its promise settles.

**Non-event state changes** (websocket, timers): compiler-visible callbacks
reachable from handlers, factory setup, component-local helpers, and module
initialization receive the same scope-owned commits. Factory resources are
explicitly entity-owned with `cleanup(disposer)` and drain when their root or
keyed row unregisters. Mutations hidden entirely inside external code still
need a visible callback or host boundary; passing state to unknown code only
bounds effects completed during that analyzed call.

**Reactive external synchronization:** `effect(() => ...)` receives a static
read-set and joins the same dirty set, but executes only after render/computed
work has drained. Its initial run is post-render, not a distinct guarantee that
a detached factory root has been attached to `document`.

## 7. Traces

### 7.1 Mount

```
render(App)  → all creation branches run once, node caches populated,
               entities registered, one DOM insertion.
```
Cost: same as every framework. Memoization buys nothing on mount. Fine.

### 7.2 Row selection (the common case)

```
click Row[item-42]
  → handler: selectedId = 'item-42'
  → writeSet [selectedId] → readers Row[*], Header/cartBadge
  → live dirty set: { Row[item-42], Row[item-7](previous), Header/cartBadge }
  → frame: 3 update branches run; each writes one className/text change.
  → 997 other rows: not walked, not compared, not awakened.
```

### 7.3 List reorder

```
handler: items = reverse(items)
  → readers of items: CartList
  → CartList update branch: keyed cache → every row is a cache HIT
  → DOM work: appendChild moves only; zero row re-execution, zero recreation.
```

### 7.4 Conservative boundaries

```
handler: state[someKey()] = x      // compiler cannot prove keys
  → bounded write effect = state root
  → access table selects observers of state
  → their value-cached setters no-op unchanged writes.

handler: unresolvedImport()        // no finite write-effect boundary
  → unbounded write effect → dirty set = { ROOT subtree }
```

## 8. What the User Writes

```tsx
// No imports or state wrappers. Plain variables, plain handlers.
let selectedId = null;

function Row({ item }) {
  return (
    <li class={selectedId === item.id ? 'sel' : ''}
        onClick={() => (selectedId = item.id)}>
      {item.name}
    </li>
  );
}
```

For ordinary UI state, the user-visible contract ends there. External
synchronization may additionally use the ambient `effect` intrinsic shown in
§4.6; it still has no imported state wrapper or dependency array. Everything
else in §4–§6 is generated or internal.

## 9. Hard Problems (known, tracked)

1. **Props are read-set edges.** `CartList` reads `items`, passes `item` to
   `Row` → `Row` transitively reads `items`. The analysis must flow through
   props, closures, and loop bodies. This is the bulk of compiler work.
2. **Method-call write effects.** `items.anyMethod()` is conservatively bounded to
   `items`; no built-in or third-party method semantics table is required.
3. **Dynamic access.** `obj[computed]` retains a bounded `obj` root when its
   provenance is known (see Fallback rule).
4. **Aliasing.** `const a = items; a.push(x)` — writes must be tracked through
   local aliases (conservative alias analysis; when unsure → bounded roots).
5. **Cross-component shared state.** Module-level variables read by many
   components are fine (they're just big read-sets), but the table must stay
   precise enough that common events don't degrade to root-commit. Measure and
   tune conservative receiver/root boundaries.
6. **SSR / hydration.** Creation branch must be able to *adopt* server-rendered
   nodes (populate `$` from existing DOM, matched by deterministic order/IDs)
   instead of creating. Server output embeds entity IDs as marker attributes or
   comments so hydration is adoption, not reconciliation. (Existing
   cursor-hydration work plugs in here.)
7. **Dead entities.** Events resolving to unmounted IDs are skipped silently;
   optional dev-mode warning.
8. **Effect feedback and attachment.** Direct effect writes must preserve
   branch execution so stabilizing feedback does not become a false cycle.
   Post-render scheduling is distinct from detecting when a detached root is
   attached to `document`.

## 10. Non-Goals

- ❌ No virtual DOM, no tree diffing — anywhere, ever.
- ❌ No signals / observable values as a user concept or runtime graph.
- ❌ No user-facing state management primitives (no stores, hooks, refs API).
- ❌ No required immutability from the user (plain mutation is the DX).
- ❌ No new language — this is TS/JS + JSX compiled, not an Imba-style language.

## 11. Success Criteria

- js-framework-benchmark (keyed): within reach of Solid/Imba on:
  - select row (target: only 2 rows touched),
  - swap rows (target: node moves only, zero row re-execution),
  - partial update (target: O(changed rows), no tree walk).
- create 1k/10k rows: no worse than vanilla-class frameworks (pure mount cost).
- effect correctness: render-before-effect ordering, one rerun per batch,
  teardown-before-rerun/unmount, stabilizing conditional feedback, and bounded
  failure for genuine cycles.
- DX test: a React user can read a component and understand it with zero
  framework-specific knowledge.

## 12. Glossary

- **Entity** — a schedulable component, computed, or reactive effect record.
- **Dirty set** — the set of entity IDs scheduled for re-render this frame.
- **Reactive effect** — a component-owned post-render callback with statically
  discovered dependencies and automatic returned teardown ownership.
- **Bounded write effect** — a conservative possible write attached to a finite
  reactive receiver/root.
- **Unbounded write effect** — a possible write with no finite reactive boundary; it
  triggers root-subtree commit.
- **Origin** — the entity whose handler processed the triggering event.
- **Root commit** — re-render from the mounted root (Imba behavior; our fallback).
- **Value-cached setter** — a DOM write guarded by previous-value comparison.
