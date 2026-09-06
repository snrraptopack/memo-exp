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

## Lazy destructuring

TSRX `&{ ... }` and `&[ ... ]` patterns use Memoized DOM's native reactive
destructuring analysis. The frontend removes the lazy sigil while preserving
the authored pattern, types, defaults, aliases, and nesting; the compiler then
replays those bindings whenever their reactive source changes.

```tsx
function UserCard(&{ name, age }: Props) @{
  <article><h2>{name}</h2><p>{age}</p></article>
}
```

Conceptually this uses the same component contract as ordinary destructuring:

```tsx
function UserCard({ name, age }: Props) {
  return <article><h2>{name}</h2><p>{age}</p></article>;
}
```

In Memoized DOM the second form is already reactive rather than a permanent
snapshot. Direct assignments to a lazy binding are rejected because ordinary
JavaScript destructuring does not write through to the source property. Write
the source member explicitly when mutation is intended.

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

Cases do not fall through. The pinned TSRX semantic pass treats their
declarations as sharing the switch lexical scope, so case-local bindings must
have distinct names.

Inside markup, the same switch is conceptually an inline render helper:

```tsx
<main>
  {(() => {
    switch (status) {
      case 'ready': return <Dashboard />;
      case 'loading': return <Spinner />;
      default: return <ErrorView />;
    }
  })()}
</main>
```

The shared render planner expands that exhaustive helper into an ordinary
conditional region before DOM emission. The IIFE above is explanatory syntax;
it is not present at runtime. Emitted code uses a branch selector and branch
factories, mounts only the selected output, and does not create a reactive
temporary containing JSX or DOM nodes.

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

## Colorless data boundaries

Memoized DOM gives TSRX `@try`, `@pending`, and `@catch` a static colorless-data
profile. The try body currently contains one direct component and at least one
of its direct identifier props must be a compiler-known colorless source:

```tsx
export function Page() @{
  const user = $fetch<User>('/api/user');
  const statistics = $fetch<Statistics>('/api/statistics');

  @try {
    <Dashboard suspend {user} {statistics} />
  } @pending {
    <DashboardSkeleton />
  } @catch (error, reset) {
    <DashboardFailure {error} {reset} />
  }
}
```

`suspend` is a shorthand compiler directive on the component call. With it,
the pending output is shown once until every associated source has its initial
value, then the component mounts atomically. A source failure selects `@catch`;
`reset` retries the failed source. Committed content remains visible during a
later refresh.

Without `suspend`, the component mounts immediately. Every unresolved
colorless read site renders its own instance of the authored `@pending` output;
as each source commits, only its dependent sites are replaced. A failed site
similarly renders `@catch`, and `reset` retries that site's failed source. Use a
site-valid inline fallback in this mode. Use `suspend` when the pending output
is a whole-panel skeleton that should appear only once.

The suspended form is conceptually the same readiness contract as this TSX:

```tsx
<Group>
  <Pending component={DashboardSkeleton} />
  <Error component={DashboardFailure} />
  <Dashboard suspend user={user} statistics={statistics} />
</Group>
```

This is currently a colorless-source boundary, not a universal exception
boundary for arbitrary synchronous throws inside descendants. The direct
component and direct source-prop restrictions keep ownership, retry, and
diagnostics static instead of discovering dependencies by throwing at runtime.

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
| Nested or expression-position `@switch` | Supported |
| Lazy `&{ ... }` / `&[ ... ]` destructuring | Supported through native reactive replay; direct binding writes are rejected |
| `@try` / `@pending` / `@catch` | Supported for one direct component with statically visible colorless-source props; `suspend` opts into atomic initial readiness |
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
