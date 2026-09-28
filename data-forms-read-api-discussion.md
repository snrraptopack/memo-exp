# `$read`, `$forms`, and lifecycle-only `$track`: closed discussion

Status: closed. The agreed core API was implemented on `main` in `81450ce`.
Written on `main`, starting at `e68e848`, on 2026-09-27.

This is the design record, not the current API reference. Sections marked
**proposal** preserve alternatives considered during discussion; they do not
override the implemented contract. Current usage is in [the data guide](docs/05-data.md)
and [the package README](packages/data/README.md). Later extensions, if any,
will be separate work rather than an unresolved part of this discussion.

## 1. Purpose and agreed direction

This document defines proposed native MMD data and form APIs. It distinguishes
decisions made in the discussion from details that still need a contract.

The following directions are agreed:

1. Add `$read` to accept a promise and expose its resolved result as a transparent
   value. Its values behave like `$fetch` values.
2. Remove ordinary promise inputs from `$track`. A promise enters the transparent
   source system through `$read`, rather than through `$track`.
3. Remove `.value` from trackers. Payload access belongs to the transparent value;
   tracking supplies lifecycle observation and applicable controls.
4. Add a native `$forms` API whose returned form source is trackable through
   `$track(form)`. The form also exposes its own `pending`, so ordinary submission
   UI does not require creating a tracker. Optimistic updates use the tracker
   for the form source, not an assumed source returned by the action callback.
5. Ship no optimistic-update API. Users implement optimistic writes, confirmation,
   reconciliation, and rollback using ordinary application data and lifecycle
   callbacks.
6. `$read` sources must be replayable through `$track(source).refresh()`. The
   compiler retains the promise creation expression, including when `$read`
   receives a separately declared promise binding. Users do not need to inline
   the expression or wrap it in an arrow function to enable refresh.
7. Schema forms need one `errors` collection with `kind: 'parse' | 'submit'` and
   compatibility with Zod and other Standard Schema validators. Overlapping
   submissions must retain independent execution
   IDs and callbacks so optimistic writes can settle independently.
8. Remove `$action` and the shipped optimistic collection helpers. Application
   code owns optimistic writes and rollback through `$track` callbacks.

The earlier suggestion that `$track` continue accepting bare promises is withdrawn.
The suggestions to make forms untrackable, track an unknown `saveMessage` return
value, or require authored factories for `$read` refresh are withdrawn. Form
trackability, direct form `pending`, and replay of direct/bound promise creation
are now agreed directions. Other form details remain proposals.

## 2. Existing implementation versus intended changes

The current `main` branch has a public `$fetch` typed as `ResolvedValue<T>`.
Internally it carries a fetch resource; the compiler turns authored payload reads
into readiness-aware reads and subscriptions. The payload itself is not a proxy
that can synchronously resolve a promise.

Before this change, `$track` accepted both transparent values and
`PromiseLike<T>`. Its separate promise tracker exposed `.value` and did not
participate in compiler-managed transparent reads. The implementation now routes
promise observation through `$read` and removes bare-promise tracking.

The previous types and resource code contained `OptimisticChange`, collection
helpers, and `optimistic.ts`. They are removed with `$action`; ordinary source
writes and per-execution callbacks remain available for application code.

Relevant implementation entry points:

- [Public exports](packages/data/src/index.ts)
- [Public types](packages/data/src/types.ts)
- [Transparent reads and tracking](packages/data/src/transparent.ts)
- [Data runtime ownership and settling](packages/data/src/client.ts)
- [Fetch resources](packages/data/src/resource.ts)
- [Form controller](packages/data/src/forms.ts)
- [Promise read controller](packages/data/src/read-resource.ts)
- [Compiler source definitions](packages/compiler/src/context/model.ts)
- [Compiler source discovery](packages/compiler/src/features/data-sources/discovery.ts)
- [Compiler read rewriting](packages/compiler/src/features/data-sources/read-rewriting.ts)
- [Compiler derivation rebinding](packages/compiler/src/analysis/instance.ts)
- [Data authoring guide](docs/05-data.md)
- [Group and suspension guide](docs/06-group.md)

## 3. `$read`: the value contract

**Agreed direction:** authored reads behave like `$fetch` payload reads.

```tsx
const user = $read(loadUser(id));
const request = $track(user);
const label = user.name.toUpperCase();

return <p>{label}</p>;
```

Candidate type:

```ts
function $read<T>(promise: PromiseLike<T>): ResolvedValue<Awaited<T>>;
```

`Awaited<T>` describes the actual promise fulfillment result, including nested
thenables. The returned authored value has the payload's type and retains
compiler-visible source provenance. It does not expose `.data`, `.then`, or a
request-state wrapper.

The behavior required by “like `$fetch`” is concrete:

- A pending render read is unavailable; it does not evaluate `user.name` against
  an invented empty object.
- Derivations depending on the value run when their prerequisites are ready and
  replay when the source binding receives a new committed result.
- Resolution invalidates only the compiled consumers of that source.
- `Group` supplies pending/error presentation at consuming sites.
- `suspend` includes consumed `$read` sources in the same readiness mechanism as
  consumed fetch sources. An unused promise source does not block a subtree.
- An imperative read before availability throws the existing unresolved-read
  error contract. `$read` does not turn arbitrary JavaScript into synchronous
  promise execution; an imperative sequence needing the result still awaits
  work or runs in a success callback.
- A successful `undefined` or `null` result is distinguishable internally from
  “not resolved.” Readiness must depend on status, not payload truthiness.
- The resolved payload remains ordinary data. Direct writes must notify compiled
  consumers through the same mutation machinery used for fetch payloads.

### Promise identity and reactivity

**Proposal:** wrapping the same promise within one data-runtime boundary shares
one underlying execution record. Repeated reads do not execute work again.
Application-runtime ownership and listener ownership are distinct: removing one
consumer must not invalidate another consumer of the same promise.

For `const user = $read(loadUser(id))`, changing reactive `id` reruns the
declaration's expression and attach a new promise to the stable source binding,
as fetch-input derivations do today. Changing `id` does not itself mutate or
restart the old promise. The latest binding receives the latest result; an older
fulfillment must not overwrite it. Retained callbacks for older executions must
still observe their own outcomes.

Replay and request-local ownership both require retaining source provenance.
The compiler must follow promise bindings rather than treating every supplied
promise as an opaque terminal value. Materialization on the server must happen
inside the owning request runtime; shared observation alone is not request isolation.

### Retry, cancellation, errors, and SSR

**Agreed direction: both of these authored forms must support refresh:**

```ts
// Direct creation expression.
const user = $read(loadUser(id));
const request = $track(user);
request.refresh();
```

```ts
// Creation expression reached through a binding.
const promise = loadUser(id);
const user = $read(promise);
const request = $track(user);
request.refresh();
```

In the direct form, the compiler retains `loadUser(id)`. In the bound form,
it follows `promise` to its initializer and retains the same creation expression.
Refresh executes that expression again, observes a fresh promise, assigns a new
execution ID, and commits the outcome through the stable `user` source. It must
not merely await the previously settled promise again.

An internal generated closure may be equivalent to `() => loadUser(id)`, but
that is compiler machinery. The authored API remains `$read(promise)`; an arrow
function is not required from the user. Binding indirection must not disable retry.

**Proposal:** refresh evaluates the current reactive inputs, including the current
`id`. It is an explicit replay even when those inputs have not changed. This is
distinct from automatic replay when an input changes. Both use the same creation
provenance and stable binding, and both need stale-outcome protection.

For aliases, reassigned bindings, imported promise bindings, helper returns, and
event-created sources, analysis must establish which creation operation belongs
to the source and its owner. The direct and locally bound examples above are
required supported forms, not optional factory-only cases. The full supported
provenance shapes and diagnostics remain implementation work. If creation
provenance genuinely cannot be established, define a precise diagnostic; do not
silently implement refresh by returning the old promise.

Whether replay also replaces other authored consumers of the original `promise`
binding is a separate alias-ownership decision. The required behavior is that the
tracked `$read` source gets a fresh execution; it does not require changing the
meaning of unrelated JavaScript references to an already-created promise.

The runtime distinction still matters internally: promises themselves do not
restart. The compiler-retained creation operation creates new work. That
distinction does not impose extra factory syntax on the author.

Likewise, detaching a consumer is not cancellation. An explicit signal can be
passed to the operation that creates the promise, but `$read` cannot add signal
support to arbitrary work retroactively.

Promise failures need a provider-neutral error representation. The existing
`toRequestError` categorizes unknown errors as network failures; that is unsuitable
for every database, worker, parser, or application promise. Preserve the cause
and define its presentation category without pretending every failure is HTTP.

SSR must include active `$read` work in readiness/settling. A bare promise has
no URL-based transfer identity. **Proposal:** no automatic hydration payload
transfer for arbitrary promises in the first version. Any transfer extension
needs a stable identity, serialization policy, and request-isolation contract.
This does not remove SSR rendering support; it means client work may execute
again rather than adopt an unidentified server result.

## 4. `$track`: source observation without payload access

**Agreed direction:** these are intended authored forms:

```ts
const user = $read(loadUser());
const request = $track(user);

request.onSuccess((resolvedUser, executionId) => {
  console.log(resolvedUser.name, executionId);
});

// No longer supported:
$track(loadUser());
request.value;
```

Callbacks receiving a successful result do not violate the value/state split.
The callback is notification of one execution's outcome; it is not a second
reactive payload store.

Preserve the useful existing fields: `id`, `status`, `pending`, `refreshing`,
`error`, `onSuccess`, and `onError`. Control methods need source-specific meaning:

| Input | `refresh` | `abort` |
|---|---|---|
| Fetch source | Start another fetch execution | Cancel the represented cancellable execution |
| `$read` source | Replay compiler-retained creation operation, including bound promise initializers | Requires cancellation support from the underlying operation |
| Form source | Replay/resubmission policy still open | Only meaningful with explicit action cancellation support |

**Proposal:** expose control capabilities in source-specific tracker types,
rather than supply misleading universal no-op methods. Keeping one uniform
tracker with capability flags is an alternative; choose this before implementation.

`id` remains execution identity. It must not become a form's permanent identity
or an aggregate identity for unrelated overlapping operations. A tracker attached
to a stable binding can follow its current execution, while a callback registered
for an execution remains tied to that execution.

## 5. `$forms` returns a trackable form source with its own `pending`

**Agreed direction: yes, an operation source.** A form has an idle phase, creates
executions when submitted, and can publish a successful result. That is enough
to participate in tracking without treating the form controller as its payload.

The same returned form source exposes `form.pending` directly. For basic UI,
authors read that property without going through `$track`. When they need
execution IDs or outcome callbacks for optimistic changes, they use `$track(form)`.
These are two views of the same submissions, not two independent lifecycles.

There are two source identities to distinguish:

1. The form operation source, whose current submission `$track(form)` observes.
2. Its result source, `form.result`, whose payload is read transparently.

The result source is a projection of the same form controller, not a second
execution. Reading it never invokes the action. It carries compiler provenance
so normal Group, derivation, mutation, and readiness rules apply.

Candidate authoring shape:

```tsx
const form = $forms(async (fields: FormData) => {
  return saveMessage(fields);
});

return (
  <form onSubmit={form.submit}>
    <input name="message" required />
    <button disabled={form.pending}>
      {form.pending ? 'Sending…' : 'Send'}
    </button>
    {form.hasResult ? <p>{form.result.message}</p> : null}
  </form>
);
```

Form-source recognition in `$track` is required by the agreed direction. It does
not already exist in the current `ResolvedValue<T>` overload. The callback's
return is observed by `$forms`; no example may assume `saveMessage` returns a
trackable source. It might return an ordinary promise, a plain value, or an
existing transparent source. Accepted callback return types need definition,
but form trackability does not depend on those types.

### Candidate controller surface

```ts
interface FormSource<TResult> {
  readonly pending: boolean;
  readonly errors: readonly FormError[];
  readonly result: ResolvedValue<TResult>;
  readonly hasResult: boolean;
  submit(event: SubmitEvent): void;
}
```

This sketch omits internal brands and precise event current-target types.
`submit` is a stable function usable as a DOM handler. A programmatic
`dispatch(FormData)` returning a retained execution source is a separate proposed
extension; do not overload an event handler to also mean arbitrary action dispatch.

`hasResult` means a result has committed, including a successful `undefined`
result. It starts false unless an initial result was provided. Reading an idle
form result must not submit anything. An unguarded unavailable result produces
an empty read site; an idle form must not show an endless “Loading” skeleton
before the user has attempted submission. This idle policy differs from a
pending fetch and needs explicit Group support or a requirement to guard reads.

An initial result option is useful for editing an existing record. The exact
overload is open. It supplies a payload without manufacturing a successful
submission or firing submission callbacks.

### Native submission steps

**Proposal:** the DOM handler follows this sequence:

1. Native constraint validation occurs through normal browser submission.
2. On an accepted submit event, synchronously prevent default navigation.
3. Apply the form's overlap policy before dispatching additional work.
4. Capture the form and submitter immediately, then construct its `FormData`.
   Preserve submitter name/value, repeated entries, and files. Do not defer
   reading the event's `currentTarget` until after an `await`.
5. Allocate an execution ID and enter pending, including asynchronous parsing.
6. Parse/validate if configured. Do not call the action on validation failure.
7. Invoke the action exactly once and observe its returned work.
8. Publish its result or failure, notify registered outcome callbacks once,
   and release execution listeners according to ownership.

The handler must be bound to its intended form. Reusing one controller across
two mounted form elements needs a separate contract; **proposal:** one controller
per component instance/form owner for the first version.

## 6. Raw fields, optional schema, and one error collection

The basic form passes native `FormData` to the action. `$forms` does not need to
invent field conversions, optionality rules, or controlled input state:

```ts
const form = $forms((fields: FormData) => saveMessage(fields));
```

If the author supplies a Zod or other Standard Schema validator, the action
receives its validated output type:

```tsx
const form = $forms({
  schema: MessageFieldsSchema,
  action: fields => saveMessage(fields.message, fields.attachment),
});

return (
  <form onSubmit={form.submit}>
    <input name="message" />
    {form.errors
      .filter(error => error.kind === 'parse' && error.path?.[0] === 'message')
      .map(error => <p>{error.message}</p>)}
    <button disabled={form.pending}>Send</button>
    {form.errors
      .filter(error => error.kind === 'submit')
      .map(error => <p>{error.message}</p>)}
  </form>
);
```

The single `form.errors` collection has this proposed discriminated shape:

```ts
type FormError =
  | { kind: 'parse'; message: string; path?: readonly PropertyKey[] }
  | { kind: 'submit'; message: string; cause?: unknown };
```

`parse` means the supplied schema rejected submitted data; its issue path can
identify a field. `submit` means the action failed. There is no separate
`errors.fields` or `errors.submit` object, and no second `parse` API. Without a
schema, the action gets native `FormData`; `$forms` does not reinterpret fields.

Schema compatibility requires defining what value a schema receives from
`FormData`. That conversion should be minimal and documented when implemented.
The form API should not prescribe blanket number, checkbox, empty-file, or
optional-text rules. The schema decides validation and transformation; the
user does not need those rules to use a basic form.

## 7. Submission lifecycle, errors, and previous results

**Agreed direction:** the form exposes its own `pending`, and `$track(form)`
observes its submission executions. **Proposal:** use the following state table.
Form `pending` means at least one submission is active even when a previous
result exists. It is not fetch's “cold load only” definition.

| Event | Current tracker status | `form.pending` | `hasResult` | Result |
|---|---|---|---|---|
| Creation without initial result | idle | false | false | unavailable |
| Creation with initial result | idle | false | true | initial payload |
| Submission accepted | pending | true | unchanged | previous result retained |
| Parsing rejects fields | error for that execution | true if another is active | unchanged | previous result retained |
| Action succeeds | success for that execution | true if another is active | true if it commits | committed result retained |
| Action rejects | error for that execution | true if another is active | unchanged | previous result retained |

`refreshing` can remain false for forms: an explicit submission is not a background
fetch revalidation. The direct `pending` property is agreed. With overlapping
submissions, `$track(form).id` refers to the newest accepted execution while
`form.pending` aggregates all active executions. A callback registered for one
execution is pinned to its ID and does not switch to a newer execution. The
track's own `pending` needs an exact current-versus-aggregate meaning.

**Agreed direction:** one `form.errors` collection contains `parse` errors from
schema validation and `submit` errors from the action. Each error belongs to an
execution ID internally; displayed errors follow the newest accepted submission,
so an older failure cannot replace the newer submission's UI. Registered
`onError` callbacks for the older execution still run. Action failures preserve
their cause; expected domain failures may instead be returned as a discriminated
result and are then successful executions.

Field issues belong to the submitted snapshot. **Proposal:** clear displayed
issues on the next accepted submission or explicit clearing, not automatically
on typing. Older validation results cannot repopulate them for a newer submission.
Automatic clearing requires a live input-observation contract that has not been
requested or defined.

Group around `form.result` must not hide a valid previous result on a later failed
submission. The submission error is available in `form.errors` while the
previous payload remains available. Before any result exists, an attempted and
failed result read can use Group error presentation. This requires separating
payload readiness from the latest operation outcome internally.

## 8. Reset, retry, cancellation, and overlap

### Reset

**Proposal:** no automatic input reset. Users choose when to reset the actual
DOM form, including after success. Resetting controls is distinct from clearing
the last result, tracker state, or application data. Native `HTMLFormElement.reset()`
restores default values; controlled values need explicit application writes.

A future `form.reset()` needs a precise owner/ref binding and must say whether it
only resets controls. Until that is defined, a captured native form reference is
the unambiguous mechanism. The earlier reset-method suggestion was not a complete
contract.

### Retry

**Proposal:** another submit reads the controls again and creates a new execution.
Do not expose mutation replay as generic tracker `refresh()`. Retrying an identical
submission snapshot is a distinct operation and may duplicate a server mutation.
If supported, name it explicitly and specify its idempotency requirements.

### Cancellation

An optional action context could carry `signal` and `id`. This is a proposal,
not an accepted second callback parameter. Aborting would signal cooperative
work; it cannot undo an already-committed server write. Owner disposal detaches
DOM consumers, but must not discard registered execution callbacks before they
can perform application-owned cleanup. Fetch cancellation and arbitrary promise
observation must remain distinguishable.

### Overlapping submissions

The optimistic example requires each invocation to have an independent outcome.
**Proposal:** accept overlapping submissions by default. Each accepted submit
captures its own FormData, allocates its own ID before invoking the action, and
starts its own lifecycle. The form source remains one stable object.

For two submissions A then B:

1. A receives ID `a`. Inside A's action, `$track(form).id === a`; callbacks
   registered there are pinned to A. `form.pending` becomes true.
2. B receives ID `b`. Inside B's action, `$track(form).id === b`; callbacks
   registered there are pinned to B. Both operations remain active.
3. If B succeeds first, B's success callback fires with `b`. `form.pending`
   stays true while A is active. If A then fails, A's error callback fires with
   `a` and rolls back only A's optimistic write. Pending then becomes false.
4. Reverse completion order has the same per-ID callback behavior. A newer
   submission never discards an older submission's registered callbacks.

**Proposal:** `form.pending` is `activeCount > 0`; do not set it false when
only one of several active submissions finishes. Displayed `form.errors` and
`form.result` follow the newest accepted submission, so a late older result
cannot replace newer result or error UI. Every per-ID callback still runs,
allowing application state to reconcile each operation separately. The latest
result display policy remains open if a different rule is desired.

Disabling a button using `form.pending` is an application choice to suppress
rapid submits. The form source does not silently impose that policy.

## 9. Optimistic application code remains user-owned

MMD supplies writes and lifecycle notifications. It does not supply temporary
overlay state, automatic rollback, commit patches, or a `useOptimistic` equivalent.

**Agreed direction:** optimistic updates use ordinary application writes and
`$track(form)` outcome callbacks. The tracked object is the source returned by
`$forms`, not an unknown result returned from `saveMessage` or another helper.
The form's own `pending` remains available for UI independently of that tracker.

The following illustrates the proposed callback-registration timing, using an
additive change to keep the rollback operation explicit:

```tsx
const form = $forms((fields: FormData) => {
  const request = $track(form);
  const executionId = request.id;

  pendingVotes.add(executionId);
  story.votes++;

  request.onSuccess((_result, id) => pendingVotes.delete(id));
  request.onError((_error, id) => {
    if (pendingVotes.delete(id)) story.votes--;
  });

  return saveVote(story.id, fields);
});
```

Here `story` and `pendingVotes` are ordinary application state. `saveVote` does
not need to be trackable: `$forms` observes its return and reports the outcome
through the form source. There is no manual `await`/`try`/`catch` rollback layer
in this pattern, and no automatic optimistic behavior in the framework.

For this proposed shape to work, the form allocates the submission ID and marks
it pending before invoking the action. Calling `$track(form)` inside that action
then observes that exact submission, and callbacks remain tied to its ID. The
action is invoked on submission, after controller initialization, not during
the `$forms` declaration. These timing rules need explicit validation; they must
not be assumed from the existing fetch tracker implementation.

With multiple invocations, `request.id` in each action is different.
`pendingVotes` holds one entry per ID; one failure deletes and reverses only
its own increment. The form callback registry cannot use the existing fetch
tracker behavior that stops observing when the source ID changes. It must retain
each registered callback until that execution settles or the callback is disposed.

Registration before the first submission is a separate open question: does it
observe the next submission or subscribe persistently to all submissions? Existing
one-shot execution callbacks must not silently become permanent subscriptions.

An application should retain the smallest inverse change per execution rather
than restore a whole-state snapshot that could overwrite successful changes from
another operation. Tracker callbacks provide lifecycle evidence; the application
decides the write and its inverse.

The same distinction applies to form result state: a returned result commits to
the result source, while application writes remain ordinary writes. `$forms` must
not implicitly merge its result into some unrelated application collection.

## 10. Historical implementation checklist

1. Remove promise-input overloads and `.value` from public/internal tracking, docs,
   type fixtures, and tests. Preserve result-bearing success callbacks.
2. Define a common source observation protocol: snapshot, subscription, execution
   identity, payload availability, ownership, and optional control capabilities.
   It can be an internal abstraction; no public wrapper is required.
3. Implement promise observation for `$read` through that protocol, including
   rejection handling, shared observation, rebinding, and stale-outcome protection.
   Retain replay provenance for direct creation expressions and expressions reached
   through promise bindings; `$track(readSource).refresh()` creates fresh work.
4. Extend compiler source metadata to recognize more than one source constructor
   from the data module. Current discovery maps one definition per module and
   direct-provider rebinding assumes fetch target/options arguments. Adding a
   second definition with `$read` would not by itself solve these assumptions.
5. Extend local/module source discovery, imported factory provenance, event-created
   source handling, mutation notification, derivations, Group, atomic preparation,
   and cleanup to the new source kinds.
6. Add the form operation controller, native submit capture, optional schema
   validation, one kind-tagged error collection, direct `pending`, result
   projection, trackability, and overlapping execution ownership. Allocate identity
   before the action and retain per-ID callbacks across later submissions.
7. Define tracker capabilities for promise and form sources. Avoid accidentally
   inheriting fetch-specific behavior. `$read` refresh uses compiler-retained replay;
   cancellation remains dependent on underlying operation support. Form tracking
   needs per-execution callback retention rather than fetch-style stop-on-new-ID.
8. Integrate SSR settling and request ownership; defer unidentified promise/form
   result hydration transfer unless its identity and serialization rules are defined.
9. Remove the shipped optimistic surface and `$action`; use `$fetch` for HTTP
   mutations or `$forms` for native form submissions.

Meaningful acceptance checks include delayed and rejected promise reads, null/void
fulfillment, derived values, Group and suspend behavior, cross-file sources,
source rebinding races, listener cleanup, SSR isolation, typed-field inference,
direct and bound promise creation refresh producing new work, current-input replay,
submitter and repeated-field capture, Zod/Standard Schema inference, field-error
mapping, async validation, direct form pending, overlapping form tracking
callbacks tied to submission IDs, pending-count behavior, previous
result preservation, and compile-time rejection of `$track(promise)`/tracker `.value`.

## 11. Final contract and possible later extensions

The implementation settles the core choices:

- `$read(promise)` has transparent `$fetch`-style reads. The compiler retains
  direct or bound promise creation for refresh with current reactive inputs.
- `$track` accepts sources, not bare promises, and exposes no `.value`.
- `$forms` accepts a raw `FormData` action or `{ schema, action }`, and its
  `submit` accepts a browser submit event or `FormData` on the server.
- The form exposes aggregate `pending`, `hasResult`, `result`, and one
  `errors` array with `parse` or `submit` entries. The newest accepted
  submission owns the displayed result and errors.
- `$track(form)` supplies the current execution ID and outcome callbacks.
  Callbacks stay pinned to their execution across overlapping submissions.
  It does not expose fetch-like `refresh` or `abort`.
- `$action` and the bundled optimistic collection helpers are removed.
  Application code performs optimistic writes and per-execution reconciliation.

Possible later work includes initial form results, explicit cancellation,
broader promise provenance diagnostics, and transfer of promise results through
hydration. None is required to use the implemented API.
