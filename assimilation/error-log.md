# Error log

Compiler errors hit while hand-lowering cases. Each entry keeps the producing
code, the exact error, and how it was resolved — these become diagnostics or
supported forms later.

## 001 — dynamic JSX tag fed by a route map lookup

**Code** (`assimilation/mmd/src/App.tsx`):

```tsx
const routes = {
  '01-usestate-counter': UseStateCounter,
  '02-useeffect-title': UseEffectTitle,
  // …
};

export function App() {
  let route = location.hash.replace(/^#\/?/, '');
  // hashchange listener writes `route` …

  const Case = (routes as Record<string, typeof CaseIndex>)[route] ?? CaseIndex;
  return (
    <main>
      <Chrome />
      <hr />
      <Case />
    </main>
  );
}
```

**Error** (vite dev server, plugin `memoized-dom`):

```
 dynamic JSX tag 'Case' has no finite string or linked-component candidates
  at assimilation/mmd/src/App.tsx:47:7
```

**Why it fails**: a dynamic tag needs a *finite, statically discoverable*
candidate set. `routes[route]` is a computed member lookup — the compiler
can't enumerate which components the selector may pick, and `??` /
`LogicalExpression` initializers aren't traversed for candidates.

**Resolution**: switched both apps to their ecosystem's official router —
MMD's compiler-owned `route` / `route-to` attributes (real URL paths), React's
`react-router-dom` `<Routes>/<Route>` — same path table on both sides. React's
runtime `routes[route]` component dispatch has no MMD lowering; there is no
dynamic component type to lower to.
