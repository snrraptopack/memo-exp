# DOM refs

DOM refs are compiler-recognized lifecycle slots. They expose real DOM nodes
without a `ref()` wrapper, runtime JSX value, hook, or subscription.

## Mutable refs

An identifier or member expression is an assignment target:

```tsx
function App() {
  let div: HTMLDivElement | undefined;
  const state: { button?: HTMLButtonElement } = {};

  return <>
    <div ref={div}>Hello</div>
    <button ref={state.button}>Save</button>
  </>;
}
```

Mount assigns the node. Teardown clears the target only while it still holds
that same node. Member receivers and computed keys are evaluated once and
retained for cleanup. These compiler-generated writes are lifecycle storage;
they do not schedule reactive rendering.

## Callback refs

A callback receives the node after its emission scope has created its DOM. Its
optional return value is synchronous teardown:

```tsx
function setup(node: HTMLDivElement) {
  console.log('mounted', node);
  return () => console.log('unmounted', node);
}

return <div ref={setup}>Hello</div>;
```

Inline callbacks and factories use the same contract:

```tsx
return <div ref={(node) => {
  install(node);
  return () => uninstall(node);
}} />;

return <div ref={fadeIn({ ms })} />;
```

A factory is evaluated once when its element is created. Ref callback identity
is not reactively replaced on a retained element; use an explicit `effect()`
when setup itself must reactively reconfigure.

## Multiple refs and failures

Arrays may contain mutable refs, callbacks, nested arrays, and empty values:

```tsx
return <input ref={[input, state.input, setupAccessibility]} />;
```

Setup runs left-to-right and teardown runs right-to-left. The returned
disposer is idempotent. If setup throws, previously installed refs roll back
right-to-left. Cleanup continues after failures and reports one error or an
`AggregateError`.

The source shape of a ref array is static; array spreads are rejected.

## Cleanup ownership

Ref cleanup follows the smallest structural owner:

| Element location | Teardown owner |
|---|---|
| Static component content | Component entity |
| Conditional branch | Active branch |
| Keyed list | Row entity |
| Conditional inside a row | Nested active branch |
| Lazy children/render slot | Individual slot mount |

Consequently a branch swap or row removal runs ref cleanup immediately without
waiting for the parent component to unmount.

## Component forwarding

Components have no implicit host node. A component ref is an ordinary callback
adapter prop and must be forwarded to the host that the component chooses:

```tsx
function Input({ ref: inputRef, ...rest }) {
  return <input ref={inputRef} {...rest} />;
}

function App() {
  let input: HTMLInputElement | undefined;
  return <Input id="email" ref={input} />;
}
```

Named ref props are also supported and their contract is linked across files:

```tsx
function Field({ inputRef, ...rest }) {
  return <input ref={inputRef} {...rest} />;
}

return <Field inputRef={input} />;
```

A generic rest/spread wrapper can forward the ordinary `ref` prop:

```tsx
function Input({ id, ...rest }) {
  return <input id={id} {...rest} />;
}
```

## Spread refs

No `createRefKey()` API is needed. A spread-bearing element or component
recognizes the ordinary `ref` property selected by normal source-order
override semantics:

```tsx
const props = {
  id: 'example',
  ref: (node: HTMLInputElement) => {
    install(node);
    return () => uninstall(node);
  },
};

return <input {...props} />;
```

Plain JavaScript still applies before compilation: `{ ref: input }` reads the
current value of `input`; an arbitrary runtime object cannot preserve the
ability to assign back to that lexical variable. Use a callback property in a
programmatically assembled object. Direct `ref={input}` remains the concise
compiler-native mutable form.

## Attachment timing

Refs receive real nodes after their local DOM scope is built, but a component
factory may still return a detached root. A ref therefore means “created and
owned,” not necessarily “already connected to `document`.” Integrations that
need document attachment should use an explicit host lifecycle boundary.
