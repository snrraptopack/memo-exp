# `@memoized-dom/router`

`@memoized-dom/router` is Memoized DOM's renderer-independent routing runtime. It owns immutable URL state, deterministic matching, nested route manifests, navigation history, cancellation, redirects, and synchronous navigation guards. It does not render components, load route data, or define an SSR wire format.

## Route state and focused subscriptions

```ts
import { route, subscribeNavigation } from '@memoized-dom/router';

route.pathname;
route.query.get('tab');
route.params;
route.matches;
route.matched?.metadata;
route.signal;

subscribeNavigation(event => {
  console.log(event.phase, event.navigation.to.pathname);
});
```

`route` is one stable, getter-backed object. Its query view is read-only, match arrays and parameters are frozen, and every location change aborts the previous `route.signal`. Generated consumers can use `subscribeRouteSelected()` from the internal entry to update only when a selected pathname, query value, parameter, or match changes.

## Manifests and matching

```ts
import { createRouteManifest } from '@memoized-dom/router';

const manifest = createRouteManifest([
  { id: 'root', pattern: '/', metadata: { layout: true } },
  { id: 'projects', parentId: 'root', pattern: '/projects' },
  { id: 'project', parentId: 'projects', pattern: '/:projectId' },
  { id: 'missing', parentId: 'root', pattern: '/*' },
]);

manifest.matchAll('/projects/compiler'); // root -> projects -> project
manifest.build('project', { params: { projectId: 'compiler' } });
```

Definitions may be out of order. Construction validates duplicate and missing IDs, parent cycles, parameter shadowing, wildcard placement, and ambiguous unrelated routes. Static segments outrank parameters, which outrank wildcards. A terminal wildcard is the not-found/catch-all mechanism.

For lower-level use, `matchRoutePattern()`, `createRouteMatcher()`, `joinRoutePaths()`, and `buildRoutePath()` expose the same validated path primitives.

## Navigation

```ts
import {
  navigate,
  navigateRelative,
  redirectRoute,
  blockNavigation,
} from '@memoized-dom/router';

navigate('/organizations/:organizationId', {
  params: { organizationId: 'acme' },
  query: { tab: 'members', tag: ['compiler', 'runtime'] },
});

navigateRelative('../settings');

const unblock = blockNavigation(navigation => {
  if (navigation.to.pathname === '/private') {
    return redirectRoute('/login', { replace: true });
  }
  if (hasUnsavedChanges) return false;
});
```

`navigate()` and `navigateRelative()` return a `completed` or `blocked` result. Guards run before router-owned history changes and may allow, block, or redirect. They are intentionally synchronous: waiting for data belongs to the future router/data coordination layer. Redirect chains are capped at 16 and guards cannot recursively mutate router state.

Relative paths use directory semantics: `details` from `/projects/one` resolves to `/projects/one/details`, while `../two` resolves to `/projects/two`. A runtime `basePath` keeps application paths independent from deployment paths:

```ts
const runtime = createRouteRuntime({
  basePath: '/app',
  routeHistory: createMemoryRouteHistory({ initialEntries: ['/app'] }),
  routes: manifest.entries,
});

runtime.navigate('/projects'); // address: /app/projects, route.pathname: /projects
```

## Router-owned history

```ts
const history = createMemoryRouteHistory({
  initialEntries: ['/', '/projects'],
});
const runtime = createRouteRuntime({ routeHistory: history });
```

The `RouteHistory` interface separates navigation storage from browser event plumbing. The built-in memory implementation has stable keys and indices, forward-stack truncation, non-mutating `peek()`, synchronous publication, and rollback when a subscriber rejects an update. It is useful for tests, embedded/non-browser roots, deterministic replay, and guardable traversal. An explicitly supplied history remains owned by the caller; disposing the runtime unsubscribes but does not destroy it.

## Browser behavior

The Navigation API is the primary browser boundary. Same-origin application navigations are intercepted and use after-transition scrolling. The fallback uses history plus reference-counted `popstate`, `hashchange`, and delegated click listeners. Downloads, external links, non-self targets, modified clicks, hash-only anchors, and URLs outside `basePath` remain native.

Navigation API events can be guarded before commit. Router-initiated memory-history traversal is also guardable because the destination can be peeked first. Legacy browser `popstate` is observational—the browser has already traversed when it fires—so it cannot provide the same pre-commit guarantee.

## Compiler boundary and HMR

`@memoized-dom/router/internal` exposes the small bridge intended for generated code: connection lifetime, structural resolver installation/replacement, atomic location-and-match publication, full or selected subscriptions, relative navigation, and navigation lifecycle access. `replaceRouteResolver()` resolves the current location before swapping and makes stale HMR disposers harmless.

The compiler owns `route` and `route-to` as universal JSX properties. They are
erased before normal host/component prop handling, so neither appears in the
DOM or a component's public props. Every route fragment is canonical and starts
with `/`; nested fragments compose with their nearest route-bearing JSX
ancestor:

```tsx
<main route="/">
  <section route="/projects">
    <article route="/:projectId">Project</article>
  </section>
  <aside route="/*">Not found</aside>
</main>
```

This declares `/`, `/projects`, `/projects/:projectId`, and the terminal
catch-all. The compiler emits one structural manifest plus focused DOM regions;
it does not perform a runtime JSX-tree discovery pass.

Navigation targets are checked against that linked route graph. Parameterized
and catch-all paths require exact parameter keys:

```tsx
<button route-to={{
  path: '/projects/:projectId',
  params: { projectId },
  query: { tab: 'activity' },
}}>
  Open project
</button>
```

`route-to` accepts `path`, `params`, `query`, `hash`, and `replace`. History
`state` is intentionally not authored here; any internal navigation metadata is
compiler/runtime-owned. Anchors receive a real `href`, while other intrinsic
elements receive compiled navigation behavior that composes with `onClick` and
respects `preventDefault()`. The generated singleton browser connection is
idempotent across HMR module evaluation.

Chunk-loading syntax remains a build-integration concern and is not part of the
current directive lowering.

## Deliberate boundaries

- Router/data coordination is not implemented yet. Its caching, pending-state, error, and invalidation contract needs a separate design discussion.
- Router SSR is not implemented yet. Memoized DOM first needs renderer-level SSR, streaming, and hydration ownership. The package therefore does not depend on Seroval or commit to another router's serialization format.
- Each server request or independently routed root must eventually receive its own runtime. The default singleton is browser-document state and must never be shared between concurrent requests.
