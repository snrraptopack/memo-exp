# Changelog

## Unreleased

### Fixed

- Router: a pathname with repeated slashes (`/a//b`) no longer throws
  from the generated route manifest; pathnames collapse repeated
  slashes before matching.
- Router: static route segments with non-ASCII characters
  (`route="/café"`) now match the percent-encoded pathnames browsers
  and servers deliver. `matchRoutePattern` and the route table share
  one segment rule instead of a separate regex engine.
- Router: a wildcard route matched at its own base (`/docs/*` at
  `/docs`) reports `params['*'] === ''` from every matcher, including
  `route.params`.
- Router: `matchRoutePattern` results are frozen, so a caller can no
  longer corrupt the memoized match returned to later callers.
- Router: `navigate('/search?q=x')` and `buildRoutePath` throw a clear
  error instead of silently dropping an embedded query or hash; use
  the `query` and `hash` options.
- Router: scroll restoration keeps positions in memory while scrolling
  and writes `sessionStorage` only when an entry is left or the page
  is hidden (`pagehide`/`visibilitychange` instead of `beforeunload`).
  Stored positions are capped at 100 entries.
- SSR: in-memory `$fetch` dispatch now carries the page request's
  `cookie`, `authorization`, `accept-language`, and `user-agent`
  headers, as a browser's same-origin fetch would. Cookie-authenticated
  routes no longer fail during SSR while working in the browser. Headers
  set on the `$fetch` call still win.
- SSR: `<style>` and `<script>` text is written raw instead of
  HTML-escaped, which corrupted CSS selectors and inline JSON. A forged
  end tag inside the text is neutralized with the language's own escape.
- SSR: `<select value={x}>` marks the matching `<option>` as `selected`
  instead of emitting an ignored `value` attribute.
- SSR: route preparation redirects resolve like client navigation and
  must stay on the application origin; an external or protocol-relative
  target is a render error instead of an open redirect. Relative targets
  now resolve against the route path as they do in the browser.
- List-region suffixes can no longer collide with authored bindings
  (`let items1`, `let when0`) or with generated conditional/route
  region ids.
- Component rows under expression owners (conditional/route regions)
  now invalidate the owning list on item writes.
- SSR module-state cells (`moduleStateCells`): member writes and
  `delete` on state objects route through `updateCell`;
  `for (x of xs)` / `for (k in obj)` targets lower through a
  temporary binding plus `setCell`; bare `count++` / `--count`
  compile instead of crashing; all compound and logical assignment
  operators lower generically; labels and break targets are
  preserved.
- `if`/`switch` tests in components replay arbitrary calls — no
  method whitelist — and fold reads from program-scope helpers,
  linked imports, and component-local closures into the derivation,
  so `if (gate()) label = 'x'` re-derives when `gate`'s reads change.
- Dynamic JSX tag selectors evaluate once per pick instead of once
  per candidate.
- `switch` returns inside components handle trailing `break`,
  empty fallthrough cases, `case x: break` (null branch), and dead
  code after `break`.
- Row-derivation substitution is now scoping-correct: labels,
  non-computed property/method keys, binding patterns, catch params,
  `for-of`/`for-in` lefts, and function/class ids are no longer
  substituted, while parameter defaults are.
- `key` provided through a JSX spread attribute (`<Row {...props} />`
  where `props.key` is set) now drives keyed list reconciliation,
  falling back to item identity when the merged key is nullish.

### Diagnostics (new compile errors for previously miscompiled programs)

- Destructuring reactive module state at module level —
  `const { x } = store` snapshots the value and cannot stay live;
  written destructured bindings (`let [a] = src; a = next`) are also
  rejected. Function-boundary reads such as `const [cb] = [() => x]`
  remain allowed.
- Uppercase JSX-bearing consts that are not plain functions —
  `const C = memo(() => <div />)` now fails fast with a clear error
  instead of a misleading late error at the `<C />` site.
- Assignments to a row derivation inside row JSX, plus shadowing via
  catch params, binding patterns, `for-of`/`for-in` lefts, and
  function/class names, now fail with a clear error.
- `if`/`switch` tests that read reactive state but cannot be replayed
  (assignment/`delete`/`await`/`yield` inside the test, or a call
  whose summary writes state) are diagnosed instead of silently
  freezing as one-time setup.
- Destructuring or value-producing writes on SSR state cells are
  rejected with a clear diagnostic.

### Performance

- List rows keyed through spreads fall back to item identity, and
  `key`/`ref`-free spreads no longer pay for key extraction beyond a
  single merged read per row.
