# @memoized-dom/runtime

Dependency-free registry, scheduling, optional dirty-reason batching, access
routing, keyed regions, props boxes, cleanup/ref ownership, and DOM value helpers
for memoized-dom compiler output.

Application source does not need to import reactive primitives. The ordinary
browser entry imports only the mounting boundary:

```ts
import { mount } from '@memoized-dom/runtime';
import { App } from './App';

mount('root', App);
```

Generated modules import this package as one namespace:

```js
import * as MD from '@memoized-dom/runtime';
```

`mount()` resolves string targets with `document.getElementById()`, owns only
the nodes produced by the compiled root, returns an idempotent `unmount()`
handle, and keeps the compiler's private factory ABI out of authored code.
Pass `{ onHydrateError(error) { /* log mismatch */ } }` as a third argument
to observe a hydration mismatch before `mount()` replaces server markup with
a fresh client render.

## Dirty reasons and opaque pulls

`reasonsHit()` treats a full update and opaque pull as wildcards by default.
Compiler-proven primitive slots can pass `false` as its third argument to ignore
only the pull cause. Actual causes in mixed batches still match, and full updates
still open every gate. Existing two-argument generated calls retain their behavior.

A failed ordinary render retains a full dirty mark for the next commit. This
prevents a subsequent pull or partial write from skipping slots that the failed
render never reached. Independent render entities and their cascades finish
before the error is reported. The failed entity and its descendants wait for a
later commit; effects wait for coherent render completion. One render error is
re-thrown unchanged, multiple independent errors are aggregated. The runtime
does not schedule an immediate retry or roll back completed writes. Failed
effects keep their existing behavior; unregistered or replaced entities are not
revived. A stale batch entry cannot render a replacement with the same ID.

A synchronous render error during an opaque pull still schedules the next
browser frame. The original error propagates, and recovery uses the retained
full dirty mark. Removing the last volatile owner or disposing its application
during the failed render prevents rearming; no immediate retry is added.

## Keyed list ownership

List sources must be arrays. A non-array payload raises a diagnostic naming the
list before changing its buffers or ownership. This preserves existing rows and
allows a later valid source to recover. TypeScript type arguments do not validate
network payloads: an API response containing `photos` must be read as
`result.photos`, not as the whole response array.

`reconcile()` accepts an optional fourth `fixedPositions` argument for compiler
proofs of unchanged item identities, positions and keys. A committed region with
the same length can skip identity/key validation while still synchronizing all
retained content in forward order. Existing callers keep ordinary validation.
Initial mounting, hydration, length mismatches and interrupted general frames
use the normal path. This is a trusted compiler contract, not a runtime inference
from an unchanged array reference.

General reconciliation keeps retained keys in the region's existing Map. A
private frame marker detects duplicates and preserves consumed-key visibility
for in-frame `refreshKey()` and `size()` calls. Key evaluation, row updates and
cleanup hooks retain their forward ordering. Removed keys remain available to
cleanup hooks until the general removal pass finishes; placement follows cleanup.
Ordered row records preserve lifecycle order after reorders.

When the forward pass has consumed every old key, reconciliation skips the
removal scan. Reorders and insertion/reorders still evaluate authored keys and
refresh retained content normally. Any missing old key keeps the cleanup pass.
When surviving old positions are increasing, every retained row is already in
the longest increasing subsequence. Mixed insertion/removal frames skip the LIS
calculation and place only new rows. Actual reorders keep normal LIS analysis.

Rows with empty node extents still own keys and lifecycle callbacks. During
placement they do not become insertion boundaries or split pending DOM runs.
The next actual retained node, or the list's closing anchor, bounds insertion.
This keeps visible rows inside the region when empty and visible rows reorder.

Fresh rows are staged separately until commit. Fresh mounts and complete
replacements adopt the staged Map directly. Interrupted frames remain disposable,
including when a retained prop update or render throws before its ordered record
is stored. This preserves ownership; reconciliation is not transactional and
does not roll back authored effects or completed DOM writes after an exception.

## Entity teardown

`unregisterSubtree()` removes the registered subtree before running cleanup hooks,
with descendants disposed before their owners. Entities without child links use
a direct removal path. Traversal buffers are retained for nested owners; error
arrays are created only when a cleanup reports a failure. Owner cleanups still
run in reverse registration order, and reported failures do not stop later hooks.

Registry generation advances before removal notifications and cleanup hooks.
Each removal invalidates the cached ID list before notifying listeners, so calls
to `registeredIds()` during teardown reflect the current registry. Previously
returned ID snapshots keep their contents.

List regions become terminal before running disposal callbacks. Reentrant
`dispose()`, reconciliation and refresh calls then do nothing, and `size()`
returns zero. Disposal finishes the remaining rows, entities and anchors before
reporting cleanup failures: one error is rethrown unchanged, multiple errors are
reported together. Interrupted frames retain the same ownership coverage.

An active reconciliation also stops after a key getter, prop replay or retained
row updater disposes the region. If a row factory disposes its owner before
returning, the returned entry is cleaned separately because it has not yet
entered the ownership cache. Later rows are not created or refreshed, and the
reconciler does not insert into removed anchors. This is cancellation of the
remaining work; authored effects and completed DOM writes are not rolled back.

Removal, clear and replacement mark each row's disposer and ownership cleanup
as started before calling authored code. An unmount during either phase cannot
run it twice, and active reconciliation stops when that callback returns.
Throwing cleanup hooks do not prevent later removed rows or their entities from
being cleaned; errors are reported after the removal batch finishes. Successful
subsequence/suffix removal commits its surviving rows before reporting failures.
General replacement/mixed frames can still be interrupted before placement and
remain disposable. This does not provide rollback or support arbitrary nested
reconciliation from cleanup hooks.

The compiler marks proven DOM-only inline or component rows with the final `resourceFree`
argument to `createListRegion()`. Those entries have no entities or disposal
callbacks. Complete clear/replacement and ordinary unmount can remove their
owned DOM range without visiting empty cleanup records. Suffix removal also
skips empty disposal/cleanup work after successful range deletion; failed or
unavailable ranges still remove individual nodes. Clear retains the same
boundary comments; unmount removes them. Other callers retain normal cleanup,
including callers that disable row ID tracking without this additional proof.

The package is independently buildable:

```bash
bun run build
```
