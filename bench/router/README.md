# Router Hotpath Benchmarks

Standardized Vitest benchmark suite for `@memoized-dom/router`.

---

## What is Measured

1. **Query String (`query string`)**:
   - `createRouteQuery` single dictionary encoding
   - `createRouteQuery` rotating samples (preventing mono-morphic shortcuts)
   - `route.query` fast lookups (`.get()`, `.has()`, `.getAll()`)

2. **Path Operations (`path`)**:
   - `normalizeRoutePath` (clean fast-path vs. redundant separators)
   - `buildRoutePath` (parameter substitution into path templates)
   - `buildRoutePath` with full params + query + hash

3. **Pattern Matching (`match`)**:
   - Exact static match (`/settings/billing/invoices`)
   - 1-parameter dynamic route (`/users/:userId`)
   - Rotating parameter inputs (preventing engine monomorphic caching)
   - Deep 3-parameter route (`/organizations/:orgId/projects/:projectId/builds/:buildId`)
   - Wildcard catch-all (`/docs/*`)
   - Radix Segment Trie Route Table (`createRouteMatcher` across 500 routes)

4. **In-Memory Navigation (`navigation`)**:
   - `navigate ({ href })` URL string transitions
   - `navigate ({ to, params })` typed navigation
   - `navigate changing params loop` rapid parameter-changing transitions (cycling 50 IDs)

---

## How to Run

Run the suite using Vitest Bench:

```bash
bun run bench:router
```
