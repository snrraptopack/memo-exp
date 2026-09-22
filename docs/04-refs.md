# Refs — getting at real DOM nodes

JSX gives you the tree; refs hand you the actual `Element` when you need to
do something JSX can't express — focus, measure, scroll, pass the node to a
library. There's no `useRef` or ref object; a ref is just a slot the runtime
fills with the node, and there are a few different ways to declare one.

## The mutable ref — assign into a variable

The simplest form: a `let` variable (or a member of an object) as the `ref`
value. The runtime assigns the node to it once that part of the DOM exists:

```tsx
export function Editor() {
  let input: HTMLInputElement | undefined;
  const nodes: { panel?: HTMLElement } = {};

  return (
    <section ref={nodes.panel}>
      <input ref={input} />
      <button onClick={() => input?.focus()}>Focus</button>
    </section>
  );
}
```

- `input` starts `undefined` and holds the real `<input>` element after
  mount. Read it inside handlers, effects, async callbacks — anywhere that
  runs after the DOM exists.
- Member expressions work the same (`nodes.panel`) — handy when you want to
  group refs in a plain object.
- On teardown the slot is cleared **only if it still holds that node** — so
  reusing the variable elsewhere is safe.
- Ref assignments don't trigger reactive updates — `let input` is a
  lifecycle slot, not UI state. Don't render `{input}` expecting it to fill
  in; read it in code.

## The callback ref — run code per node

Pass a function and it receives the element directly. Return a function for
teardown:

```tsx
function install(node: HTMLElement) {
  const observer = new ResizeObserver(() => measure(node));
  observer.observe(node);
  return () => observer.disconnect();   // optional cleanup
}

export function Panel() {
  return <section ref={install}>…</section>;
}
```

A callback ref installs **once** per element while that element lives. Its
identity isn't reactively replaced — if the setup needs to change with
state, that's what `effect` + a mutable ref is for.

## Several refs on one element

`ref` accepts a **static array** — every entry gets the node:

```tsx
<input ref={[input, nodes.input, installAccessibility]} />
```

- Setup runs **left-to-right**, teardown **right-to-left**.
- Nested arrays and empty slots (`null`, `undefined`, `false`) are allowed.
- **No spreads** — `ref={[...extraRefs, input]}` is a compile error; the
  compiler needs a fixed shape to emit the installs.

## Where a ref's life ends

Ref cleanup is owned by the smallest region around the element: a keyed list
row, a conditional branch, a component. Remove that region — delete the row,
swap the branch, unmount — and the ref's teardown runs immediately. Callback
ref cleanups and cleared mutable slots both honor that boundary.

## Forwarding refs through components

Components have no implicit host element, so a ref travels as a normal prop
and the child plants it on a real element:

```tsx
function Input({ label, ref: forwarded }: { label: string; ref?: unknown }) {
  return (
    <label>
      <span>{label}</span>
      <input ref={forwarded} />
    </label>
  );
}

export function Form() {
  let email: HTMLInputElement | undefined;
  return <Input label="Email" ref={email} />;
}
```

`Form`'s `email` ends up holding the `<input>` inside `Input` — the ref just
passes through. Combine with arrays to grab it locally *and* forward it:
`ref={[forwarded, inputRef]}`.

## Rules of thumb

| Need | Reach for |
|---|---|
| Read/focus/measure a node from handlers | mutable ref (`let` / member) |
| Per-node setup with teardown (observers, libraries) | callback ref |
| Several things want the same node | `ref={[a, b, c]}` |
| Parent needs a child's node | forward `ref` as a prop |
| Setup that must change when state changes | `effect` reading a mutable ref |

One thing refs don't do: they never fire during SSR — there's no browser
node on the server. Callback refs first run on the client after hydration.

Next: [05 — Data loading](./05-data.md)
