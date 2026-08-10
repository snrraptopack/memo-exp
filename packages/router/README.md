# `@memoized-dom/router`

The router package is the runtime foundation for Memoized DOM's compiler-driven routing. It owns URL state, browser history, route matching, nested path composition, cancellation boundaries, and navigation. It does not render route components and currently contains no knowledge of the future `route` or `route-to` JSX directives.

In browsers that expose the Navigation API, the runtime uses its `navigate` event as the primary boundary. Browsers without it use history, location events, and delegated anchor clicks as the fallback.

## Application state

```ts
import { route } from '@memoized-dom/router';

route.pathname;
route.query.get('tab');
route.hash;
route.state;
route.params;
route.matches;
route.signal;
```

`route` is a stable getter-backed object. Navigating changes its values without replacing the object. Its `query` view exposes only read-only `URLSearchParams` operations, so application code cannot mutate router state without navigating. `route.params` and `route.matches` are populated by the compiler-owned structural route controller; before that layer is installed they are empty.

Each location change aborts the previous `route.signal`. Async work tied to a location can use this signal to stop when navigation moves elsewhere.

## Navigation

```ts
import { navigate } from '@memoized-dom/router';

navigate('/docs');

navigate('/organizations/:organizationId', {
  params: { organizationId: 'acme' },
  query: { tab: 'members', tag: ['compiler', 'runtime'] },
  hash: 'active',
});

navigate('/docs/*', { params: { '*': 'compiler/setup' } });
navigate('/login', { replace: true, state: { redirected: true } });
```

Literal patterns infer required parameter and terminal-wildcard values in TypeScript. Values are encoded by path segment; `.` and `..` segments are rejected so URL normalization cannot change the destination. Navigation updates route state synchronously. Async work should use `route.signal`; navigation does not wait for application data loading.

## Matching and nested paths

```ts
import {
  joinRoutePaths,
  matchRoutePattern,
} from '@memoized-dom/router';

const project = joinRoutePaths(
  '/organizations/:organizationId',
  '/projects/:projectId',
);

matchRoutePattern(
  project,
  '/organizations/acme/projects/compiler',
);
```

Matching supports static segments, `:parameters`, and a terminal `*` wildcard. Prefix matching is available for layout routes:

```ts
matchRoutePattern('/docs', '/docs/compiler', { end: false });
```

Child paths passed to `joinRoutePaths()` are always relative to their parent, even when written with a leading slash. `/` represents an index route. A terminal wildcard cannot own children.

Pattern validation rejects queries and hashes in declarations, empty segments, malformed or repeated parameters, and non-terminal wildcards. `compareRoutePatterns()` provides the canonical ordering: at the first differing segment, static beats parameter and parameter beats wildcard. `validateRoutePatterns()` rejects duplicate IDs and overlapping patterns with equal specificity. The compiler should run equivalent validation while it still has source locations so it can produce richer diagnostics.

## Compiler boundary

The `@memoized-dom/router/internal` entry contains the small bridge intended for generated code:

- connect and disconnect browser listeners with application lifetime;
- install one structural resolver per runtime;
- resolve and publish a location plus its complete active match chain atomically;
- subscribe other generated consumers when a snapshot boundary is needed;
- seed a scoped location for SSR and tests.

`installRouteResolver()` runs synchronously inside a location transaction. If it throws, the location and cancellation signal roll back. Installing a second resolver is rejected; this prevents two application roots from overwriting one shared match chain. HMR must uninstall the previous resolver before installing its replacement.

The default exports represent one browser-document router. SSR and pages with independently routed application roots must create separate instances with `createRouteRuntime()` and bind generated code to the instance's `route`. Server rendering must not seed the default singleton because concurrent requests would share it.

Generated routing code must not teach the compiler that imports named `route` or imports from this package are intrinsically reactive. The structural route region uses the explicit resolver bridge. Ordinary reads of external getter-backed state continue to follow Memoized DOM's generic external-reactivity rules.

## Browser behavior

The Navigation API remains the primary boundary. Intercepted navigations use the browser's after-transition scrolling behavior. Hash-only changes, downloads, external destinations, and events the browser says cannot be intercepted remain native.

The history fallback installs `popstate`, `hashchange`, and delegated click listeners while connected. It intercepts unmodified same-origin HTTP(S) anchors, while leaving downloads, external links, non-self targets, modified clicks, and hash-only links to the browser. Connections are reference-counted, but each runtime still has exactly one structural resolver.

Keeping the generated-code bridge separate lets JSX lowering be added without turning route directives into user-facing functions or components.
