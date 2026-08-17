# Router Hotpath Benchmarks

Micro- and lifecycle benchmarks for `@memoized-dom/router`.

---

## What is Measured

1. **Path Pattern Matching (`matchRoutePattern`)**:
   - Exact static match (`/settings/billing/invoices`)
   - 1-parameter dynamic route (`/users/:userId`)
   - Rotating parameter inputs (preventing engine mono-morphic caching)
   - Deep 3-parameter route (`/organizations/:orgId/projects/:projectId/builds/:buildId`)
   - Wildcard catch-all (`/docs/*`)
   - Large Route Set (500 distinct route patterns)

2. **Path Building & Interpolation (`buildRoutePath`)**:
   - Parameter substitution into path templates
   - Query string encoding (`?tab=telemetry&page=2&tag=prod&tag=edge`)
   - Hash resolution

3. **Query Operations (`createRouteQuery`)**:
   - Fast read-only query string extraction (`get`, `has`, `getAll`)

4. **In-Memory Navigation (`createRouteRuntime`)**:
   - Full `navigate()` transition throughput
   - Rapid parameter-changing transitions (`/services/:id` cycling 50 IDs)

---

## How to Run

Run the suite using Bun:

```bash
bun run bench:router
```
