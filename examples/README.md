# DOM Ref Laboratory

This is the real Vite application used to exercise memoized-dom outside
compiler test fixtures.

```bash
bun run example:dev
bun run example:build
bun run example:preview
```

`vite.config.ts` identifies `refs/RefsApp.tsx` as the authored
reactive graph entry. The browser entry imports that source module directly.
There is no generated source directory or separate compiler build script.

The active application demonstrates:

- mutable identifier and member refs;
- named, inline, and factory callback refs with returned teardown;
- multiple refs on one host;
- standard, named, and rest/spread component forwarding;
- ordinary ref properties inside spreads;
- conditional-branch and keyed-row cleanup ownership.

The Kanban, class-todo, CMS, incident, cart, dashboard, music, todo, and wizard
applications remain available as additional authored graphs under their
respective folders.
