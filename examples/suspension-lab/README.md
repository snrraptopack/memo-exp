# Suspension Lab

A routed mixed-frontend application for comparing Memoized DOM's two initial
data reveal strategies.

`SuspensionLabApp.tsx` owns only the persistent shell. The linked
`routes/LabRoutes.tsx` component owns the route root and every page route,
demonstrating that route declarations do not need to be exposed in the entry
component.

- `/colorless-tsx` mounts a TSX dashboard shell immediately and reveals only
  the sites unlocked by each response.
- `/suspended-tsx` uses a direct component `suspend` directive inside `Group`.
- `/suspended-tsrx` expresses the same atomic boundary with
  `@try` / `@pending` / `@catch`.
- `/colorless-tsrx` demonstrates site-local TSRX pending/error output and
  targeted retry after an intentional first-attempt profile failure.

The in-app Fetch-compatible transport returns ordinary `Response` objects after
deterministic delays of 0.9 s, 2.1 s, and 3.4 s.

```bash
MMD_EXAMPLE=suspension-lab/main.ts bun run example:dev
```

Then open `/suspension-lab/`.
