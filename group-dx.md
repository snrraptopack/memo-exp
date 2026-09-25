# Group — scoped pending/error policy

Declare *what* loading and failure look like once, high in the tree. Every
read site and every `suspend` boundary beneath resolves the **nearest**
declaration. One `Group` at the root covers the whole app; a nested `Group`
restyles a section; `suspend` is an opt-in atomic boundary any element can
raise — no positional relationship to `Group` required.

## The API

```tsx
<Group pending={Skeleton} error={Failure}>
  {/* any number of children, any shape */}
</Group>
```

- `pending` — a component (or inline render callback) shown while a covered
  source is pending.
- `error` — a component receiving `{ error, retry }`, shown when a covered
  source fails **or the subtree crashes**. `error.kind` is `'request'` or
  `'crash'`; `error.message` is the human-readable cause either way.
  Request failures additionally carry `status`, `statusText`, `data`,
  `issues`; a crash exposes the thrown value as `error.cause`. `retry`
  does the right restoration for each (refire the request vs. remount the
  failed unit fresh).
- Children — anything. `Group` itself renders nothing: it's a compile-time
  scope marker, erased before emit, no DOM node, no runtime entity.
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

- The boundary claims **every read beneath it, unconditionally** — its
  own reads and sources descendants create. `<Parent suspend>` waits for
  a child's own `$fetch`, and nothing inside can narrow the wait set:
  `suspend` dominates, the whole subtree stays withheld until all of it
  is ready.
- `suspend` still controls only the **first mount** — later refreshes keep
  the committed UI on screen.
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
from any read: nearest `suspend` ancestor claims it unconditionally;
else nearest `Group` handles it per-site; else the built-in default.

## `<Group suspend>` — the shorthand

`Group` itself can take `suspend`, making the whole subtree one atomic
boundary with its own policy — the direct replacement for today's
suspend-on-the-content-child pattern:

```tsx
<Group suspend pending={PageSkeleton} error={PageFailure}>
  <Article />
  <Comments />
</Group>
```

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
  // error.kind === 'crash'; error.cause is the thrown value
  return <p>{error.message} <button onClick={retry}>Reload section</button></p>;
}
```

- `retry` is polymorphic by kind: `request` → refire the request (mounted
  UI stays); `crash` → tear down and remount the failed unit fresh —
  dead state can't resume.
- A request error no scope claims is thrown render-side and lands in the
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

## What changes from today

| Today | Proposed |
|---|---|
| Exactly three children: `<Pending>`, `<Error>`, one content child | `pending` / `error` props; unlimited children |
| `<Pending component={X} />` sentinel element | `pending={X}` — component identifier or inline render callback |
| `suspend` only on the direct content child | `suspend` on any element or component in scope |
| Policy = the one Group that wraps you | Policy = nearest Group ancestor, resolved per callsite, per key |
| No Group → automatic-site defaults | Unchanged — same defaults |
| `suspend` requires provable local sources | `suspend` claims all reads beneath it — descendant sources included; nothing inside opts out |
| `error` = request failure only; render crashes kill the mount | `error` = the one failure arm — request failures and render crashes both claim at it, discriminated by `error.kind` |

## Semantics pinned by this DX

- **Nearest scope wins** — resolution walks component callsites, so the
  answer can differ per mount point of the same component.
- **Per-key inheritance** — inner Groups merge over outer (`pending`
  override keeps outer `error`), not replace.
- **`suspend` dominates** — a suspended element waits for every source
  beneath it, including descendant-created ones; inner `Group`s and
  `suspend`s cannot narrow the wait set. The only opt-out is structural:
  move the section out from under the suspended element, or don't
  suspend. Claiming descendant sources is the one part of this model
  that needs runtime registration (the boundary can't enumerate child
  sources statically) — everything else stays a compile-time rewrite.
- **Inner `Group`s rule non-suspended space** — per-site placeholders,
  per-key policy inheritance, and post-commit/refresh handling.
- **`error` is the one failure arm** — `error.kind` is `'request'` for a
  failed `$fetch` / server function / `$routed`, `'crash'` for a render
  failure; `error.message` reads naturally for both. `retry` is
  polymorphic: refire for requests, teardown + fresh remount for
  crashes. Crashes claim at the smallest enclosing unit inside the
  nearest `error`-carrying scope — narrower than React's whole-boundary
  replacement. Needs kernel support: a `render()` throwing mid-commit
  must route to the boundary instead of killing the drain.
- **Erased scope** — `Group` emits no runtime entity; policy travels as
  the existing hidden `dataPolicies` component argument.
- **Refresh is not re-suspend** — boundaries govern first mount only;
  `refreshing` keeps committed UI and per-site placeholders apply.

## Questions to resolve before implementation

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
4. **Whose error policy handles an initial failure beneath an ancestor
   `suspend` and a nested `Group`?** The ancestor owns the atomic first mount,
   while the nested Group supplies a nearer policy. Which one renders the
   failure before the boundary commits, and does that change after commit?
