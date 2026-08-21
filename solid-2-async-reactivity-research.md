# Solid 2 Async Reactivity Research

## Status and scope

This document records how Solid 2.0 RC models asynchronous reads, mutations,
loading, errors, ownership, and server rendering. It is research material for
Memoized DOM's data-layer design; it is not a proposal to copy Solid's public
API.

Research date: 2026-08-21.

Solid `v2.0.0-rc.0` was released on 2026-08-13. The release announcement says
the API is frozen at the release-candidate stage, while also warning that bugs
may remain.

## 1. Executive findings

Solid 2's central change is not a fetch client. It makes asynchronous results a
property of its reactive graph:

1. An ordinary computation may return a value, Promise, or AsyncIterable.
2. Reading an unresolved computation propagates an internal not-ready state
   through downstream computations.
3. A structural boundary converts that state into loading UI.
4. Resolution wakes only graph nodes that depend on the unresolved source.
5. After a value has committed, revalidation normally retains the committed
   value until its replacement can reveal.
6. Mutations are modeled separately as transactional actions with optimistic
   state and explicit invalidation.
7. SSR, hydration, streaming, and client-only sources use the same async-node
   model rather than a second server data abstraction.

The design removes `createResource` from Solid core. It does not provide HTTP
request normalization, a query-key system, response validation, cache-duration
policy, or a general server-state cache. Those remain the responsibility of
application or data-library code.

## 2. Async is a computation capability

Solid 2 allows `createMemo`, derived stores, and related computations to return
a Promise or AsyncIterable:

```tsx
const user = createMemo(() => fetchUser(id()));

return (
  <Loading fallback={<UserSkeleton />}>
    <UserProfile user={user()} />
  </Loading>
);
```

The accessor is consumed as its resolved type. The UI does not normally carry
`Promise<T>` or `T | undefined` through every consumer. Initial unavailability
is represented structurally by a boundary.

This is described as "colorless async": downstream code reads the value using
the same reactive interface used for synchronous data. The node itself knows
whether its answer is ready.

### 2.1 Runtime mechanics

The current Solid signals implementation follows this broad sequence:

1. A computed node evaluates its function.
2. If the result is synchronous, it commits normally.
3. If the result is thenable or async-iterable, the node records that flight.
4. If no initial value is available, a read throws an internal `NotReadyError`
   carrying the unresolved source.
5. A downstream computation that encounters the marker records the pending
   source and becomes blocked on it.
6. The not-ready state can continue through derived computations until a
   loading boundary handles it.
7. When the flight settles, Solid walks dependants registered on that pending
   source, clears their pending-source relationship, and schedules blocked
   nodes to run again.

This is not ordinary exception-driven application control flow. The marker is
an internal graph protocol that simultaneously carries readiness and dependency
information.

### 2.2 Flight identity and stale answers

Each async computation retains the identity of its current in-flight result.
Settlement callbacks ignore a result that is no longer the node's current
flight. The implementation also avoids committing an async answer when a newer
dirty or optimistic write has superseded it.

This prevents an older request from overwriting the result of a newer reactive
question. It is graph-node concurrency protection, not HTTP-cache identity.

### 2.3 AsyncIterable support

An AsyncIterable is treated as a value stream. Each yielded value can become a
new committed answer. Solid registers iterator cleanup with the computation's
owner and stops pulling an unobserved auto-disposed stream.

Promises that resolve to an AsyncIterable are flattened by one async level, so
server or transport stubs may return streams without exposing a separate UI
primitive.

### 2.4 Dependency reads around `await`

There is an important constraint: an unresolved reactive source first read
after an `await` cannot be registered through the original synchronous
dependency-collection pass. Solid's development runtime diagnoses this case and
instructs authors to read the reactive input before the first `await`, or to
restructure it as an input.

This limitation matters when comparing runtime tracking with ahead-of-time
dependency analysis. Colorless async does not make arbitrary JavaScript async
control flow automatically traceable.

## 3. Loading is branch readiness

`<Loading>` is the structural boundary for a branch that cannot produce its
first content because a value is unresolved.

The boundary is intentionally not a generic "is the network busy" indicator.
Its main job is determining whether a branch can reveal:

- Before the branch has committed content, unresolved reads show the fallback.
- After the branch has committed content, ordinary revalidation keeps the
  previous content visible.
- Nested loading boundaries control how much of the tree waits together.
- A keyed/on relationship can request that a boundary show its fallback again
  when a particular question changes.

This separates initial readiness from background or input-driven updates.

## 4. Pending is semantic, not merely transport state

Solid 2's `isPending(expression)` asks whether a different answer for the
observed reactive expression is in flight and has not revealed.

It normally becomes true when:

- a tracked input changes and the derived async answer is not ready; or
- an action declares that it will affect the observed value.

A bare refresh of the same question is deliberately quiet. The currently
displayed value still answers the current question, so a confirmation request
does not automatically make `isPending` true. Code can explicitly declare the
refresh as affecting a value when the UI should present it as a pending change.

This distinction produces at least three separate concepts:

1. Initial branch readiness.
2. Transport/process activity.
3. A new semantic answer waiting to reveal.

Treating all three as one `loading` boolean loses information.

## 5. Stale and latest values

When a reactive input changes, Solid ordinarily retains the last committed
answer while the replacement is pending. This gives stale-while-revalidating
behavior at the graph level.

`latest(expression)` can inspect the in-flight/latest side of a transition,
falling back to the stale committed value when a newer value is not available.
It is distinct from the normal committed read.

`resolve(expression)` provides an imperative Promise that settles when a
reactive expression produces a non-pending answer. It is intended for tests and
imperative code and cannot itself be called from a reactive scope.

## 6. Provisional first values

Solid provides `loadingValue` and store-oriented `seedLoadingValue` options for
cases where an application has a valid first-paint value of type `T`.

A provisional value means the initial computation need not suspend through a
loading boundary. It is useful when the placeholder is a meaningful value of
the same type. When no honest `T` exists, the RFC recommends a structural
loading boundary instead of inventing a misleading data value.

## 7. Errors and reveal coordination

`<Errored>` is the error boundary. Its fallback may receive an error accessor
and a reset action. Reset retries the errored branch rather than permanently
replacing it.

`<Reveal>` coordinates multiple loading boundaries. It can control whether
sibling branches reveal naturally, together, or in sequence. This is useful
for avoiding visually confusing partial reveals without forcing unrelated
requests into a waterfall.

The relevant separation is:

- computations represent data and dependency state;
- `Loading` represents initial readiness;
- `Errored` represents failed evaluation;
- `Reveal` represents presentation ordering.

## 8. Refresh is invalidation

`refresh(target)` means that a derived computation should be invalidated and
recomputed. It is not itself a loading-state API.

This permits data to be recomputed without automatically changing presentation
state. An action can combine `affects(target)` with `refresh(target)` when a
refresh should be understood as a user-visible pending change.

## 9. Mutations are not reads

Solid deliberately models mutations separately from asynchronous derivations.
An `action()` is an imperative async workflow that coordinates:

- optimistic writes;
- an asynchronous side effect;
- reconciliation or refresh after the side effect; and
- rollback when the workflow fails.

Actions run inside transitions. Solid's generator and async-generator forms
provide explicit suspension/re-entry points:

```tsx
const saveTodo = action(function* (todo) {
  setOptimisticTodos((todos) => {
    todos.push(todo);
  });

  yield api.addTodo(todo);
  refresh(todos);
});
```

The generator is not merely stylistic. A runtime cannot automatically regain
the same transition context after every arbitrary `await`. `yield` gives the
action runner an observable boundary where it can resume the transaction.

### 9.1 Optimistic state

`createOptimistic` and `createOptimisticStore` layer temporary values over
their source. Optimistic values participate in the transition and revert or
reconcile when the action settles.

The optimistic layer is designed to compose with ordinary signals and stores
rather than creating a parallel mutation cache.

### 9.2 `affects`

`affects(target, key?)` declares which reactive value or store location an
in-flight action is expected to change. This allows pending meaning to
propagate through the same graph as reads.

The target may be a computation or a granular store location. This is more
precise than a single global mutation counter.

## 10. Ownership and disposal

Solid computations are owned by the scope in which they are created. Owned
roots, effects, async iterators, and cleanup hooks are disposed with their
parent unless explicitly detached.

For an async node, in-flight work also acts as an observer so transient
subscriber churn does not automatically tear down and restart a request.
After settlement, an auto-disposed node with no subscribers can be released.

Ownership answers a different question from caching:

- ownership decides when a consumer and its work may be released;
- cache policy decides whether a resolved value should remain reusable.

Conflating the two can either leak unused work or discard useful cached data.

## 11. Server rendering and hydration

The async RFC describes three source postures:

### 11.1 Server-authoritative

The default source is resolved on the server, serialized, and adopted as the
authoritative hydration value. The client does not immediately refetch it on
load.

### 11.2 Hybrid

A hybrid source can render from a server value but recompute against live
client state after hydration. Viewport-dependent calculations are a typical
example.

### 11.3 Client-only

A client source is not serialized as server data. It may either provide a
declared provisional value or use the nearest loading boundary's fallback in
the server output.

Other relevant options include:

- `deferStream: true`, which delays the initial stream flush until a source has
  its first value; and
- `transparent: true`, an integration-level option for client-only reactive
  nodes that must not shift hydration identifiers.

This model treats the server as another producer for the same reactive node.
Hydration adopts the server commit rather than converting it into a separate
client query abstraction.

## 12. Compiler involvement in Solid 2

Solid 2 ships an OXC-based JSX/compiler toolchain, and its Vite integration can
also recognize platform constructs such as lazy/client-only module imports and
inject resolved module URLs.

However, async dependency discovery remains primarily a runtime graph
responsibility. The compiler does not statically construct the complete data
dependency graph. Solid's async design therefore solves a different problem
from Memoized DOM's ahead-of-time reactive linking.

## 13. What Solid's async core does not solve

Solid's async graph does not by itself define:

- HTTP method and URL normalization;
- headers/query normalization for request identity;
- request sharing across independently created consumers;
- active versus application-retained cache scopes;
- stale-time or garbage-collection policy;
- response parsing and Standard Schema validation;
- structured HTTP errors;
- retry/backoff policy;
- normalized entity storage; or
- persistent/offline cache storage.

An application can build these capabilities under an async computation, or
adopt a query library. They should not be attributed to Solid's reactive core.

## 14. Comparison facts relevant to Memoized DOM

The current Memoized DOM data package already implements request identity,
request sharing, scoped cache retention, abort behavior, response validation,
stale-result protection, and optimistic collection changes.

Its missing connection is reactive integration:

- resource and action objects expose snapshot subscriptions internally;
- compiled reads of their getters are currently treated as opaque external
  state;
- their owning component is reevaluated through the volatile animation-frame
  fallback;
- request arguments are captured when `$fetch` is created; and
- component-local ownership is currently expressed through explicit cleanup.

These are implementation facts, not a conclusion that Memoized DOM should use
Solid's API shape.

## 15. Design questions carried into the DX discussion

The research leaves the following questions open for Memoized DOM:

1. How should an ahead-of-time compiler represent an unresolved data read
   without copying Solid's accessor and boundary vocabulary?
2. Can initial readiness be expressed naturally through Memoized DOM's JSX
   directives and regions?
3. Can the compiler prove where a non-null async value is safe to read and
   produce stronger diagnostics than a runtime-tracked framework?
4. How should transport activity differ from a semantic answer change?
5. Should reactive request arguments remain ordinary expressions, become an
   explicit factory, or use a compiler directive?
6. How should resource ownership follow component, conditional-region, and
   keyed-row lifetimes?
7. Can normal `async`/`await` actions retain optimistic transaction context
   through compiler transformation, avoiding generator syntax?
8. How should data reads compose with the recently added `if`, `else-if`, and
   `else` directives?
9. Which parts of the internal async-source protocol should be generic enough
   for non-fetch data producers?
10. What SSR contract must exist before data serialization and hydration are
    implemented?

No answer in this section is predetermined by Solid's design.

## 16. Primary sources

- Solid 2.0 RC announcement and release notes:
  <https://github.com/solidjs/solid/releases/tag/v2.0.0-rc.0>
- Solid 2.0 async data RFC:
  <https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/05-async-data.md>
- Solid 2.0 actions and optimistic updates RFC:
  <https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/06-actions-optimistic.md>
- Solid 2.0 control-flow RFC (`Loading`, `Errored`, and `Reveal`):
  <https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/03-control-flow.md>
- Solid 2.0 ownership RFC:
  <https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/02-signals-derived-ownership.md>
- Current Solid async graph implementation:
  <https://github.com/solidjs/solid/blob/next/packages/solid-signals/src/core/async.ts>
- Current Solid action implementation:
  <https://github.com/solidjs/solid/blob/next/packages/solid-signals/src/core/action.ts>
- Ryan Carniato, "Async Derivations in Reactivity":
  <https://dev.to/this-is-learning/async-derivations-in-reactivity-ec5>

The RC announcement says a separate "reads, writes, and the wire" deep-dive
series will follow. No official installment from that series was located by
the research date above; this document therefore relies on the RC, RFCs,
implementation, and the earlier async-derivations article.
