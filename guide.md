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
13. Treat `$fetch<T>()` as the resolved `T`: read properties, derive values,
    and map arrays directly. Do not use `.data`, `.refresh()`, or mutation
    facades on the fetched value.
14. Put unresolved render reads under `Group`, use `$track(value)` only when
    request status is part of the UI, and use the `Error` arm's `retry`
    callback for retries.
15. Maintain strict Value vs. Tracker separation: the value (`ResolvedValue<T>`)
    is 100% colorless plain data; `$track(value)` is an observation lens for
    request lifecycle (`id`, `status`, `pending`, `refreshing`, `error`,
    `onSuccess`, `onError`, `refresh`, `abort`). Never add `.mutate()`,
    `.update()`, or `.then()` to `$track`.
16. Mutate client data directly in memory (`story.votes++`) for optimistic
    updates. Do not use pseudo-store dispatchers. For optimistic rollbacks,
    journal the smallest domain-specific reversible delta keyed by `tracked.id`.
17. Never destructure a colorless source at declaration time (`const { length }
    = getStories()` or `const [item] = $fetch(...)` is compile error
    `[MMD-S004]`). Read properties lazily at use sites (`stories.length`).
18. Server functions in `server/functions/*.ts` must begin with an HTTP verb
    prefix (`get*`, `post*`, `put*`, `patch*`, `delete*`). `get*` functions
    return `ResolvedValue<T>` and may be called in render; non-`get*` functions
    (`post*`, etc.) must only be invoked in event handlers or callbacks
    (`[MMD-S010]`).
19. For server and fullstack applications, use `serve()` from
    `@memoized-dom/server`, compose middleware/routes/SSR on the returned app,
    and let Vite supply the client/server boundary and SSR document.

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

Install the server and adapter packages for fullstack SSR, HTTP serving, and hosting runtime bridges:

```bash
npm install @memoized-dom/server @memoized-dom/adapters
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
| `@memoized-dom/data` | Optional transparent `$fetch` values, `$track`, declarative data boundaries, independent action results, validation, caching, and SSR state transfer. |
| `@memoized-dom/router` | Optional public route state and imperative navigation; compiler routing also emits imports from its generated-code bridge. |
| `@memoized-dom/language-service` | Optional tsserver diagnostics and fixes for compiler errors and `let` bindings that can safely be `const`. |
| `@memoized-dom/server` | Composed fullstack application server (`serve()`), server router, and SSR rendering primitives (`renderToReadableStream`, `renderToString`, `renderWithDom`). |
| `@memoized-dom/adapters` | Platform runtime bridges (Node.js `createNodeHandler`, Bun `createBunFetch`), stream composition, and HTTP response utilities. |

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
    "types": ["@memoized-dom/compiler/jsx", "vite/client"],
    "paths": {
      "#server-functions": ["./.memoized/server-functions.d.ts"]
    }
  },
  "include": ["src", "vite.config.ts", "server"]
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
      clientEntry: 'src/main.ts',
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
why ordinary animation libraries and other getter-backed external state can
work without package-name-specific compiler rules. Transparent `$fetch` values
use their dedicated compiler integration instead. Still dispose external
resources with `cleanup`.

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
<LoadingPanel if={mode === 'loading'} />
<ErrorPanel else-if={mode === 'error'} message={message} />
<Results else items={items} />
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
sources such as `maybeItems?.map(...)` are supported. Static JSX arrays may be
flattened, but a mutable runtime array of JSX is not a virtual-node store; keep
mutable data in an ordinary collection and map it to JSX at the render site.

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

The authored data API is colorless: fetched payloads retain their ordinary
TypeScript shape, while the compiler preserves the hidden request provenance
needed for availability checks and targeted DOM updates.

```ts
import {
  $fetch,
  $track,
  $action,
  Group,
  Pending,
  Error as ErrorArm,
  createDataRuntime,
  clearDataRuntime,
  RequestError,
} from '@memoized-dom/data';
```

Do not import `@memoized-dom/data/internal`. That entry exists only for
generated code and framework adapters.

### Transparent fetch values

`$fetch<T>` declares a GET source and returns a compiler-aware value assignable
to `T`. Consume the payload directly: there is no public `.data` wrapper.

```tsx
import {
  $fetch,
  Group,
  Pending,
  Error as ErrorArm,
} from '@memoized-dom/data';

interface Todo {
  id: number;
  title: string;
  done: boolean;
}

const todos = $fetch<Todo[]>('/api/todos', {
  cache: { scope: 'app' },
});

function TodoSkeleton() {
  return <p>Loading…</p>;
}

function TodoFailure({ error, retry }) {
  return (
    <div>
      <strong>{error.message}</strong>
      <button onClick={retry}>Retry</button>
    </div>
  );
}

export function Todos() {
  const open = todos.filter((todo) => !todo.done);

  return (
    <Group>
      <Pending component={TodoSkeleton} />
      <ErrorArm component={TodoFailure} />
      <ul>
        {open.map((todo) => (
          <li key={todo.id}>{todo.title}</li>
        ))}
      </ul>
    </Group>
  );
}
```

`Group` owns the unavailable states for its data sources. Its first child is a
`Pending` policy, its second child is an `Error` policy, and its final child is
the content UI. By default the content mounts immediately: each expression or
structural site that actually consumes unavailable data receives the matching
policy independently. The error component receives `{ error, retry }`;
retrying is a boundary capability, not a method added to the payload.

Put the shorthand compiler directive `suspend` on the direct content element
when its first mount must wait for every colorless source the compiler infers
from that content:

```tsx
<Group>
  <Pending component={DashboardSkeleton} />
  <ErrorArm component={DashboardFailure} />
  <Dashboard suspend user={user} statistics={statistics} />
</Group>
```

This form renders one pending policy until both initial values commit, then
mounts `Dashboard` atomically. A failure renders one error policy and `retry`
targets the failed source. Later refreshes keep the committed dashboard visible;
`suspend` controls initial readiness, not background revalidation. The compiler
consumes `suspend`, so it is neither passed to `Dashboard` nor included in prop
validation. A direct host element such as `<section suspend>` is also valid.
The directive is rejected outside this direct Group position or when written
as `suspend={...}`.

The compiler carries source dependencies through property reads, derivations,
conditions, lists, and component props. Render reads wait for the source instead
of evaluating against a fake `null` payload. An imperative read that truly runs
too early raises `UnresolvedDataReadError`, which identifies the source and read
site instead of producing a random `null.length` or null-property crash.

### Value vs. Tracker separation: the `$track` model

In Memoized DOM, there is a strict architectural separation between **the data payload** and **the request lifecycle**:

| Entity | Role | Type | Primary Usage |
| :--- | :--- | :--- | :--- |
| **Transparent Value** (`result`, `stories`) | **The Data Payload** | `ResolvedValue<T>` (assignable to `T`) | Template rendering, expressions, reads (`stories.map(...)`, `story.votes`) |
| **Tracked Request** (`$track(result)`) | **The Request Lifecycle** | `TrackedValue<T>` | Event handlers, loading indicators, outcome callbacks (`onSuccess`, `onError`) |

#### Key tenets:

1. **The Value Stays 100% Colorless**:
   `const stories = $fetch<Story[]>('/api/stories')` or `const result = postVote(id)` returns transparent data. In application code, it behaves as a plain TypeScript value. It has no `.then()` method, no Promise wrapper, and requires no `.data` unwrapping.
2. **`$track(...)` is a Request Lens, Not a Store**:
   `$track(value)` observes and controls the request associated with a value. It does **not** have `.mutate()` or `.update()`, and never owns or alters the payload data structure.
3. **No Promise Pollution (`then` / `catch` removed)**:
   `$track` is **not** a Promise and does not implement `PromiseLike`. Developers are not forced into `async / await` or `.then()` chains. Outcome handling is expressed through explicit `onSuccess` and `onError` lifecycle hooks.

#### The `TrackedValue<T>` interface

```ts
export interface TrackedValue<T> {
  /**
   * Unique execution ID for the current/latest in-flight request cycle.
   * Changes whenever a new request is triggered (initial fetch, refresh(), or action call).
   */
  readonly id: string;

  /** Status indicators */
  readonly status: 'idle' | 'pending' | 'success' | 'error';
  readonly pending: boolean;     // Cold initial load in-flight
  readonly refreshing: boolean;  // Background revalidation in-flight
  readonly error: RequestError | null;

  /** One-shot outcome callbacks for this exact execution */
  onSuccess(callback: (data: T, requestId: string) => void): () => void;
  onError(callback: (error: RequestError, requestId: string) => void): () => void;

  /** Imperative controls */
  refresh(): Promise<T>;
  abort(): void;
}
```

```tsx
import { $track } from '@memoized-dom/data';

export function SyncState() {
  const request = $track(todos);
  return (
    <output class={{ busy: request.refreshing }}>
      {request.refreshing ? 'Syncing…' : request.status}
    </output>
  );
}
```

#### Direct client mutation ("Like Our Count App")

In Memoized DOM, state updates operate directly on plain JavaScript objects in memory:

```tsx
// Ordinary local state:
let count = 0;
<button onClick={() => { count++; }}>{count}</button>
```

Fetched data follows the exact same philosophy. When data arrives on the client, it lives as transparent data in client memory. Developers mutate properties directly:

```ts
function upvote(id: number) {
  const story = stories.find((s) => s.id === id);
  if (story) {
    story.votes++; // Direct mutation on transparent data; compiler updates DOM directly
  }
}
```

There is no need for `setStories(...)`, immutable array copies, or pseudo-store dispatchers like `$track.mutate()`.

#### Single-action optimistic updates and rollbacks

For an isolated action, developers mutate client data directly and register an `onError` inverse operation. The request `id` makes the rollback idempotent:

```ts
const pendingVotes = new Set<string>();

function handleVote(id: number) {
  const story = stories.find((s) => s.id === id);
  if (!story) return;

  // 1. Call the endpoint and capture this exact execution.
  const tracked = $track(postVote(id));
  const pending = tracked.id;

  // 2. Direct client mutation (DOM updates immediately).
  pendingVotes.add(pending);
  story.votes++;

  // 3. A failure reverses only this operation, not an old whole-object snapshot.
  tracked.onError((_error, requestId) => {
    if (pendingVotes.delete(requestId)) story.votes--;
  });

  // 4. Success confirms the already-visible increment.
  tracked.onSuccess((_data, requestId) => {
    pendingVotes.delete(requestId);
  });
}
```

#### Concurrent optimistic mutations & domain journals

In real applications, users may click rapidly, firing multiple concurrent requests (e.g., Request 1 through Request 7):
- **Out-of-order resolution**: Request 3 might fail due to network congestion or rate limits, while Request 7 succeeds.
- **Authoritative server state**: Request 7 might return `{ votes: 42 }` (accounting for other concurrent users).
- **The flaw of manual whole-object rollback**: If Request 3 fails, restoring its previous whole-object snapshot would wipe out the optimistic changes from Requests 4, 5, 6, and 7!

There is no universal optimistic manager. The runtime cannot know whether a write is an increment, replacement, reorder, deletion, or a server-side change to several records. Hidden cloning would also be expensive and break object identity.

Each operation records the smallest reversible change required by its domain. A counter records a delta; a form records changed fields; a reorder records previous indices. The request ID makes each journal entry independent:

```ts
const pending = new Map<string, { story: Story; delta: number }>();

function handleVote(id: number) {
  const story = stories.find((s) => s.id === id);
  if (!story) return;

  const request = $track(postVote(id));
  pending.set(request.id, { story, delta: 1 });
  story.votes++;

  request.onSuccess((_result, requestId) => {
    pending.delete(requestId);
  });

  request.onError((_error, requestId) => {
    const operation = pending.get(requestId);
    if (operation === undefined) return;
    operation.story.votes -= operation.delta;
    pending.delete(requestId);
  });
}
```

The framework deliberately does not provide a `createOptimistic` snapshot manager. Whole-object snapshots cannot safely represent overlapping deltas, reorders, deletes, and server-side changes. If absolute server convergence is required, refresh the relevant query after the operation journal drains.

#### The role of the request `id`

Every request cycle generates an incrementing, unique client-runtime `id` (e.g., `"request-1"`, `"request-2"`):
- When a query is re-fetched via `tracked.refresh()`, `tracked.id` updates to identify the new execution.
- When an action is invoked, its `$track(actionResult).id` represents that specific network attempt.

`id` is essential for:
1. **Race Condition Prevention**: Comparing `tracked.id` ensures stale responses cannot overwrite fresher state when responses arrive out of order.
2. **Snapshot Map Keys**: Unambiguous map key (`new Map<string, Entry>()`) to correlate in-flight mutations with their exact pre-mutation state.
3. **Telemetry & Devtools**: Client-side correlation key (not an HTTP idempotency key unless explicitly forwarded).

#### Replacement and cancellation

Assigning a newer result to a local binding changes which operation the UI is displaying; it does not cancel older dispatched work. The compiler detaches the old operation from that render site, retains it until its exact `onSuccess`/`onError` outcome is delivered, and then releases it. Only an explicit `abort()` or supplied `AbortSignal` means cancellation.

Non-GET requests are not deduplicated by default. Two identical POST calls may represent two intentional operations. Applications prevent accidental rapid submission by disabling/debouncing controls, and servers that require at-most-once processing use a domain idempotency key.

#### Destructuring rejection on colorless sources (`[MMD-S004]`)

In colorless data semantics, the compiler represents `const data = getStories()` or `const data = $fetch(...)` through a request-local source descriptor rather than a materialized synchronous snapshot. Destructuring evaluates its member accesses immediately when the statement executes, before the source has settled:

```tsx
// 💥 COMPILE ERROR [MMD-S004]:
const { length, user } = getStories();
const [firstStory] = getStories();
```

Because native JavaScript evaluates destructuring immediately upon executing the statement, properties would evaluate to `undefined` (or throw during array iterator unrolling), breaking reactive tracking.

The compiler rejects destructuring on colorless sources at declaration time with `💥 [MMD-S004]`:
* **Rejected**: `const { length } = getStories();`, `const [a, b] = $fetch(...);`, `({ length } = getStories());`
* **Allowed**:
  * Plain identifier binding: `const stories = getStories();`
  * Property access at the use site: `stories.length`, `stories.map(...)`, `story.title`
  * Destructuring a settled item inside a map callback:
    ```tsx
    {stories.map((story) => {
      const { title, votes } = story; // `story` is a settled plain item
      return <article>{title} — {votes}</article>;
    })}
    ```

#### Architectural boundaries (what to avoid)

To keep the codebase modular, clean, and optimized:
- ❌ **Do NOT add `.mutate()` or `.update()` to `$track`**: `$track` is an observation lens, not a state manager.
- ❌ **Do NOT add `.then()` / `.catch()` to `$track`**: `$track` should not be a Promise or thenable. Use `onSuccess` and `onError`.
- ❌ **Do NOT expose compiler `EventSourceSlot` machinery as public API**: event-assigned variables remain ordinary authored locals.
- ❌ **Do NOT force developers into `effect()` hooks for event logic**: Event handling logic belongs in event handlers, not in reactive synchronization effects.

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

Request inputs are compiler-reactive. When a compiler-visible value used by
the target or options changes, the compiler rebinds the same hidden source and
runs the new request. The authored payload binding remains stable, so existing
render dependencies, `Group`, and `$track` continue observing it.

```tsx
export function UserSearch() {
  let search = '';
  const users = $fetch<User[]>('/api/users', {
    query: { search },
  });
  const request = $track(users);

  return (
    <section>
      <input
        value={search}
        onInput={(event) => {
          search = event.currentTarget.value;
        }}
      />
      <p if={request.pending}>Searching…</p>
      <ul>{users.map((user) => <li key={user.id}>{user.name}</li>)}</ul>
    </section>
  );
}
```

For `search === 'Ada Lovelace'`, that declaration requests
`/api/users?search=Ada+Lovelace`. Query values are URL encoded; do not build the
query string manually. Dynamic path segments are reactive too:

```ts
const user = $fetch<User>(`/api/users/${userId}`);
```

Changing `userId` re-runs the source for the new path. Replaying an equivalent
normalized request identity does not issue a duplicate request. If an older
request is still in flight when the inputs change, it is detached from this
source and cannot overwrite the newer result.

Cache modes:

- Omit `cache` or use `'active'` to share while a matching source is active.
- Use `cache: false` for a private request/result.
- Use `cache: { scope: 'app' }` to retain data until that data runtime is
  cleared.

No time-based freshness/retention option is currently part of the public API.

`null` is the only paused target:

```ts
const user = $fetch<User>(userId ? `/api/users/${userId}` : null);
```

The target and options belong to that source declaration. The public payload
does not expose refresh, abort, update, or mutate methods. Use ordinary
application data writes for local state changes;
use an action for server writes.

The generic `$fetch<T>()` is a TypeScript assertion, not runtime validation.
Pass a Standard Schema-compatible validator with `validate` when the response
is untrusted; the output type is inferred from the schema and validation
failures use `error.kind === 'validation'`.

### Data runtimes and ownership

Use `createDataRuntime` for application/request isolation, a custom base URL,
or an injected fetch implementation. Install it as the active runtime before
mounting; authored modules still use the exported transparent `$fetch` and
`$action` facades.

```ts
import {
  createDataRuntime,
  setActiveDataRuntime,
} from '@memoized-dom/data';
import { mount } from '@memoized-dom/runtime';
import { App } from './App';

const data = createDataRuntime({
  baseURL: 'https://api.example.com/',
});
setActiveDataRuntime(data);
mount('root', App);
```

`data.clear()` aborts active work and drops retained results.
`clearDataRuntime()` clears the currently active runtime. Server rendering and
tests can use `runWithDataRuntime(runtime, callback)` for scoped isolation.

## Fullstack Server Architecture & SSR: `@memoized-dom/server` & `@memoized-dom/adapters`

Memoized DOM provides a unified fullstack application architecture centered around **`defineServer`**, an in-memory **`serverFetch`** bridge, an onion **middleware pipeline**, automatic **document streaming**, and **compiler-named HTTP functions**.

### The Unified Backend API: `defineServer`

Rather than manually stitching together HTML documents, streams, and ad-hoc HTTP endpoints, developers configure the fullstack application server in a single configuration block (`server.ts`):

```ts
// server.ts
import { defineServer, type DefineServerOptions } from '@memoized-dom/server';
import type { ServerMiddleware } from '@memoized-dom/server/router';
import { App } from './App';

interface Locals {
  requestId: string;
  user?: string;
}

let sequence = 0;

const logger: ServerMiddleware<Locals> = async (context, next) => {
  const response = await next();
  console.log(
    `[http] ${context.request.method} ${context.url.pathname} → ${response.status}`,
  );
  return response;
};

const session: ServerMiddleware<Locals> = (context, next) => {
  context.locals.user = context.request.headers.get('x-user') ?? undefined;
  return next();
};

const requireAdmin: ServerMiddleware<Locals> = (context, next) => {
  if (context.request.headers.get('x-admin') !== 'yes') {
    return new Response('Admins only', { status: 403 });
  }
  return next();
};

const options: DefineServerOptions<Locals> = {
  // 1. Root compiled UI component
  app: App,

  // 2. HTML template container — framework loads, validates <!--ssr-outlet-->, and streams
  document: new URL('./index.html', import.meta.url),

  // 3. Global middleware (runs for all requests: pages, /api/*, /_fn/*)
  middleware: [logger, session],

  // 4. Request locals factory (isolated per external dispatch and child in-memory dispatch)
  createLocals: () => ({ requestId: `req-${String(++sequence)}` }),

  // 5. Server endpoints and route-specific middleware
  routes: {
    // Bare handler = implicit GET; plain objects/arrays automatically serialize to Response.json()
    '/api/health': () => ({ ok: true }),

    // Method map: POST only. Other methods answer 405 with an Allow header.
    '/api/echo': {
      POST: (context) => ({
        echoed: context.url.pathname,
        requestId: context.locals.requestId,
      }),
    },

    // Prefix group (*): applies middleware to all nested routes beneath it
    '/api/admin/*': { middleware: [requireAdmin] },
    '/api/admin/stats': (context) => ({
      admin: context.locals.user ?? 'anonymous',
      requestId: context.locals.requestId,
    }),
  },

  // 6. Page render policy
  render: {
    mode: 'resolve',     // 'resolve' waits for request-owned data to settle; 'shell' streams immediately
    markers: true,       // emits hydration markers + application/mmd+json payload for client hydrate
    timeout: 10_000,     // quiescence budget in ms before falling back to shell
    delivery: 'stream',  // 'stream' flushes document prefix while data settles; 'buffer' renders string
  },

  // 7. Default ResponseInit for rendered HTML pages (e.g. edge caching headers)
  init: {
    headers: {
      'cache-control': 'public, max-age=5, stale-while-revalidate=60',
    },
  },

  // 8. Centralized error boundary
  onError: (err, ctx) => {
    console.error(`[SERVER-ERROR] ${ctx.request.method} ${ctx.request.url}:`, err);
    return new Response('Internal Server Error', { status: 500 });
  },
};

export default defineServer(options);
```

#### Handler return types normalization

A route handler can return any of the following; `defineServer` normalizes the response automatically:
* `object` | `array` $\rightarrow$ `Response.json(data)`
* `string` $\rightarrow$ `new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8' } })`
* `Response` $\rightarrow$ Passed through untouched
* `ReadableStream` $\rightarrow$ `new Response(stream)`

#### The `render` Policy Block

`defineServer` exposes rendering choices as one explicit, fully-defaulted `render` block:

| Option | Default | Lowered to | Meaning |
| :--- | :--- | :--- | :--- |
| `mode` | `'resolve'` | `RenderOptions.mode` | `'resolve'` waits for request-owned data to become quiescent and flushes the resolved tree plus state payload. `'shell'` serializes the initial tree with pending arms immediately. |
| `markers` | `true` | marker + payload emission | `true` emits adoption markers and the `application/mmd+json` payload consumed by `hydrate`. `false` produces clean host-consumable HTML (static/non-hydrating). |
| `timeout` | `10_000` | `RenderOptions.timeout` | Quiescence budget for `'resolve'`. On expiry, falls back to the settled shell rather than hanging. |
| `delivery` | `'stream'` | `renderToReadableStream` vs `renderToString*` | `'stream'` flushes the document prefix while the application settles. `'buffer'` materializes the full HTML result before constructing the `Response`. |

### Fullstack HTML Template Configuration (`index.html`)

In fullstack mode, the HTML template container (`examples/fullstack/index.html`) must contain the `<!--ssr-outlet-->` marker inside the target root element:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Memoized DOM — Fullstack Demo</title>
  </head>
  <body>
    <!-- The server streams its rendered HTML into #root for client hydration -->
    <div id="root"><!--ssr-outlet--></div>
    <script type="module" src="/main.ts"></script>
  </body>
</html>
```

Key lifecycle behavior:
* When `document: new URL('./index.html', import.meta.url)` is passed to `defineServer`, the framework loads this template and splits it at `<!--ssr-outlet-->`.
* The **prefix** (everything up to `<div id="root">`) is flushed immediately.
* The server-rendered application markup and the `<script type="application/mmd+json">` state payload are streamed directly into the outlet.
* The **suffix** (`</div><script type="module" src="/main.ts"></script>...`) follows immediately.
* On the browser, `hydrate('root', App)` in `main.ts` targets `<div id="root">`, adopts the server-rendered DOM nodes, and restores state from the payload without issuing duplicate network requests.

### Client Hydration Bootstrap (`main.ts`)

On the client, the data runtime is installed first so `hydrate` can restore the server payload before the compiled tree adopts the marked DOM:

```ts
// main.ts
import { mount } from '@memoized-dom/runtime';
import { App } from './App';

// mount restores SSR data and adopts compatible server-rendered markup.
mount('root', App);
```

Every server function call resolves from the `application/mmd+json` payload on hydration without refetching. Structural mismatches are reported through `onRecover` with automatic fallback to `mount`.

### Compiler-Named HTTP Functions (`server/functions/`)

Server functions live in the **`server/functions/`** directory (e.g. `server/functions/stories.ts`). They are plain async TypeScript functions with strict HTTP verb prefixes that compile into both a server endpoint and a client-side typed facade:

1. **Strict HTTP Verb Prefix**: An exported function must begin with `get`, `post`, `put`, `patch`, or `delete` (e.g. `getStories`, `postVote`, `deleteStory`).
2. **Automatic Route Registration**: Mounted automatically by `defineServer` at `/_fn/<module>/<function>` (e.g. `/_fn/stories/getStories`).
3. **Module Middleware Export**: Modules can export a `middleware` array (`export const middleware = [ ... ]`) which composes in front of every endpoint registered in that module.
4. **Request Context**: Call `getServerContext<Locals>()` to read the active request context (`locals`, `request`, etc.) without process-global singletons.

```ts
// server/functions/stories.ts
import { getServerContext } from '@memoized-dom/server';
import type { ServerMiddleware } from '@memoized-dom/server/router';

function logServerFunction(): ServerMiddleware {
  return (context, next) => {
    console.log(`[fn] ${context.request.method} ${context.url.pathname}`);
    return next();
  };
}

// Module-level middleware runs for every endpoint in this file:
export const middleware = [logServerFunction()];

interface Story {
  id: number;
  title: string;
  votes: number;
}

const stories: Story[] = [
  { id: 1, title: 'First Story', votes: 3 },
  { id: 2, title: 'Second Story', votes: 5 },
];

// 1. GET function: cacheable read, returns stories
export async function getStories() {
  return stories;
}

// 2. GET function with parameter: mapped to query string (?id=1)
export async function getStory(id: number) {
  return stories.find((story) => story.id === id) ?? null;
}

// 3. POST function: mutation, receives JSON body, reads request context
export async function postVote(id: number) {
  const { locals } = getServerContext<{ user?: string }>();
  const story = stories.find((candidate) => candidate.id === id)!;
  story.votes += 1;
  return { id: story.id, votes: story.votes, by: locals.user ?? 'anonymous' };
}

// 4. DELETE function
export async function deleteStory(id: number) {
  const { request } = getServerContext();
  if (request.headers.get('x-admin') !== 'yes') {
    throw new Error('deleteStory requires admin privileges');
  }
  const index = stories.findIndex((story) => story.id === id);
  if (index === -1) throw new Error(`Unknown story ${id}`);
  return stories.splice(index, 1)[0]!;
}
```

#### Strict HTTP verb prefix matrix

| Prefix | HTTP Method | Parameter Transport | Client Lowering | Valid Call Sites |
| :--- | :--- | :--- | :--- | :--- |
| **`get*`** | `GET` | URL Query | `$fetch('/_fn/...', { query })` $\rightarrow$ `ResolvedValue<T>` | Component Render, Module Scope, Event Handlers |
| **`post*`** | `POST` | JSON Body | `$fetch('/_fn/...', { method: 'POST', body })` $\rightarrow$ `ResolvedValue<T>` | Event Handlers, Callbacks Only |
| **`put*`** | `PUT` | JSON Body | `$fetch('/_fn/...', { method: 'PUT', body })` $\rightarrow$ `ResolvedValue<T>` | Event Handlers, Callbacks Only |
| **`patch*`** | `PATCH` | JSON Body | `$fetch('/_fn/...', { method: 'PATCH', body })` $\rightarrow$ `ResolvedValue<T>` | Event Handlers, Callbacks Only |
| **`delete*`** | `DELETE` | JSON Body | `$fetch('/_fn/...', { method: 'DELETE', body })` $\rightarrow$ `ResolvedValue<T>` | Event Handlers, Callbacks Only |

#### Consuming server functions in UI (`#server-functions`)

In UI code, import functions directly from the **`#server-functions`** alias (mapped in `tsconfig.json` to `./.memoized/server-functions.d.ts`).

As demonstrated in `examples/fullstack/App.tsx`, calling a `get*` function returns a transparent `ResolvedValue<T>` that can be mapped directly, while calling a mutating function (like `postVote`) inside an event handler returns a source tracked via `$track`:

```tsx
// App.tsx
import { getStories, getStory, postVote } from '#server-functions';
import { $track, Group, Pending, Error as ErrorArm } from '@memoized-dom/data';

export function App() {
  let selectedId: number | null = null;
  let lastVote = null as ReturnType<typeof postVote> | null;
  const stories = getStories(); // GET source resolves transparently

  function handleVote(id: number) {
    lastVote = postVote(id); // Mutating call returns source tracked by $track
    const tracker = $track(lastVote);

    const story = stories.find((s) => s.id === id);
    if (story) story.votes++;

    tracker.onError(() => {
      if (story) story.votes--;
    });
  }

  return (
    <main>
      <ul>
        {stories.map((story) => (
          <li key={story.id}>
            {story.title} — {story.votes} votes
            <button onClick={() => handleVote(story.id)}>Vote</button>
          </li>
        ))}
      </ul>
      {lastVote !== null && (
        <p if={$track(lastVote).pending}>Recording vote…</p>
      )}
    </main>
  );
}
```

### Vite Fullstack Configuration

In `vite.config.ts`, wire both the client compiler and the fullstack server loader:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import memoizedDom, { memoizedDomFullstack } from '@memoized-dom/vite';

export default defineConfig({
  appType: 'custom',
  plugins: [
    memoizedDom({ entries: 'main.ts' }),
    memoizedDomFullstack({ entry: 'server.ts' }),
  ],
});
```

* `memoizedDom` compiles client components and generates the `#server-functions` facade barrel under `.memoized/`.
* `memoizedDomFullstack` loads `server.ts` through `ssrLoadModule` and auto-installs generated server-function routes per dispatch with hot-module replacement.

### The In-Memory `serverFetch` Bridge ("One Data Source")

When components call `$fetch('/api/stories')` or `getStories()` during SSR:
1. Dispatch bypasses TCP sockets, localhost loopbacks, and network serialization.
2. The request enters the pre-compiled route and middleware pipeline **in memory**.
3. Global middleware, route middleware, response normalization, and error handling run identically to real HTTP requests.
4. During hydration, settled data is restored from the `application/mmd+json` payload tag with zero network requests.
5. Subsequent client navigation uses standard browser `fetch()`.

### Middleware Pipeline & Request Context

* **`ServerContext<TLocals>`**: Contains `request` (untouched native `Request`), `params`, `locals`, `url`, and optional `platform`.
* **`ServerMiddleware<TLocals>`**: `(ctx, next) => Response | Promise<Response>`.
* **Onion Model**: Global middleware $\rightarrow$ Prefix group middleware (`/api/*`, `/api/admin/*`) $\rightarrow$ Route handler $\rightarrow$ Unwinding.
* **Short-Circuiting**: Any middleware can return a `Response` immediately (e.g. `401 Unauthorized`, `302 Redirect`). Prefix middleware (like `/admin/*`) can redirect unauthenticated users before SSR renders, saving compute and preventing unauthorized HTML leaks.

### Compiler Guardrails for Server Functions

* **`[MMD-S010]`**: Calling non-`get*` functions as top-level synchronous statements during initial render evaluation triggers a compile error. They must be invoked inside event handlers or action helpers.
* **`[MMD-S011]`**: Functions exported from `server/functions/*` must begin with `get`, `post`, `put`, `patch`, or `delete`.
* **`[MMD-S003]`**: Only verb-prefixed async functions and the `middleware` export may cross the client boundary. Non-function values (e.g. database handles, secrets) cannot be exported and are safely prevented from leaking.
* **`[MMD-E004]`**: `getServerContext()` throws if invoked outside an active request dispatch.

### Platform Adapters & Host Integration: `@memoized-dom/adapters`

Because `defineServer` outputs a standard `(request: Request) => Promise<Response>` function, host integration is straightforward:

#### Bun
```ts
import server from './server';

export default {
  port: 3000,
  fetch: server, // Bun passes native Request directly
};
```

#### Node.js (via `@memoized-dom/adapters/node`)
```ts
import { createServer } from 'node:http';
import { createNodeHandler } from '@memoized-dom/adapters/node';
import server from './server';

createServer(createNodeHandler(server)).listen(3000);
```

#### Edge Runtimes (Cloudflare Workers, Deno, Vercel Edge)
Pass edge bindings (`env`, `waitUntil`) through `ServerContext.platform`. The core router and renderer remain 100% Web Standard and never import Node APIs.

### Low-Level Server Rendering Primitives

For developers bringing a custom backend framework (Hono, Elysia, Express, Fastify) who only need rendering primitives:

| Primitive | Rendering tier | Return value | Data behavior | Ownership |
| --- | --- | --- | --- | --- |
| `renderWithDom` | LinkeDOM or injected `DocumentLike` | live document, nodes, HTML, runtime | immediate shell | caller disposes `result.runtime` |
| `renderWithDomAsync` | LinkeDOM or injected `DocumentLike` | live document, nodes, HTML, runtime | can settle in `resolve` mode | caller disposes `result.runtime` |
| `renderToString` | fast string document | HTML string | immediate shell | disposed automatically |
| `renderToStringAsync` | fast string document | HTML string | can settle in `resolve` mode | disposed automatically |
| `renderToResult` | fast string document | HTML, payload object, payload script | immediate shell | disposed automatically |
| `renderToResultAsync` | fast string document | HTML, payload object, payload script | can settle in `resolve` mode | disposed automatically |
| `renderToReadableStream` | fast string document | Web `ReadableStream<Uint8Array>` | shell or ordered settled streaming | disposed when stream finishes/errors |

```ts
import { renderToReadableStream } from '@memoized-dom/server';
import { createDocumentStream, htmlResponse } from '@memoized-dom/adapters';
import { App } from './App';

export function handleRequest(request: Request): Response {
  const url = new URL(request.url);
  const body = renderToReadableStream(App, {
    url: url.pathname + url.search,
    mode: 'resolve',
    markers: true,
    signal: request.signal,
  });

  return htmlResponse(createDocumentStream({
    prefix: '<!doctype html><html><body><div id="root">',
    body,
    suffix: '</div><script type="module" src="/main.ts"></script></body></html>',
  }));
}
```

### Actions and action results

`$action` creates a lazy write operation. Creating it sends nothing; calling it
sends the request and immediately returns that invocation's independent live
result. It does not return a promise.

```ts
import { $action } from '@memoized-dom/data';

interface Todo { id: string; title: string }
interface CreateTodo { title: string }

const createTodo = $action<Todo, CreateTodo>('/api/todos', {
  method: 'POST',
});

const creation = createTodo({ title: 'Write the guide' });

creation.id;    // unique to this invocation
creation.state; // initially 'idle', then 'pending'/'success'/'error'
```

Supported methods are `POST`, `PUT`, `PATCH`, and `DELETE`; the default is
`POST`. Plain objects/arrays are JSON encoded, while native request bodies such
as `FormData`, blobs, and `URLSearchParams` pass through.

Read `data` and `error` under the matching state boundary. No optional chaining
is needed inside those arms:

```tsx
import type { ActionResult } from '@memoized-dom/data';

function CreationState({ creation }: { creation: ActionResult<Todo> }) {
  return (
    <section>
      <p if={creation.state === 'pending'}>Creating…</p>
      <p if={creation.state === 'error'}>{creation.error.message}</p>
      <TodoRow if={creation.state === 'success'} todo={creation.data} />
    </section>
  );
}
```

Every call returns a different `id` and state record, so concurrent calls cannot
overwrite one another. There is no `await`, `.settled`, `pending` boolean,
`status`, `abort`, `reset`, `refresh`, or action-call options object.

Optimistic UI is ordinary program logic, not a data-package mutation API:
create a temporary item, insert it into the same data structure the UI reads,
and retain the returned action result with that temporary item's identity. On
`success`, replace/reconcile it from `creation.data`; on `error`, remove only
the temporary item owned by `creation.id`. The package does not invent
`append`, `replace`, `remove`, `mutate`, or rollback methods.

```ts
import {
  $action,
  $fetch,
  type ActionResult,
} from '@memoized-dom/data';

interface Todo {
  id: string;
  title: string;
}

interface CreateTodo {
  title: string;
  temporaryId: string;
}

const todos = $fetch<Todo[]>('/api/todos');
const creations = new Map<string, ActionResult<Todo>>();

const createTodo = $action<Todo, CreateTodo>('/api/todos', {
  onSuccess(created, input) {
    const index = todos.findIndex((todo) => todo.id === input.temporaryId);
    if (index !== -1) todos[index] = created;
  },
  onError(_error, input) {
    const index = todos.findIndex((todo) => todo.id === input.temporaryId);
    if (index !== -1) todos.splice(index, 1);
  },
});

function addTodo(title: string) {
  const temporary: Todo = {
    id: `temporary-${crypto.randomUUID()}`,
    title,
  };

  todos.unshift(temporary);

  const creation = createTodo({
    title,
    temporaryId: temporary.id,
  });
  creations.set(creation.id, creation);
}
```

The temporary ID connects the ordinary array entry to its request. The action
result remains available in `creations` for pending/error UI, while the action
callbacks perform only the success/error reconciliation owned by that request.

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
import {
  $fetch,
  Group,
  Pending,
  Error as ErrorArm,
} from '@memoized-dom/data';
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

function PostsPending() {
  return <p>Loading…</p>;
}

function PostsError({ error, retry }) {
  return (
    <div>
      <strong>{error.message}</strong>
      <button onClick={retry}>Retry</button>
    </div>
  );
}

function Home() {
  let heading: HTMLHeadingElement | undefined;
  const posts = $fetch<Post[]>('/api/posts', { cache: { scope: 'app' } });
  const visiblePosts = posts.slice(0, session.compact ? 3 : 10);

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

      <Group>
        <Pending component={PostsPending} />
        <ErrorArm component={PostsError} />
        <ul>
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
      </Group>
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

### Destructuring colorless sources at declaration time

Do not do this:

```tsx
const { length, user } = getStories(); // 💥 [MMD-S004]
const [firstItem] = $fetch('/api/items'); // 💥 [MMD-S004]
```

Native destructuring evaluates properties immediately upon declaration, before the source settles. Keep the source binding and read properties lazily (`stories.length`, `stories.map(...)`), or destructure inside a map callback over settled items.

### Invoking mutations as top-level synchronous statements

Do not execute mutating server functions (`post*`, `put*`, etc.) as bare top-level statements during component initialization:

```tsx
export function StoryList() {
  postVote(1); // 💥 [MMD-S010]: would execute HTTP POST immediately during initial render/SSR
  return <div>...</div>;
}
```

Instead, call mutations inside event handlers or action helpers declared in the component, exactly as in `examples/fullstack/App.tsx`:

```tsx
export function StoryList() {
  let lastVote = null as ReturnType<typeof postVote> | null;

  function handleVote(id: number) {
    lastVote = postVote(id); // ✅ Correct: invoked in response to user action
  }

  return <button onClick={() => handleVote(1)}>Vote</button>;
}
```

### Adding store or promise methods to `$track`

Do not call `$track(stories).mutate()` or `$track(stories).then(...)`. `$track` is an observation lens, not a state manager or Promise. Mutate transparent data directly (`story.votes++`) and handle execution outcomes via `onSuccess` and `onError`.

### Expecting one server function to invalidate another automatically

Server functions are independent HTTP resources. From these two calls alone,
Memoized DOM cannot know that deleting one project changes the collection
returned by the other:

```ts
const projects = getProjects();
const projectsRequest = $track(projects);

function removeProject(id: string) {
  const index = projects.findIndex(project => project.id === id);
  if (index === -1) return;

  const removed = projects[index]!;
  projects.splice(index, 1); // immediate local/optimistic UI

  const deletion = $track(deleteProject(id));
  deletion.onError(() => {
    projects.splice(Math.min(index, projects.length), 0, removed);
  });
  deletion.onSuccess(() => {
    // Optional authoritative convergence with the exact affected query.
    void projectsRequest.refresh();
  });
}
```

Directly changing the transparent collection is the immediate UI path.
Refreshing its tracker is the authoritative server-convergence path. Keep the
collection in a shared mounted owner when several routes must observe the same
optimistic change. Memoized DOM does not guess endpoint relationships or
globally refetch every GET after a POST, PATCH, PUT, or DELETE.

### Attempting whole-object snapshot rollbacks during concurrent mutations

Do not restore entire previous objects on mutation failure. If multiple actions are in-flight concurrently, an old whole-object snapshot will overwrite fresher optimistic writes. Journal the smallest reversible domain delta (e.g. `delta: 1`) keyed by `request.id`.

### Forgetting HTTP verb prefixes on server functions

Every function in `server/functions/*.ts` must begin with an approved verb: `get*`, `post*`, `put*`, `patch*`, or `delete*`. Non-prefixed functions raise `[MMD-S011]`.

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

### Treating transparent fetch values as resource wrappers

Do not write `users.data`, `users.pending`, or `users.refresh()`. A
`$fetch<User[]>()` value is the `User[]` payload; read request state through
`$track(users)` and handle unavailable UI through `Group`.

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
- `$fetch` values are consumed as plain payloads, unresolved reads are covered
  by `Group`, request state uses `$track`, and no resource methods are invented.
- `$action` invocations are stored as independent action results and are never
  awaited or given `.settled`/refresh/optimistic call options.
- Router paths start with `/`, route targets are declared, param keys are exact,
  and no router internals are imported.

If these rules are followed, the compiler can preserve Memoized DOM's intended
model: plain authored TypeScript, graph-wide state placement, statically routed
reactivity, and direct memoized real-DOM updates.
