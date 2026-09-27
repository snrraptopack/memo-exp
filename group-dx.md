# Group — scoped pending/error policy

Declare *what* loading and failure look like once, high in the tree. Every
read site and every `suspend` boundary beneath resolves the **nearest**
declaration. One `Group` at the root covers the whole app; a nested `Group`
restyles a section; `suspend` is an opt-in atomic boundary any element can
raise — no positional relationship to `Group` required.

This document describes proposed DX, not a claim that these semantics are
already implemented. `$routed` always blocks destination entry, but an
available Group pending policy can show a safe route loading shell during
module loading and preparation. Without that policy, navigation is deferred.
Group also governs ordinary resource availability after entry.

### Implementation status

The props-based Group API now supports arbitrary children, inline synchronous
callbacks, and independently inherited pending/error policies across component
calls and files. Empty Groups pass through inherited policies; they add no DOM.
Group has one authored API: pending/error props. Pending/Error child
declarations and their public exports are removed; there is no compatibility
mode or positional three-child contract.
Authored `Group suspend`, host-element suspension, and component suspension
now prepare the active descendant tree, including resources owned in other
files. Ordinary atomic request failures and owned render crashes replace that
atomic slot through its effective error policy, with fresh-generation retry.
Plain, unsuspended component crash recovery and route entry failures still
need their separate ownership integration.
Route-shell integration below is not implemented yet.

The internal runtime now provides detached activation generations:
ordinary preparation renders can update detached output while assignable refs,
authored refs, and mounted effects remain held. Nested generations cannot
release lifecycle work through a pending parent; cancellation drains registered
owners and queued refs. These are compiler primitives, not authored APIs.
It also tracks resources consumed in explicit owner/read-site scopes. Replays
replace that site's read set without dropping untouched sinks during incremental
updates, removed branches release their claims, and
shared sources are observed without transferring ownership or aborting them.
Readiness waits for queued owned render work as well as consumed resources:
a source settling can reveal another child and must not publish in between.
Data render-read and availability helpers participate in these scopes;
unused declarations, derivations, and mounted-effect reads do not independently
block preparation. Compiler-owned scopes now cover initial and incremental
text, scalar attribute/prop reads (including ordered spreads), module-list
receivers, and availability/conditional picks. A
removed non-entity branch releases its read sites too. Local selectors do not
wait for sources used only by inactive branches; request-state selectors retain
their subscriptions. Attribute values use scalar availability reads rather
than embedding pending/error JSX in an attribute.

A compiler-emitted prepared range observes readiness and publishes the
current detached DOM once, including child output discovered after creation,
before releasing refs and effects. Nested regions fold into a pending outer
generation; abandoning a region prevents stale publication. It now uses
stable `mmd:g` range identities and adopts resolved server ranges in place,
including nested regions, without moving their content or showing a fallback.
Mismatch reporting preserves the rejected server range until mount recovery.
The internal range also rolls back failed staged/committed owners, replaces
its slot through an internal error factory, and retries in a fresh generation.
Borrowed failed requests retry without reviving disposed component holders;
retry clicks deduplicate and callbacks from retired error arms are inert.
Ref/effect activation waits until surrounding compiler initialization finishes,
and an internal settled promise distinguishes publication from lifecycle readiness.
Compiled Group suspension now has cross-file, cancellation, nested dominance,
synchronous shell SSR, resolved SSR, and in-place resolved hydration coverage.
Unused resources and inactive branches do not hold first activation open.
After that activation, a source rebind preserves the owner and uses read-local
availability UI; remounting creates a fresh atomic generation.
Specialized component-row prop paths still need focused integration coverage.
Route ranges now key activation by their semantic route ID and consumed
pathname: changed path parameters remount and re-suspend the destination,
query/hash changes retain its instance, and unchanged parent layouts remain.
This does not enable pre-entry route loading shells yet.

The first code slice hardens existing router behavior: native history
traversal now prepares `$routed` before entry, tracked failed/blocked pops
recover by traversal rather than extra pushes, stale retries are guarded,
and history-entry scroll identity is preserved. Scroll work is cancellable,
late hash targets are observed, and the internal coordinator accepts a
renderer-readiness promise. Route publication now collects real atomic commit
promises and passes them to scroll restoration; a pending atomic fallback is
not scroll-ready. Superseded ranges reject readiness and cannot scroll the
new destination. This is internal coordination, not a developer option.
Legacy/external browser history entries without a tracked index cannot be
reversed reliably through the fallback History API. Their failure is reported
while committed UI is retained; a stronger untracked-entry recovery policy
is still required. `bun run test:router:browser` exercises real-browser
back/forward scroll positions, pending preparation, failure recovery/retry,
late hash targets, and superseded scroll work. It uses an installed browser
(or `MMD_BROWSER_PATH`) rather than downloading one. Unit tests additionally
exercise readiness promises, malformed hashes, stale retries, and disposal.

General component crash recovery, slotless-read promotion, fallback chunk
ownership, unified route shells/errors, and the
new shell/error URL-publication rules still require implementation and
integration tests. Existing pre-entry failures currently report through
navigation events; the Group error replacement described below is proposed.

## The API

```tsx
<Group pending={Skeleton} error={Failure}>
  {/* any number of children, any shape */}
</Group>
```

- `pending` — a component (or inline render callback) shown while a covered
  source is pending.
- `error` — a component receiving `{ error, retry }`, shown when a covered
  source fails **or the subtree crashes**. Proposed `error.kind` is
  `'request'`, `'module'`, or `'crash'`; `error.message` is the
  human-readable cause in each case.
  Request failures additionally carry `status`, `statusText`, `data`,
  `issues` when available; module failures and crashes expose the cause as
  `error.cause`. Retry refires a failed request, retries a recoverable
  module load, or remounts a failed render unit fresh.
- Children — anything. `Group` itself renders nothing: it's a compile-time
  scope marker with no wrapper DOM. Plain policy scopes can be erased;
  atomic suspension and crash recovery still need runtime ownership.
- Both props are optional and independently inherited — more below.

## One Group at the root

```tsx
// App.tsx
function Skeleton() {
  return <p class="skeleton">Loading…</p>;
}

function Failure({ error, retry }) {
  return (
    <p class="error">
      {error.message}
      <button onClick={retry}>Retry</button>
    </p>
  );
}

export function App() {
  return (
    <Group pending={Skeleton} error={Failure}>
      <Header />
      <Main />
      <Footer />
    </Group>
  );
}
```

Every transparent-source read anywhere beneath — inside `Header`, `Main`,
their children, any depth — shows `Skeleton` at its own read site while
pending and `Failure` at that site on error. Nothing is wired per
component: the policy flows through component calls as a hidden argument,
so each callsite resolves the scope it was mounted under. A component used
under two different Groups sees each scope's policy at the matching
callsite — per-instance "nearest", not lexical.

## `suspend` anywhere

`suspend` no longer requires being the direct content child of a `Group`.
Put it on any element or component in scope — it becomes an atomic
boundary using the nearest `Group`'s policy:

```tsx
export function Page() {
  return (
    <main>
      {/* read-site placeholder: Skeleton appears exactly here */}
      <h1>{me.name}</h1>

      {/* whole dashboard waits for its inferred sources, mounts once */}
      <Dashboard suspend user={me} stories={stories} />

      {/* host elements suspend too */}
      <section suspend>
        <h2>{me.name}</h2>
        <ul>
          {stories.map(s => <li key={s.id}>{s.title}</li>)}
        </ul>
      </section>
    </main>
  );
}
```

- The boundary claims **every read in the active subtree being prepared** — its
  own reads and sources descendants create. `<Parent suspend>` waits for
  a child's own `$fetch`, and nothing inside can narrow the wait set:
  `suspend` dominates, the whole subtree stays withheld until all of it
  is ready.
- `suspend` controls the first activation of a region, including a new
  destination identity. Refreshing that same destination keeps committed
  UI on screen. Reusing a component instance does not by itself make a
  different route-parameter destination a refresh.
- While suspended, the `Skeleton` occupies the exact spot where the
  element will mount.

Because an ancestor `suspend` is absolute, it is a deliberate choice —
don't mark a parent `suspend` unless the *whole* tree should mount
atomically. Progressive per-read-site behavior isn't something a child
requests; it's what the parent didn't take away. A nested `suspend` under
a suspended parent changes nothing for the first mount — it only governs
content mounting *after* the parent commits (a later conditional branch,
a swapped route).

## Nested Groups — override a section

When one section needs different fallback semantics, wrap it:

```tsx
<Group pending={Skeleton} error={Failure}>
  <Feed />
  <Group pending={TableSkeleton}>
    <AdminTable suspend />
  </Group>
</Group>
```

Inheritance is **per key**: the inner `Group` supplies `pending`; `error`
still resolves to `Failure` from the outer scope. A `Group` providing no
new keys is a passthrough — its subtree sees the outer scope unchanged.

```tsx
<Group pending={Skeleton} error={Failure}>
  <Group error={CriticalFailure}>    {/* pending still Skeleton */}
    <BillingPanel suspend />
  </Group>
</Group>
```

An inner `Group` handles any read no `suspend` ancestor has claimed —
per-site placeholders under the inner scope's policy. Under a suspended
ancestor it does *not* narrow the boundary's wait set — `suspend`
dominates absolutely — but it still owns which policy that subtree's
placeholders and refresh states use once mounted. The full claim order
from any read: the outermost still-uncommitted `suspend` ancestor owns
atomic replacement and uses the policy resolved at that boundary;
nested boundaries contribute readiness, not separate first-mount UI.
Otherwise the nearest independently activating `suspend` claims it;
else the nearest `Group` handles it per-site; else the built-in default.
An inner error policy does not split an outer uncommitted atomic region.

## `<Group suspend>` — the shorthand

`Group` itself can take `suspend`, making the whole subtree one atomic
boundary with its own policy:

```tsx
<Group suspend pending={PageSkeleton} error={PageFailure}>
  <Article />
  <Comments />
</Group>
```

## Routes — `$routed` controls entry, Group controls availability

Required `$routed` preparation must complete successfully before the
destination activates. An effective, independently available Group
`pending` policy selects loading-shell presentation; without it the previous
page remains visible until preparation succeeds. The policy can come from
a Group at the route region itself or any ancestor level. Neither Group
nor `suspend` bypasses the entry gate.
Redirects and authorization resolve before destination components start.
Shared parent layouts stay mounted across successful child navigation.

```tsx
<Group pending={ReportSkeleton} error={ReportError}>
  <ReportDetail route="/reports/:id" suspend />
</Group>
```

While the lazy module or `$routed` loads, `ReportSkeleton` occupies the
changing route slot, without mounting ReportDetail or starting its protected
child work. On successful entry, `suspend` keeps the region atomic while
ordinary descendant resources prepare. Without `suspend`, the same route
shell covers entry preparation; after entry the destination's static UI
appears and ordinary pending reads use local placeholders.

| Effective available pending policy | During module / `$routed` preparation |
|---|---|
| Present, with or without `suspend` | Show the destination route-slot shell; preserve shared layouts |
| Absent | Retain the previous page until required preparation succeeds |

This does not make every destination fetch blocking. Put genuinely
entry-critical work in `$routed`; ordinary component resources can load
after entry under the Group policy:

```tsx
const report = $routed(({ params }) => getReport(params.id));

// Inside the destination, after entry:
const comments = client.$fetch('/comments');
```

| Ordinary resources after destination entry | Presentation while pending |
|---|---|
| `suspend` with an effective pending policy | Show the marked region's fallback, then reveal it atomically |
| No `suspend`, with an effective pending policy | Render static content immediately; show pending UI at individual reads ("colorless" / progressive mode) |
| No effective pending policy | Use built-in empty pending defaults; `suspend` still controls atomic activation |

The policy may be declared by a Group at the region itself or inherited
from any ancestor. An error-only Group can inherit an outer `pending`;
without one it does not create a loading shell or opt navigation out of
previous-page retention. An error policy may still present a route failure.
An empty Group is a passthrough, not an instant-navigation opt-in.
In progressive mode each read's slot updates coherently, but the whole
region does not wait for all reads together. Place `suspend` on the
changing child region rather than a layout that must remain visible.

Putting all page data in `$routed` makes all that work block entry.
Already-ready preparation has no meaningful wait; the exact cache and
revalidation rules remain a separate contract. No separate `<Route>`
loading wrapper is introduced here.

### Lazy code and independently available shells

Group's effective pending policy is also the navigation shell policy.
There is no separate `<Route>` wrapper or additional opt-in merely for
lazy loading. Scope presence alone is insufficient: an available pending
component or callback must resolve at the changing route activation slot.

A Group declared only inside an unloaded module cannot cover that module's
download. The shell/fallback and its dependencies must be available
independently of the destination chunk. Static UI inside that chunk cannot
render before it arrives. If no available outer pending policy exists,
entry preparation remains deferred; once the module activates, its own
Group declarations can govern ordinary internal resources.

### Safety and identity

- A `$routed` function can authorize, redirect, and fetch in one operation.
  All required preparation blocks entry; no compiler inference of a safe
  partially completed gate is needed. Protected child work must not start
  through an unresolved parent gate.
- Prepared state is published only for the successful destination.
  Navigation supersession must prevent an old attempt from committing or
  updating the new destination.
- A new matched route or changed path parameters activates a destination;
  a refresh of the same destination retains committed UI. Query-only
  changes need a precise identity/revalidation rule before implementation.
- History commit, navigation completion, and DOM/scroll readiness are
  separate milestones. An instant shell is not "destination ready".

### Initial visits and retries

On client-only initial visits there is no old page to retain. An available
Group pending policy shows the route shell while entry prepares; without
one, use the empty bootstrap default. A Group hidden inside the destination
chunk cannot supply pre-entry UI. After entry, ordinary resources use the
policy above. Fully resolved SSR preserves server-rendered DOM
while client chunks download and restores server-prepared data rather
than repeating initial `$routed` work. Streaming SSR is a separate future
capability, not implied by this proposal.

A `$routed` or route-module import failure uses the nearest independently
available Group `error` policy at the failed route slot. It can replace a
pending shell or the previous child with destination error UI, even when
no pending policy was supplied. Shared layouts remain mounted; protected
destination components do not mount merely to display the failure.
Without an available error policy, retain the current page and report via
navigation events; on an initial visit, bootstrap handling reports it.

Retry repeats failed navigation preparation, showing the effective pending
shell when available, and activates the destination only after success.
Request preparation failures use `error.kind: 'request'`; import failures
use `'module'`. Displaying a destination error is a separate failure
presentation milestone, not successful entry. URL/history timing for that
milestone follows the agreed contract in answer #6 below; its presentation
integration remains unimplemented.

After entry, ordinary resource failures use the effective Group error
policy. Request retry refires that operation; render-crash retry recreates
the failed unit. Unaffected siblings and shared layout state are preserved.

Retry is operation-specific, not a whole-app remount. A deleted deployment
chunk or a cached module-evaluation failure may require a reload rather
than another identical import; ordinary retry cannot guarantee recovery.

### Automated SSR chunk handoff

The compiler identifies route modules; Vite maps them to emitted JS/CSS
and shared dependencies; SSR uses the rendered route chain to emit
deduplicated preload/style links and module identity in the existing
hydration payload. Developers never author hashed chunk URLs or transfer
keys for this coordination. Preloading improves delivery, not readiness
or error-boundary semantics.

## Crashes land in the same arm

`error` is the single failure arm — it isn't request-only. A render
failure (a throw during mount, a derivation, a render pass) claims at the
**smallest enclosing unit**: the failed component or `suspend` element's
slot inside the nearest scope carrying an `error` policy. The rest of the
scope keeps rendering:

```tsx
<Group pending={Skeleton} error={Failure}>
  <Header />
  <Buggy post={post} />   {/* throws mid-mount → Failure in Buggy's slot */}
  <Footer />              {/* unaffected — renders normally */}
</Group>
```

```tsx
function Failure({ error, retry }) {
  if (error.kind === 'request') {
    // error.status / error.data / error.issues available too
    return <p>{error.message} <button onClick={retry}>Retry</button></p>;
  }
  // Module loading failures are distinct from render crashes.
  if (error.kind === 'module') {
    return <p>Could not load this section. <button onClick={retry}>Retry</button></p>;
  }
  // error.kind === 'crash'; error.cause is the thrown value
  return <p>{error.message} <button onClick={retry}>Reload section</button></p>;
}
```

- `retry` is polymorphic by kind: `request` → refire the request (mounted
  UI stays where possible); `module` → retry the recoverable loader;
  `crash` → tear down and remount the failed unit fresh —
  dead state can't resume.
- An ordinary resource request error no scope claims is thrown render-side and lands in the
  same arm — it arrives normalized with `kind: 'request'`, so transport
  failure stays distinguishable from code failure.
- Crashes inside the `error` arm itself propagate to the next outer scope.
- Not caught: errors in event handlers, async callbacks, and effect
  bodies — those run outside the render pass, same exclusions as React.

## No Group in scope

`suspend` and transparent reads don't *require* a `Group`. Outside any
scope they use the built-in default: pending renders nothing at the site,
an unclaimed request error throws, and a render crash propagates and
kills the mount — same as today. `Group` supplies the UI, never the
permission.

## Semantics pinned by this DX

- **Nearest scope wins** — resolution walks component callsites, so the
  answer can differ per mount point of the same component.
- **Per-key inheritance** — inner Groups merge over outer (`pending`
  override keeps outer `error`), not replace.
- **`suspend` dominates** — a suspended element waits for every source
  in its actively prepared subtree, including descendant-created ones; inner `Group`s and
  `suspend`s cannot narrow the wait set. The only opt-out is structural:
  move the section out from under the suspended element, or don't
  suspend. Claiming descendant sources is the one part of this model
  that needs runtime registration (the boundary can't enumerate child
  sources statically) — everything else stays a compile-time rewrite.
- **Inner `Group`s rule non-suspended space** — per-site placeholders,
  per-key policy inheritance, and post-commit/refresh handling.
- **`error` is the one failure arm** — `error.kind` is `'request'` for a
  failed ordinary `$fetch` / server-function resource or `$routed` request,
  `'module'` for route import failure, and `'crash'` for a render failure.
  Route failures use the available Group error UI, but navigation retains
  lifecycle ownership; retry reattempts failed entry rather than mounting
  the destination prematurely.
  `error.message` reads naturally across kinds. `retry` is
  polymorphic: refire for requests, teardown + fresh remount for
  crashes. Crashes claim at the smallest enclosing unit inside the
  nearest `error`-carrying scope — narrower than React's whole-boundary
  replacement. Needs kernel support: a `render()` throwing mid-commit
  must route to the boundary instead of killing the drain.
- **No wrapper DOM** — plain Group policy declarations can be erased;
  policy travels as the existing hidden `dataPolicies` component argument.
  Atomic boundaries and crash recovery require runtime ownership.
- **Refresh is not re-suspend** — boundaries govern destination activation;
  `refreshing` keeps committed UI and per-site placeholders apply.
- **Entry preparation is separate from presentation** — required `$routed`
  work blocks entry regardless of Group or `suspend`. An available effective
  pending policy shows a route shell; otherwise retain the previous page.
  Group also governs ordinary resources after entry. Empty/error-only
  Groups do not enable shells unless they inherit a pending policy.

## Six implementation questions — agreed direction

The following answers are the agreed implementation direction. They specify
the contracts without adding public syntax; the implementation-status section
above remains authoritative about which pieces have actually shipped.

1. **How does an atomic `suspend` discover its complete wait set?** A child
   may create a source only while preparing or mounting. Which work may run
   before the first commit, when is source registration complete, and what
   happens when a conditional branch reveals another source later?
2. **What exactly is the crash recovery unit?** If mounting or committing
   fails halfway through a component or suspended element, which DOM, state,
   effects, and subscriptions are rolled back? What does `retry` remount, and
   how does a crash in the error arm move to an outer scope?
3. **Where does a per-site fallback render when the read has no child slot?**
   A text expression has a visible location, but an attribute or host property
   read may not. Which enclosing element or region owns its pending and error
   UI, and how do we keep the resulting DOM valid?
4. **How is fallback availability guaranteed?** Define compiler/Vite
   ownership rules so shell and error dependencies stay loadable outside
   the destination chunk, and define escalation when a fallback itself fails.
5. **What is the recovery scope for navigation retry?** Define which parent
   preparation results remain valid and which failed/superseded child work
   reruns, without bypassing gates or repeating successful side effects.
6. **What is destination identity and when does navigation commit?** Pin
   query-only changes, URL/history timing, failure after shell commit,
   back/forward behavior, cancellation, and readiness-aware scrolling.

### 1. Discover readiness through staged preparation

Give each activating atomic boundary a preparation generation. Components
in its active subtree initialize against that generation and register the
resources their reads actually consume. Prepare detached output or staged
render descriptions; do not publish live DOM, assign public refs, run
mounted effects, or attach live event handlers before commit.

When a consumed resource settles, resume/re-evaluate the affected work.
It may reveal a conditional child and another resource. The boundary is
ready only when the active render has completed, no consumed resource is
pending, and no discovery/render work remains queued. An empty wait set
alone is not proof of readiness if some child has not been prepared yet.
Inactive branches and future user interactions are not part of this set.

Source identity must survive preparation passes: cache creation by owning
instance and compiler read/source site, with its request inputs. Abandoning
a branch releases its registration; abandoning a generation disposes its
staged instances and subscriptions. Cancel owned requests where possible;
shared requests/imports may finish but cannot publish into an obsolete slot.

Resources created only by mounted effects cannot block that first mount:
running those effects early would violate their lifecycle. Such resources
are post-commit work. If first-mount readiness needs them, move their
declaration into preparation-visible component work. A render that creates
new requests forever must surface a diagnostic rather than silently loop.

### 2. Recover an owned slot, with transactional cleanup

The recovery unit is an independently owned component slot or explicit
atomic host/Group boundary. Before its first commit, failure disposes all
staged DOM, child instances, subscriptions, and queued effects. After commit,
a render crash tears down that unit and its descendants, runs registered
cleanup, clears owned refs, and puts error UI in the same slot. Siblings and
shared ancestors retain their instances and state.

An uncommitted outer atomic boundary owns a descendant failure as a whole;
otherwise use the smallest independently recoverable slot. Do not attempt
to resume half-mutated component state. Retry creates a fresh generation
and fresh local state for that failed unit, while shared external resource
caches follow their own invalidation rules.

Fallbacks have their own instances, but their failure must skip the policy
that produced them and escalate to the next available outer error policy.
If none exists, report a terminal failure rather than recursively rendering
the same fallback. Kernel writes need ownership/cleanup bookkeeping before
this guarantee can be implemented. Arbitrary side effects performed by
user code during render cannot be rolled back; render must remain free of
such effects. Event/async/effect exceptions remain outside render recovery.

### 3. Promote slotless reads to the smallest valid owner

Text/child expressions use their own replaceable slots. A pending value in
an attribute, host property, component prop, or structural condition cannot
render a component in that value position. Promote readiness to its smallest
valid owner: the host element, receiving component slot, or conditional
region. Multiple such reads share that owner's wait set. This is local
atomic promotion, not suspension of the entire page.

Do not commit an element with fabricated attributes, broken event handlers,
or stale security-sensitive values. On initial activation, withhold that
owner and put its fallback in the owner's parent slot. During refresh,
retain committed output under the existing refresh policy.

Fallback output must be valid for the insertion context (for example, table
rows, select options, and SVG). Diagnose statically provable invalid shapes;
validate dynamic fallback output before insertion and report a boundary
error rather than letting the browser silently rearrange DOM. Recommend
moving Group/suspend to a larger valid region when the supplied fallback
cannot fit. Do not add arbitrary wrapper elements to repair the markup.

### 4. Compile shell dependencies outside destination ownership

The compiler records the pending/error policy effective at each route
activation site. The Vite integration treats those fallback components and
their dependencies as available shell dependencies, not route-exclusive
imports eligible for placement only in the destination chunk. Shared chunks
are fine; their dependency closure must be loaded with the owning shell.
This need not eagerly import every fallback for every unrelated route.

Policies declared only inside a lazy module become available after that
module loads; before then, use an already available outer policy or defer.
Do not speculate that an unavailable inner Group can cover its own import.
SSR resolves the same dependency graph for preload/style links and payload
identity. A fallback that suspends cannot wait on the resource it is meant
to cover; use an available outer pending policy or the empty default. A
fallback that crashes escalates as described above.

### 5. Retry the failed attempt, not the whole application

Bind retry to the destination and failed operation's attempt token.
Deduplicate repeated clicks while that retry is in flight. A retry belonging
to a superseded destination is inert; it must not navigate back unexpectedly.
Reuse successfully loaded module code, evict a failed loader entry where
recoverable, and start a fresh preparation attempt for the failed route.

Keep unchanged, successfully committed parent layouts mounted. Reuse parent
preparation only when its route/request inputs and explicit validity rules
still match. Do not treat a cached parent result as permanent authorization:
rerun required guards/auth checks unless their validity contract permits
reuse. Run child preparation only after those checks succeed. Never publish
partially successful child data from a failed attempt.

There is no general exactly-once guarantee for arbitrary `$routed` side
effects. Recommend read-oriented/idempotent preparation, with mutations in
explicit actions. Retry must not automatically replay an entire successful
chain merely because one child failed; when a failed operation itself may
have produced a side effect, application idempotency is still necessary.
Stale deployment chunks or cached module-evaluation failures may require a
reload; do not add unbounded automatic retry or URL cache-busting loops.

### 6. Separate URL presentation, entry, and DOM readiness

Use the semantic matched route-instance chain plus path parameters as region
identity. Query changes produce a new navigation/preparation attempt with
fresh inputs, but retain the same region instance by default rather than
automatically remounting local state. Query-dependent preparation must be
revalidated; unrelated changes may reuse results only under a proven
dependency/cache contract. Hash-only changes do not rerun route preparation.

For controlled push/replace navigation, resolve synchronous blockers first.
If an available pending policy lets the router publish a shell, update
URL/history when publishing it. Otherwise keep the old URL and page until
successful destination publication. Showing an available destination error
also publishes that destination URL, even after deferred preparation. If no
error policy can show it, retain the previous page and URL. These are separate
failure/presentation milestones, not claims that entry succeeded. Their
shell/error integration is not implemented yet.

Retry stays on the same attempted URL and creates no extra history entry.
If preparation redirects after a shell URL was published, replace that
provisional history entry with the redirect destination; without a published
shell, publish only the final destination. A redirect is a control result,
not an error fallback.

Back/forward already changes the browser URL: do not push a new entry to
mirror it. Prepare the selected history destination and use its shell or
retain old content while waiting. Unhandled failure must be visibly reported
as a failed history navigation, not silently treated as successful entry.
For tracked history entries, a blocked/failed pop restores the prior entry by
traversal, not an extra push; this recovery is covered by unit and browser tests.
Untracked/external entries still need a stronger recovery policy, as noted in
the implementation status. Supersession invalidates old commits and retries; it must not
undo history belonging to a newer navigation.

Keep separate internal milestones: shell/error publication, successful
entry preparation, and committed DOM readiness. Navigation completion must
not mean merely that a skeleton appeared. Scroll restoration waits for the
new region's first committed output; an atomic region's pending shell is
not that output. Progressive output may commit before all local reads settle;
hash targets inside pending slots need an explicit later target-ready signal,
not a fixed number of animation frames. Cancel scheduled scroll/focus work
when a newer navigation supersedes it.
