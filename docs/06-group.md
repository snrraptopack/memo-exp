# Group — letting the markup own loading states

In the last doc you saw the manual version of loading UI:

```tsx
{request.pending ? <p>Loading…</p> : null}
{request.error !== null ? <p>{request.error.message}</p> : null}
{stories.map(s => <li key={s.id}>{s.title}</li>)}
```

That works, but it's machinery you're writing by hand — a `pending` branch,
an `error` branch, a retry button, around every place that reads fetched
data. `Group` removes it: you write the markup as if the data were already
there (the synchronous-authoring model again), and `Group` supplies the
pending and error UI for whatever isn't ready yet.

```tsx
import { $fetch, Group } from '@memoized-dom/data';

const stories = $fetch<Story[]>('/api/stories');

function Skeleton() {
  return <p>Loading…</p>;
}

function Failure({ error, retry }) {
  return (
    <p>
      {error.message}
      <button onClick={retry}>Retry</button>
    </p>
  );
}

export function Stories() {
  return (
    <Group pending={Skeleton} error={Failure}>
      <ul>
        {stories.map(s => <li key={s.id}>{s.title}</li>)}
      </ul>
    </Group>
  );
}
```

The contract:

- `pending`: what to show at a read site while its source is loading.
- `error`: what to show when its source fails. The component receives
  `{ error, retry }`; retry refires the failed request.
  `error.kind` is `request`; `error.requestKind` retains the transport category
  (`http`, `network`, `decode`, or `validation`). Status/data/issues are retained,
  and `error.cause` is the original error. A covered atomic render crash uses
  `kind: 'crash'` and Retry remounts that atomic unit, not the whole app.
- Children: any number of elements, components, fragments, or text.
  Group adds no wrapper DOM.

Both policies are optional and inherit independently from the nearest Group,
including across component files. An error-only inner Group keeps an outer
pending policy. An empty Group passes through both policies. Without any
pending policy, unavailable read slots are empty while static content renders.
Inline synchronous callbacks are also supported:

```tsx
<Group pending={() => <i>Loading…</i>}
  error={({ error, retry }) => <button onClick={retry}>{error.message}</button>}>
  <h1>Stories</h1>
  <StoryList />
</Group>
```

This currently covers resource failures, not arbitrary render crashes or
pre-entry route failures. Route shells and unified route errors are planned;
`$routed` still gates destination entry.

## Independent sites — pending and error live *where the data is read*

`Group` doesn't block the whole subtree on the slowest request. The pending
policy **expands to each read site**: wherever markup touches unavailable
data, the placeholder appears at that spot — and only that spot. Everything
else renders as soon as it can.

```tsx
const stories = $fetch<Story[]>('/api/stories');
const me = $fetch<User>('/api/me');

export function Page() {
  return (
    <Group pending={Skeleton} error={Failure}>
      <section>
        <h1>{me.name}</h1>                       {/* Skeleton here */}
        <p>Signed in as {me.name}</p>            {/* and here — each read site gets its own */}
        <ul>
          {stories.map(s => <li key={s.id}>{s.title}</li>)}
        </ul>                                     {/* renders the moment stories lands */}
      </section>
    </Group>
  );
}
```

If `stories` resolves while `me` is still in flight, the list appears
immediately and **both** `{me.name}` spots show the skeleton independently.
Read `me` in four places → four skeletons. It's never one blocked tree.

Same rule on failure: if the `me` request errors, **each** of its read sites
renders the error component — the story list keeps working. One failed
request doesn't take down the section.

## How inheritance works

Group supplies two independent policies. A nested Group replaces only the
policies it declares:

```tsx
<Group pending={AppLoading} error={AppFailure}>
  <Header />
  <Group pending={PanelLoading}>
    <Reports />
  </Group>
  <Group error={SettingsFailure}>
    <Settings />
  </Group>
  <Group><Footer /></Group>
</Group>
```

Reports uses `PanelLoading` and `AppFailure`. Settings uses `AppLoading` and
`SettingsFailure`. Header and Footer use both app policies. An empty Group
does not reset anything, and an error-only Group does not disable loading UI.
If no pending policy exists anywhere above a read, its pending slot is empty.
If no error policy exists, the resource error is thrown, not silently hidden.

Policies belong to the **mounted component instance**, not the source or
component definition. Render the same Reports component under two different
Groups and each instance uses its own policies. Two reads of the same resource
can therefore have different placeholders and error presentations.

Inheritance follows component calls, including imports from other files:

```tsx
// App.tsx
<Group pending={AppLoading} error={AppFailure}>
  <Reports />
</Group>

// Reports.tsx — no Group is needed to inherit the caller's policies.
export function Reports() {
  const report = $fetch<Report>('/api/report');
  return <section><h1>Report</h1><p>{report.title}</p></section>;
}
```

The section and heading mount immediately. The paragraph's resource read
shows AppLoading, then its value. A Group inside Reports can override either
policy for a smaller region, and deeper components inherit that override.
No context prop needs to be passed manually. Without `suspend`, inheriting
loading UI does **not** hold back the whole child component.

## `suspend` — choose what appears atomically

Group chooses the presentation; `suspend` chooses the region to withhold.
They are different responsibilities. A marked host element withholds that
element, while a marked component call withholds that component and its DOM.
Its surrounding layout remains mounted. Marking a region does not suspend
its parent or unrelated siblings.

The marked region prepares its active descendant tree off-screen, including
resources created inside child components in other files. Refs and mounted
effects are held until publication. An unused source or inactive branch does
not block readiness. `Group suspend` applies the same rule to all its children.

Sometimes you *don't* want piecemeal rendering — a dashboard that looks
broken half-loaded, a component that needs all its props at once. Put the
bare `suspend` directive on the element or component that should wait:

```tsx
export function Page() {
  return (
    <Group pending={DashboardSkeleton} error={DashboardFailure}>
      <Dashboard suspend user={me} stories={stories} />
    </Group>
  );
}
```

Now one pending policy covers the whole thing until **every** source the
active subtree consumes has committed — then `Dashboard` appears
atomically with all values ready.

It's not component-only — a host element takes it too:

```tsx
export function Page() {
  return (
    <Group pending={Skeleton} error={Failure}>
      <section suspend>
        <h1>{me.name}</h1>
        <ul>
          {stories.map(s => <li key={s.id}>{s.title}</li>)}
        </ul>
      </section>
    </Group>
  );
}
```

Same markup as before, but now nothing shows until both `me` and `stories`
have resolved — then the whole `<section>` mounts at once.

Details that matter:

- Write it bare — `suspend`, not `suspend={true}` (the valued form is
  rejected). No direct-child position is required. An inherited Group policy
  can supply its UI across files; without a pending policy the region waits
  behind an empty placeholder.
- It's a compile-time directive — it's consumed, never passed to
  `Dashboard` as a prop.
- `suspend` only controls the **first** mount. Later refreshes keep the
  committed UI on screen — it's not a "re-suspend on every fetch" switch.
  Rebinding a source in the same committed instance uses ordinary read-local
  pending UI. A remount or changed route path parameter starts a new atomic
  activation; query/hash changes retain the instance.

### Across a component boundary

```tsx
// Parent owns this source; this dependency is visible at the callsite.
<Group pending={PanelLoading} error={PanelFailure}>
  <h1>Reports</h1>
  <ReportBody suspend report={report} />
</Group>
```

The heading stays visible. ReportBody initializes in a detached preparation,
so its own safe data work can start alongside `report`. The whole region
remains withheld until every active descendant read is ready. Public refs
and mounted effects do not run against this detached work. This is ordinary
data readiness, not authorization: `$routed` still gates route entry before
protected destination components initialize.

A child can instead own the marked region:

```tsx
// Child.tsx, called under the parent's Group
export function ReportBody({ report }) {
  return <section>
    <h2>Details</h2>
    <Group>
      <article suspend>{report.title}</article>
    </Group>
  </section>;
}
```

The section and h2 mount; only the article waits. The empty Group inherits
the caller's pending/error UI. Add `pending={DetailLoading}` here to change
the article's placeholder without changing the parent's other read sites.

An inner boundary cannot reveal content through an uncommitted outer
boundary. The outer boundary owns first-mount replacement and uses its own
effective policy; inner Groups still choose read-local presentation after
the outer region commits. A failed staged descendant rolls back the atomic
  region, and Retry creates a fresh generation. Shared resources are borrowed,
not disposed with the failed component.

## When to use which

| Shape | Reach for |
|---|---|
| Each read site shows its own placeholder as data lands | plain `Group` children |
| Content must appear all-at-once | `Group` + `suspend` |
| You need request status in *logic* (disable a button, journal a rollback) | `$track` — from the previous doc |

Next: [07 — Routing](./07-routing.md)
