# Memoized DOM guide for code-generating LLMs

This document is a self-contained guide for building applications with the
published Memoized DOM packages. Treat it as the framework contract when
generating a new project.

Memoized DOM is a compiler-first TypeScript + JSX framework. Application code
uses ordinary variables, objects, arrays, functions, classes, DOM events, and
JSX. The compiler discovers reads, writes, derived values, effects, component
boundaries, lists, conditions, and routes ahead of time. The runtime updates
real DOM nodes directly; there is no virtual DOM and no user-facing signal,
store, hook, or state-wrapper API.

The most important rule is:

> Reactivity follows compiler-visible reads and writes, not `let`, `const`, a
> naming convention, or a state primitive.

State can live anywhere in the connected authored module graph: inside a
component instance, at module scope, in a separate state file, inside a plain
object or collection, behind linked helper functions, or in a plain TypeScript
class. Module state is not a special store type.

## Rules an LLM must follow

1. Write plain TypeScript and JSX. Do not import React, a JSX runtime, hooks,
   signals, or a state manager.
2. Do not invent APIs such as `useState`, `useEffect`, `createSignal`, `ref()`,
   `computed()`, or `defineComponent()`.
3. Import `mount` only in the browser entry. Import `$fetch`/`$action` only when
   using the data package, and import router values only when they are actually
   read or called.
4. `effect(...)` and `cleanup(...)` are compiler intrinsics. Use them as ambient
   globals and do not import them.
5. Use `let` only when the binding itself must be reassigned. Prefer `const`
   when only an object's or collection's contents change.
6. Never use `let` as a reactivity marker. A never-written `let` is not made
   reactive merely by being declared with `let`.
7. A `const` object, array, `Map`, `Set`, or class instance can be reactive.
   `const` fixes the binding, not its contents.
8. Express derived state as an ordinary pure `const` expression. The compiler
   replays it when its dependencies change. Do not assign to a derived value.
9. Keep all authored application modules reachable through static imports from
   the configured Vite entry so the compiler can link cross-file reads and
   writes.
10. Render changing collections with `.map(...)` and give rows a stable
    `key`, normally an ID. Do not build a mutable array of runtime JSX values.
11. Components are synchronous uppercase functions or uppercase `const` arrow
    functions. A component factory is initialization code and normally runs
    once per instance; reactive updates do not rerun the whole component.
12. Use compiler-owned `route` and `route-to` JSX attributes for application
    routing. Do not import anything from `@memoized-dom/router/internal`.
13. Keep `$fetch` resource objects intact. Reading `resource.data` later is
    live; destructuring `{ data }` takes an ordinary JavaScript snapshot.
14. Own long-lived resources explicitly with `cleanup(...)`.

## Minimal published-package project

Memoized DOM's compiler and Vite adapter require Node.js 24.11 or newer. The
adapter targets Vite 8.

Install the core build packages:

```bash
npm install @memoized-dom/runtime
npm install -D @memoized-dom/compiler @memoized-dom/vite vite typescript
```

Install these public packages when the app uses data loading and routing:

```bash
npm install @memoized-dom/data @memoized-dom/router
```

The compiler is listed explicitly even though the Vite adapter depends on it.
That makes the published JSX/global type entry directly resolvable in every
package-manager layout.

Package roles:

| Package | Application use |
|---|---|
| `@memoized-dom/runtime` | Public `mount` boundary and generated-code runtime. |
| `@memoized-dom/compiler` | Build-time compiler plus `@memoized-dom/compiler/jsx` ambient types. Application modules normally do not import its JavaScript API. |
| `@memoized-dom/vite` | Compiles the connected authored graph during Vite development and builds. |
| `@memoized-dom/data` | Optional `$fetch`, `$action`, validation, sharing, cancellation, and optimistic updates. |
| `@memoized-dom/router` | Optional public route state and imperative navigation; compiler routing also emits imports from its generated-code bridge. |
| `@memoized-dom/language-service` | Optional tsserver diagnostics and fixes for compiler errors and `let` bindings that can safely be `const`. |

For editor diagnostics, optionally install the language service and add it to
`compilerOptions.plugins`:

```bash
npm install -D @memoized-dom/language-service
```

```json
{
  "compilerOptions": {
    "plugins": [
      { "name": "@memoized-dom/language-service" }
    ]
  }
}
```

This plugin improves tsserver-powered editors; it does not add diagnostics to
standalone `tsc`.

Use this small layout:

```text
project/
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  src/
    main.ts
    App.tsx
    styles.css
```

`package.json`:

```json
{
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

Keep the dependencies added by the install commands. Do not add React or a
React JSX plugin.

`tsconfig.json`:

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
    "types": ["@memoized-dom/compiler/jsx", "vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

The `@memoized-dom/compiler/jsx` type entry declares JSX plus the ambient
`effect` and `cleanup` compiler intrinsics. It does not add a runtime import.

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';

export default defineConfig({
  plugins: [
    memoizedDom({
      entries: 'src/main.ts',
    }),
  ],
});
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Memoized DOM app</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/main.ts` is an ordinary browser entry with one top-level `mount` call:

```ts
import { mount } from '@memoized-dom/runtime';
import { App } from './App';
import './styles.css';

const application = mount('root', App);

// Optional: application.unmount() is idempotent and runs owned cleanup.
```

`mount` accepts an element ID or an `Element`. The current runtime supports one
mounted application at a time. Do not call a compiled component as a normal
function from authored code; render it with JSX or pass the root component to
`mount`.

`src/App.tsx` can begin with no framework imports at all:

```tsx
export function App() {
  let count = 0;
  const doubled = count * 2;

  return (
    <main>
      <h1>Memoized DOM</h1>
      <button onClick={() => count++}>
        Count: {count}; doubled: {doubled}
      </button>
    </main>
  );
}
```

The `doubled` value updates. The compiler turns that authored `const`
derivation into instance-owned replay code; the component function is not
called again on every click.

## The state model: state can live everywhere

Memoized DOM does not ask the author to declare which values are reactive. The
compiler links mutations to consumers by analyzing the connected source graph.
A relationship becomes reactive when a value is read by rendered output, a
derived value, or an effect and the compiler can observe a write that may
change it.

### `let` versus `const`

Declaration kind retains normal JavaScript meaning:

| Source shape | Meaning in Memoized DOM |
|---|---|
| `let count = 0` | The binding may be reassigned, incremented, or updated. |
| `const state = { count: 0 }` | The binding is fixed; `state.count` may change reactively. |
| `const items = []` | The binding is fixed; `push`, `splice`, index writes, and other content mutations can be reactive. |
| `const selected = new Set()` | `add`, `delete`, and other receiver operations can invalidate readers. |
| `const doubled = count * 2` | A pure derived value, replayed when `count` changes. It is read-only authored state. |
| `let label = 'ready'` with no writes | Just a stable variable; `let` alone does not create reactivity. |

Correct examples:

```tsx
export function Counter() {
  let count = 0;                       // binding changes
  const state = { step: 1 };           // object contents change
  const history: number[] = [];        // array contents change
  const doubled = count * 2;           // derived from count

  return (
    <section>
      <button onClick={() => {
        count += state.step;
        history.push(count);
      }}>
        {count} / {doubled} / {history.length}
      </button>
      <button onClick={() => state.step++}>step: {state.step}</button>
    </section>
  );
}
```

Incorrect ideas:

```ts
let immutableByConvention = 1; // `let` does not make this reactive by itself.

const items = [1, 2];
items = [3, 4];                 // invalid: rebinding a const root

let count = 1;
const doubled = count * 2;
doubled++;                      // invalid: a derivation is read-only
```

Use `const` whenever the binding itself does not change. The language-service
package can even suggest this because it knows that mutable `const` contents
remain valid reactive mutation targets.

### Component-local state

Variables declared during component initialization belong to that component
instance. Each instance gets its own closure state, derived values, DOM nodes,
effects, and cleanup ownership.

```tsx
export function SearchBox() {
  let query = '';
  let submitted = '';
  const normalized = query.trim().toLowerCase();

  function submit(event: Event) {
    event.preventDefault();
    submitted = normalized;
  }

  return (
    <form onSubmit={submit}>
      <input
        value={query}
        onInput={(event) => {
          query = (event.currentTarget as HTMLInputElement).value;
        }}
      />
      <button type="submit">Search</button>
      <output>{submitted}</output>
    </form>
  );
}
```

The component body is initialization plus a declarative update plan. Do not
expect an arbitrary statement such as `console.log('render')` in the component
body to run on every state change. Use `effect` for reactive imperative work.

### Module-level and cross-module state

Module state is a shared singleton for the connected application graph. It can
be a primitive binding, object, collection, or class instance. Actions may live
beside it or in other linked files.

`src/counter-state.ts`:

```ts
export let count = 0;

export const preferences = {
  step: 1,
  showDetails: true,
};

export const history: number[] = [];

export function increment() {
  count += preferences.step;
  history.push(count);
}

export function setStep(step: number) {
  preferences.step = step;
}
```

`src/counter-derived.ts`:

```ts
import { count, history } from './counter-state';

export const doubled = count * 2;
export const hasHistory = history.length > 0;
export const summary = `${count} (${history.length} updates)`;
```

`src/CounterPanel.tsx`:

```tsx
import { count, increment, preferences, setStep } from './counter-state';
import { doubled, hasHistory, summary } from './counter-derived';

export function CounterPanel() {
  return (
    <section>
      <button onClick={increment}>{count} / {doubled}</button>
      <button onClick={() => setStep(preferences.step + 1)}>
        Step: {preferences.step}
      </button>
      <p if={hasHistory}>{summary}</p>
    </section>
  );
}
```

The compiler links all three files. It turns exported derived expressions into
computed entities and propagates only changed derived results to their readers.
No component imports a store primitive and no state file imports the runtime.

Module-level derived chains may cross several files:

```ts
// state.ts
export let sales = 20;
export function recordSale() { sales++; }

// gross.ts
import { sales } from './state';
export const gross = sales * 25;

// label.ts
import { gross } from './gross';
export const grossLabel = `$${gross}`;
```

Pure top-level `if`/`else` and exhaustive `switch` calculations are supported
when a result is assigned by the branches:

```ts
import { status } from './state';

export let statusLabel = '';
switch (status) {
  case 'ready':
    statusLabel = 'Ready';
    break;
  case 'busy':
    statusLabel = 'Working';
    break;
  default:
    statusLabel = 'Unavailable';
    break;
}
```

This is a computed result, not mutable application state. Application handlers
must update `status`, not `statusLabel`.

### Plain class state

Classes authored in the linked graph need no base class or proxy:

```ts
export class TodoStore {
  todos = [{ id: 1, title: 'Learn Memoized DOM', done: false }];
  filter: 'all' | 'open' = 'all';

  add(title: string) {
    this.todos.push({ id: Date.now(), title, done: false });
  }

  toggle(id: number) {
    const todo = this.todos.find((item) => item.id === id);
    if (todo) todo.done = !todo.done;
  }
}

export const todos = new TodoStore();
```

The compiler summarizes linked method writes and routes updates to readers.
An instance returned by an external, uncompiled package instead uses the
external-state compatibility path described later.

### Async code, timers, and callbacks

Use ordinary async functions. Writes before and after `await` are committed at
their actual execution boundaries:

```tsx
export function Profile() {
  let loading = false;
  let name = '';
  let error = '';

  async function load() {
    loading = true;
    error = '';
    try {
      const response = await fetch('/api/profile');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { name: string };
      name = data.name;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Request failed';
    } finally {
      loading = false;
    }
  }

  return (
    <section>
      <button disabled={loading} onClick={load}>Load</button>
      <p>{loading ? 'Loading…' : name}</p>
      <p if={!!error}>{error}</p>
    </section>
  );
}
```

The same compiler-visible invalidation applies to callbacks passed to timers,
promises, subscriptions, and linked helpers. If an external library mutates a
rendered object later through code the compiler cannot see, Memoized DOM falls
back to pulling that rendered state once per visible animation frame while its
owner is mounted. Existing DOM value guards prevent unchanged writes. This is
why ordinary animation libraries and getter-backed data resources work without
package-name-specific compiler rules. Still dispose external resources with
`cleanup`.

## Derived state

Derived state is ordinary pure TypeScript evaluated from state or props:

```tsx
export function Cart({ taxRate }: { taxRate: number }) {
  const items = [{ id: 1, price: 20, quantity: 1 }];
  let coupon = 0;

  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const tax = (subtotal - coupon) * taxRate;
  const total = subtotal - coupon + tax;

  return <output>{total.toFixed(2)}</output>;
}
```

Important derived-state rules:

- Use a `const` expression; no `computed()` or memo hook exists.
- A derived expression can read local state, props, module state, imported
  derived values, and pure linked helper results.
- Derivations can form chains. The compiler replays the reachable chain in
  source/dependency order.
- A helper call is allowed in a derivation when its relevant implementation is
  visible/linkable and pure.
- Do not write state, recurse, or perform external side effects while computing
  a derivation.
- Do not mutate the derived result itself as though it were source state.
- Keep expensive work split into separate derivations where practical; the
  compiler can replay only the groups reached by a particular write.

This helper-based derivation is supported:

```tsx
export function Counter() {
  let count = 1;

  function getCount() {
    return count;
  }

  const doubled = getCount() * 2;
  const quadrupled = doubled * 2;

  return <button onClick={() => count++}>{quadrupled}</button>;
}
```

It is incorrect to claim that `getCount() * 2` cannot update. The compiler
propagates reads through supported local and linked helpers. It will reject a
helper used as a derivation if that helper writes reactive state or is
recursive.

## Components, props, events, and JSX

Declare components as synchronous uppercase functions:

```tsx
export function Greeting({ name }: { name: string }) {
  return <p>Hello {name}</p>;
}

export const Badge = ({ text }: { text: string }) => (
  <strong>{text}</strong>
);
```

Use ordinary props, destructuring, rest props, nested children, and callbacks.
Linked child components retain their instance and receive changed props without
recreating their factory.

```tsx
function Frame({ title, children }: { title: string; children?: unknown }) {
  return (
    <section>
      <h2>{title}</h2>
      <div>{children}</div>
    </section>
  );
}

export function App() {
  let name = 'Ada';
  return (
    <Frame title={name}>
      <button onClick={() => name = 'Grace'}>Rename</button>
    </Frame>
  );
}
```

Events use normal DOM-style JSX names such as `onClick`, `onInput`,
`onChange`, `onSubmit`, `onKeyDown`, and `onPointerMove`. Event handler writes
are compiler-instrumented and batched. Use normal assignments and mutations;
there is no setter function requirement.

Fragments are supported. Dynamic text, properties, attributes, classes, styles,
`innerHTML`, component props, and event expressions are compiled to direct DOM
operations. `innerHTML` is trusted/unsanitized and must not be combined with
compiler-managed children on the same element.

Components may use supported JSX early returns and exhaustive JSX `if`/`switch`
control flow. Keep components synchronous; start async work from a handler,
effect, or resource rather than making the component itself `async`.

### Conditions

Normal JSX conditionals work:

```tsx
{pending ? <p>Loading…</p> : <Results />}
{showDetails && <Details />}
```

For readable sibling branches, use compiler-owned directives:

```tsx
<LoadingPanel if={request.pending} />
<ErrorPanel else-if={!!request.error} error={request.error} />
<Results else items={request.data ?? []} />
```

Rules for `if`/`else-if`/`else`:

- They are compile-time JSX properties and are removed from DOM/component
  props.
- A chain must be made of adjacent siblings. Only formatting whitespace and
  JSX comments may be between branches.
- Any number of `else-if` branches is allowed; `else` is optional.
- `else-if` or `else` without a preceding `if` is a compiler error.
- A standalone `if={condition}` is valid.
- Branch changes replace only the stable owned DOM region and immediately run
  branch refs/cleanup.

### Lists

Render reactive collections with `.map(...)`:

```tsx
export function TodoList() {
  const todos = [
    { id: 1, title: 'First', done: false },
    { id: 2, title: 'Second', done: false },
  ];

  return (
    <ul>
      {todos.map((todo, index) => (
        <li key={todo.id}>
          <span>{index + 1}. {todo.title}</span>
          <button onClick={() => todo.done = !todo.done}>
            {todo.done ? 'Done' : 'Open'}
          </button>
        </li>
      ))}
    </ul>
  );
}
```

Use a stable domain key such as `todo.id`; avoid an index key when rows may be
inserted, removed, or reordered. Keyed rows retain their DOM nodes, local state,
effects, and refs across reorders. Removing a row disposes only that row.

Calculated sources such as `items.filter(predicate).map(...)` and optional
sources such as `resource.data?.map(...)` are supported. Static JSX arrays may
be flattened, but a mutable runtime array of JSX is not a virtual-node store;
keep mutable data in an ordinary collection and map it to JSX at the render
site.

## Effects and cleanup

### `effect`

`effect` is the escape hatch for reactive work outside the DOM: subscriptions,
connections, media APIs, logging, animations, and synchronization with other
systems.

```tsx
export function Presence({ roomId }: { roomId: string }) {
  let enabled = true;

  effect(() => {
    if (!enabled) return;
    const connection = connectToRoom(roomId);
    return () => connection.disconnect();
  });

  return (
    <button onClick={() => enabled = !enabled}>
      {enabled ? 'Connected' : 'Disconnected'}
    </button>
  );
}
```

Effect contract:

- Do not import `effect`.
- Put it directly at the top level of a component body or directly at module
  scope. It is not a general function that may be hidden in arbitrary nested
  control flow.
- Pass one synchronous inline callback or one resolvable local/module function.
- Do not pass a dependency array. The compiler discovers immediate local,
  prop, module, imported, and derived reads statically.
- Effects initially run after DOM render work. On a dependency change, DOM and
  computed work drains before the effect reruns.
- A returned synchronous function is the teardown. It runs before rerun and
  when the owner is removed.
- The effect callback itself cannot be `async`. Start async work inside it and
  return a synchronous abort/unsubscribe function.
- Writes performed inside an effect are supported, but unconditional feedback
  loops are errors. Prefer effects for external synchronization, not derived
  values.

A named conditional effect can be activated and deactivated structurally:

```tsx
export function Clock() {
  let running = false;
  let now = Date.now();

  function synchronize() {
    const timer = window.setInterval(() => now = Date.now(), 1000);
    return () => window.clearInterval(timer);
  }

  if (running) {
    effect(synchronize);
  }

  return (
    <button onClick={() => running = !running}>
      {running ? new Date(now).toLocaleTimeString() : 'Stopped'}
    </button>
  );
}
```

A conditional effect must be controlled by top-level `if` statements whose
branches contain only `effect(...)`, nested effect-only `if` statements, or
empty statements. While false, the active callback does not exist; becoming
false runs its teardown.

Effects also work at module scope as singleton reactive entities:

```ts
export let theme: 'light' | 'dark' = 'light';

effect(() => {
  document.documentElement.dataset.theme = theme;
  return () => delete document.documentElement.dataset.theme;
});

export function toggleTheme() {
  theme = theme === 'light' ? 'dark' : 'light';
}
```

Module effects can read and write linked module state. Their latest teardown is
owned by module reevaluation/HMR. A module effect with no dependencies runs
once after module initialization.

### `cleanup`

Use `cleanup(disposer)` for a non-reactive resource created during component
initialization:

```tsx
export function WidthProbe() {
  let width = window.innerWidth;

  const onResize = () => width = window.innerWidth;
  window.addEventListener('resize', onResize);
  cleanup(() => window.removeEventListener('resize', onResize));

  return <output>{width}</output>;
}
```

`cleanup` is ambient and accepts exactly one disposer expression. Call it
directly during component factory initialization. It is component-owned and
runs on unmount. It is not valid at module scope; use a module `effect` with a
returned teardown there.

## DOM refs

DOM refs are compiler-owned lifecycle slots. There is no `useRef`, `ref()`
wrapper, or public ref-key object.

### Mutable refs

Use an assignable identifier or member expression:

```tsx
export function Editor() {
  let input: HTMLInputElement | undefined;
  const nodes: { panel?: HTMLElement } = {};

  return (
    <section ref={nodes.panel}>
      <input ref={input} />
      <button onClick={() => input?.focus()}>Focus</button>
    </section>
  );
}
```

The node is assigned after its local DOM scope is created. On teardown, the
target is cleared only if it still holds that same node. These lifecycle
assignments do not schedule reactive rendering; `let input` is a writable ref
slot, not UI state.

### Callback refs

A callback receives the real node and may synchronously return cleanup:

```tsx
function install(node: HTMLElement) {
  node.dataset.mounted = 'true';
  return () => delete node.dataset.mounted;
}

export function Panel() {
  return <section ref={install}>Ready</section>;
}
```

A callback ref is installed once for a retained element. Its identity is not
reactively replaced. If the setup must be reconfigured when state changes, use
an `effect` and a mutable ref.

Several refs may be installed on one element:

```tsx
<input ref={[input, nodes.input, installAccessibility]} />
```

Nested static arrays and empty values are allowed. Setup is left-to-right and
teardown is right-to-left. Array spreads are not allowed because the compiler
needs a static ref shape.

Ref ownership follows the smallest structural region: a conditional branch,
keyed row, render slot, or component. Removing that region runs its ref cleanup
immediately.

### Forwarding refs through components

Components do not have an implicit host element. Forward a ref prop explicitly:

```tsx
interface InputProps {
  label: string;
  ref?: unknown;
  inputRef?: unknown;
  id?: string;
}

function Input({ label, ref: forwardedRef, inputRef, ...rest }: InputProps) {
  return (
    <label>
      <span>{label}</span>
      <input ref={[forwardedRef, inputRef]} {...rest} />
    </label>
  );
}

export function Form() {
  let email: HTMLInputElement | undefined;
  return <Input label="Email" ref={email} id="email" />;
}
```

The normal `ref` property can also travel through an ordinary rest/spread
wrapper. When building a runtime props object, use a callback ref. An object
literal `{ ref: input }` reads the current value of `input`; ordinary JavaScript
cannot preserve the ability to assign back to that lexical binding.

## Data loading: `@memoized-dom/data`

The data package exports public browser-first fetch resources and callable
actions:

```ts
import {
  $fetch,
  $action,
  createDataRuntime,
  clearDataRuntime,
  RequestError,
} from '@memoized-dom/data';
```

The package is usable independently of the compiler. Memoized DOM currently
treats its getter-backed values like any other opaque external state and
pulls rendered getters through the compatibility path. There is no compiler
rule based on the names `$fetch` or `$action`.

### Fetch resources

`$fetch` starts a GET request immediately and returns one stable resource:

```tsx
import { $fetch } from '@memoized-dom/data';

interface Todo {
  id: number;
  title: string;
}

export function Todos() {
  const todos = $fetch<Todo[]>('/api/todos');
  cleanup(todos.abort);

  return (
    <section>
      <p if={todos.pending && !todos.data}>Loading…</p>
      <div else-if={!!todos.error && !todos.data}>
        <strong>{todos.error?.message}</strong>
        <button onClick={() => todos.refresh()}>Retry</button>
      </div>
      <ul else>
        {todos.data?.map((todo) => (
          <li key={todo.id}>{todo.title}</li>
        ))}
      </ul>
    </section>
  );
}
```

Component factories run once, so this declaration does not issue a new request
on every reactive update.

Resource state:

```ts
resource.data;       // T | undefined
resource.error;      // RequestError | null
resource.status;     // 'idle' | 'pending' | 'success' | 'error'
resource.pending;    // boolean
resource.refreshing; // boolean
```

During refresh, existing successful data remains available,
`pending === true`, and `refreshing === true`. A failed refresh preserves old
data and places the refresh error in `error`.

Do not destructure live state:

```ts
const resource = $fetch<User[]>('/api/users');
const { data, pending } = resource; // snapshots; these bindings do not update
```

Keep the resource and read `resource.data`/`resource.pending` where needed.
Bound methods such as `const { refresh } = resource` are safe to extract.

Request options include query values, headers, identity, sharing, validation,
and cancellation:

```ts
const users = $fetch<User[]>('/api/users', {
  query: {
    search: 'Ada',
    page: 2,
    active: true,
    tag: ['compiler', 'typescript'],
  },
  headers: {
    Authorization: `Bearer ${token}`,
  },
  key: ['users', accountId],
  cache: { scope: 'app' },
  signal: abortSignal,
});
```

Query `undefined` values are omitted and array values become repeated query
fields. Normalized URL, query, headers, and validator form the automatic
request identity unless `key` is supplied.

Cache modes:

- Omit `cache` or use `'active'` to share while a matching resource is active.
- Use `cache: false` for a private request/result.
- Use `cache: { scope: 'app' }` to retain data until that data runtime is
  cleared.

No time-based freshness/retention option is currently part of the public API.

`null` is the only paused target:

```ts
const user = $fetch<User>(userId ? `/api/users/${userId}` : null);
```

The target and options are captured when the resource is created. Changing
`userId` does not currently recreate the resource automatically. Replace a
component-local resource explicitly and abort the previous resource when
request arguments change:

```tsx
let user = loadUser(userId);

function selectUser(nextId: string) {
  userId = nextId;
  const previous = user;
  user = loadUser(userId);
  previous.abort();
}
```

Resource operations:

```ts
await resource.refresh();
resource.abort();

resource.update((current) => [...(current ?? []), newItem]);
resource.mutate((current) => {
  current?.push(newItem);
});
```

`update` must return a replacement top-level value. `mutate` ignores its
callback result and preserves the existing top-level value, which makes
in-place operations such as `push` safe. Both supersede an older in-flight
read so stale results cannot overwrite the local change.

The generic `$fetch<T>()` is a TypeScript assertion, not runtime validation.
Pass a Standard Schema-compatible validator with `validate` when the response
is untrusted; the output type is inferred from the schema and validation
failures use `error.kind === 'validation'`.

### Isolated data runtimes and ownership

Use `createDataRuntime` for a separate request/cache/action boundary, a custom
base URL, or an injected fetch implementation:

```tsx
import { createDataRuntime } from '@memoized-dom/data';

export function Users() {
  const data = createDataRuntime({
    baseURL: 'https://api.example.com/',
  });
  const users = data.$fetch<User[]>('users');
  cleanup(data.clear);

  return <output>{users.pending ? 'Loading' : users.data?.length ?? 0}</output>;
}
```

`data.clear()` aborts active reads/actions, resets their pending state, detaches
resources, and drops retained results. Existing resource objects remain valid
and may later be refreshed. `clearDataRuntime()` clears the exported default
runtime. For one default-runtime resource, `cleanup(resource.abort)` is the
smaller ownership boundary.

### Actions and optimistic updates

`$action` creates a lazy write operation. Creating it sends nothing; calling it
sends the request:

```tsx
import { $action, $fetch } from '@memoized-dom/data';

interface Todo { id: string; title: string }
interface CreateTodo { title: string }

const todos = $fetch<Todo[]>('/api/todos');
const createTodo = $action<Todo, CreateTodo>('/api/todos', {
  method: 'POST',
});

async function addTodo(title: string) {
  const temporary: Todo = { id: `temp-${Date.now()}`, title };
  await createTodo(
    { title },
    { optimistic: todos.append(temporary) },
  );
}
```

Supported methods are `POST`, `PUT`, `PATCH`, and `DELETE`; the default is
`POST`. Plain objects/arrays are JSON encoded, while native request bodies such
as `FormData`, blobs, and `URLSearchParams` pass through.

Action state uses `data`, `error`, `status`, and `pending`. Calls return normal
promises and may be handled with `await`/`try`/`catch`. `abort()` cancels active
client work and `reset()` returns visible state to `idle`. The visible state
belongs to the most recently started invocation, so an older late result cannot
overwrite it.

Array resources expose optimistic change constructors:

```ts
await createTodo(input, {
  optimistic: todos.append(temporary),
});

await updateTodo(input, {
  optimistic: todos.replace(existing, optimisticVersion),
});

await deleteTodo(existing.id, {
  optimistic: todos.remove<void>(existing),
});
```

Each change is single-use. Failure rolls back only that change; success
reconciles from the action result. Use `refresh: [anotherResource]` only for
related authoritative data that cannot be derived from the action result.

## Routing: `@memoized-dom/router`

Prefer compiler-owned JSX routing. The compiler sees the linked route graph,
validates it, emits one manifest, and creates stable route-selected DOM regions.
No provider or router component is required.

```tsx
import { route } from '@memoized-dom/router';

function Home() {
  return <main><h1>Home</h1></main>;
}

function Project() {
  const projectId = route.params['projectId'] ?? '';
  const tab = route.query.get('tab') ?? 'overview';

  return (
    <main>
      <h1>Project {projectId}</h1>
      <p>Tab: {tab}</p>
      <a route-to="/projects">All projects</a>
    </main>
  );
}

function NotFound() {
  return <main><h1>Not found</h1><a route-to="/">Home</a></main>;
}

export function App() {
  return (
    <div route="/">
      <Home route="/" />
      <section route="/projects">
        <h1>Projects</h1>
        <Project route="/:projectId" />
      </section>
      <NotFound route="/*" />
    </div>
  );
}
```

The nested declarations above produce `/`, `/projects`,
`/projects/:projectId`, and a terminal catch-all. Route fragments:

- are static strings;
- must begin with `/`;
- compose with the nearest route-bearing JSX ancestor;
- may contain `:namedParams`;
- may use terminal `/*` as a catch-all;
- cannot place child routes beneath a catch-all.

`route` is compiler-owned on both host elements and linked components. It is
removed before normal props/DOM handling.

### Navigation with `route-to`

Use a string for a declared static destination:

```tsx
<a route-to="/projects">Projects</a>
```

Use an object for params, query, hash, or replacement:

```tsx
<a route-to={{
  path: '/projects/:projectId',
  params: { projectId: project.id },
  query: { tab: 'activity', tag: ['compiler', 'runtime'] },
  hash: 'latest',
  replace: false,
}}>
  Open project
</a>
```

The destination must exist in the linked route graph. Parameter keys must
exactly match the path—missing, extra, and duplicate keys are compiler errors.
A catch-all destination uses `params: { '*': 'docs/setup' }`.

Anchors receive a real `href`. Other intrinsic elements receive compiled click
navigation. `route-to` composes with `onClick` and respects
`event.preventDefault()`. It does not support authored history `state`.

### Reading route state

Import the stable getter-backed `route` object only where URL state is needed:

```ts
import { route } from '@memoized-dom/router';

route.href;
route.pathname;
route.search;
route.query.get('tab');
route.query.getAll('tag');
route.hash;
route.params;
route.matches;
route.matched;
route.navigationType;
route.signal;
```

The query view is read-only, and parameters/matches are frozen. Every location
change aborts the previous `route.signal`, which can be passed to cancellable
work such as `$fetch` options.

### Programmatic navigation

Use the public router package when navigation is not naturally expressed in
JSX:

```ts
import {
  navigate,
  navigateRelative,
  back,
  forward,
  blockNavigation,
  redirectRoute,
} from '@memoized-dom/router';

const result = navigate('/projects/:projectId', {
  params: { projectId: 'compiler' },
  query: { tab: 'members' },
});

navigateRelative('../settings');

const unblock = blockNavigation((navigation) => {
  if (navigation.to.pathname === '/private') {
    return redirectRoute('/login', { replace: true });
  }
  if (hasUnsavedChanges) return false;
});
```

`navigate` and `navigateRelative` return a completed/blocked result. Navigation
guards are synchronous and may allow, block, or redirect. Call `unblock()` when
the guard is no longer needed; if it is component-owned, register that with
`cleanup(unblock)`.

Do not use `@memoized-dom/router/internal` in application code. That entry is a
bridge for compiler-generated code. Do not manually call `connectRouter`,
install a route resolver, subscribe just to mirror `route.pathname` into local
state, or manually manipulate `history` for normal app navigation.

Current router boundaries: route/data coordination, route-level lazy chunk
syntax, SSR, streaming, and hydration are not implemented by the routing
directives. Load data explicitly inside routed components and own it normally.

## A compact full example

This example combines module state, local state, derived state, an effect, a
ref, data loading, and routing while importing only real public APIs.

`src/state.ts`:

```ts
export const session = {
  visits: 0,
  compact: false,
};

export const visitLabel = `Visits: ${session.visits}`;

export function recordVisit() {
  session.visits++;
}

export function toggleCompact() {
  session.compact = !session.compact;
}
```

`src/App.tsx`:

```tsx
import { $fetch } from '@memoized-dom/data';
import { route } from '@memoized-dom/router';
import {
  recordVisit,
  session,
  toggleCompact,
  visitLabel,
} from './state';

interface Post {
  id: number;
  title: string;
}

function Home() {
  let heading: HTMLHeadingElement | undefined;
  const posts = $fetch<Post[]>('/api/posts', { cache: { scope: 'app' } });
  const visiblePosts = posts.data?.slice(0, session.compact ? 3 : 10) ?? [];

  cleanup(posts.abort);

  effect(() => {
    document.title = `${visitLabel} · Memoized DOM`;
  });

  return (
    <main>
      <h1 ref={heading}>Posts</h1>
      <div>
        <button onClick={recordVisit}>{visitLabel}</button>
        <button onClick={toggleCompact}>
          {session.compact ? 'Show more' : 'Compact'}
        </button>
        <button onClick={() => heading?.focus()}>Focus heading</button>
      </div>

      <p if={posts.pending && !posts.data}>Loading…</p>
      <div else-if={!!posts.error && !posts.data}>
        <strong>{posts.error?.message}</strong>
        <button onClick={() => posts.refresh()}>Retry</button>
      </div>
      <ul else>
        {visiblePosts.map((post) => (
          <li key={post.id}>
            <a route-to={{
              path: '/posts/:postId',
              params: { postId: post.id },
            }}>
              {post.title}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}

function PostPage() {
  const postId = route.params['postId'] ?? '';
  return (
    <main>
      <a route-to="/">← Posts</a>
      <h1>Post {postId}</h1>
    </main>
  );
}

function NotFound() {
  return <main><h1>404</h1><a route-to="/">Go home</a></main>;
}

export function App() {
  return (
    <div route="/">
      <Home route="/" />
      <PostPage route="/posts/:postId" />
      <NotFound route="/*" />
    </div>
  );
}
```

In production, make an element focusable before calling `focus()` if it is not
naturally focusable (for example, add `tabIndex={-1}` to the heading). The ref
above is included to show syntax and lifecycle, not to replace accessible
focus design.

## Common mistakes

### Treating `let` as the reactive API

Wrong mental model: “all `let` values are reactive and `const` values are not.”

Correct mental model: the compiler connects observable writes to reads. Use
`let` for rebinding and `const` for stable bindings, including mutable objects
and derived expressions.

### Adding wrappers around state

Do not create a fake `state()` or `derived()` identity helper. It is unnecessary
and can obscure the graph. Write the value and expression directly:

```ts
let count = 0;
const doubled = count * 2;
```

### Recomputing derived state in an effect

Do not do this:

```ts
let doubled = 0;
effect(() => { doubled = count * 2; });
```

Use `const doubled = count * 2`. Effects are for external synchronization.

### Destructuring data resources

Do not render a destructured `data` or `pending` snapshot. Retain the resource
object and read its getters in derived/JSX expressions.

### Importing compiler intrinsics

Do not import `effect` or `cleanup` from runtime/testing or another package.
They are unbound ambient identifiers recognized by the compiler. Defining a
local function with either name intentionally shadows the intrinsic.

### Using router internals

Application code uses JSX `route`/`route-to` and public exports from
`@memoized-dom/router`. The `/internal` entry is for generated code.

### Expecting React component semantics

Do not rely on component-body code rerunning after each update. Do not return
React elements as runtime data. Think “one-time component factory plus
compiler-generated DOM update closures and structural regions.”

### Hiding all mutation behind uncompiled code

The compiler is most precise when authored helpers are statically imported and
linked. External objects with pull-readable getters remain correct through the
volatile frame fallback, but hidden state with neither a readable current value
nor an observable callback boundary cannot be discovered by any framework
without an explicit integration.

## Final generation checklist

Before returning a generated Memoized DOM project, verify:

- The Vite plugin is installed and configured with the real browser entry.
- The entry has one top-level `mount(target, App)` call.
- TypeScript uses `jsx: "preserve"` and includes
  `@memoized-dom/compiler/jsx` types.
- React and hook/signal libraries are absent.
- Mutable bindings use `let`; mutable contents may stay behind `const`.
- Derived values are pure `const` expressions and are never assigned.
- Shared/module state is plain exported TypeScript and all relevant files are
  statically reachable from the entry graph.
- Components are synchronous uppercase functions.
- Lists use `.map(...)` with stable keys.
- Conditional directive siblings form valid adjacent chains.
- `effect` and `cleanup` are used without imports and only in supported owner
  positions.
- Refs use `ref={target}` or callback refs, with explicit component forwarding.
- `$fetch` resources are not destructured, changing request arguments are
  handled explicitly, and resources/runtimes have cleanup ownership.
- Router paths start with `/`, route targets are declared, param keys are exact,
  and no router internals are imported.

If these rules are followed, the compiler can preserve Memoized DOM's intended
model: plain authored TypeScript, graph-wide state placement, statically routed
reactivity, and direct memoized real-DOM updates.
