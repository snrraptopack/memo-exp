# SSR and router branch integration — 2026-10-07

Integration complete. The verification counts below are historical; the later
consolidated checkpoint and current package audit are recorded in
[Rearchitecture plan](./rearchitecture-plan.md). This is not a separate pending
merge or execution plan.

## Reviewed inputs

| Branch | Requested commit | Integration |
|---|---|---|
| `feat/router-improvements` | `47abe94` | Already an ancestor of main; no duplicate patch. |
| `fix/ssr-hardening` | `b9b9824` | Merged as `b557064`; redirect fixture updated to declare its actual root. |
| `feat/ssr-region-streaming` | `6d34639` | Includes `b6735c8` streaming and region recovery; adapted to current restoration boundaries. |

## Review changes

The hardening merge preserves router matching and scroll changes alongside
credential forwarding, raw-text serialization, selected options and confined
route redirects. Explicit fetch headers win; forwarding occurs only for
same-origin in-memory routes.

Streaming uses the existing request render session, fetch store, source
restoration, region factories and adoption controller. Its old monolithic fetch
changes were ported into the optional restoration capability. No additional
cache, renderer, public compatibility alias or method inference was added.

Late delivery now handles separate uncached consumers. Refresh, local writes
and abort release stream claims, so an older server outcome cannot overwrite
client-owned state. Cancellation also clears pending flags for a waiting entry
without a network handle. Undelivered sources fetch after parsing; hydration
can still defer those starts until adoption finishes.

The payload explicitly identifies a streaming document. Once mounted, its
root owns the DOM even if initial source records are unavailable. Delivery
enters that root's application runtime. Unmount releases global ownership and
the parsing listener. Chunks arriving before mount patch HTML and transfer
records; chunks arriving after mount hand off data instead.

The region producer waits for output consumption, bounding queued replacements
under a slow reader. Cancellation discards queued output and awaits session
disposal; deadlines interrupt a producer waiting for consumption. Buffered
delivery and roots with compiler-proven initial HTML keep their existing
settled delivery contract.

Region recovery pops failed cursor plans before validation, retires failed
render generations and abandons nested marker claims. Unaffected ranges keep
their server nodes. Mismatches outside regions retain root recovery.

## Verification

All 143 server checks passed before the final backpressure adjustment; the
35 focused session, delivery, serve and initial-request checks passed after it,
including a new blocked-reader deadline regression. All 88 data checks pass,
including refresh, local-write, abort and uncached-consumer regressions. All
26 selected hydration checks pass, covering before/after-mount delivery,
nested recovery, keyed lists, route fragments, parser completion and unmount.

A production Vite build passes in Chrome: the HTML parser executes template
replacement scripts, the browser adopts the resulting nodes, no browser
refetch occurs and interaction works. This check uses authored fixtures and
compiler output. No example files or dependency versions were changed.

These are correctness and integration results, not timing or bundle-size
comparisons. Region tracking currently reserializes candidate ranges after
each settlement; profiling and narrowing that work remain separate follow-up
work. Inline replacement requires JavaScript and a matching nonce under CSP.
