# `@memoized-dom/router`

The router package is the runtime foundation for Memoized DOM's compiler-driven routing. It owns URL state, browser history, route matching, nested path composition, cancellation boundaries, and navigation. It does not render route components and currently contains no knowledge of the future `route` or `route-to` JSX directives.

In browsers that expose the Navigation API, the runtime uses its `navigate` event as the primary boundary. This lets the eventual router observe and intercept ordinary same-origin anchors, programmatic navigation, and traversal through one path. Browsers without it use `history.pushState()`/`history.replaceState()` plus `popstate` and `hashchange` as the fallback.

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

`route` is a stable getter-backed object. Navigating changes its values without replacing the object. `route.params` and `route.matches` are populated by the compiler-owned structural route controller; before that layer is installed they are empty.

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

navigate('/login', { replace: true, state: { redirected: true } });
```

Literal patterns infer their required parameters in TypeScript. The compiler layer will later provide whole-application validation and component-target navigation.

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

Static, parameter, and wildcard route ranking is exposed for the structural controller. Compiler diagnostics—not the runtime—will reject malformed or ambiguous route trees.

## Compiler boundary

The `@memoized-dom/router/internal` entry contains the small bridge intended for generated code:

- connect and disconnect browser listeners with application lifetime;
- subscribe the root structural route region to location changes;
- publish the complete active match chain atomically;
- seed a location for SSR and tests.

Keeping this bridge separate means the runtime can be completed and tested before JSX lowering is added, without turning route directives into user-facing functions or components.
