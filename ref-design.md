# DOM refs - deferred design

DOM refs are intentionally deferred until their ownership, cleanup, forwarding,
and reconfiguration semantics are implemented together. This document records
the current design direction; it is not a supported source-language contract
yet.

## Proposed syntax

`ref` is a compiler-recognized JSX attribute. It does not require a `ref<T>()`
runtime primitive.

```tsx
let div: HTMLDivElement | undefined;
const state: { button?: HTMLButtonElement } = {};

return <>
  <div ref={div}>Hello</div>
  <button ref={state.button}>Save</button>
</>;
```

An identifier or member expression in `ref={target}` is an assignment target,
not an ordinary value read. Mount assigns the real DOM node. Teardown clears
the target only if it still contains that node:

```ts
target = node;

// Generated teardown
if (target === node) target = undefined;
```

Ref assignment is lifecycle storage, not a reactive state write. Assigning or
clearing a ref must not independently schedule rendering.

## Callback refs

A callback receives the real DOM node once it is created. Its optional return
value is the teardown:

```tsx
function setup(node: HTMLDivElement) {
  console.log('mounted', node);
  return () => console.log('unmounted', node);
}

return <div ref={setup}>Hello</div>;
```

Inline callbacks and callback factories should use the same contract:

```tsx
let div: HTMLDivElement | undefined;

return <div ref={(node) => {
  div = node;
  return () => {
    if (div === node) div = undefined;
  };
}} />;
```

```tsx
return <div ref={fadeIn({ ms })}>Hello</div>;
```

The initial factory design evaluates `fadeIn({ ms })` when the element is
created. Reactive factory reconfiguration is deferred because silently
rerunning setup would make a ref a hidden effect.

## Cleanup ownership

Ref teardown belongs to the nearest structural owner:

| Element location | Teardown owner |
|---|---|
| Static component content | Component entity |
| Conditional branch | Active branch |
| Keyed list | Row |
| Conditional inside a row | Nested active branch |

Removing a branch or row must therefore tear down its refs immediately, even
while the parent component remains mounted. Callback teardown is synchronous
and is not awaited.

Multiple refs use an array:

```tsx
return <input ref={[input, state.input, setupAccessibility]} />;
```

Mount proceeds left to right. If mounting succeeds, teardown proceeds in
reverse order. The exception/rollback behavior when one callback throws still
needs an explicit decision.

## Component forwarding

Components do not automatically expose a DOM node because they may return
fragments or several roots. A component receives a ref adapter as a prop and
must forward it explicitly:

```tsx
function Input({ ref: inputRef, ...rest }) {
  return <input ref={inputRef} {...rest} />;
}

let input: HTMLInputElement | undefined;
return <Input ref={input} />;
```

Named props remain an ordinary alternative:

```tsx
function Field({ inputRef }) {
  return <input ref={inputRef} />;
}

return <Field inputRef={input} />;
```

The compiler must preserve an assignable sink across the component call; it
cannot pass the target's current value. Programmatically assembled spread refs
will likely require a unique runtime key similar to `createRefKey()`, and are
deferred with the rest of the ref implementation.

## Required first implementation

- Mutable identifier and member-expression targets.
- Named, inline, and factory callback refs.
- Callback-returned teardown.
- Multiple refs with deterministic teardown order.
- Explicit component forwarding.
- Correct component, conditional-branch, and keyed-row ownership.
- Tests for retained nodes, replacement, unmount, forwarding, and exceptions.

## Open questions

- Whether callback replacement on a retained node is ever reactive.
- Rollback ordering when one of several ref callbacks throws.
- The exact representation used to carry an assignable sink through props.
- Programmatic refs inside spread objects and their runtime key.
- Development diagnostics for an accepted component ref that is never
  forwarded.
