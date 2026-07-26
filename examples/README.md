# Todo Application

This is the real Vite application used to exercise memoized-dom outside
compiler test fixtures.

```bash
bun run example:dev
bun run example:build
bun run example:preview
```

`vite.config.ts` identifies `todo.tsx` as the authored reactive graph entry.
The browser entry imports that source module directly. There is no generated
source directory or separate compiler build script.

The application covers linked module state, module-level derivations, keyed
component lists, `Set` and `Map` receiver invalidation, async imported helpers,
conditional values, dynamic DOM props, and normal Vite production bundling.
