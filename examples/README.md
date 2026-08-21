# Memoized News

This is the real Vite application used to exercise memoized-dom outside
compiler test fixtures.

```bash
bun run example:dev
bun run example:build
bun run example:preview
```

`vite.config.ts` compiles `entry.ts` and its connected module graph directly.
The active application is a Hacker News client backed by the live Algolia
Hacker News API.

It demonstrates:

- compiler-owned `route` and `route-to` JSX directives;
- nested route regions, parameterized story routes, and a `/*` catch-all;
- real `@memoized-dom/data` loading, retry, error, and cleanup behavior;
- keyed story pages that are appended as scrolling approaches the document end;
- retained page results and per-page skeleton states;
- responsive, deliberately familiar Hacker News presentation.

The Kanban, class-todo, CMS, incident, cart, dashboard, music, todo, and wizard
applications remain available as additional authored graphs under their
respective folders.
