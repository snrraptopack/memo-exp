# `createDataRuntime` - Architectural Notes & Usefulness

This document summarizes the role, internal implementation, usefulness, and potential future enhancements of `createDataRuntime` in the `@memoized-dom/data` package.

---

## 1. Overview

`createDataRuntime` is a factory function defined in [`src/client.ts`](file:///C:/Users/babyface/Desktop/memoized-dom/packages/data/src/client.ts#L27-L59) and exported from [`src/index.ts`](file:///C:/Users/babyface/Desktop/memoized-dom/packages/data/src/index.ts#L5).

It instantiates an **isolated data runtime instance** (`DataRuntime`) containing its own fetch environment, query store cache, and reactive resource creators.

### Function Signature
```ts
export function createDataRuntime(
  options: DataRuntimeOptions = {},
): DataRuntime;
```

### Options (`DataRuntimeOptions`)
- **`fetch`**: Custom `fetch` implementation (defaults to `globalThis.fetch`). Useful for custom HTTP clients, authentication wrappers, or mock fetchers in unit tests.
- **`baseURL`**: Base URL (`string | URL`) automatically prepended to relative request targets across all `$fetch` and `$action` calls within this runtime.

---

## 2. What `createDataRuntime` Produces

Calling `createDataRuntime(...)` returns an object with three core members:

```ts
interface DataRuntime {
  readonly $fetch: FetchFunction;
  readonly $action: ActionFunction;
  clear(): void;
}
```

1. **`$fetch`**: Creates reactive query resources (`FetchResource<T>`) linked to this runtime's private `FetchStore`. Supports request deduplication, cache sharing, and `StandardSchemaV1` validation (Zod, Valibot, ArkType, etc.).
2. **`$action`**: Creates reactive mutation objects (`Action<TResult, TInput>`) for POST, PUT, PATCH, and DELETE HTTP requests. Supports optimistic UI updates and target resource revalidation.
3. **`clear()`**: Disposes and cancels all active in-flight requests and clears all cached entries inside this runtime's private `FetchStore`.

---

## 3. How It Works Under the Hood

The implementation relies on three internal building blocks:

- **`FetchEnvironment`** ([`src/resource.ts`](file:///C:/Users/babyface/Desktop/memoized-dom/packages/data/src/resource.ts#L27-L30)): Holds the resolved `fetch` function getter and `baseURL`.
- **`FetchStore`** ([`src/resource.ts`](file:///C:/Users/babyface/Desktop/memoized-dom/packages/data/src/resource.ts#L193-L242)): A dedicated map of `FetchEntry` objects. Manages cache lifecycles, active request deduplication, and consumer subscription counters.
- **`createAction`** ([`src/action.ts`](file:///C:/Users/babyface/Desktop/memoized-dom/packages/data/src/action.ts#L92-L200)): Binds mutation calls and optimistic rollback/commit behavior to the runtime environment.

```
+-------------------------------------------------------------------+
|                        DataRuntime Instance                        |
|                                                                   |
|   +-----------------------+           +-----------------------+   |
|   |   FetchEnvironment    |           |      FetchStore       |   |
|   |  (fetch, baseURL)     |           |  (Cache Map & Entries)|   |
|   +-----------+-----------+           +-----------+-----------+   |
|               |                                   |               |
|         +-----+-----------------------------------+-----+         |
|         |                                               |         |
|         v                                               v         |
|      $action(...)                                    $fetch(...)  |
+-------------------------------------------------------------------+
```

---

## 4. Usefulness & Key Use Cases

While `@memoized-dom/data` exports a default singleton `$fetch` and `$action` at module level, explicitly using `createDataRuntime` is essential for:

### 1. Server-Side Rendering (SSR) Isolation
In multi-tenant or server-rendered applications, shared singletons cause request state leaks between user sessions. Creating a new `createDataRuntime()` per incoming HTTP request ensures 100% session and cache isolation.

### 2. Testing and Mocking
Allows injecting mock fetch handlers (`fetch: mockFetch`) or local mock data endpoints without polluting the global `globalThis.fetch` object or affecting other test suites (see example in [`examples/data-reactivity/DataReactivityApp.tsx`](file:///C:/Users/babyface/Desktop/memoized-dom/examples/data-reactivity/DataReactivityApp.tsx#L8-L10)).

### 3. Multi-Tenant or Micro-Frontend Base URLs
Different sections of an application may talk to different microservices or API subdomains (e.g. `https://api.user.service` vs `https://api.billing.service`). Distinct runtimes handle routing cleanly with scoped `baseURL` options.

### 4. Controlled Cache Lifecycles
Calling `runtime.clear()` purges only the resources bound to that specific runtime without resetting global application state or sibling component caches.

---

## 5. Potential Enhancements to Revisit

When refining or expanding `@memoized-dom/data`, consider the following potential runtime improvements:

1. **Global Interceptors / Middleware**: Extend `DataRuntimeOptions` to accept request/response hooks (e.g. `onRequest`, `onResponse`, `onError`, `headers` factory) so authentication headers (JWTs) can be set once at the runtime level.
2. **SSR Dehydration & Hydration**: Add `runtime.dehydrate()` to dump the `FetchStore` state to JSON during server rendering, and `runtime.hydrate(state)` to restore it on the client without duplicate network requests.
3. **Global Pending / Loading State**: Expose aggregate reactive properties on `DataRuntime` (e.g. `runtime.pendingCount`, `runtime.isPending`) to simplify global UI progress indicators.
4. **Cache Eviction & Stale Time Policies**: Configure TTL, stale-while-revalidate duration, or auto-garbage-collection rules inside `DataRuntimeOptions`.
