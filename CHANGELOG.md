# Changelog

## Unreleased

### Added

- SSR: `mode: 'stream'` streams pending regions out of order. The shell is
  sent as soon as route preparation and mount finish; each region whose data
  settles follows as a `<template>` with its data, in completion order, and
  an inline script patches it into place before the browser program runs.
  Hydration then adopts the resolved regions without refetching. Regions
  that arrive after `mount()` are delivered to the mounted root as data;
  sources still pending at the settle budget are fetched by the browser once
  the document ends. `RenderOptions.nonce` and `RenderPolicy.nonce` supply a
  CSP nonce for the inline scripts.
- Data: serialized pending sources may be marked `streamed`; the browser
  waits for the streaming response to deliver them instead of fetching.
- Hydration: a mismatch inside a data region (conditional or atomic
  `Group` range) now discards and client-renders only that region; the rest
  of the root keeps its server DOM. `onHydrateError(error, scope)` receives
  `'region'` for these and `'root'` before a whole-root fallback.

### Fixed

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
