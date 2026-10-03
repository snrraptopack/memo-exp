# @memoized-dom/utils

This project does not support legacy APIs. All packages and consumers must use the current APIs. Do not add compatibility shims, deprecated aliases, or fallback paths for superseded APIs.

Optional helpers for Memoized DOM applications.

```tsx
import { optimistic } from '@memoized-dom/utils';

const vote = optimistic({
  action: (direction: 'up' | 'down') => saveVote(story.id, direction),
  apply(direction) {
    const change = direction === 'up' ? 1 : -1;
    story.votes += change;
    return error => {
      story.votes -= change;
      voteError = error.message;
    };
  },
});
```

`action` starts a fresh operation and returns an MMD trackable source or a
promise. `vote` returns that same result. The `apply` callback runs immediately
and receives the operation ID as an optional second parameter. Its rollback
function runs only if that operation fails; it may ignore the error parameter.
Each overlapping call has its own rollback. Plain promises are wrapped in a
temporary `$read` source, while `$fetch` and server-function results are
tracked directly. An optional `reconcile(saved, payload, id)` callback replaces
temporary data with the server's returned data without refetching.

The returned function can be called directly from an event handler or passed
as a `$forms` action. `$forms` owns validation and submission state; this
utility owns the optimistic change and rollback.
