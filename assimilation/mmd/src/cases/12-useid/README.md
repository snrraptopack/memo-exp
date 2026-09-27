# 12-useid (MMD lowering candidate)

Candidate lowering for `useId` — diagnosed by the compiler today.

## Lowering being tested

| React | MMD candidate |
|---|---|
| `const id = useId()` | `let id = ''; id = allocFieldId();` — module counter behind a `let` snapshot |

Getting here took three compiler rejections — see `error-log.md` #002:

- `const id = \`field-${nextFieldId++}\`` → rejected: update inside a
  per-instance derivation.
- `nextFieldId++; let id = …` → rejected: `let` whose init reads reactive
  state must be `const` (and `const` would *replay*, collapsing all ids to
  the newest — semantically broken, correctly refused).
- `const id = allocFieldId()` → rejected: the compiler scans into helpers
  and sees the write anyway.

The only writable shape is `let` + a real statement-level reassignment —
the write happens *at* the statement, not inside a derivation.

## Known gap vs a real lowering

- React `useId` ids are **deterministic per tree position** (SSR-stable:
  `:r0:` is the same on every load for the same tree). A mount-order
  counter is *not* — it depends on which instances mounted first.
- The RFC's intended target is an entity-derived id (from the component
  instance id MMD already allocates). This twin stands in until that's
  exposed to authored code — the error trail proves a primitive is needed.

## Same checklist as the React version

1. `for`/`id` pairs match per field; the two fields differ.
2. Label click focuses its own input.
3. Within a mount, the id never changes.

## Notes / divergences

_verified in browser — matches the React twin._
