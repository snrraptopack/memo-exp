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

## 4. History State (`route.state`)

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

## 5. Deterministic Scroll Restoration Engine

`@memoized-dom/router` includes an automatic, zero-configuration scroll coordinator:

1. **Manual Restoration Enforcement**: Disables native browser scroll snapping (`history.scrollRestoration = 'manual'`) so asynchronous component rendering never gets clamped to `(0, 0)`.
2. **History-Keyed Tracking**: Automatically captures viewport `(x, y)` scroll positions per history entry, persisting them to memory with `sessionStorage` fallback.
3. **Pop Navigation (Back/Forward)**: Automatically restores exact previous scroll coordinates after the target route's microtask and render phase settle.
4. **Push Navigation (New Link)**: Resets viewport scroll to top `(0, 0)`.
5. **Hash Navigation (`#target`)**: Queries `#target` elements by `id` or `name` and scrolls them into view, retrying on the next animation frame if asynchronous data is loading.

---

## 6. Server-Side Rendering (SSR) & Request Isolation

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

## 7. Manifests & Lower-Level Matching Primitives

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
