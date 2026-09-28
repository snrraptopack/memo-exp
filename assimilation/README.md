# React → MMD Assimilation Lab

Two apps render the same case set — one in **real React**, one in
**hand-written MMD**. Comparing them side by side is how we pin down the exact
lowering path before touching the compiler.

```
assimilation/
  react/        real Vite + React 19 + react-router-dom   → :5173
  mmd/          hand-lowered MMD via @memoized-dom/vite   → :5174
  error-log.md  every genuine error hit on the MMD side (compile or
                runtime) gets a numbered entry: producing code, exact
                error, resolution. Non-negotiable — log it there.
```

## Run

```bash
bun run assimilation:react   # http://localhost:5173  (real React)
bun run assimilation:mmd     # http://localhost:5174  (compiled MMD)
```

Both apps serve the same **real URL paths** (History API — no hash routing):
`/01-usestate-counter` on either port renders the same case. Each page header
cross-links its twin.

## Case format

Every case is a numbered folder pair under each app's `src/cases/`:

```
react/src/cases/03-memo-forwardref/
  Case.tsx     idiomatic React version
  README.md    scenario + behavior checklist to verify
mmd/src/cases/03-memo-forwardref/
  Case.tsx     hand-written MMD equivalent (what the compiler should emit)
  README.md    the exact lowering table + same checklist + divergence notes
```

Conventions:

- **Numbered, zero-padded folders** (`01-`, `02-`, …) encode the intended
  reading/implementation order.
- **Folder name = URL path.** `cases/03-memo-forwardref` is served at
  `/03-memo-forwardref` in both apps.
- Routing is the real router in each ecosystem — react-router-dom
  `<Route path="…">` on the React side, compiler-owned `route="…"` /
  `route-to="…"` attributes on the MMD side. Adding a case = one `<Route>` in
  `react/src/App.tsx`, one `route` sibling in `mmd/src/App.tsx`, one link in
  each `CaseIndex`.
- No single-page mega-app, no dynamic component dispatch — MMD has no runtime
  component type (see `error-log.md` #001).
- **Lowered vs idiomatic.** The MMD `Case.tsx` starts from the exact shape the
  compiler emits (that's the thing being verified). When the *idiomatic* MMD
  version differs meaningfully — e.g. `useReducer` handlers can write the
  cell directly, `useSyncExternalStore` can read a module `let` instead of
  subscribing — the routed page renders both labeled sections
  ("lowered" / "idiomatic") and the README spells out both forms. Where the
  lowering already *is* idiomatic (useMemo/useCallback/effect), the README
  says so instead.

## Compiler lowering path (confirmed)

React source lowers to MMD **syntax** before shared analysis — there is no
second compile mode. In `packages/compiler/src/analysis/prepare.ts`:

```
unwrapReactComponentWrappers   memo()/forwardRef() → plain function inits,
                               ref param folds into `ref` prop
normalizeComponentDeclarations const arrows → canonical `function` decls
assimilateReactSource          useState → let+setter, useEffect → effect(),
                               useRef → {current} box, useMemo → const, …
runAnalysis / emission         identical for authored and assimilated code
```

`discoverManifest` (linking/discovery.ts) runs the same unwrap+normalize pair
so package export manifests see wrapped components as real components.
The hand-written cases here mirror exactly what these passes emit.

## Status legend

- `pending` — not started
- `paired` — both versions exist, awaiting browser verification
- `verified` — MMD matches React in the browser
- `provisional` — the MMD side is a known-wrong stand-in awaiting a real primitive
- `candidate` — an MMD primitive exists; a case pair is planned, not built
- `divergent` — a difference was found (note it in the case README)
- `unsupported` — deliberately out of scope (per react-assimilation-rfc.md)

## Matrix

| React API | Case path | MMD lowering | Status |
|---|---|---|---|
| `useState` | `/01-usestate-counter` | `let` binding + `const` derivations | verified |
| `useEffect` | `/02-useeffect-title` | `effect()` intrinsic | verified |
| `useRef` | `/03-memo-forwardref` | `{ current }` box / `let` ref sink | verified |
| `memo` + `forwardRef` | `/03-memo-forwardref` | erased / `ref` prop pass-through | verified |
| `memo` alone | `/04-memo-only` | erased — bodies run once anyway | verified |
| `useMemo` | `/05-usememo` | `const` derivation chain | verified |
| `useCallback` | `/06-usecallback` | plain function (stable by construction) | verified |
| `useReducer` | `/07-usereducer` | `let` + dispatch writing the cell | verified |
| `useSyncExternalStore` | `/08-usesyncexternalstore` | `let` + `effect` subscribe/`Object.is` guard | verified |
| `useLayoutEffect` | `/09-uselayouteffect` | `effect()` — **pre-paint confirmed**, sound lowering target | verified |
| `useImperativeHandle` | `/10-useimperativehandle` | ordinary `api` prop box + `effect` — `ref` attr is a DOM-root sink (error-log #003) | verified |
| `useContext` + `createContext` | `/11-usecontext` | no MMD primitive — prop-drilling twin; diagnosed today | verified |
| `useId` | `/12-useid` | `let` + statement write of module counter; needs entity-derived id (error-log #002) | verified |
| `useTransition` | `/13-usetransition` | sync write; `isPending` → constant `false` — diagnosed today | divergent |
| `useDeferredValue` | `/14-usedeferredvalue` | identity (`const x = q`) — diagnosed today | divergent |
| `Fragment` | `/15-fragment` | native `<>` support | verified |
| `useInsertionEffect` | `/19-useinsertioneffect` | `effect()` candidate — ordered phase, pre-paint | paired |
| `useDebugValue` | `/18-usedebugvalue` | erased | paired |
| attrs: `className`/`style`/`htmlFor`/`checked`/`onChange` | `/17-attrs` | shared host-attr pipeline; `onChange`→`onInput` on text inputs | paired |
| `useOptimistic` + `useActionState` + `useFormStatus` (19) | `/20-forms` | `optimistic({action, apply, reconcile})` + `$forms` — real primitives (post-merge) | verified |
| `createPortal` | `/21-createportal` | manual `effect` + imperative DOM; reactive JSX in foreign container unsupported | paired |
| `use(promise)` + `Suspense` (19) | `/22-suspense` | `$read(promise)` + `Group pending`/`suspend` — per-call and per-region reveal units; `suspend` is first-mount only | verified |
| `lazy` | `/22-suspense` | no component-level twin — route-scoped code splitting only (the route is the lazy chunk) | divergent |
| `Children.count` / `Children.map` | `/16-children` | call-site specialization → constant/list row; authored twin = opaque slot + array prop | paired |
| `Children.only` / `toArray` | — | no supported kind (error-log #004/#005 — no element introspection) | unsupported |
| `createRoot` → `mount` | entry files | `createRoot(el).render()` → MMD `mount` — the two apps themselves are the verification | verified |
| `StrictMode` double-invoke | — | unsupported | unsupported |
| `lazy` component-level | — | unsupported — no dynamic component value; `route` splitting covers page-level | unsupported |
| runtime route dispatch (`routes[loc]`) | — | no MMD lowering — use `route` attrs | unsupported |
