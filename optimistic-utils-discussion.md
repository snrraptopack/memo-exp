# Optimistic utility: direct and form usage

Status: `optimistic` is implemented in `@memoized-dom/utils`. This document
shows direct and form usage; `$forms`, `$read`, and `$track` are existing data
APIs.

## One operation, one function

Assume `story` is reactive application state, `saveVote` sends a vote to the
server, and `VoteSchema` is a Standard Schema (for example, a Zod schema) that
validates a form field named `direction` as `'up' | 'down'`.

```tsx
import { optimistic } from '@memoized-dom/utils';

type VoteInput = { direction: 'up' | 'down' };
let voteError = '';

const submitVote = optimistic({
  action: (input: VoteInput) => saveVote(story.id, input.direction),
  apply(input) {
    const change = input.direction === 'up' ? 1 : -1;
    story.votes += change;
    return (error) => {
      story.votes -= change;
      voteError = error.message;
    };
  },
});
```

`saveVote` can return a trackable value from a server function or `$fetch`, or
an ordinary promise. `submitVote` returns the **same result** as `action`; it
does not turn a trackable value into a promise. For each call, `apply` runs
immediately and returns the undo function for **that call**. A successful
request leaves the local change in place or passes the saved value to
`reconcile` if provided. A failed request calls that undo
function with the request error. A caller that only needs to reverse state can
still write `return () => { story.votes -= change; }`. `apply` can optionally
receive that call's operation ID as its second argument when a temporary item
needs an ID.

The TypeScript contract preserves the exact return type of `action`:

```ts
import type { FetchResource, RequestError, ResolvedValue } from '@memoized-dom/data';

type OperationResult = PromiseLike<unknown> | FetchResource<unknown> | ResolvedValue<unknown>;
type SettledResult<R> =
  R extends PromiseLike<infer T> ? Awaited<T> :
  R extends FetchResource<infer T> ? T :
  R extends ResolvedValue<infer T> ? T :
  never;

interface OptimisticOptions<P, R extends OperationResult> {
  action: (payload: P) => R;
  apply: (payload: P, operationId: string) => (error: RequestError) => void;
  reconcile?: (saved: SettledResult<R>, payload: P, operationId: string) => void;
}

function optimistic<P, R extends OperationResult>(
  options: OptimisticOptions<P, R>,
): (payload: P) => R;
```

Synchronous values are not requests and are rejected. The `error` parameter
is available to the undo function but need not be
declared by the caller. For a rejected plain promise, the runtime's
`RequestError` retains the original rejection in `cause`.

There is no `target` option: `apply` can close over `story`, or the payload can
identify which target to update. `reconcile` is optional; counters that need no
server reconciliation can omit it.

## Replacing a temporary row with the server's row

The same operation ID identifies the draft on success or failure. The returned
server value is passed to `reconcile`; no list refetch is needed.

```tsx
const sendMessage = optimistic({
  action: (fields: { message: string }) => saveMessage(fields.message),
  apply(fields, id) {
    messages.push({ id, text: fields.message, pending: true });
    return () => {
      const index = messages.findIndex(message => message.id === id);
      if (index !== -1) messages.splice(index, 1);
    };
  },
  reconcile(saved, _fields, id) {
    const index = messages.findIndex(message => message.id === id);
    if (index !== -1) messages.splice(index, 1, saved);
  },
});

function MessageControls() {
  const form = $forms({ schema: MessageSchema, action: sendMessage });
  return <>
    <button onClick={() => sendMessage({ message: 'Hello' })}>Quick send</button>
    <form onSubmit={form.submit}>
      <input name="message" />
      <button type="submit">Send</button>
      {form.pending && <span>Sending...</span>}
    </form>
  </>;
}
```

`reconcile` receives the resolved payload whether `saveMessage` returned a
promise or a trackable `$fetch`/server-function value. Failed calls run only
their own rollback. Other pending drafts remain in the list.

## Without a form

Call the returned function from any event handler. The undo callback can show
the failure without assuming that `action` returned an awaitable promise.

```tsx
function VoteButton() {
  return <section>
    <span>{story.votes} votes</span>
    <button onClick={() => {
      voteError = '';
      submitVote({ direction: 'up' });
    }}>Upvote</button>
    {voteError && <p role="alert">{voteError}</p>}
  </section>;
}
```

## With a form

Pass **the same `submitVote` function** to `$forms` as its action. The form
validates `FormData`, supplies typed fields, and owns `pending`, `errors`, and
`result`. The utility owns the immediate vote and its rollback.

```tsx
import { $forms } from '@memoized-dom/data';

function VoteForm() {
  const form = $forms({ schema: VoteSchema, action: submitVote });

  return <section>
    <span>{story.votes} votes</span>
    <form onSubmit={form.submit}>
      <button type="submit" name="direction" value="up">Upvote</button>
      <button type="submit" name="direction" value="down">Downvote</button>
      {form.pending && <span>Saving...</span>}
      {form.errors[0] && <p role="alert">{form.errors[0].message}</p>}
    </form>
  </section>;
}
```

The submit button contributes `direction` to `FormData`. If validation fails,
`$forms` never calls `submitVote`, so no optimistic change is applied. On a valid
submission, `$forms` calls `submitVote(fields)` once. The utility calls
`saveVote` once, applies the local change, and returns that *same result* to
the form. `$forms` already settles a returned trackable source as well as a
promise; it owns `pending` and `errors`, while the utility observes the same
operation for rollback. Two observers do not mean two server requests. The
buttons remain enabled here to allow overlapping submissions; `form.pending`
stays true while any submission is active. The form reports a failed action as
an error with `kind: 'submit'`; its schema errors have `kind: 'parse'`.

## Tracking and limits

Each invocation needs its own trackable operation. If `action` returns a
server-function or `$fetch` source, the utility uses `$track(result)` directly.
If it returns a plain promise, the utility creates a source with `$read(result)`
and tracks that. `$track` still never accepts a bare promise. Source detection
must use the runtime's source identity, not guess from `.then` or from the
resolved payload's shape. The utility must attach the callbacks to the ID of
this invocation, so overlapping requests settle independently. Returning a
shared source without starting a new operation would not meet that contract.

The utility releases its one-shot `$read` source after a plain promise settles.
It does not offer refresh for write operations. `$forms` can settle a returned
source, and its types expose the settled payload as `form.result`.

The inverse vote update above remains correct when several votes settle in
different orders: each failure reverses only its own `+1` or `-1`. A generic
undo function cannot safely restore an old snapshot of a field after a newer
edit to that same field. That case needs operation-specific guarding or a later
rebase-oriented helper.
