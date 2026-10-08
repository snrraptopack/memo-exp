# memoized-dom

Analyzed, real-DOM reactive UI for plain TypeScript and JSX.

There are no virtual DOMs, no signals, no hooks, and no store wrappers. You write standard JavaScript variables, objects, arrays, and classes. The compiler tracks reads and writes across modules, and the runtime updates only the exact DOM nodes that depend on what changed. Components run once during initialization.

---

## Quick Start

### 1. Installation

Install the runtime and build tools:

```bash
npm install @memoized-dom/runtime
npm install -D @memoized-dom/compiler @memoized-dom/vite vite typescript
```

Optional capability packages:

- `@memoized-dom/data` — `$fetch`, `$read`, `$track`, `$forms`, and `<Group>`
- `@memoized-dom/router` — client-side routing, navigation, and `$routed`
- `@memoized-dom/server` — `serve()`, server routes, SSR, and streaming

### 2. Configuration

**`tsconfig.json`**

Set `"jsx": "preserve"` so the Memoized DOM compiler owns JSX transforms, and include the ambient compiler types:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "strict": true,
    "noEmit": true,
    "types": ["@memoized-dom/compiler/jsx"]
  },
  "include": ["src"]
}
```

**`vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';

export default defineConfig({
  plugins: [
    memoizedDom({ clientEntry: 'src/main.ts' }),
  ],
});
```

### 3. Application Entry

**`src/main.ts`**

```ts
import { mount } from '@memoized-dom/runtime';
import { App } from './App';

mount('root', App);
```

**`src/App.tsx`**

```tsx
export function App() {
  let count = 0;
  const doubled = count * 2; // Derived expression: updates automatically

  return (
    <button onClick={() => count++}>
      {count} / {doubled}
    </button>
  );
}
```

---

## State and Reactivity

Reactivity follows reads and writes:

- **`let` vs `const`**: Use `let` when the variable binding itself is reassigned (`count++`) or when initializing derived values that re-evaluate when sources change. Use `const` for stable bindings and in-place mutations (`state.step++`, `items.push(x)`, `set.add(x)`).
- **Component state**: Declared directly in the component body. Each mounted instance receives its own state. The component body executes once as setup, not on every change.
- **Module state**: Module-level variables, objects, `Map`s, and `Set`s are shared reactive state. Mutating them from helper functions updates all reading components across the app without store boilerplate.
- **Class state**: Standard TypeScript classes work out of the box. Mutating instance properties from methods is tracked directly.
- **Derived values**: Write derived state as plain `const` or `let` expressions (e.g. `const total = price * qty`). Never write directly to a derived binding.
- **Reactive control flow**: `if` and `switch` statements that compute values replay before DOM updates. `if` and `switch` branches that return JSX mount and dispose stable DOM regions without re-running the component function.
- **Lists and collections**: Render arrays using `.map()` with a stable `key` attribute (`<li key={item.id}>{item.name}</li>`). Array mutations (`push`, `splice`, index assignments) update the DOM directly.

---

## Effects and Cleanup

`$effect` and `$cleanup` are compiler intrinsics available without imports:

- **`$effect(callback)`**: Runs synchronous imperative side-effects after the DOM settles. Automatically tracks reactive dependencies read within the callback body and re-runs when they change. Returning a function registers a teardown that runs before each re-run and on unmount.
- **Effect refs**: Pass a named function declared in the same module (`$effect(sync)`).
- **Conditional effects**: Wrap `$effect` in an `if` block (`if (active) $effect(connect)`). The effect is created when the condition becomes true and torn down when it becomes false.
- **Module effects**: Top-level `$effect` in any module creates a singleton reactive effect that re-evaluates across module updates.
- **`$cleanup(disposer)`**: Registers a one-time teardown function for non-reactive resources (e.g. `setInterval`, manual event listeners). Multiple cleanups execute last-in, first-out (LIFO) when the component unmounts.

```tsx
export function Chat({ roomId }: { roomId: string }) {
  let unread = 0;

  $effect(() => {
    document.title = unread === 0 ? 'Chat' : `Chat (${unread})`;
  });

  $effect(() => {
    const connection = joinRoom(roomId);
    connection.onMessage(() => unread++);
    return () => connection.leave();
  });

  return <button onClick={() => unread = 0}>Mark read ({unread})</button>;
}
```

---

## DOM Refs

Access real DOM nodes without wrapper objects or hooks:

- **Mutable ref**: Bind a `let` variable or object property directly (`<input ref={input} />`). Assigned once mounted and cleared on teardown.
- **Callback ref**: Pass a function (`<section ref={(el) => { observer.observe(el); return () => observer.disconnect(); }} />`).
- **Multiple refs**: Pass a static array of refs (`<input ref={[input, nodes.input, onMount]} />`). Setup runs left-to-right; teardown runs right-to-left.
- **Ref forwarding**: Components do not have implicit host elements. Accept `ref` as a prop and pass it to an underlying intrinsic element (`<input ref={props.ref} />`).

---

## Data Loading and Async

Asynchronous data reads like synchronous values using compiler intrinsics:

- **`$fetch<T>(url, options?)`**: Declares a request whose binding behaves directly as the resolved payload (`ResolvedValue<T>`). It is a derivation over its URL and query parameters; updating a reactive input automatically re-triggers the request.
- **`$read(promise)`**: Converts an existing promise into a transparent reactive value.
- **`$track(source)`**: Inspects and controls the underlying request lifecycle without modifying the data payload. Provides:
  - `id`: Unique execution identifier.
  - `status`: `'idle' | 'pending' | 'success' | 'error'`.
  - `pending`: Initial load in flight.
  - `refreshing`: In-flight refresh while previous data remains displayed.
  - `error`: `RequestError | null`.
  - `refresh()`: Starts a new request.
  - `abort()`: Cancels the active request.
  - `onSuccess(callback)` and `onError(callback)`: Execution-specific lifecycle callbacks.
- **Optimistic updates**: Mutate transparent data directly for immediate UI feedback. Use `$track` with `request.id` to apply and selectively roll back individual operations.
- **`$forms(action | { schema, action })`**: Manages form submissions, validation with Standard Schema (e.g. Zod), pending states, and errors. Server code can submit `FormData` directly.

```tsx
export function Stories() {
  const stories = $fetch<Story[]>('/api/stories');
  const request = $track(stories);

  return (
    <section>
      {request.pending ? <p>Loading…</p> : null}
      <ul>
        {stories.map(s => <li key={s.id}>{s.title}</li>)}
      </ul>
      <button onClick={() => request.refresh()}>Refresh</button>
    </section>
  );
}
```

---

## Loading UI and `<Group>`

Use `<Group>` from `@memoized-dom/data` to declare loading and error UI without manual branching:

- **Independent read sites**: By default, placeholders appear only at the specific slots where unresolved data is read. The rest of the tree renders immediately.
- **Policy inheritance**: `<Group pending={Skeleton} error={Failure}>` provides default presentations that nested components inherit automatically across files.
- **`suspend` directive**: Add the bare `suspend` attribute to an element or component (`<Dashboard suspend />`) to withhold that subtree until all active descendant data sources resolve, mounting the entire region atomically.

```tsx
import { Group } from '@memoized-dom/data';

export function DashboardView() {
  return (
    <Group pending={Skeleton} error={ErrorPanel}>
      <Dashboard suspend />
    </Group>
  );
}
```

---

## Client Routing

Declare routes and links with compile-time JSX attributes:

- **`route="/path"`**: Mounts elements or components when the URL matches. Supports `:param` capture and terminal `*` wildcards.
- **Nested layouts**: Nesting a `route` inside another joins their URL patterns. The parent's outer markup acts as persistent layout chrome that stays mounted during child navigation.
- **`route-to="/path"`**: Declares navigation targets. On `<a>` elements, generates real `href` attributes with client-side interception. Can accept an object for parameterized routes: `{ path: '/story/:id', params: { id: 42 }, query: { tab: 'info' }, replace: true }`. Dead links to undeclared routes trigger compile errors.

### Router API (`@memoized-dom/router`)

- **`route`**: Reactive snapshot of the current location (`pathname`, `params`, `query`, `matches`, `signal`).
- **`navigate(pattern, options)`**: Programmatic navigation.
- **`navigateRelative(pattern, options)`**: Navigation relative to the current route.
- **`blockNavigation(guard)`**: Synchronous navigation guard. Return `false` to cancel or `redirectRoute('/path')` to redirect.
- **`subscribeNavigation(listener)`**: Subscribes to navigation lifecycle phases (`start`, `prepare`, `redirect`, `blocked`, `error`, `complete`).

---

## Route Preparation with `$routed`

`$routed(prepare)` runs before a route commits and its component renders:

- Must be placed in a component attached to a `route`.
- **Universal context**: `{ url, params, query, signal, state }`. The `state` bag persists across navigations to that route.
- **Server-backed context**: Accessing `request`, `locals`, `services`, or `platform` marks the callback as server-only. The compiler extracts the function to execute on the server, streaming only the serialized result to the browser.
- Supports `async`/`await` and returning `redirectRoute('/login')` to redirect before rendering.

```tsx
export function StoryPage() {
  const story = $routed(async ({ params, services }) => {
    return await services.database.stories.find(params.id);
  });

  return <h1>{story.title}</h1>;
}
```

---

## Server and SSR (`@memoized-dom/server`)

Configure full-stack applications with `serve()`:

```ts
// server.ts
import { serve } from '@memoized-dom/server';
import { App } from './src/App';

const app = serve({
  createLocals: (request) => ({ requestId: crypto.randomUUID() }),
  createServices: async () => ({ database: await initDb() }),
  createPlatform: (request) => ({ env: process.env }),
  onError: (error) => new Response('Internal Error', { status: 500 }),
});

app.ssr(App);

export default app;
```

- **Lifetimes**:
  - `createLocals`: Runs on every request for request-specific state.
  - `createServices`: Runs once lazily to build shared application resources (e.g. database pools).
  - `createPlatform`: Runs per request to provide deployment host bindings (e.g. Cloudflare Workers env).
- **HTTP endpoints**: Standard routing methods (`app.get`, `app.post`, `app.put`, `app.delete`, etc.) receive `{ request, url, params, locals, services, platform }`.
- **SSR modes**:
  - `resolve`: Waits for all data sources before sending the full HTML page.
  - `stream`: Sends the shell immediately, streaming content regions and hydration data as they resolve.
  - `shell`: Sends the static shell immediately with pending UI; data loads client-side.
- **Hydration**: Client `mount('root', App)` automatically adopts server markup. Optional `onHydrateError` diagnostic callback catches hydration mismatches.

---

## Server Functions

Server functions reside in `server/functions/*.ts` and provide type-safe RPC endpoints:

- **Annotations**: Explicit JSDoc annotations define HTTP methods (`@GET`, `@POST`, `@PUT`, `@PATCH`, `@DELETE`).
- **Validation**: `@Input schema` validates arguments using Standard Schema (such as Zod).
- **Virtual import**: Client code imports functions through `#server-functions`. Calling a `@GET` endpoint returns a transparent data source; calling mutation methods sends JSON payloads.
- **Context access**: Read server state inside functions using `getServerContext()`.
- **Typing contract**: Export `interface ServerTypes` from `server/config/index.ts` to type `locals`, `services`, and `platform` globally across routes, middleware, and server functions.

---

## Compiler Intrinsics Reference

The following ambient intrinsics are provided by the compiler without manual imports:

- **`$effect(callback)`**: Synchronous reactive effect replaying on dependency changes.
- **`$cleanup(disposer)`**: One-time component teardown on unmount.
- **`$fetch(target, options?)`**: Transparent fetch resource payload.
- **`$read(promise)`**: Converts a promise into a transparent reactive value.
- **`$track(source)`**: Inspects and controls lifecycle states of fetch sources, promises, or forms.
- **`$forms(action | options)`**: Form submission, validation, and pending state management.
- **`$routed(prepare)`**: Pre-render route data preparation and navigation gating.

---

## Code Health

Development tests and type checks use Bun 1.4.3 or newer (including the current canary). After installing dependencies and building the workspace packages:

```bash
bun run test        # All suites, including Chrome integration tests
bun run test:root   # Compiler/runtime tests, with two isolated Bun workers
bun check          # Project type check
bun run bench:router
```

DOM suites preload Happy DOM; backend suites use Bun's native globals. Individual packages retain their `bun run test:<package>` commands. Browser tests use `MMD_CHROME_PATH` when provided, or discover an installed Chrome/Chromium browser. They skip when no supported browser is available. Keep the browser suite sequential to avoid competing Vite builds and browser teardown.

Agent code-health checks should run Fallow from the package being analyzed:

```bash
cd packages/compiler
fallow list
fallow dead-code
fallow health --hotspots --targets
fallow audit --base HEAD~1
```

or simply `fallow` to get general issues across all categories.

Treat findings as candidates: trace removals, avoid blind auto-fixes, and run the repository tests and typecheck after edits.
