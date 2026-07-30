# Kanban Studio

This is the real Vite application used to exercise memoized-dom outside
compiler test fixtures.

```bash
bun run example:dev
bun run example:build
bun run example:preview
```

`vite.config.ts` identifies `kanban/KanbanApp.tsx` as the authored
reactive graph entry. The browser entry imports that source module directly.
There is no generated source directory or separate compiler build script.

The active application demonstrates:

- named conditional module effects with teardown;
- keyed component rows containing nested keyed task lists;
- helper-selected dynamic intrinsic tags;
- named JSX render props;
- linked module state and imported mutations.

The class-todo, CMS, incident, cart, dashboard, music, todo, and wizard
applications remain available as additional authored graphs under their
respective folders.
