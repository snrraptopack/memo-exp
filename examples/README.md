# Memoized News

This is the real Vite application used to exercise memoized-dom outside
compiler test fixtures.

```bash
bun run example:dev
bun run example:build
bun run example:preview
```

Restart the Vite dev process after changing compiler or Vite-plugin source.
Vite keeps build plugins in memory, so HMR can update authored TSX while an
already-running process still uses the previous compiler implementation.

`vite.config.ts` compiles the selected example's connected module graph.
Every example directory carries its own `index.html` + `main.ts` and serves
at its own URL (e.g. `/hacker-news/`); the root `/` is a link list. Pick the
graph for tooling with `MMD_EXAMPLE=<file>` (default `workspace/main.ts`).
The Hacker News client is backed by the live Algolia Hacker News API.

It demonstrates:

- compiler-owned `route` and `route-to` JSX directives;
- compiler-owned `if`, `else-if`, and `else` branches for loading, error, and
  success states without JSX ternaries;
- nested route regions, parameterized story routes, and a `/*` catch-all;
- real `@memoized-dom/data` loading, retry, error, and cleanup behavior;
- keyed story pages that are appended as scrolling approaches the document end;
- retained page results and per-page skeleton states;
- responsive, deliberately familiar Hacker News presentation.

The experimental `tsrx-todo` application exercises direct TSRX AST lowering
through the normal shared Vite adapter. Run it with `bun run example:tsrx` and
visit `/tsrx-todo/`.

The Kanban, class-todo, CMS, incident, cart, dashboard, music, todo, and wizard
applications remain available as additional authored graphs under their
respective folders.
