# `@memoized-dom/router`

`@memoized-dom/router` is Memoized DOM's compiler-first, renderer-independent routing engine. It owns immutable URL state, deterministic route matching, compiler-extracted nested manifests, history management, scroll restoration, cancellation, and synchronous navigation guards.

There are no router context providers, component wrappers, or hooks. Routing declarations compile to stable, mutually exclusive real-DOM regions.

---

## 1. Reactive Route State (`route`)

Import the getter-backed `route` object in any component, helper, or derived state. Reads are compiler-tracked and re-render only the subtrees that consume changed fields:

```ts
import { route } from '@memoized-dom/router';

// Reactive URL properties:
route.pathname;             // e.g. "/projects/compiler"
route.query.get('tab');     // e.g. "activity"
route.query.getAll('tag');  // string[] for multi-value keys (?tag=a&tag=b)
route.search;               // e.g. "?tab=activity"
route.hash;                 // e.g. "#heading-2"
route.state;                // Unwrapped history state (objects, primitives, arrays)
route.navigationType;       // 'load' | 'push' | 'replace' | 'pop'

// Matched route metadata:
route.params;               // Frozen parameter dictionary: { projectId: "compiler" }
route.matches;              // Full hierarchy of matched manifest entries
route.matched;              // Nearest active route match

// Request cancellation:
route.signal;               // AbortSignal: aborted on every subsequent navigation
```

---

## 2. Programmatic Navigation

Use imperative navigation when transitions are triggered by code, forms, or timers:

```ts
import {
  navigate,
  navigateRelative,
  back,
  forward,
  blockNavigation,
  redirectRoute,
  subscribeNavigation,
} from '@memoized-dom/router';

// Parameterized path navigation with query and history state:
navigate('/organizations/:orgId/projects/:projectId', {
  params: { orgId: 'acme', projectId: 'compiler' },
  query: { tab: 'members', sort: 'desc' },
  hash: 'team-lead',
  state: { fromCheckout: true },
});

// Relative directory navigation:
navigateRelative('../settings');

// Browser traversal:
back();
forward();

// Synchronous navigation blockers / guards:
const unblock = blockNavigation(navigation => {
  if (navigation.to.pathname === '/admin' && !currentUser.isAdmin) {
    return redirectRoute('/login', { replace: true });
  }
  if (hasUnsavedChanges()) {
    return window.confirm('Discard unsaved changes?');
  }
});

// Navigation lifecycle observer:
subscribeNavigation(event => {
  console.log(event.phase, event.navigation.to.pathname);
});
```

---

## 3. Compiler JSX Directives (`route` & `route-to`)

The compiler owns `route` and `route-to` as universal JSX attributes. They are erased from DOM attributes and component props during build time.

### Declaring Route Regions (`route`)
```tsx
export function App() {
  return (
    // Root element registers the application route graph root:
    <div class="shell" route="/">
      <Header />
      <main class="outlet">
        {/* Sibling routes are resolved exclusively by the compiler: */}
        <Dashboard  route="/" />
        <Stories    route="/stories" />
        <StoryPage  route="/item/:storyId" />
        <Settings   route="/settings/*" />
        <NotFound   route="/*" />
      </main>
    </div>
  );
}
```

### Declarative Links (`route-to`)
`route-to` on an `<a>` tag compiles to a real `href` with client-side pushState navigation:

```tsx
{/* Static route link */}
<a route-to="/stories">Stories</a>

{/* Object destination with params, query, hash, and replace */}
<a route-to={{
  path: '/item/:storyId',
  params: { storyId: story.id },
  query: { comments: 'all' },
  hash: 'reply-form',
  replace: false,
}}>
  {story.title}
</a>
```

---

## 4. Route Preparation (`$routed`)

`$routed` prepares a destination before its component mounts. It is useful for
route-owned data, authentication, authorization, redirects, and other work
that must finish before the destination becomes visible.

It is not another spelling of `$fetch`. A normal data source belongs to the
rendering lifecycle and may be consumed through a data `Group`; a `$routed`
result belongs to navigation and is ready when the destination component
starts rendering.

```tsx
import { $routed } from '@memoized-dom/router';

interface ReportPageData {
  report: { id: string; title: string };
}

function isReportPageData(value: unknown): value is ReportPageData {
  return typeof value === 'object' && value !== null && 'report' in value;
}

export function ReportPage() {
  const page = $routed(({ state, params }) => {
    // One state object belongs to this preparation. It is not automatically
    // partitioned by params, so the application chooses any cache key.
    const cacheKey = `report:${params.reportId}`;
    const cached = state[cacheKey];
    if (isReportPageData(cached)) return cached;

    const loaded = readLocalReport(params.reportId);
    state[cacheKey] = loaded;
    return loaded;
  });

  return <h1>{page.report.title}</h1>;
}
```

The callback receives one prospective-route context:

| Field | Meaning |
| :--- | :--- |
| `params` | Parameters for the destination match. |
| `url`, `query` | Destination URL and its read-only query values. |
| `signal` | Cancellation signal aborted when preparation is superseded. |
| `state` | Mutable application-owned object retained for this preparation ID. |
| `request` | Active server request for a server-backed preparation. |
| `locals` | Typed request-owned application data. |
| `services` | Typed application-scoped services. |
| `platform` | Typed host bindings, when configured. |

These fields are siblings. Read `params.reportId`, not
`state.params.reportId`. `state` has no framework methods such as `key()`,
`freshFor()`, or `invalidate()`. Because its keys are application-defined,
reads have type `unknown` and should be narrowed or asserted by the
application.

The same `state` object is reused on later visits within a route runtime.
Serializable keys cross the SSR hydration and browser/server preparation
boundaries. Non-serializable keys stay local to the runtime that created them.
The successful `$routed` result itself must be transportable when preparation
runs on the server.

### Server-backed preparation

Using `request`, `locals`, `services`, `platform`, or a `#server/*` value makes
the callback server-backed. The compiler removes that callback body from the
browser graph and generates the route-preparation transport automatically.

```tsx
import { $routed, redirectRoute } from '@memoized-dom/router';

export function AdminReportPage() {
  const page = $routed(({ params, locals, services, signal }) => {
    if (!locals.user) {
      return redirectRoute('/login', { replace: true });
    }

    // Do not author async/await here. Returning service or server-function
    // work lets the route runtime settle it before committing navigation.
    return services.reports.loadPage(params.reportId, locals.user.id, {
      signal,
    });
  });

  return <h1>{page.report.title}</h1>;
}
```

There is no need to call `getServerContext()` inside `$routed`; its callback
already receives the active typed request context. Raw request, local,
platform, and service objects are never serialized to the browser.

### Authoring and navigation contract

`$routed` is a compiler intrinsic and must be:

- assigned directly to a component-local `const`;
- passed an inline synchronous callback (return asynchronous work instead of
  declaring the callback `async`);
- independent of component props and other component-instance bindings,
  because preparation runs before the component exists;
- attached by the compiler to a route-owning component in the linked route
  graph.

Controlled `navigate()` and `route-to` navigation run synchronous blockers
first, then prepare the matched destination, then commit the URL and route.
`navigate()` exposes that lifecycle without adding a second
`route.transition` state object:

```ts
const result = navigate('/reports/:reportId', {
  params: { reportId: 'quarterly' },
});

if (result.status === 'preparing') {
  await result.finished;
}

const unsubscribe = subscribeNavigation(event => {
  if (event.phase === 'error') {
    showRouteError(event.error, () => event.retry?.());
  }
});
```

Preparation errors reject `finished` and publish an `error` navigation event.
The event's `retry()` repeats the failed destination. A newer navigation
aborts the previous preparation through its `signal`. Browser Back/Forward
uses the same preparation pipeline while respecting the browser's already
committed history traversal.

During SSR, the matched preparation runs before the component. Its result and
serializable `state` keys are included in the hydration payload, and `mount()`
adopts them automatically before the component reads its `$routed` result.

---

## 5. History State (`route.state`)

`route.state` gives access to ephemeral client-side metadata attached directly to the browser's history entry (`history.state`):

- **Invisible in URL**: Never exposed in the address bar or sent to the server in HTTP requests.
- **Any Data Type**: Accepts plain objects, arrays, numbers, strings, and booleans.
- **Isolated**: Internal router bookkeeping (such as scroll keys) is automatically stripped; `route.state` returns pure user data.
- **Survives Reloads**: Preserved by the browser across page reloads and browser Back/Forward traversals.

```ts
// Passing state during navigation:
navigate('/checkout', {
  state: { draftOrderId: 1042, step: 2 }
});

// Reading state reactively in any component:
const state = route.state as { draftOrderId?: number; step?: number } | null;
```

---

## 6. Deterministic Scroll Restoration Engine

`@memoized-dom/router` includes an automatic, zero-configuration scroll coordinator:

1. **Manual Restoration Enforcement**: Disables native browser scroll snapping (`history.scrollRestoration = 'manual'`) so asynchronous component rendering never gets clamped to `(0, 0)`.
2. **History-Keyed Tracking**: Automatically captures viewport `(x, y)` scroll positions per history entry, persisting them to memory with `sessionStorage` fallback.
3. **Pop Navigation (Back/Forward)**: Automatically restores exact previous scroll coordinates after the target route's microtask and render phase settle.
4. **Push Navigation (New Link)**: Resets viewport scroll to top `(0, 0)`.
5. **Hash Navigation (`#target`)**: Queries `#target` elements by `id` or `name` and scrolls them into view, retrying on the next animation frame if asynchronous data is loading.

---

## 7. Server-Side Rendering (SSR) & Request Isolation

During server renders or unit tests, routing runs through an isolated memory history without touching global browser singletons:

```ts
import {
  createRouteRuntime,
  createMemoryRouteHistory,
  runWithRouteRuntime,
} from '@memoized-dom/router';

const routeHistory = createMemoryRouteHistory({
  initialEntries: ['/stories?sort=desc'],
});
const runtime = createRouteRuntime({ routeHistory });

// Every read, match, and navigation inside the callback is isolated to this request:
runWithRouteRuntime(runtime, () => {
  console.log(route.pathname); // "/stories"
  console.log(route.query.get('sort')); // "desc"
});
```

---

## 8. Manifests & Lower-Level Matching Primitives

For tools, static analyzers, and headless routing:

```ts
import { createRouteManifest, matchRoutePattern } from '@memoized-dom/router';

const manifest = createRouteManifest([
  { id: 'root', pattern: '/', metadata: { layout: true } },
  { id: 'projects', parentId: 'root', pattern: '/projects' },
  { id: 'project', parentId: 'projects', pattern: '/:projectId' },
  { id: 'catchall', parentId: 'root', pattern: '/*' },
]);

manifest.matchAll('/projects/compiler'); // [root, projects, project]
manifest.build('project', { params: { projectId: 'compiler' } }); // "/projects/compiler"
```
