# Data Layer RFC — Transparent Data Values and Local Groups

Status: draft for debate
Audience: data package, compiler, runtime, and testing contributors
Original direction: `fix.md`
Research input: `solid-2-async-reactivity-research.md`

## Current implementation status (2026-08-24)

The first client/compiler vertical slice exists in the working tree:

- public `ResolvedValue<T>` and `$track(value)` types and runtime intrinsics;
- provider metadata through `transparentAsyncSources`, so compiler recognition
  is not tied to a local identifier literally named `$fetch`;
- guarded imperative reads and unavailable-safe scalar/attribute reads;
- availability-gated replay of component-local derived state;
- fetch notifications connected to ordinary runtime push invalidation with
  automatic component cleanup;
- compiler-only `Group`, `Pending`, and `Error` declarations with the normalized
  three-child shape, plus independent pending/error/retry replacement for
  scalar, conditional, structural, and keyed-list consumption sites;
- transparent origin propagation through component-local derivations and
  linked component props, including private policy forwarding across modules;
- nearest nested-Group overrides and empty-until-commit structural sites when
  no Group is present;
- no volatile frame polling for recognized transparent sources.

The slice currently invalidates the owning component subtree. Exact
consumption entities, compiler-proven pending DOM-legality diagnostics,
runtime-owned module source materialization, derived payload transport as a
component prop, and SSR snapshot/hydration integration remain implementation
work. Section 16 now gives the concrete proposed design for every item in that
list except DOM-legality diagnostics. This status is intentionally explicit so
examples below are not mistaken for claiming that every RFC case already
compiles.

This RFC deliberately does not adopt Solid's async runtime graph, suspension
protocol, loading-boundary behavior, or public API. The useful inspiration is
limited to presenting resolved data as an ordinary value and distinguishing
initial availability from background work. Memoized DOM must implement those
ideas through its own compiler-known reads, stable DOM regions, and push
invalidation.

`data-loading-api.md` remains the reference for the machinery below this
surface: request identity, active sharing, retained caching, generation tokens,
validation, abort behavior, actions, and optimistic transactions.

## 1. The intended experience

`$fetch` returns the value the application asked for:

```tsx
function Profile() {
  const user = $fetch<User>('/api/user');

  return <h1>{user.name}</h1>;
}
```

The inferred type is a compiler-aware `ResolvedValue<User>`. It is directly
usable and assignable as `User`, with no `.value`, while retaining the source
provenance needed by `$track` and `Group`.

Conceptual public typing:

```ts
declare const resolvedValue: unique symbol;

type ResolvedValue<T> = T & {
  /** Type-only provenance brand. Application code never reads this field. */
  readonly [resolvedValue]: T;
};

function $fetch<T>(target: string | URL, options?: FetchOptions): ResolvedValue<T>;
```

`ResolvedValue<T>` is a provenance type, not a proposal to mutate a native
array, primitive, or response object by attaching methods at runtime. Ordinary
reads and compiler-visible writes behave as the original `T`.

Code that only consumes data can continue accepting the original shape:

```tsx
function UserList({ users }: { users: User[] }) {
  return <ul>{users.map((user) => <li>{user.name}</li>)}</ul>;
}
```

Code that intentionally observes request lifecycle preserves the provenance:

```tsx
function UserListControls({ users }: { users: ResolvedValue<User[]> }) {
  return <span class={{ pending: $track(users).pending }}>Users</span>;
}
```

`$track` is compiler-resolved from source provenance; it must not search for a
request by payload object identity or payload equality at runtime. Two sources
may resolve to the same primitive or object without sharing lifecycle state.

There is no `.data`, no accessor call, no null assertion, and no mandatory
loading-state branch. The compiler knows that `user` comes from an asynchronous
data source and follows that origin through ordinary code.

The core rule is:

> Unavailability belongs to the exact compiled place that consumes the value,
> not to the component, subtree, or application containing it.

Static content renders immediately. Separate data-consuming places resolve
independently. Nothing waits for unrelated data unless one expression actually
requires that data.

## 2. Non-negotiable framework alignment

The data design must preserve Memoized DOM's core principles:

1. Authored data is used like an ordinary TypeScript value.
2. There is no user-visible signal, accessor, hook, or promise plumbing.
3. There is no runtime dependency graph and no runtime read discovery.
4. The compiler follows data provenance through bindings, derived expressions,
   props, children, module imports, conditionals, and keyed rows.
5. Request transitions push canonical invalidation into the existing runtime;
   they are not discovered by polling in the finished design.
6. Existing real DOM nodes, scalar caches, and structural regions perform the
   update. There is no virtual tree or diff.
7. Data may live at module scope, component scope, or any linked scope supported
   by ordinary framework state.
8. Ownership follows the smallest component, conditional, render slot, or keyed
   row that owns the request consumer.
9. Unsupported escapes are diagnosed honestly. The framework must not use
   proxies or silently pass an unresolved internal value into unknown code.

## 3. Group is a local presentation policy

`Group` supplies pending and error presentation for data-consuming sites under
it. By default it is not a loading boundary and does not choose one branch for
its whole subtree. A direct component child may explicitly opt into atomic
initial readiness with the compiler-owned `suspend` directive described below.

Working syntax:

```tsx
function UserPending() {
  return <span class="skeleton" />;
}

function UserFailure({ error, retry }) {
  return (
    <button onClick={retry}>
      {error.message}
    </button>
  );
}

function App() {
  const user = $fetch<User>('/api/user');

  return (
    <Group>
      <Pending component={UserPending} />
      <Error component={UserFailure} />
      <Profile user={user} />
    </Group>
  );
}
```

`Group` has exactly three direct children, in this order:

1. one `Pending` policy declaration;
2. one `Error` policy declaration;
3. one content child.

When the content contains several siblings, the author uses a fragment as that
third child:

```tsx
<Group>
  <Pending component={UserPending} />
  <Error component={UserFailure} />
  <>
    <Avatar src={user.avatar} />
    <strong>{user.name}</strong>
  </>
</Group>
```

`Pending` and `Error` are policy declarations consumed by `Group`. They do not
render where they are written and are not alternative content branches. The
single content child mounts normally and immediately. A fragment introduces no
wrapper DOM element, and `Group` itself emits none.

The exact shape is deliberate, not an incidental parser restriction. Opting
into `Group` means choosing both automatic policies. Authors who want to omit a
policy or write different control flow use `$track` instead. The compiler must
reject missing, reordered, or additional direct children rather than inventing
defaults.

### 3.1 Pending receives no source bookkeeping

The pending component does not receive source arrays, source indexes, resource
names, or compiler identities:

```tsx
function PendingText() {
  return <span>Loading…</span>;
}

<Group>
  <Pending component={PendingText} />
  <Error component={LocalFailure} />
  <Profile user={user} />
</Group>
```

The compiler already knows which value a consumption site needs. That
bookkeeping must remain invisible to application code.

### 3.2 Error is bound to the failing target automatically

An error component may receive the error and a retry action:

```tsx
function LocalFailure({ error, retry }) {
  return (
    <button onClick={retry}>
      Retry: {error.message}
    </button>
  );
}
```

The compiler/runtime binds `retry` to the failed data target responsible for
that exact consumption site. The author does not look up a source, index into a
source array, or pass the request around manually.

An error component that needs no details can ignore both props:

```tsx
function OfflineMark() {
  return <span>Unavailable</span>;
}
```

The precise public type for a site depending on several failed inputs remains
an implementation question. It must not expose compiler source metadata merely
to solve that case.

### 3.3 Group does not wait for everything in `data` by default

An object passed to `data` declares several values covered by the same local
presentation policy. It does not create `Promise.all` semantics.

```tsx
function App() {
  const user = $fetch<User>('/api/user');
  const statistics = $fetch<Statistics>('/api/statistics');

  return (
    <Group>
      <Pending component={InlineSkeleton} />
      <Error component={InlineError} />
      <Dashboard user={user} statistics={statistics} />
    </Group>
  );
}
```

Given:

```tsx
function Dashboard({ user, statistics }) {
  return (
    <main>
      <h1>{user.name}</h1>
      <strong>{statistics.totalSales}</strong>
      <footer>Dashboard</footer>
    </main>
  );
}
```

the behavior is:

- `main` and `footer` mount immediately;
- the `user.name` site shows `InlineSkeleton` while `user` is unavailable;
- the `statistics.totalSales` site shows its own `InlineSkeleton` while
  `statistics` is unavailable;
- if `statistics` resolves first, its site updates immediately;
- `user` remains pending only at the places that read `user`;
- neither value waits for the other.

The object form exists for convenient policy scope, not reveal coordination.

#### Explicit component suspension

When a component is only useful after all of the Group's initial values exist,
the author can request coordinated first mount explicitly:

```tsx
<Group>
  <Pending component={DashboardSkeleton} />
  <Error component={DashboardError} />
  <Dashboard suspend user={user} statistics={statistics} />
</Group>
```

This is the supported atomic readiness form. The suspended component or host
element must be the direct third child, and `suspend` must be a shorthand attribute. The
compiler consumes it before ordinary component prop analysis. While either
source lacks its first committed value, the Group renders one pending policy
and does not mount `Dashboard`. A failure renders one error policy whose retry
targets the failed prerequisite. After the first successful mount, background
refresh keeps the committed component visible.

Without `suspend`, the earlier site-local behavior remains unchanged. This
keeps colorless data as the default and makes the broader coordination cost an
explicit authored directive. The compiler infers its prerequisites from the
colorless values read by the content.

### 3.4 One value used in several places

```tsx
function Profile({ user }) {
  return (
    <article>
      <h1>{user.name}</h1>
      <p>{user.bio}</p>
      <footer>Public profile</footer>
    </article>
  );
}
```

Before `user` resolves, the name and biography are two local pending sites.
The article and footer already exist. When `user` commits, both sites update
through their ordinary generated update paths.

This is intentionally not component suspension. `Profile` ran, created its
static DOM, and established the exact places that need `user`.

### 3.5 Separate expressions remain separate

```tsx
<p>
  <strong>{user.name}</strong>
  <span>{statistics.orderCount}</span>
</p>
```

Each JSX expression is an independent site. Either one can resolve while the
other remains pending.

If one authored expression genuinely requires several values, only that
expression remains unavailable until it can evaluate:

```tsx
<p>{formatSummary(user, statistics)}</p>
```

Its pending UI is still the ordinary `Pending` component declared by the
nearest matching `Group`. No source list is exposed to that component.

### 3.6 Passing data through components

```tsx
function App() {
  const user = $fetch<User>('/api/user');

  return (
    <Group>
      <Pending component={AvatarSkeleton} />
      <Error component={AvatarError} />
      <Layout>
        <Navigation user={user} />
        <Page>
          <Profile user={user} />
        </Page>
      </Layout>
    </Group>
  );
}
```

The value keeps its data-source origin through props and caller-owned children.
`Layout` and `Page` do not become pending merely because they transport or
contain `user`. Only expressions that consume `user` receive the group's local
presentation.

### 3.7 Derived values

```tsx
function Todos() {
  const todos = $fetch<Todo[]>('/api/todos');
  const open = todos.filter((todo) => !todo.done);
  const count = open.length;

  return (
    <Group>
      <Pending component={InlineSkeleton} />
      <Error component={InlineError} />
      <>
        <h1>Todos</h1>
        <strong>{count}</strong>
        <ul>{open.map((todo) => <li>{todo.title}</li>)}</ul>
      </>
    </Group>
  );
}
```

`open` and `count` retain the origin of `todos`. They are not evaluated with a
fake empty array, `undefined`, or placeholder object. Their consuming sites are
pending until the derivation can produce an honest value.

This reuses the framework's existing derived replay and push scheduling, but
availability propagation is new compiler work. Reusing the scheduler does not
mean an unresolved source can be executed as an ordinary derivation.

Resolution replays the derived chain and updates the count and list regions.
This extends the framework's existing replaying-derivation behavior; it does
not add a general async computation graph.

### 3.8 Lists and site-appropriate pending DOM

Different DOM positions may require different pending markup. Nested groups
override the presentation for the same value:

```tsx
function Todos() {
  const todos = $fetch<Todo[]>('/api/todos');

  return (
    <Group>
      <Pending component={InlineSkeleton} />
      <Error component={InlineError} />
      <>
        <h1>You have {todos.length} todos</h1>

        <ul>
          <Group>
            <Pending component={TodoRowsSkeleton} />
            <Error component={TodoRowsError} />
            {todos.map((todo) => <li>{todo.title}</li>)}
          </Group>
        </ul>
      </>
    </Group>
  );
}
```

The outer group supplies the inline policy for `todos.length`. The nearest
inner group supplies list-valid pending/error DOM for the list expression.

Nested groups do not create request copies. They only override presentation at
matching consumption sites.

### 3.9 Conditions and dynamic regions

```tsx
function Account({ user }) {
  return (
    <section>
      <h1>{user.name}</h1>

      {user.isAdmin ? (
        <AdminControls user={user} />
      ) : (
        <MemberControls user={user} />
      )}

      <footer>Account settings</footer>
    </section>
  );
}
```

The name site and the conditional region are separate. The footer renders
immediately. The conditional region uses the pending policy until its branch
can be selected, without blocking the name or the rest of the section.

### 3.10 Attribute and property reads

Not every JavaScript read is a place where fallback DOM can legally be
inserted. For an unresolved attribute/property/class/style value, the element
still mounts and that individual sink remains unset until it can be written:

```tsx
<img src={user.avatar} alt="Profile photo" />
```

The `img` may mount without `src`; `alt` is already present. When `user` becomes
available, the normal guarded property/attribute setter fills `src`.

If an application wants a visible skeleton replacing an entire element, it
should express a structural site around that element. Exact syntax for a
concise structural override remains open; the compiler must not arbitrarily
hide unrelated static content merely because one attribute is unavailable.

### 3.11 Pending DOM legality and stable regions

A value-capable site may alternate between pending content, error content, and
the committed value. The compiler therefore gives each such site a stable
start/end anchor pair. Those anchors belong to ordinary client rendering and
cleanup; they do not commit the separate hydration marker protocol.

The chosen `Pending` and `Error` components must also be legal children of the
site's DOM parent. For example, a fallback inserted inside `p` or `span` must
produce phrasing content, while a fallback inside `tbody` must produce legal
table children. When the compiler can prove that a policy component's root is
illegal at a linked site, it reports a compile-time diagnostic naming both the
policy and the site. When the component shape is dynamic and cannot be proven,
development builds report the invalid insertion with the same source context.

This constraint is local to the consumption site. The compiler must not repair
invalid HTML by moving the fallback, wrapping it in an arbitrary element, or
turning `Group` into a subtree boundary.

### 3.12 Without Group

`Group` is optional:

```tsx
function Greeting() {
  const user = $fetch<User>('/api/user');

  return (
    <header>
      <span>Hello</span>
      <strong>{user.name}</strong>
    </header>
  );
}
```

The unresolved site is empty until it has a value. Static content still mounts,
and settlement fills the exact site.

An initial failure with no matching `Group` propagates the source's
`RequestError` to the application's root render-error path. On the client, an
installed application error handler receives it; without one, the runtime
reports and rethrows it. During SSR, the render operation rejects before it can
be reported as a successful response. Development builds attach the source
binding and consumption-site context; production keeps the same propagation
semantics with less diagnostic metadata. It never becomes a silent empty site.

## 4. Error and refresh behavior

### 4.1 Initial failure

If a source fails before ever committing a value, each affected consumption
site uses the nearest matching group's `Error` component.

Retry is already targeted. A retry action rendered at the failed site retries
the data prerequisite for that site; application code does not select it by
name or index.

### 4.2 Refresh keeps committed UI

Once a value has committed, refreshing it keeps that value visible:

```tsx
function Users() {
  const users = $fetch<User[]>('/api/users');

  return (
    <Group>
      <Pending component={UsersSkeleton} />
      <Error component={UsersError} />
      <>
        <button onClick={() => $track(users).refresh()}>Refresh</button>
        <UserList users={users} />
      </>
    </Group>
  );
}
```

During refresh:

- the current list stays mounted and readable;
- pending components do not replace committed sites;
- a successful answer patches the existing sites;
- a refresh failure does not erase the committed list;
- optional `$track` state may expose the refresh failure or activity when the
  author wants extra UI for it.

`Group` handles the absence of an initial value. It is not a generic network
activity indicator.

## 5. `$track` returns reactive state for authored control flow

`$track(value)` returns the reactive request state associated with that value.
Its fields are reactive reads: when request state changes, conditionals and DOM
sites reading those fields update through the normal compiler/runtime path.

This is the alternative for an author who does not want `Group` and its
automatic local pending/error insertion:

```tsx
function Users() {
  const users = $fetch<User[]>('/api/users');
  const state = $track(users);

  return (
    <section>
      <UsersSkeleton if={state.pending} />
      <UsersError else-if={state.error} error={state.error} />
      <UserList else users={users} />
    </section>
  );
}
```

The author chooses the branches and their placement. `Group` and `$track` are
two presentation styles over the same reactive request state:

- `Group` automatically applies `Pending`/`Error` at exact consumption sites;
- `$track` exposes reactive state so the author can write ordinary
  `if`/`else-if`/`else` regions instead.

`$track` represents the state of `users`; it is not `users`, does not replace
`users`, and is not the target of data mutations.

`$track` is resolved from compiler-preserved source provenance, not by looking
up the resolved payload at runtime. Keeping the prop or binding typed as
`ResolvedValue<T>` is therefore required only where request state must remain
available; ordinary data-only consumers may accept `T`.

The first state surface should be based on the existing resource snapshot:

```tsx
const state = $track(users);

state.status;
state.pending;
state.refreshing;
state.error;
```

An additional `settled` or `stale` field requires a separately agreed semantic
contract. It should not be assumed merely because another async system exposes
similar terminology.

Grouped tracking follows the object names supplied by the author:

```tsx
const user = $fetch<User>('/api/user');
const statistics = $fetch<Statistics>('/api/statistics');
const state = $track({ user, statistics });

state.user.pending;
state.statistics.error;
```

These fields remain independently reactive. Grouped `$track` does not make the
requests settle together.

### 5.1 Data changes remain ordinary writes

`$track` observes and controls request lifecycle; it is not the target of data
mutations. A transparent collection remains an ordinary collection, and the
compiler traces writes through its known aliases:

```tsx
const todos = $fetch<Todo[]>('/api/todos');
const todo = todos.find(item => item.id === id);
if (todo !== undefined) todo.done = true;
```

The exact supported alias/write boundary must be compiler-defined. Writes that
escape compiled code cannot silently promise targeted invalidation.

Automatic consumer cleanup must not depend on calling `$track`. The compiler
and runtime own request attachment and disposal according to structural
ownership.

## 6. State can live everywhere

Transparent data must preserve the framework's module-level state model:

```tsx
// session.ts
export const currentUser = $fetch<User>('/api/session');
```

```tsx
import { currentUser } from './session';

function Header() {
  return (
    <Group>
      <Pending component={AvatarSkeleton} />
      <Error component={SignedOutMark} />
      <>
        <Avatar src={currentUser.avatar} />
        <strong>{currentUser.name}</strong>
      </>
    </Group>
  );
}
```

The same rules apply to local bindings, aliases, derived values, component
props, caller-owned children, keyed rows, and imported module values.

A module-scope `$fetch` declaration describes a lazy source; importing the
module must not start a process-global request or allocate process-global
mutable request state. Each `ApplicationRuntime` materializes its own source
instance on first use, keyed by the compiler-assigned canonical identity. The
instance owns request state, cache policy, consumers, and disposal for that
runtime. This isolation applies to multiple client roots as well as concurrent
server requests.

The implementation should reuse the runtime-owned context/cell lookup and
creation hooks established for request-local state, while preserving the data
source's distinct request lifecycle. A fetched source is not reduced to an
ordinary state cell merely because its ownership lookup follows the same path.

Reactive request inputs are a separate concern. If a module source reads query
or parameter state, changing that input computes a new request identity and
re-executes the source inside each owning runtime; no dependency change means
no new request. Re-execution uses the same stale-while-revalidate rule as manual
refresh: a previously committed value remains visible and is replaced only by
a successful result. Reactive re-execution does not solve ownership and must
never cause runtimes to share one mutable source instance.

## 7. Existing data behavior that remains

The new authoring surface does not replace the existing data engine. The
following responsibilities stay below it:

- normalized method/URL/query/header request identity;
- active request sharing and optional application retention;
- request generation tokens so stale responses cannot win;
- Standard Schema validation;
- structured request errors;
- abort and cleanup behavior;
- refresh and local updates;
- `$action` invocation state and concurrency;
- optimistic transaction ordering, commit, reconciliation, and rollback;
- request-local server data runtimes.

The work is primarily connecting this engine to compiler-owned value flow and
push invalidation while replacing the accessor-heavy author surface.

## 8. Compiler contract

The compiler must understand a generic transparent-async-source category. It
must not contain a one-off rule based only on a function being named `$fetch`.
The data package supplies the first implementation of that category.

### 8.1 Every transparent read is accounted for

Enforcement cannot stop at JSX sinks. The compiler must classify every read of
a transparent source or a derived value carrying its provenance:

- render expressions, attributes, conditions, and derived computations become
  availability-aware update entities and do not execute until their required
  values are committed;
- event handlers, effects, module statements, call arguments, and other
  imperative reads first resolve the committed payload from the owning source;
- a read that executes before an initial value exists throws an
  `UnresolvedDataReadError` naming the authored binding and read site;
- passing a transparent value into unknown or uncompiled code must either pass
  an honestly resolved `T` at execution time or produce a compiler diagnostic
  when that cannot be guaranteed.

This guard is an honesty check on a source the compiler already knows. It is
not a thrown pending token used to discover dependencies or search for a
boundary. A future settled-path optimization may remove a provably redundant
guard, but correctness must not depend on that optimization.

Required compiler responsibilities:

1. Assign a stable canonical identity to every transparent source binding.
2. Preserve its origin through aliases, derived values, props, children,
   imports, conditions, and keyed rows.
3. Classify and instrument every transparent read, including reads outside DOM
   creation, according to section 8.1.
4. Associate every consuming DOM sink or structural region with its source
   prerequisites.
5. Validate that each `Group` has exactly `Pending`, `Error`, and one content
   child; several content siblings must be wrapped in a fragment.
6. Make an initially unavailable site render its nearest matching pending
   policy without preventing unrelated creation work.
7. Replace only that local pending/error content when prerequisites change.
8. Replay derived chains only when their source values can be read honestly.
9. Route source transitions through existing canonical invalidation and
   ordinary update entities.
10. Bind local error retries to the failed prerequisite automatically.
11. Generate stable local anchor pairs and structural cleanup for source
    consumers.
12. Check statically knowable pending/error output against the DOM context of
    every linked site and retain contextual development diagnostics for dynamic
    output.
13. Diagnose flows that escape into code where transparent reads cannot be
    preserved safely.

This is static data-flow integration, not runtime dependency collection.

## 9. Runtime/data contract

The runtime and data package remain responsible for:

- lazily materializing a source inside the current `ApplicationRuntime` rather
  than at module import time;
- current source state: unavailable, committed, refreshing, or failed;
- the last committed value;
- the active request and generation identity;
- resolving guarded imperative reads to that committed payload;
- publishing a push invalidation when that state changes;
- request sharing and consumer lifetime;
- targeted retry, refresh, and abort;
- preserving a committed value during refresh;
- propagating unhandled `RequestError` instances to the application/root render
  error path, including rejection of an SSR render;
- disposing work when its final structural consumer leaves.

The runtime must not build a general observer graph from arbitrary reads. The
compiler has already emitted the relevant ownership and invalidation routes.

## 10. Consumption-site semantics

| Source state | Renderable value site | Attribute/property sink | Imperative read |
|---|---|---|---|
| Initially unavailable, matching Group | local `Pending` component | leave sink unset | `UnresolvedDataReadError` |
| Initially unavailable, no Group | empty local region | leave sink unset | `UnresolvedDataReadError` |
| Committed | committed value | guarded write | value |
| Refreshing with committed value | keep committed value | keep committed value | committed value |
| Initial failure, matching Group | local `Error` component | leave sink unset | `RequestError` |
| Initial failure, no Group | propagate `RequestError` to app/root render path | leave sink unset | `RequestError` |
| Refresh failure with committed value | keep committed value | keep committed value | committed value; error available through `$track` |

No row in this table requires a `loading` check from the author.

## 11. Explicitly rejected

- An implicit `Ready`, `Loading`, `Suspense`, or equivalent whole-subtree gate.
- Waiting for every inferred content dependency without a direct content
  element explicitly marked `suspend`.
- Passing `sources`, indexes, canonical keys, or compiler IDs to pending UI.
- Making authors inspect `available`/`pending` before ordinary value reads.
- Runtime dependency tracking or an async reactive graph.
- Throwing an internal not-ready token through computations to discover a
  boundary.
- Proxy-wrapped resolved values.
- Thenable resources.
- Returning `T | undefined` as the primary authoring type.
- Attaching `refresh`, `update`, `remove`, or other capability members directly
  to payload objects and arrays; payload fields may use those names.
- Making development throw while production silently renders an empty failed
  site; failure propagation is the same in both modes.
- Optional or reordered `Group` policy children. Authors choosing automatic
  local policy provide both declarations in the normalized three-child form.
- Moving fetch operations or optimistic transaction producers onto the state
  returned by `$track`.
- Treating `$fetch` as a generic async-computation API for viewport, timers, or
  arbitrary client-only state.
- Implicitly declaring an error handled merely because `.error` appears
  somewhere in a component.

## 12. Relationship to SSR

SSR should pause before hydration marker design while these semantics are
settled. The data model determines:

- whether each consumption site emits pending, error, or committed content;
- which local regions can change after a request settles;
- what resource snapshots are transferred;
- how module-level data remains request-local;
- what the client restores before hydration;
- how a server-pending local site becomes a client-committed local site.

The current LinkeDOM reference renderer and request-local runtime work remain
useful infrastructure. This RFC must not claim hydration markers or branch-skew
behavior are already frozen or proven.

## 13. Implementation sequence

1. **Semantic fixtures first** — encode the DX cases in this RFC as authored
   compiler fixtures, especially independent sites and cross-component props.
2. **Generic source description** — define how a library declares that a call
   produces a compiler-transparent async value without hard-coding `$fetch` by
   name.
3. **Runtime-owned source materialization** — make module and local source
   descriptions instantiate lazily inside the current `ApplicationRuntime`,
   with isolation fixtures for multiple roots and concurrent server requests.
4. **Push transition bridge** — make FetchStore transitions commit canonical
   source identities instead of relying on volatile polling.
5. **Value-flow analysis and read enforcement** — propagate source origins and
   instrument every read through aliases, derivations, props, children,
   imports, conditions, keyed rows, effects, and event handlers.
6. **Local site emission** — add stable anchors, DOM-legality diagnostics, and
   pending/error handling to existing scalar and structural regions without
   creating a new application-wide scheduler.
7. **Group lowering** — validate exactly three children, consume
   `Pending`/`Error` declarations as local presentation policies, and implement
   nesting plus nearest-match behavior.
8. **`$track` surface** — expose request identity, reactive lifecycle state,
   outcome observation, refresh, and abort without turning it into a data store.
9. **Ownership and escape diagnostics** — automatic cleanup plus clear errors
   for unsupported imperative/uncompiled escapes.
10. **SSR contract** — define success snapshots, restore-before-create, and
   server-pending local-site behavior before resuming hydration protocol work.

## 14. Decision log

```text
Decision: $fetch returns ResolvedValue<T>, directly usable and assignable as T without a .value accessor.
Status: proposed
Reason: data should pass through normal TypeScript and component props without accessor or null plumbing while retaining typed fetch operations.
Constraint: ResolvedValue is type-only provenance; native payload objects and arrays are not mutated to attach methods, and no proxy or runtime dependency graph is introduced.
```

```text
Decision: Group supplies presentation independently at exact consumption sites by default; a direct component or host child may explicitly opt into atomic initial readiness with shorthand suspend.
Status: proposed
Reason: static component content and independently resolved values should render without waiting unless the component author declares that partial initial output is not useful.
Rejected alternative: implicit whole-branch readiness and Promise.all-style grouping without an authored suspend directive.
```

```text
Decision: Group has exactly three direct children: Pending, Error, and one content child.
Status: accepted authoring direction
Reason: a normalized shape avoids ambiguous content classification and gives the compiler one stable content scope; multiple content siblings use a fragment.
Rejected alternative: optional policies or extra direct content children; authors wanting custom policy control use $track.
```

```text
Decision: Pending receives no source metadata.
Status: proposed
Reason: source identity is compiler bookkeeping and the same pending component should be usable at every matching local site.
```

```text
Decision: Error retry is automatically targeted to the failed prerequisite at its local site.
Status: proposed
Reason: application code should not locate resources by source arrays, indexes, or canonical keys.
Open point: representation when several prerequisites of one expression fail.
```

```text
Decision: $track returns optional reactive state for authored conditional rendering.
Status: proposed
Reason: authors who do not want Group's automatic local insertion need reactive pending/error/status fields for ordinary if/else regions.
Constraint: $track state is not the fetched value and is never the target of payload mutation.
```

```text
Decision: module-scope fetch declarations materialize lazily per ApplicationRuntime.
Status: proposed
Reason: authored state may live anywhere, but mutable request state may not leak across client roots or server requests.
```

```text
Decision: an initial failure without a matching Group propagates through the application/root render-error path.
Status: proposed
Reason: a failed source must not leave an unexplained permanent hole; SSR rejects and client handling remains explicit, with no silent production-only fallback.
```

## 15. Open questions

1. Final names for `$track`, `Pending`, and `Error`.
2. The concise explicit syntax for replacing a whole element when one of its
   attributes is unavailable; default attribute behavior remains deferred
   assignment.
3. Which imperative escapes can be proven safe after a settled guard and which
   require an explicit value-resolution API.
4. The minimum `$track` vocabulary for the first version; semantic staleness
   should not be exposed before reactive request identity exists.

## 16. Proposed design for the remaining compiler/runtime slices

This section turns the remaining implementation boundaries into one coherent
contract. The names are illustrative internal names, not additions to the
author API. The design preserves these non-negotiable properties:

- authored values remain their real `T` values;
- payload objects and arrays are never decorated or proxied;
- `.value` is never introduced;
- availability and provenance are compiler knowledge, not runtime read
  discovery;
- every invalidation still targets an ordinary Memoized DOM entity;
- application and server-request runtimes never share mutable source state.

### 16.1 Four different things must not be conflated

| Layer | Meaning | Visible to authored code? |
|---|---|---|
| payload | The committed `T`, such as `User` or `Todo[]` | yes |
| source handle | The internal owner of request state and operations | no |
| projection | A compiler-emitted recipe from one or more source handles to a payload | no |
| site entity | The existing runtime update unit for one DOM/prop/structural consumer | no |

`ResolvedValue<T>` remains a type-level authoring promise. At runtime the
compiler may keep a source handle in the generated binding, but every authored
read resolves to the payload. A derived value is different: its generated
binding may hold an ordinary payload snapshot, while the compiler separately
retains the projection that can produce a fresh snapshot.

### 16.2 Derived payloads cross props through a private projection ABI

Consider ordinary authored code:

```tsx
function App() {
  const todos = $fetch<Todo[]>('/api/todos');
  const open = todos.filter(todo => !todo.done);
  return <TodoCount todos={open} />;
}

function TodoCount({ todos }: { todos: Todo[] }) {
  return <strong>{todos.length}</strong>;
}
```

`open` must arrive as a real `Todo[]`. It cannot carry hidden properties and
the public prop type must not become a resource wrapper. The compiler therefore
passes a second, private argument parallel to ordinary props. Conceptually:

```ts
interface DataProjection<T> {
  readonly sources: readonly SourceHandle<unknown>[];
  read(): T;
}

TodoCount(id, parent, [openPayload], {
  todos: projection([todosSource], values =>
    (values[0] as Todo[]).filter(todo => !todo.done)
  ),
});
```

The actual representation may be a compact tuple. Its required semantics are:

1. `sources` contains the flattened base prerequisites in deterministic
   authored order. A projection never points at a mutable derived payload as
   its source of truth.
2. `read()` resolves the latest committed base payloads and reruns the pure
   projection. It throws the ordinary `RequestError` or
   `UnresolvedDataReadError`; it never throws a suspension token.
3. The normal prop slot contains the ordinary payload when available. During
   generated pending creation it may contain an internal placeholder, but all
   authored reads are still guarded by the compiler and can never observe that
   placeholder.
4. The child replays its local prop binding from the projection before any
   dependent site update. Event handlers and effects resolve the projection at
   execution time rather than closing over a stale payload snapshot.
5. If the child forwards the prop unchanged, it forwards the same projection.
   If it derives another value, the compiler composes and flattens a new
   projection over the original base sources. It does not depend on listener
   execution order between parent and child.
6. A local `Group` in the child matches the projection's base prerequisites.
   An inherited Group policy remains a separate private policy argument; data
   provenance and presentation policy are not one object.
7. `$track` accepts a compiler-proven projection and reports reactive state
   aggregated from its base prerequisites. Controls that require one concrete
   request are rejected for a derived value with multiple base sources.
8. Passing a derived value to uncompiled code resolves and passes `T` at that
   execution point. The private projection never escapes the compiled graph.

If several prerequisites fail, authored dependency order is the deterministic
selection order. The Error component receives the first failure and its retry
targets that prerequisite. If it succeeds while another prerequisite remains
failed, the same site presents the next failure. No source list or index enters
the author API.

For `$track(derived)`, `pending` means at least one prerequisite has no committed
value, `refreshing` means at least one prerequisite is refreshing while all
required committed payloads remain readable, and `error` follows the same
deterministic first-failure rule. `$track({ left, right })` remains the explicit
keyed form when the author wants separate state per named value rather than one
aggregate projection state.

TypeScript method return types do not preserve the `ResolvedValue` phantom
brand through arbitrary user derivations. Consequently `$track` declarations
must accept ordinary inferred payload types and rely on the compiler to require
transparent provenance at those call sites. Group dependencies come from
compiler provenance across its content. `$track({ left, right })` receives a mapped state result. Broad intrinsic
typing must not make an unproven `$track(ordinaryValue)`
silently work: the compiler emits a provenance diagnostic, and the compile-only
fallback throws when invoked without transformation.

The compiler manifest/linker should serialize projection origins as canonical
source references plus prop-flow edges, not JavaScript closures. Each caller
emits its own small `read()` closure from linked provenance. This keeps module
summaries serializable and lets minification rename local bindings safely.

The first implementation should support projections through named props and
compiled children/render slots. Prop spreads require either a statically
enumerable expansion or a diagnostic; a private provenance map must never be
merged into the authored props object.

### 16.3 Exact invalidation uses ordinary site entities

Source transitions must stop calling `markDirtySubtree(owner)`. The compiler
already knows every source prerequisite and every consumer, so it can emit a
fixed route without building a runtime observer graph.

Each async consumption site is assigned a deterministic entity identity under
its smallest structural owner, for example `owner/$data/0`. The mapping is:

| Consumption | Exact target |
|---|---|
| text, attribute, property, class, or style | a small data-site entity whose render closure updates only that sink |
| automatic pending/error/value expression | its conditional region entity |
| keyed `.map` | its list region entity |
| component prop projection | a prop-push site entity in the caller |
| effect | the existing effect entity |
| imperative event read | no subscription; resolve when the event executes |

Creation evaluates each site once and registers its update closure using the
existing `register({ id, parent, render })` contract. Structural sites reuse
the conditional/list entities they already own instead of registering a
second wrapper.

The initial implementation installs a fixed, site-owned subscription for each
exact entity. A later code-size pass may coalesce subscriptions by mounted
owner and base source and call a small `markDirtyMany(ids, reason)` helper.
That is an identity-neutral batching optimization: both forms mark the same
compiler-known site IDs and neither performs runtime dependency collection.
Dynamic rows install the same fixed routes relative to their row owner.

Transparent structural entities cover their active branch. Sinks beneath that
branch remain in its ordinary branch updater and do not install duplicate
source subscriptions or redundant `$data` entities. A separately mounted
child still owns its own transported-source subscriptions.

Important ordering rules:

1. Projection replay happens inside the exact site's render closure before its
   sink update.
2. Caller prop-push sites are parents of the receiving child entity. A prop
   push may dirty the child, which joins the same commit drain after its
   parent.
3. A list source dirties the list region. Reconciliation pushes changed item
   props to retained rows; the compiler must not subscribe every row directly
   merely because the row receives an item produced by that list.
4. A row that directly closes over an unrelated source receives its own
   row-relative site subscription.
5. Several sites may recompute the same pure projection initially. Sharing a
   compiler-known projection entity is a later optimization, not a semantic
   runtime graph and not required for correctness.

Ownership is split deliberately:

- a component-local source is disposed once by the component instance that
  created it;
- a module source is disposed only with its `DataRuntime`;
- prop/children consumers own only their subscriptions;
- a structural site owns its site entity, anchors, policy components, and
  subscription cleanup, never the transported source.

This eliminates broad subtree work without changing the scheduler, access
table, component update model, or Group semantics.

### 16.4 Module sources are immutable descriptions, not live requests

A module-level declaration must be safe when ESM evaluates outside any server
request:

```tsx
export const currentUser = $fetch<User>('/api/session');
```

The compiler lowers it conceptually to an immutable description:

```ts
const currentUser = defineSourceDescription(
  './session.ts#currentUser',
  () => fetchDescription<User>('/api/session'),
);
```

`defineSourceDescription` does not call `fetch`, create an abort controller, or
select the browser-default data runtime. Importing the module therefore has no
request side effect.

Every `DataRuntime` owns a source-instance map. The first read, subscription,
or `$track` use materializes the description in the currently active
runtime. The map key is the compiler's canonical source identity. Materialized
state includes the fetch controller, request/cache identity, last committed
payload, error/status, generation, and consumer set. Two application runtimes
evaluating the same shared module description receive different instances.

Each mounted application runtime is paired with one data runtime. Mount/server
entry points activate that pair for compiled execution; a process-wide browser
data singleton must not become the storage owner for a second independent
application root merely because both roots imported the same module.

The lifecycle contract is:

- module descriptions live with the evaluated module graph and are immutable;
- module source instances live until `DataRuntime.clear()`/application-runtime
  disposal;
- component-local source instances live until their creating structural owner
  leaves;
- imported consumers never acquire disposal authority over either source;
- browser HMR replaces a description version and explicitly retires stale
  instances rather than silently reusing them.

Request arguments are evaluated inside the owning runtime when the description
materializes. If those arguments read reactive route/module state, the compiler
also emits a source-description entity with those exact dependencies. A change
re-evaluates the description and rebinds the materialized source. Rebinding
keeps a committed payload visible while the new request is in flight and uses
the existing generation rule so the old response cannot win.

Module-level derivations of transparent data are lazy projections too; they
must not read a payload during ESM evaluation. Module-level `$track` views must
be runtime-relative facades over the description/projection and must not
capture a materialized controller.
Otherwise the compiler should require those calls to occur inside a
runtime-owned execution scope.

The same descriptor rule applies to module-level `$action` declarations.
Their immutable declaration may live at module scope, but invocation state and
abort/concurrency bookkeeping materialize in the active `DataRuntime`.

Source descriptions are a distinct facility from runtime state cells. They may
reuse application-runtime lookup hooks and canonical linker identities, but
their request lifecycle, sharing, refresh, validation, and serialization stay
owned by the data package.

### 16.5 SSR has an explicit settle mode and shell mode

Non-streaming SSR needs an explicit answer for an unresolved resource at
flush. The server API should expose two modes:

```ts
type ServerDataMode = 'resolve' | 'shell';
```

`resolve` is the default production SSR mode:

1. Run a synchronous creation pass. Used source descriptions materialize and
   local sites initially render Pending/empty content.
2. Await all requests started by that pass.
3. Re-enter the request's application, router, data, and document contexts and
   drain the ordinary runtime commit queue.
4. Repeat because newly committed structural branches may reveal additional
   sources.
5. Stop at quiescence, an abort signal, a configured deadline, or a bounded
   maximum number of discovery rounds.

A handled initial error renders its nearest Group Error site. An unhandled
initial error rejects the render. A refresh failure with committed data keeps
the committed server HTML, matching client semantics.

`shell` performs one creation pass and flushes Pending/empty sites immediately.
It does not wait for data and is not streaming. A shell-mode data runtime should
record descriptions without starting server network work that will immediately
be aborted; the client starts those requests after adoption.

Moving from today's synchronous reference renderer to `resolve` requires an
async-safe context boundary. No ambient application/data/router/document
pointer may remain installed across an `await`. Source callbacks capture their
owning application runtime, and each synchronous create/commit phase re-enters
all request contexts with `try/finally`. Emitted element creation must use the
runtime's `RenderEnvironment.document` before concurrent async SSR is enabled.

### 16.6 Data transfer is source-state transfer, not closure serialization

The state envelope contains only materialized source snapshots required by the
rendered tree. A version-one conceptual shape is:

```ts
interface SerializedDataStateV1 {
  readonly formatVersion: 1;
  readonly sources: readonly {
    /** Module key, or declaration key plus deterministic structural owner. */
    readonly sourceId: string;
    /** Build/provider contract, independent from the payload value. */
    readonly contractId: string;
    /** Safe digest used to reject a different evaluated request. */
    readonly requestFingerprint: string;
    readonly snapshot:
      | { readonly status: 'success'; readonly data: JsonValue }
      | { readonly status: 'error'; readonly error: SerializedRequestError }
      | { readonly status: 'pending' };
  }[];
}
```

Rules:

1. Source IDs are deterministic across the server/client build pair. Local
   source IDs include the deterministic component/row owner ID; module source
   IDs use the canonical linker identity.
2. `contractId` covers the transparent-source provider, declaration identity,
   schema/decoder contract, and payload format version. It contains no user
   data.
3. `requestFingerprint` is derived from the non-secret portion of normalized
   request identity and never embeds or hashes a URL credential, secret header
   value, cookie, or bearer token. If removing those inputs makes compatibility
   ambiguous, the source is non-transferable by default unless the host
   supplies an explicit public transfer key and inclusion policy.
4. Only JSON-safe validated payloads transfer in version one. Custom values
   require an explicit serializer/validator pair; closures, promises, signals,
   DOM nodes, symbols, and active request handles never transfer.
5. Errors use a deliberately sanitized `SerializedRequestError`; causes,
   response bodies, headers, and private validation inputs are excluded unless
   an application serializer explicitly opts in.
6. Successful snapshots restore as committed and do not issue a duplicate
   initial request. Cache/retention policy determines later revalidation.
7. Pending snapshots restore in a paused-pending state. Their network work
   starts only after the corresponding hydration owner has adopted.
8. Error snapshots restore the same local Error branch. Retry remains targeted
   through the restored source handle.
9. A refreshing source transfers its committed payload plus a `revalidate`
   intent, never an in-flight promise. Revalidation resumes after adoption.
10. A host may omit private data. If omitted state was needed for committed
    server HTML, hydration remounts only the affected data-site entity to its
    pending state; it must not trust mismatched DOM or discard the whole root.

The host integration owns inclusion policy and safe JSON embedding in the
scoped `application/mmd+json` channel. Adoption metadata and data state remain
separate envelopes exactly as required by `ssr-proposal.md`.

### 16.7 Restore happens before component hydration

The client sequence is fixed:

1. Parse and independently validate the transport, manifest, router state, and
   data-state envelopes.
2. Create the client `ApplicationRuntime`, router runtime, and `DataRuntime`.
3. Install valid serialized source records into the data runtime's dormant
   restore table.
4. Enter hydration and run compiled factories. A source description claims a
   record only when `sourceId`, `contractId`, and request fingerprint all
   match.
5. Adopt/register exact data-site entities using the same IDs that rendered on
   the server.
6. After the root adopts successfully, start pending sources, requested
   revalidations, refs, and effects in their documented order.
7. Remove the scoped payload element when the host/runtime contract says it is
   no longer needed.

Data sites require no new hydration marker category. Scalar sites use their
own deterministic entity metadata, while pending/error/value structural output
uses the same conditional/list boundary markers required for ordinary client
structure. A source state mismatch therefore recovers at the data site or its
existing structural region, not at an application-wide suspense boundary.

Manifest incompatibility still forces ordinary client creation. Independently
valid data state may be retained for that creation; invalid or unmatched source
records are dropped with development diagnostics and never guessed by array
position.

### 16.8 Implementation slices and gates

1. **Projection ABI:** add compiler/linker provenance summaries for derived
   props and children, emit private flattened projections, and prove two-level
   forwarding plus event/effect freshness.
2. **Exact site entities:** specialize scalar/prop consumers, reuse existing
   structural entities, replace subtree invalidation, and benchmark registry
   and emitted-size cost.
3. **Runtime source descriptions:** lower module `$fetch`/`$action`, materialize
   per `DataRuntime`, and prove two roots plus concurrent requests over one
   shared module record.
4. **SSR settle coordinator:** add resolve/shell modes, async-safe context
   re-entry, abort/deadline/discovery-round behavior, and Group error fixtures.
5. **Snapshot envelope:** serialize/restore success, pending, error, and
   refreshing states with security and JSON-shape tests.
6. **Hydration handoff:** restore before factory execution, defer pending work
   until adoption completes, and prove zero duplicate successful requests.

The first three slices are data/compiler work and do not require hydration
marker emission. Slice four must not begin until generated DOM creation is
routed through `RenderEnvironment.document`; otherwise asynchronous concurrent
SSR would reopen the ambient-document isolation seam recorded in `ssr.md`.
