# Start

The smallest working Memoized DOM app. Five files, no boilerplate.

## Install

```bash
npm install @memoized-dom/runtime
npm install -D @memoized-dom/compiler @memoized-dom/vite vite typescript
```

Optional packages, add when you need them:

```bash
npm install @memoized-dom/data     # $fetch / $track / server-function sources
npm install @memoized-dom/router   # routing + $routed
npm install @memoized-dom/server   # serve() + SSR
```

## Layout

```
index.html
package.json
tsconfig.json
vite.config.ts
src/
  main.ts
  App.tsx
```

## The files

`package.json`

```json
{
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  }
}
```

`tsconfig.json`

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

Two things matter here: `"jsx": "preserve"` (the Memoized DOM compiler owns
JSX — no React JSX transform) and the `@memoized-dom/compiler/jsx` types,
which give you JSX typing plus the ambient `effect`/`cleanup` intrinsics.

`vite.config.ts`

```ts
import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';

export default defineConfig({
  plugins: [
    memoizedDom({ clientEntry: 'src/main.ts' }),
  ],
});
```

One plugin compiles the whole connected module graph — every file reachable
by static import from `clientEntry`.

`index.html`

```html
<!doctype html>
<html lang="en">
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/main.ts`

```ts
import { mount } from '@memoized-dom/runtime';
import { App } from './App';

mount('root', App);
```

`src/App.tsx`

```tsx
export function App() {
  let count = 0;
  const doubled = count * 2;

  return (
    <button onClick={() => count++}>
      {count} / {doubled}
    </button>
  );
}
```

`npm run dev` — that's a working reactive app.

## `mount` — the one entry call

`mount('root', App)` resolves the target (a string is an element id — an
`Element` works too), creates the app inside it, and returns a handle with
`unmount()`. If the element already contains server-rendered markup it
hydrates instead of rebuilding — covered in [09 — SSR](./09-ssr.md).

## Rules that bite on day one

- **No React, no hooks, no signals.** Plain TypeScript + JSX. Components are
  uppercase functions returning JSX.
- **Everything must be reachable by static import** from `clientEntry` — the
  compiler only sees the connected graph. A file nobody imports isn't
  compiled into the app.
- **`jsx: preserve`** — if your editor complains about `react/jsx-runtime`,
  your tsconfig is wrong, not your code.
- Components run **once** as initialization — don't expect the body to rerun
  on state change. Derived `const` expressions and rendered reads update
  selectively.

Next: [02 — State](./02-state.md)
