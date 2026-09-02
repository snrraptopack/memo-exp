# Memoized DOM TSRX profile

TSRX (TypeScript Render Extensions) is an optional source-language frontend for
Memoized DOM. It adds statement containers and template control flow to ordinary
TypeScript and JSX; it does not add a second component model, reactivity system,
or runtime.

```text
.tsx --Yuku----------\
                       -> compiler ESTree -> one analysis/linker -> direct DOM
.tsrx--@tsrx/core----/
          + Memoized DOM lowering
```

The integration is pinned to `@tsrx/core` 0.1.63. The upstream language is in
active beta, so the [official features](https://tsrx.dev/features) and
[draft specification](https://tsrx.dev/specification) must be reviewed before
upgrading the parser.

## How to describe it

The shortest accurate description is:

> Write plain reactive TypeScript with JSX-shaped markup, statement-local setup,
> and template control flow. Memoized DOM compiles both `.tsrx` and `.tsx`
> through the same static reactivity and direct-DOM pipeline.

Avoid describing `@{}`, `@if`, or `@for` as reactivity primitives. Reactivity
still follows compiler-visible reads and writes. `const` collections can remain
reactive mutation targets, and `let` is needed only when the binding itself is
reassigned.

The examples below show conceptual TSX equivalents. They explain source meaning;
they are not generated intermediate files. Memoized DOM emits direct DOM and
runtime-region operations after shared analysis.

## Components and local setup

TSRX keeps setup and the final template in one statement container:

```tsx
export function Card({ title }: { title: string }) @{
  const heading = title.trim();
  <article><h2>{heading}</h2></article>
}
```

Conceptually:

```tsx
export function Card({ title }: { title: string }) {
  const heading = title.trim();
  return <article><h2>{heading}</h2></article>;
}
```

An `@{ ... }` function body must contain setup first and finish with one render
output. Ordinary nested functions continue to use normal TypeScript braces.

A nested statement container provides a render value with local, pure setup:

```tsx
<main>
  @{
    const label = title.toUpperCase();
    <strong>{label}</strong>
  }
</main>
```

Conceptually:

```tsx
<main>
  {(() => {
    const label = title.toUpperCase();
    return <strong>{label}</strong>;
  })()}
</main>
```

Both forms use the shared JSX render-function planner. Nested setup therefore
has the same purity rules as TSX render helpers; it is not a lifecycle hook or
an independently mounted component.

## Conditional output

Nested `@if` branches are the template form of a conditional expression:

```tsx
<main>
  @if (ready) { <Dashboard /> }
  @else { <Spinner /> }
</main>
```

Conceptually:

```tsx
<main>{ready ? <Dashboard /> : <Spinner />}</main>
```

A root `@if` is conceptually an ordinary return-oriented `if` chain. Both forms
reuse Memoized DOM's existing conditional-region analysis and ownership.

Pure declarations may stay local to a branch. Conceptually, that branch becomes
the same inline render helper shown for nested statement containers:

```tsx
@if (ready) {
  const label = title.toUpperCase();
  <strong>{label}</strong>
}
```

is equivalent to the true arm of:

```tsx
ready
  ? (() => {
      const label = title.toUpperCase();
      return <strong>{label}</strong>;
    })()
  : null
```

The same rule applies to `@switch` cases and `@empty` blocks.

## Lists, indexes, keys, and empty output

```tsx
<ul>
  @for (const item of items; index index; key item.id) {
    const label = `${index + 1}. ${item.name}`;
    <li>{label}</li>
  } @empty {
    <li>No items</li>
  }
</ul>
```

Conceptually:

```tsx
<ul>
  {items.length > 0
    ? items.map((item, index) => {
        const label = `${index + 1}. ${item.name}`;
        return <li key={item.id}>{label}</li>;
      })
    : <li>No items</li>}
</ul>
```

This is not a generic imperative loop. It lowers through the same keyed or
unkeyed list regions used by `.tsx` collection rendering.

## Switch output

A root `@switch` is conceptually a return-oriented TypeScript switch:

```tsx
@switch (status) {
  @case 'ready': { <Dashboard /> }
  @case 'loading': { <Spinner /> }
  @default: { <ErrorView /> }
}
```

Each case is isolated and does not fall through. The current Memoized DOM profile
supports this form only as a statement-container function's final output.

## Dynamic elements and components

TSRX uses expression-name tags:

```tsx
<{compact ? 'span' : 'section'}>Content</{compact ? 'span' : 'section'}>
```

Conceptually, the frontend creates a collision-safe component-local selector:

```tsx
const TsrxDynamic0 = compact ? 'span' : 'section';
<TsrxDynamic0>Content</TsrxDynamic0>
```

The shared dynamic-tag planner then proves the finite candidates and emits the
normal conditional region. Finite linked component choices work the same way:

```tsx
<{expanded ? Details : Summary} item={item} />
```

Memoized DOM intentionally rejects selectors for which it cannot prove a finite
set of intrinsic tags or linked components. Finite string unions on component
props, including the official `as?: 'section' | 'article'` shape, participate in
the same shared candidate analysis.

## Scoped styles

A function-owned `<style>` block is extracted as CSS, its selectors receive the
stable TSRX scope hash, and the style element does not enter DOM emission:

```tsx
export function Card() @{
  <article class="card">
    <h2>Title</h2>
    <style>
      .card { padding: 1rem; }
      h2 { color: rebeccapurple; }
    </style>
  </article>
}
```

The conceptual equivalent is external scoped CSS plus generated class hashes,
not a runtime `<style>` DOM node. Upstream style-expression composition such as
`const styles = <style>...</style>` is not supported yet.

## Current support matrix

| Official TSRX surface | Memoized DOM profile |
|---|---|
| Ordinary TypeScript, JSX, fragments, expressions, and comments | Supported |
| JSX prop shorthand such as `<Input {value} />` | Supported |
| Statement-container function body | Supported |
| Nested and root `@if` | Supported when branches contain direct output |
| `@for (... of ...)`, `index`, `key`, loop-local setup, `@empty` | Supported |
| Root `@switch` | Supported |
| Finite dynamic intrinsic/component expressions | Supported |
| Function-owned scoped `<style>` | Supported |
| Nested `@{ ... }` statement containers with pure setup | Supported |
| Pure branch-local setup in `@if`, `@switch`, or `@empty` | Supported |
| Nested or expression-position `@switch` | Not yet supported |
| Lazy `&{ ... }` / `&[ ... ]` destructuring | Not yet supported |
| `@try` / `@pending` / `@catch` | Not yet supported |
| Style expressions and style composition | Not yet supported |
| Server submodules and identifier-source imports | Not yet supported |

Unsupported forms fail during compilation rather than entering the shared
compiler as unknown AST nodes.

## Conformance boundary

The official draft separates core syntax and early errors from host-defined
execution semantics. Memoized DOM is therefore a host profile with stronger
rules where its static ownership model requires them.

The frontend uses both the official parser and its target-neutral
`analyzeTsrx()` semantic pass, then directly lowers the extended ESTree nodes
without generating and reparsing source text. Diagnostics implemented by that
shared pass and Memoized DOM's stronger host-level restrictions use the same
structured diagnostic path. In pinned core 0.1.63, some exported template
validators remain target-owned rather than being invoked by `analyzeTsrx()`;
Memoized DOM continues to enforce the corresponding restrictions during its
host lowering.
