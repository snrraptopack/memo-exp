# State

Memoized DOM is a reactive programming model wearing plain TypeScript. There
are no signals, stores, hooks, or wrappers. You write normal variables,
objects, arrays, and classes — the **compiler** watches who reads and who
writes, and the runtime updates only the DOM that depends on what changed.

## The one idea

> Reactivity follows reads and writes — not `let`, not `const`, not a special
> type.

If a value is read by the UI (or by a derived value) and the compiler can see
a write that might change it, the two are linked. That's the whole mechanism.

```tsx
export function Counter() {
  let count = 0;
  const doubled = count * 2;   // derived — replays when count changes

  return <button onClick={() => count++}>{count} / {doubled}</button>;
}
```

No `useState`. The component body runs once; `count++` in the handler updates
exactly the text nodes that read `count` and `doubled`.

## `let` vs `const` — pick by meaning, not reactivity

`let` and `const` keep their normal JavaScript meaning:

```ts
let count = 0;              // the binding itself gets reassigned
const state = { step: 1 };  // binding fixed, contents can change
const items: string[] = []; // binding fixed, contents can change
```

So:

- **`let` doesn't create reactivity.** `let label = 'hi'` that's never
  reassigned is just a variable.
- **`const` doesn't block reactivity.** `state.step++`, `items.push(x)`,
  `set.add(x)` are all valid reactive writes.
- Use `const` whenever you only mutate contents. Reach for `let` only when
  the binding itself is reassigned (`count++`, `name = 'x'`).

## State can live anywhere

### In a component — per instance

```tsx
export function SearchBox() {
  let query = '';
  const trimmed = query.trim();

  return <input onInput={(e) => query = e.currentTarget.value} />;
}
```

Each mounted instance gets its own `query`. The body is initialization code,
not a re-render — writes update the DOM directly.

### At module scope — shared

Any module-level variable, object, or collection is shared reactive state.
Export it, mutate it from a helper, read it in a component:

```ts
// cart.ts
export const items = new Set<string>();
export function addItem(name: string) { items.add(name); }
```

```tsx
// Cart.tsx
import { items, addItem } from './cart';

export function Cart() {
  return (
    <section>
      <p>{items.size} items</p>
      <button onClick={() => addItem('book')}>add</button>
    </section>
  );
}
```

`items.size` re-renders when `add`/`delete` mutates the Set. No store
primitive, no subscription — the compiler links the write to the read across
files. The same works for `Map`, arrays, and plain objects.

### In a class — plain TypeScript

```ts
export class Todos {
  list: { id: number; done: boolean }[] = [];

  toggle(id: number) {
    const todo = this.list.find(t => t.id === id);
    if (todo) todo.done = !todo.done;
  }
}
export const todos = new Todos();
```

Method writes are analyzed like any other write. No base class, no proxy.

## Derived state is just an expression

```tsx
export function Cart() {
  const items = [{ price: 20, qty: 1 }, { price: 5, qty: 3 }];
  let coupon = 0;

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const total = subtotal - coupon;

  return <output>{total}</output>;
}
```

- Write it as a `const` expression — no `computed()` exists.
- **Derivations must be `const`.** If you forget and write
  `let doubled = count * 2`, the compiler doesn't error — it treats
  `doubled` as ordinary writable state, so it initializes once and never
  recomputes. The language service flags the `let` → `const` suggestion in
  the editor; compile-time, a stale derived value is your reminder.
- Chains work: `a` → `b` → `c` replays in order when `a` changes.
- Pure helper calls inside derivations are fine.
- **Never write to a derived value** — `total++` is invalid; update `coupon`.

## Rendering collections

Map arrays directly; give rows a stable `key`:

```tsx
const todos = [{ id: 1, title: 'a' }];

export function List() {
  return (
    <ul>
      {todos.map(t => <li key={t.id}>{t.title}</li>)}
    </ul>
  );
}
```

`todos.push(...)`, `splice`, index writes — all reactive. Don't accumulate
JSX in a mutable array; map the data.

## The mental model

Think of the whole app as a spreadsheet:

- **Cells** = your variables, fields, array elements, Set/Map contents.
- **Formulas** = `const` derived expressions.
- **The DOM** = cells' display.

You edit cells; the compiler already worked out which formulas and which
pixels depend on which cells, so only those re-evaluate. The only rule that
matters: **mutate the source, never the derived** — and keep everything
reachable through static imports so the compiler can see the whole graph.

Next: [03 — Effects & cleanup](./03-effects-and-cleanup.md)
