# External Reactivity and Invalidation

## Purpose

Memoized DOM must be able to consume ordinary JavaScript libraries without
requiring those libraries to provide a Memoized DOM adapter. The compiler must
also remain independent of particular package names and APIs. It must never
contain rules such as “calls named `$fetch` are reactive.”

This document defines the framework-level invalidation model for code whose
state changes either inside compiled application code or behind an external
JavaScript boundary.

## The three invalidation paths

### 1. Compiler-visible invalidation

When the compiler can see the write or execution callback, it emits precise
invalidation using the existing dirty-routing model.

```ts
let count = 0;

setInterval(() => {
  count++;
}, 1000);
```

The interval callback is visible, so the compiler can append the appropriate
dirty mark. The same applies to event handlers, Promise callbacks, nested
callbacks in option objects, and linked helpers whose effects can be analyzed.

This is the preferred static fast path. It performs no polling.

### 2. Opaque pull fallback

Some libraries retain an object and mutate it later without exposing their
internal callback:

```ts
const target = { value: 0 };

externalAnimationLibrary.animate(target, {
  value: 100,
  duration: 800,
});

return <output>{target.value}</output>;
```

The initial function call is visible, but the later writes happen inside code
outside the compiled graph. A dirty mark at the end of the initial call is not
enough because the value continues changing afterwards.

For rendered state proven to cross such an opaque boundary, the compiler marks
the owning entity as volatile. While that entity is mounted, the runtime
reevaluates its pull expressions once per animation frame. Existing slot guards
compare the newly pulled values and avoid DOM writes when nothing changed.

The provenance analysis covers common external-library shapes:

- Mutable objects passed to an opaque imported API.
- Live objects returned by opaque factories.
- Imported constructors and their instances.
- Factory results nested inside object initializers.
- Results assigned through members such as `state.clock = createClock()`.
- Pull-readable singleton state imported from an opaque package.
- Opaque values propagated through component-local bindings.

Graph-linked helpers with bounded compiler-visible effects remain on the static
fast path.

#### Pull-only frames are not state writes

A volatile frame uses an internal pull-only invalidation reason. It causes DOM
expressions, local derivations, and optimized list calculations to be
reevaluated, but it does not rerun effects.

This distinction is essential:

```ts
effect(() => {
  externalAnimationLibrary.animate(target, { value: 100 });
});
```

Rerunning this effect merely because a frame pulled a new `target.value` would
restart the animation on every frame. Pulling current state and replaying an
arbitrary side effect are different operations.

If a real state reason is batched with a pull-only frame, normal effect routing
still occurs.

#### Lifecycle

Volatile polling begins only after a volatile entity registers and continues
only while at least one such entity remains mounted. Unregistering the entity
removes it from the polling set. Browser frame scheduling naturally pauses in a
background tab, and the runtime additionally avoids dirtying volatile entities
while the document is hidden.

Polling does not replace library cleanup. Timelines, subscriptions, sockets,
observers, and other external resources should still be disposed through the
normal `cleanup()` primitive.

### 3. Generic runtime sources

Polling is necessary when a library gives us no observable completion or write
boundary. It is unnecessary when a library owns the mutation and therefore
knows exactly when its state changes.

A future generic runtime-source facility can provide precise push invalidation:

```ts
// Conceptual framework primitive; this is not yet a public API.
const source = createRuntimeSource();

return {
  get value() {
    source.track();
    return snapshot.value;
  },
  update(nextValue) {
    snapshot.value = nextValue;
    source.notify();
  },
};
```

The intended sequence is:

1. Generated render code establishes the currently rendering entity.
2. Reading a getter backed by a runtime source records that entity as a
   consumer.
3. The library changes its internal snapshot at a point it already controls.
4. The library calls `notify()`.
5. The runtime marks only the recorded consumers dirty.

This is a generic runtime contract, not compiler recognition of a library. A
cache, data resource, clock, editor model, socket store, media controller, or
any future primitive could use the same mechanism. External libraries are not
required to adopt it; they continue to work through visible callbacks or the
opaque pull fallback.

Adding runtime sources may require one generic compiler/runtime capability for
establishing the active consumer while generated code renders. It must not add
package names, function names, argument conventions, or library-specific logic
to the compiler.

## Choosing an invalidation path

| Situation | Correct path |
| --- | --- |
| The compiler sees the write or callback | Compiler-visible invalidation |
| An unchanged external library mutates pull-readable state invisibly | Opaque pull fallback |
| A library we control knows exactly when its snapshot changes | Generic runtime source, when available |
| State is neither pull-readable nor exposed through any execution boundary | Cannot be observed without changing semantics |

The opaque fallback establishes correctness first. A generic runtime source is
an optional performance optimization for libraries under our control.

## Application to data resources

A data-loading package such as `$fetch` does not need compiler-specific
integration. Its getter-backed state can work through the same opaque fallback
as any other JavaScript library.

The data package remains responsible for its own domain behavior:

- Request execution and response decoding.
- Cache identity and resource sharing.
- Freshness and retention lifetimes.
- AbortController-based cancellation and stale-result suppression.
- Loading, data, and error state transitions.
- Mutations and optimistic updates.
- Invalidation and refresh behavior.
- Tests for races, cleanup, caching, and rollback.

None of these responsibilities belongs in the compiler.

Because a data resource knows when a request starts, succeeds, fails, aborts,
or rolls back, it is a strong future candidate for generic runtime sources.
Using a source would let it notify exact consumers only at those transitions
instead of keeping its owner on the frame-polling lane. This is an efficiency
improvement, not a requirement for correct consumption and not a reason to
teach the compiler about `$fetch`.

## Framework-specific libraries

This interoperability model applies to ordinary JavaScript state and DOM APIs.
It does not emulate another framework's component runtime.

- Framework-independent cores can be consumed directly.
- Browser Custom Elements can be consumed directly.
- React hooks and React components still require React's dispatcher, context,
  lifecycle, and element renderer.
- Vue components and composables may require Vue's component and reactivity
  runtime.
- A library with a framework-neutral core and separate framework adapters
  should be integrated through its core.

Opaque invalidation lets Memoized DOM observe readable JavaScript state. It
cannot turn a React element tree into real DOM or recreate Vue's ownership
model.

## Semantic limit

No framework can generically detect a state transition that exposes neither a
readable current value nor an observable execution boundary. For example, if a
library returns an immutable snapshot and later replaces only a private hidden
snapshot, repeatedly reading the old returned object cannot reveal the new one.

Supporting that case requires an API exposed by the library, interception that
changes object semantics, modification of the library, or permanent broad
instrumentation. Memoized DOM must not silently use semantic-changing proxies
or emulate another framework to claim support.

The universal rule is therefore:

> Compiler-visible execution is invalidated precisely. Opaque but pull-readable
> state is reevaluated conservatively. Framework-owned state may optionally
> publish through generic runtime sources.

