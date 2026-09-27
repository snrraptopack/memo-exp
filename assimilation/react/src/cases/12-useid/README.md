# 12-useid

`useId()` links a label to its input via `htmlFor`/`id`. Two `Field`
instances must get *different* ids, and each id must be stable across
renders.

## What to verify

1. Inspect: each `label[for]` equals its sibling `input[id]`.
2. The two ids differ (React's are like `:r0:`/`:r1:`).
3. Clicking the "Email" label focuses the Email input — the association is
   functional, not just present.
4. Remount (navigate away/back) — ids can differ between mounts; what
   matters is within-instance stability and uniqueness.

## Expected React semantics being captured

- RFC intent: `useId` lowers to a **stable MMD entity-derived ID** — an id
  derived from the component instance path rather than a global counter.
- Compiler status: **diagnosed today**. The MMD twin uses a module counter
  as the candidate shape — it satisfies uniqueness + within-mount
  stability, but mount-order dependence is the gap an entity-derived id
  would close.
