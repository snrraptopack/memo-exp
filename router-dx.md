# Router DX and Route Loading Design

Status: proposed architecture. Decisions that remain open are listed at the
end; they must not be silently chosen during implementation.

This document is the current router design discussion. It corrects assumptions
in the older `router-autocompletion-spec.md`, particularly around arbitrary
element navigation, route identity, and asynchronous route readiness.

## Design principles

1. Routes remain compiler-owned JSX. There is no second route configuration
   table, provider, router component, outlet component, or hook API.
2. The structural route graph is complete before any lazy route module loads.
   Loading code must never decide whether a URL exists.
3. Nested layouts remain ordinary DOM. Only the selected child route region is
   replaced.
4. Navigation, module availability, pending presentation, and application
   policy are separate layers.
5. Native HTML semantics win. A URL destination is authored as an anchor, not
   a synthetic clickable `div`.
6. Server rendering, client adoption, HMR, links, and navigation use the same
   deterministic route identities.
7. The generated application route table provides editor types without
   requiring application code to import generated per-route helpers.

## What exists today

Routes are static JSX attributes:

```tsx
export function App() {
  return (
    <main route="/">
      <Home route="/" />
      <section route="/reports">
        <Report route="/:reportId" />
      </section>
      <NotFound route="/*" />
    </main>
  );
}
```

The compiler currently:

- collects `route` declarations from every module in the connected static
  import graph;
- composes paths through lexical JSX ancestry;
- validates ambiguity, parameters, catch-alls, and static `route-to` targets;
- emits one manifest in the application root;
- lowers each route to an independently selected conditional DOM region.

The router currently:

- matches the complete manifest synchronously;
- runs `blockNavigation()` before committing navigation;
- commits history, route state, and selected matches synchronously;
- exposes a request-local runtime during SSR;
- owns cancellation, scroll restoration, and navigation observation.

DOM creation is already conditional: an unmatched route does not create its
branch. JavaScript is not lazy: route components are still static imports in
the eager Vite graph.

Route-state subscriptions are also broader than necessary. A component that
reads `route.query.get('tab')` is notified for every route-state change. This
does not rerun the component factory, but it can recompute compiled derivations
and updates that could have been skipped.

## Target architecture

The router should have four explicit layers:

```text
authored route JSX
        |
        v
complete structural graph -----> generated route types
        |
        v
matched route instances -------> route-module resources
        |
        v
navigation transition ---------> pending/error presentation
```

Structural matching remains synchronous. Route-module resources and rendering
readiness may be asynchronous. Presentation decides what the user sees while a
matched resource is unavailable.

## Component-owned route subtrees

Lexical nesting works today:

```tsx
<section route="/reports">
  <Report route="/:reportId" />
</section>
```

Component ownership should describe the same route tree:

```tsx
// App.tsx
<Reports route="/reports" />

// Reports.tsx
export function Reports() {
  return (
    <section>
      <ReportIndex route="/" />
      <Report route="/:reportId" />
    </section>
  );
}
```

The expected paths are `/reports` and `/reports/:reportId`. The rule is:

> A route-bearing component callsite instantiates the route subtree owned by
> that component beneath the callsite route.

The compiler therefore needs two concepts:

- a route-subtree template discovered inside the component definition;
- a route instance created when that component is rendered at a route-bearing
  callsite.

If the same component is rendered beneath `/reports` and `/admin/reports`, the
manifest receives two route-instance subtrees. They share component code but
have distinct route identities and full paths.

Cloning manifest definitions is not sufficient. The compiled component body is
emitted once, so its conditional route regions must receive hidden contextual
instance identity from the callsite. Specializing and duplicating the complete
component for every callsite is not the intended model.

### Route identity requirements

Current IDs contain source line and column numbers. Those are unsuitable as the
long-term identity contract because unrelated edits can move a route.

A route-instance ID must be:

- deterministic across client and server builds;
- unique for every instantiated callsite subtree;
- available to both the manifest and compiled route region;
- stable when unrelated lines move;
- replaceable coherently during HMR;
- independent of chunk loading order.

The final encoding is an implementation detail, but it should derive from the
semantic component/callsite chain and a stable local route key, not raw source
coordinates alone.

## Structural manifest and lazy modules

The application root retains one complete structural manifest:

```text
route instance
  id
  pattern
  full pattern
  parent id
  component/module ownership
  optional client loader
  optional server loader
```

Lazy route modules never install their own replacement resolver. Evaluating a
chunk only satisfies its module resource; it does not mutate the declared route
graph.

This allows the router to match `/reports/42`, validate links, and select the
correct SSR modules before the Reports client chunk has been downloaded.

## Automatic route chunking

The normal authoring experience remains:

```tsx
import { Reports } from './routes/Reports';

export function App() {
  return <Reports route="/reports" />;
}
```

The initial compiler rule should be:

- an imported component referenced exclusively as a route boundary becomes an
  automatic dynamic chunk;
- a local component remains in its containing module's chunk;
- an imported component also used as ordinary eager UI remains eager;
- moving a component into a route-only module is how an author forces a clean
  chunk boundary.

An explicit `lazy` attribute is not an effective escape hatch when the same
module is statically imported elsewhere: that static import has already made
the module eager. If a demonstrated use case needs an override, an `eager`
escape hatch is more honest than pretending an already-eager module is lazy.

The Vite graph must analyze route-lazy edges for the complete manifest without
turning them back into eager output imports. Route CSS and side-effect ownership
must follow the resulting chunk graph, and HMR must invalidate the affected
route resource without replacing the complete manifest with a partial graph.

## Navigation contract

Controlled navigation is prepare-before-commit when the destination owns
`$routed` work:

```text
intent
  -> synchronous guards
  -> prospective route match
  -> route module and $routed preparation
  -> redirect | not found | error | superseded | ready
  -> committed
  -> destination mounted
  -> scroll restored
```

The currently committed route and DOM remain active while the prospective
route is prepared. This is what allows authentication, authorization, and
route-level data requirements to finish before a controlled link or
`navigate()` call changes the application route.

`blockNavigation()` remains synchronous and runs before preparation. It
handles conditions already known on the client, such as unsaved form state or
an immediate redirect. It must not accept promises. `$routed` is the separate
asynchronous route-preparation capability; it must not be hidden inside
`blockNavigation()`.

Browser Back/Forward traversal is the unavoidable exception. With the History
API, the browser changes the address bar before delivering `popstate`. The
router may preserve the previous DOM and its frozen route snapshot while it
prepares the traversed destination, but it cannot promise pre-commit address
bar behavior for traversal. The Navigation API may improve this where
available, but it is not the compatibility baseline.

The current `navigate()` result describes synchronous commitment. Once route
preparation is introduced, its final contract must distinguish a blocked
intent, a redirected preparation, a failed preparation, commitment, and DOM
readiness. Transition state exposes preparing, ready, error, retry, and
superseded states to the currently mounted application.

The default structural behavior during controlled preparation is therefore:

- the current route snapshot and selected DOM remain committed;
- matched destination modules and `$routed` work may load without mounting the
  destination;
- a successful preparation atomically installs the destination route snapshot
  and prepared data before its component mounts;
- a redirect starts preparation for the redirected destination without first
  mounting the rejected destination;
- an error leaves the current route committed and is presented by the route
  transition policy;
- traversal retains a frozen previous snapshot until the already-changed URL
  is ready to become the active application route.

Scroll restoration must move from URL commitment to DOM readiness for lazy
routes. Hash scrolling cannot succeed reliably before the target route region
has mounted. A superseded transition must never restore its scroll position
after the newer transition becomes active.

## Route-module resource and async presentation

A route module has an internal lifecycle:

```text
idle -> loading -> ready
                 -> error -> retry
       loading -> superseded
```

Module loading and data loading remain different resource implementations:

- module code is immutable for a build and cached after success;
- application data has request identity, freshness, invalidation, and abort
  semantics;
- component-owned data cannot begin until its module is available unless the
  data declaration is separately extracted into the route manifest.

They should still share a presentation protocol so an application does not
learn unrelated pending/error concepts. The current data `Group`, `Pending`,
and `Error` implementation is not generic yet; it is compiler-lowered around
transparent data sources and requires a specific three-child structure.

The intended direction is to extract a framework-level availability-boundary
protocol that both data resources and route-module resources can participate
in. This does not make the router depend directly on `@memoized-dom/data`.

The boundary policy must eventually define:

- initial route pending UI;
- nested child pending UI while a parent layout remains;
- optional previous-child retention with a frozen snapshot;
- route-module error presentation;
- retry without changing the current URL;
- behavior when a transition is superseded.

The exact authored boundary syntax remains open.

## Route preparation with `$routed`

`$routed` is route preparation, not another spelling of `$fetch` and not a
colorless render value. It runs before a controlled navigation commits. The
destination component mounts only after its successful result has been stored
on the destination route instance, so consuming that result does not require a
data `Group`.

```tsx
import { $routed, redirect } from '@memoized-dom/router';

export function ReportPage() {
  const page = $routed(({
    state,
    params,
    locals,
    services,
    signal,
  }) => {
    // `state` is the dedicated route-level data cache state. It does not own
    // params, request context, services, or navigation information.
    if (!locals.user) return redirect('/login');

    return services.reports.loadPage(
      params.reportId,
      locals.user.id,
      { signal },
    );
  });

  return (
    <article>
      <h1>{page.report.title}</h1>
      <p>Viewing as {page.viewer.name}</p>
    </article>
  );
}
```

The callback receives one context object. `params`, `url`, `query`, `request`,
`locals`, `services`, `platform`, `signal`, and other route/server capabilities
are normal top-level fields on that context. `state` is one additional field,
reserved exclusively for route-level data caching:

```ts
$routed(({
  state,    // route-level data cache only
  params,   // destination path parameters
  url,
  query,
  request,
  locals,
  services,
  platform,
  signal,
}) => {
  // route preparation
});
```

`state` must not grow into a second route context or a bag of unrelated
framework capabilities. It is also not the navigation transition status
object; preparing, pending, failure, and supersession belong to the router
transition. In particular, these are incorrect:

```tsx
$routed(({ state }) => {
  state.params.reportId; // wrong
  state.query.get('tab'); // wrong
  state.request; // wrong
  state.locals; // wrong
  state.services; // wrong
});
```

The normal framework surfaces remain authoritative:

| Concern | Access |
|---|---|
| Destination path parameters | callback `params` |
| Destination URL and query | callback `url` and `query` |
| Request and cancellation | callback `request` and `signal` |
| Application request data | callback `locals` |
| Server capabilities | callback `services` and `platform` |
| Route-level data caching | callback `state` |
| Committed route reads outside preparation | the normal `route` facade |

These fields are siblings. The correct expression is `params.reportId`, never
`state.params.reportId`. The callback context represents the prospective
destination even while the currently committed component tree still observes
the previous `route` facade. Every preparation context must be isolated across
SSR requests and concurrent or superseded client transitions.

The exact cache operations exposed by `state` are intentionally not specified
yet. Cache keys, freshness, invalidation, reuse, revalidation, and persistence
must be designed together. Until then, examples and implementation must not
invent members such as `state.params` or treat `state` as generic component or
history state.

### Generated route-server-function boundary

`$routed` may access server capabilities only if its callback is compiled in
the same style as a server function. The `$routed` operation participates on
both server and client, but a callback that uses server context is not shipped
or executed as ordinary browser code:

```text
SSR / server navigation
  -> invoke the extracted route preparation directly

browser navigation
  -> invoke the generated route-preparation facade
  -> dispatch to the extracted preparation on the server
```

This permits co-located route preparation without sending raw server objects
to the browser:

```tsx
import { $routed, redirect } from '@memoized-dom/router';

export function ReportPage() {
  const page = $routed(({ state, params, locals, services }) => {
    if (!locals.user) return redirect('/login');

    return services.reports.loadPage(params.reportId, locals.user.id);
  });

  return <h1>{page.report.title}</h1>;
}
```

There is no redundant `getServerContext()` call inside `$routed`; the same
typed request context is already present on the callback argument. `state`
remains the cache-specific sibling of that normal context.

No authored `await` is required. The extracted preparation may return a plain
value, a promise produced by an application service, a colorless server-function
result, or a recognized route-control result. The route preparation runtime
settles it before commitment. More involved asynchronous implementation can
remain in an application service or ordinary server function.

On the browser build, the callback above is replaced by a stable preparation
ID and a read of the successful prepared payload. The generated client facade
sends only serializable prospective-route inputs. The server constructs the
active request context and attaches `request`, `locals`, `platform`, and
`services`; none of those objects is serialized to the client.

The compiler and Vite integration must therefore:

- extract `$routed` callbacks before the client import graph can follow their
  server-only dependencies;
- allow `#server/*` values only when every use is confined to an extracted
  server region;
- report a client-boundary error when such a value escapes that region;
- reject closures over component-instance values because preparation runs
  before the component is created;
- give every preparation a deterministic route-instance identity;
- require successful results to satisfy the framework transport contract;
- reject returned requests, responses, services, database handles, and other
  non-transportable server objects;
- make preparation read-only and safe to retry or supersede;
- preserve direct in-memory dispatch during SSR instead of issuing a loopback
  HTTP request;
- update the extracted server preparation and its client facade coherently
  during HMR.

A normal generated server-function facade remains useful when route logic is
shared or should live in the server folder:

```tsx
const page = $routed(({ state, params }) => {
  return getReportPage(params.reportId);
});
```

The distinction from an ordinary direct call is lifecycle ownership:

```tsx
const report = getReport(route.params.reportId);
```

The direct call is component-owned colorless data. It may still be unresolved
at a render consumption site and uses the existing data `Group` policy.

```tsx
const page = $routed(({ state, params }) => {
  return getReportPage(params.reportId);
});
```

The routed call is navigation-owned preparation. Its pending and error states
belong to the route transition, redirects and not-found results prevent the
destination from mounting, and successful data is installed before the
component consumes it.

### Route-control and ordering rules

Successful data, redirect, not-found, error, and superseded preparation are
different outcomes. Redirect and not-found control results are consumed by the
router; they are not unions that every destination component must inspect.
The component sees only the successful result type.

Matched parent and child preparations cannot be launched with unspecified
ordering when a parent performs authorization. The route design must define
when child preparation may begin so that protected child data is not fetched
before its parent gate succeeds. Independent work should still be able to run
concurrently once the required gates have passed. The exact gate/data ordering
model remains an open design decision.

Initial preparation state is observable from the currently mounted route
transition, not from the destination component, because that component does
not exist yet. Revalidation of already committed routed data and the eventual
public cache operations on `state` require a separate focused design.

## Fine-grained route-state compilation

The router runtime already supports selector subscriptions. The compiler should
use them when it can identify a stable route read:

```tsx
const tab = route.query.get('tab');
const reportId = route.params.reportId;
const pathname = route.pathname;
```

Conceptually these become selectors such as:

```ts
route => route.query.get('tab')
route => route.params.reportId
route => route.pathname
```

An unrelated hash, query field, transition state, or history-state change then
does not schedule the dependent compiled update. The compiler continues to emit
targeted DOM operations; this optimization avoids unnecessary derivation and
region updates rather than preventing a React-style component rerender.

Dynamic access that cannot be represented safely by a stable selector falls
back to the current whole-route subscription.

## Link semantics and accessibility

`route-to` represents a URL destination and should be authored on an anchor:

```tsx
<a route-to="/reports">Reports</a>

<a route-to={{
  path: '/reports/:reportId',
  params: { reportId },
}}>
  Open report
</a>
```

The compiler emits a real `href`, preserving keyboard behavior, screen-reader
semantics, copying, middle-click, context menus, opening in a new tab, SEO, and
progressive enhancement. The router intercepts eligible same-origin navigation
without removing those native behaviors.

The compiler should reject `route-to` on non-anchor elements with guidance:

```tsx
// Navigation: use a semantic link.
<a class="card" route-to="/reports">...</a>

// An actual action: use a button and navigate deliberately.
<button onClick={() => navigate('/reports')}>Open reports</button>
```

Automatically adding `role`, `tabindex`, click, and key handlers to a `div`
does not recreate native anchor semantics and can introduce incorrect keyboard
behavior or nested interactive controls.

Application-owned link components should render the compiler-owned
`route-to` on their final anchor. Supporting `route-to` directly on arbitrary
uppercase components would require a verifiable host-forwarding contract and is
not part of the initial work.

## Generated application route types

The compiler already knows the expanded application route graph. The Vite
integration should emit one application-owned declaration such as
`.memoized/routes.d.ts` and update it during HMR.

Prefer module augmentation of the router's open route registry over a broad
global namespace when TypeScript and JSX integration allow it. The generated
shape must distinguish values used to build a URL from values read after URL
matching:

```ts
declare module '@memoized-dom/router' {
  interface RouteTable {
    '/': {
      input: {};
      params: {};
    };
    '/reports/:reportId': {
      input: {
        reportId: string | number | boolean | bigint;
      };
      params: {
        reportId: string;
      };
    };
  }
}
```

The registry powers:

- `route-to` path autocomplete;
- exact `route-to` parameter checking in TypeScript as well as the compiler;
- application-path autocomplete for `navigate()`;
- exact navigation input parameters;
- language-service diagnostics for statically known `route.params` reads.

The framework should not introduce `useRouteParams()`. The public `route`
facade remains the read API. Contextual parameter diagnostics must account for
components instantiated under more than one route context; a key is not assumed
valid merely because it exists at one callsite.

The generated registry needs a safe empty fallback so compiling the router
package or a library outside an application does not reduce all route paths to
`never`.

## Prefetch

Chunk prefetch is separate from navigation:

```text
link intent
  -> locate destination matches in the structural manifest
  -> invoke their module loaders through the shared cache
  -> do not run guards
  -> do not change route state or history
  -> do not mount route DOM
```

Static `route-to` links give the compiler enough information to generate this
efficiently. Intent can be observed through delegated pointer/focus handling
rather than attaching a large collection of independent listeners.

Data prefetch remains separate. It must not be invented until route-owned data,
cache freshness, and side-effect rules are designed. Prefetch must never execute
mutations.

Whether code prefetch defaults to intent or requires an explicit link policy is
still open.

## SSR, streaming, and client adoption

For an incoming request:

```text
request URL
  -> match the complete structural route chain
  -> load its server route modules
  -> render selected route regions
  -> emit matched route and client-chunk identity
```

The browser loads the matched client modules before adopting DOM regions that
depend on them. Otherwise a lazy route can flash pending UI or create duplicate
DOM rather than adopting the server output.

Route/chunk identity extends the existing `application/mmd+json` hydration
payload. It should not create a second `__MMD_ROUTES__` script channel. The
server may also emit `modulepreload` links for initially matched client chunks.

The normal `mount()` entry remains responsible for creation versus adoption. An
application should not manually preload route modules and then call a separate
hydration API.

Streaming may either await route code before sending a region or stream an
authored pending boundary and reveal it later. Both policies use the same
structural manifest and route identities.

## Client guards, observers, and middleware

Do not add client middleware during the first route-chunk implementation. Most
proposed use cases already map to smaller capabilities:

| Behavior | Capability |
|---|---|
| Unsaved-form protection | synchronous `blockNavigation()` |
| Redirect from known client state | synchronous guard |
| Analytics | navigation observer |
| Progress indicator | transition state/observer |
| Route timing | transition observer |
| Chunk loading | internal route-module resource |
| Async authentication and authorization | `$routed` preparation plus redirect |

Server onion middleware is not automatically a good browser-navigation model.
A client transition interacts with visible DOM, mutable history, cached chunks,
concurrent input, and work that can be superseded.

If concrete behavior remains uncovered after transitions and route data exist,
client middleware can be designed with explicit answers for:

- pre-commit versus post-commit execution;
- whether it may block or redirect;
- global, route, and component scope;
- the exact meaning of `next()`;
- cancellation, disposal, and HMR ownership.

Async work must never be smuggled into `blockNavigation()` and silently change
the synchronous navigation contract.

## Accepted direction

The current proposed architecture accepts these decisions:

1. Component-owned route subtrees compose through route-bearing callsites.
2. Reusable component bodies receive hidden route-instance context.
3. Route identities stop depending solely on source line and column.
4. The application keeps one complete structural manifest.
5. Route-only imported components split automatically.
6. Components also used as ordinary UI remain eager; route-only modules are the
   force-lazy mechanism.
7. Controlled links and `navigate()` prepare matched `$routed` work before
   commitment; History API traversal remains the browser-constrained
   commit-first exception.
8. Synchronous blockers remain synchronous.
9. The currently committed route remains mounted during controlled
   preparation; traversal retention requires a frozen route snapshot.
10. Scroll restoration waits for the active transition's DOM readiness.
11. Data and module loading use distinct resource engines behind a shared
    availability-boundary protocol.
12. The compiler emits fine-grained route selectors where reads are statically
    understood.
13. `route-to` is anchor navigation, not universal synthetic interactivity.
14. Vite emits one generated application route registry.
15. SSR route and chunk identity extend the existing hydration payload.
16. Client middleware is postponed until a concrete unmet use case exists.
17. `$routed` is navigation-owned preparation, not a colorless render source.
18. `$routed` receives one typed context containing normal sibling fields such
    as `params`, `url`, `request`, `locals`, `services`, `platform`, and
    `signal`; its additional `state` field is reserved only for route-level
    data caching.
19. Server-capable `$routed` callbacks compile as route-scoped server
    functions, while successful prepared data is read synchronously when the
    destination mounts.

## Open decisions

These points still require focused design before their implementation phase:

1. The exact semantic route-instance ID encoding.
2. The hidden context representation passed into reusable route components.
3. The public transition state shape and whether `completed` becomes
   `committed`.
4. The generic availability-boundary syntax and package ownership.
5. Default pending UI when no boundary is authored.
6. Whether code prefetch is automatic on intent or explicitly requested.
7. Contextual parameter typing for components reused under different parameter
   contracts.
8. The first streaming policy for route-module pending regions.
9. The exact cache API represented by the `$routed` `state` parameter,
   including identity, freshness, invalidation, reuse, and revalidation.
10. Parent/child `$routed` gate ordering and the point at which independent
    preparations may begin concurrently.
11. The public transition result for routed redirect, not-found, preparation
    error, retry, and supersession.

## Implementation order

1. Expand component-owned route templates at route-bearing callsites.
2. Introduce semantic instance IDs and hidden component route context.
3. Generate the application route registry and language-service integration.
4. Emit selector subscriptions for static route-state reads.
5. Add module ownership and loader metadata to the complete manifest.
6. Teach the Vite graph to emit actual route chunks and route-owned CSS.
7. Add route-module loading, ready, error, retry, and superseded states.
8. Extract `$routed` preparations into deterministic route-scoped server
   functions and generate their browser facades.
9. Add prepare-before-commit transitions for controlled navigation, including
   redirect, not-found, failure, retry, cancellation, and traversal fallback.
10. Design and implement the route-data cache behind `$routed` `state`.
11. Add the shared availability-boundary protocol.
12. Make scroll restoration readiness-aware.
13. Coordinate SSR loading, payload delivery, module preload, and client
    adoption.
14. Add code prefetch policy.
15. Re-evaluate client middleware after route data and transitions exist.
