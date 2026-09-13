# Memoized DOM Router Autocompletion & Universal Navigation Specification

**Status**: Architecture & DX Specification  
**Audience**: Compiler contributors, router maintainers, and application developers  
**Scope**: `@memoized-dom/router`, `@memoized-dom/compiler`, `@memoized-dom/vite`, and IDE tooling  

---

## 1. Executive Summary

Memoized DOM features native JSX routing through compiler-owned `route` and `route-to` attributes. Unlike traditional frameworks where routes are verified only at runtime (often resulting in 404s in production), Memoized DOM’s compiler analyzes the full route graph ahead of time.

This specification details how we leverage this ahead-of-time route knowledge to deliver:
1. **Instant IDE Autocompletion** for all declared application routes when authoring `route-to`.
2. **Exhaustive Parameter Checking** for dynamic parameterized routes (e.g. `:projectId`).
3. **Universal Element Navigation** utilizing the modern **Browser Navigation API**, allowing `route-to` to be placed on any element (`<button>`, `<a>`, `<li>`, `<div>`) without hacky wrappers.

---

## 2. Developer Experience (DX)

### A. Static Route Autocompletion
When the developer opens quotes on any `route-to` attribute:

```tsx
<button route-to="|">
//                ▲
// IDE Suggestions Popup:
// ┌───────────────────────────┐
// │ "/"                       │
// │ "/projects"               │
// │ "/projects/:projectId"    │
// │ "/admin/users"            │
// │ "/settings"               │
// └───────────────────────────┘
```

### B. Parameterized Route Autocompletion (Object Syntax)
When navigating to dynamic routes, the object syntax provides autocompletion for both the `path` and the required `params`:

```tsx
<a route-to={{ path: '/projects/:projectId', params: { | } }} />
//                                                      ▲
// IDE Suggestions Popup:
// ┌──────────────────────────────────────────────┐
// │ projectId: string | number (Required)        │
// └──────────────────────────────────────────────┘
```

### C. Compile-Time & IDE Diagnostics
If a route destination is misspelled or missing parameters:

```tsx
// 1. Misspelled route:
<a route-to="/projets">Projects</a>
//           ~~~~~~~~~
// 💥 TypeScript & Compiler Error: Route '/projets' does not exist in the application route graph.

// 2. Missing dynamic parameter:
<button route-to={{ path: '/projects/:projectId', params: {} }}>Open</button>
//                                                ~~~~~~
// 💥 TypeScript & Compiler Error: Property 'projectId' is required for route '/projects/:projectId'.
```

---

## 3. Universal Element Navigation (Modern Navigation API)

Because Memoized DOM integrates with the native **Browser Navigation API** (`navigation.navigate` and event delegation), `route-to` is an intrinsic attribute available across all HTML elements:

### 1. On `<a>` Elements (SEO & Progressive Enhancement)
```tsx
<a route-to="/projects">Projects</a>
```
* The compiler lowers this to a standard semantic `<a href="/projects">`.
* Preserves screen readers, search engine crawlers, and native browser actions ("Right click $\rightarrow$ Open in new tab", "Middle click").
* In-app clicks are intercepted via the Navigation API for instantaneous client transitions.

### 2. On Interactive Elements (`<button>`, `<li>`, `<div class="card">`)
```tsx
<button route-to="/settings">Settings</button>
<div class="card" route-to={{ path: '/item/:id', params: { id: item.id } }}>
  <h3>{item.title}</h3>
</div>
```
* **No fake anchor tags**: Developers no longer have to wrap `<button>` inside `<a href="#">` or write manual `onClick={() => router.push(...)}`.
* Clean, accessible semantic DOM without synthetic event plumbing.

---

## 4. Architectural Implementation: The Auto-Generation Pipeline

The compiler in `packages/compiler/src/router.ts` already extracts and validates the route graph into `knownRoutes`. The autocompletion system connects this compiler step directly to TypeScript:

```text
JSX Route Declarations (<div route="/...">)
                 │
                 ▼
  [1] Compiler Route Analysis (packages/compiler/src/router.ts)
      Extracts: fullPattern, params, parentId
                 │
                 ▼
  [2] Vite Plugin / Dev Server Watcher (@memoized-dom/vite)
      Writes / Updates on HMR: .memoized/routes.d.ts
                 │
                 ▼
  [3] Ambient TypeScript Declaration (MemoizedDom.RouteTable)
                 │
                 ▼
  [4] JSX.IntrinsicAttributes ('route-to' Typed via RouteTable)
                 │
                 ▼
  [5] Instant IDE Autocompletion & Type Checking (Zero Runtime Cost)
```

### The Generated Declaration File (`.memoized/routes.d.ts`)

During development and build, the Vite plugin emits an ambient type definition into the project's `.memoized/` directory:

```ts
// .memoized/routes.d.ts
declare global {
  namespace MemoizedDom {
    interface RouteTable {
      '/': {};
      '/projects': {};
      '/projects/:projectId': { projectId: string | number };
      '/admin': {};
      '/admin/users': {};
      '/*': { '*': string };
    }
  }
}
export {};
```

### The Global JSX Typings (`@memoized-dom/router`)

The router package declares its JSX types against this table:

```ts
// packages/router/src/types.ts

export type AvailablePath = keyof MemoizedDom.RouteTable;

export type RouteToProp =
  | AvailablePath
  | {
      [K in AvailablePath]: {
        path: K;
        params?: MemoizedDom.RouteTable[K];
        query?: Record<string, string | number | boolean | null | undefined>;
        hash?: string;
        replace?: boolean;
      };
    }[AvailablePath];

declare global {
  namespace JSX {
    interface IntrinsicAttributes {
      /** Compiler-owned universal navigation route target. */
      'route-to'?: RouteToProp;
      /** Compiler-owned route boundary pattern. */
      route?: string;
    }
  }
}
```

---

## 5. Imperative Navigation Autocompletion

The same `RouteTable` provides full type safety and autocompletion for imperative programmatic navigation:

```ts
import { navigate } from '@memoized-dom/router';

// 1. Static navigation:
navigate('/projects');

// 2. Parameterized navigation:
navigate('/projects/:projectId', { params: { projectId: 42 } });
```

---

## 6. Summary of Benefits

1. **Zero Link Rot**: Broken links are caught at compile time before deploying.
2. **Zero Runtime Overhead**: All autocompletion logic is type-level and code-generation based.
3. **Universal Elements**: Native Navigation API allows navigation on buttons, cards, and list items without boilerplate.
4. **Automatic HMR Sync**: Adding a new `<section route="/billing">` immediately makes `"/billing"` available in autocomplete across the entire project.
