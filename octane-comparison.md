# Octane Comparison — Hydration Architecture & List Rendering

Status: research note (input to Phase 2 marker design and list-region roadmap)
Subject: [Octane](https://github.com/octanejs/octane) (alpha) — Dominic
Gannaway's successor to Inferno; React's programming model compiled to direct
DOM code
Sources read: repo README, `docs/deferred-hydration.md`,
`docs/comment-marker-elision-plan.md`, `docs/hydration-islands-plan.md`,
`docs/react-hosted-octane-compat-plan.md`,
`packages/octane/src/runtime.ts` (30k lines),
`packages/octane/src/universal-core.ts` (13k lines),
`packages/octane/src/hydration/*`,
`packages/octane/src/react/fiber-adapter.ts`

Why this matters: Octane independently validates the category we are in
(compiler-first, no vDOM, direct DOM, real delegated events). Its hydration
and list machinery are the two areas where it is furthest ahead of us today,
and both are directly relevant to our next phases.

---

## 1. Hydration architecture vs our Phase 2 marker design

### 1.1 Their model

**Structural comment ranges, proven-elided.** Compiled output carries comment
marker pairs around dynamic regions. The twist is `comment-marker-elision`:
where the compiler can *prove* structure (static tags, sole-host roots, exact
ranges), production **elides the markers entirely** — measured in their plan:
a js-framework-benchmark page went from 121→280 raw bytes of markers down to
elided output costing +1.13% gzip on the whole bundle, with one fallback
marker costing "1 gzip byte". Development builds keep dense markers plus
**source-location-addressed text holes**: every dynamic text hole is keyed by
its slot index as `App.tsrx:42:5`, which is what hydration-mismatch warnings
cite (wrong tag / swapped branch / list shape).

**Byte-stable hydration.** The README claims streaming SSR and byte-stable
hydration: client compilation and server serialization agree on structure so
tightly that adoption needs no diffing. Mismatch detection still exists but
is a dev-only warning channel, not a recovery mechanism.

**Markerless fast paths from compiler proof.** `reconcileKeyed` accepts an
`ssrMarkerless` flag: *"the matching server compiler proved a direct host root
and omitted the item's hydration pair."* When the server compiler knows a row
renders exactly one host element, the per-row hydration markers are omitted
altogether — the row *is* its own boundary.

**Post-hydration compaction.** After adoption, adjacent marker pairs are
coalesced (`HydrationRangeGroup { start, end, depth, owners }`) so N logical
ranges collapse into one physical pair — marker overhead is paid down over
time, not just at emission.

### 1.2 Their deferred hydration (islands)

`<Hydrate when={...} split prefetch fallback onHydrated>` keeps server HTML
visible-but-inert while delaying interactivity. Eight strategy triggers
(`load | idle | visible | media | interaction | condition | never | dynamic`),
each an SSR-safe strategy object with a tiny runtime contract
(`_t/_d/_s/_o/_a`): creating a strategy never reads browser globals; setup
runs only on the client. Gates resolve; prefetch strategies can warm split
chunks before the trigger fires. Adoption semantics: the boundary's
*persistent host element* is adopted, child DOM stays dormant untouched, and
on trigger the chunk loads, the preserved DOM hydrates in place, then refs /
effects / events enable.

### 1.3 Why their model cannot be adopted wholesale — our aims differ

Re-grounded against `ssr-proposal.md`, several of their choices rest on
foundations we deliberately do not share:

| Their foundation | Ours (per proposal) | Consequence |
| --- | --- | --- |
| One build owns the page; server/client share one compiled program | Library-grade layer embedded in **arbitrary hosts** (Vite adapter, scoped JSON channel, "runtime never reads ambient globals") | Their no-manifest stance works because versions move in lockstep. Our **manifest/state envelopes exist precisely for the world where they don't** (proposal lines 735, 801: deployment skew, hostile payloads). Adopting their no-manifest design would delete a requirement we hold |
| **Byte-stable hydration** as the correctness mechanism — mismatch = dev warning | "Hydration mismatches are inevitable" — bounded **remount ladder** (dev report → smallest-owner remount → root fallback) | We normalize serializer output in the parity corpus precisely because byte-equality across tiers/versions is not achievable for us. Byte-stability can be a *goal metric* on matching builds, never the correctness foundation |
| Whole-component Suspense strata gate data reveal | **Per-consumption-site** colorless data states flip pending→committed independently after adoption (data RFC §3) | Their transition journal/Suspense restore doesn't map — our branch skew is finer-grained than any boundary. Marker grammar must cover site-level flips, which their strata never needed |
| Islands/deferred hydration shipped | **Explicit non-goal** for the first implementation (proposal line 153) | Strategy-object pattern is worth copying *later*, but adopting the `<Hydrate>` surface now would contradict scope |
| App-framework posture (owns routing, streaming, chunks) | Concurrent-request, request-isolated SSR as a **library** (`@memoized-dom/server`) | Their server tier has no equivalent of our per-request runtimes/cells problem |

One subtlety worth recording: **marker elision survives version skew** even
though byte-stability does not. Elision decisions are derived from whichever
graph the client compiled; under skew the client walks its own proven shape,
finds the server DOM disagrees, and the existing ladder handles it. Elided
markers cost location speed under skew, never correctness — provided the
cursor validates tag/kind at every step, which the proposal already requires.
Compaction is likewise safe: coalesced pairs are removed *after successful*
adoption only.

### 1.4 Point-by-point deltas (both systems aiming at hydration)

| Dimension | Our proposal (ssr-proposal §Phase 2) | Octane |
| --- | --- | --- |
| Marker policy | Hybrid sparse boundaries; dense only in dev | Same idea, shipped: dense dev, **proven-elided in prod** |
| Identity addressing | Compiler-canonical hierarchical ids + local cursors | Structural comment ranges + source-location-addressed text holes |
| Manifest | Versioned manifest/state envelopes, buildId gate | No separate manifest observed; structure agreement enforced by shared compile |
| Mismatch handling | Bounded remount ladder | Dev-only warnings; byte-stable goal means mismatches shouldn't occur |
| Marker lifetime | "Removable or ignorable after hydration" (requirement, unimplemented) | **Post-hydration range compaction implemented** |
| Per-item row markers | Required unless proven otherwise | `ssrMarkerless`: omitted exactly when the server compiler proves one host root |
| Islands/deferred | Non-goal for v1 (proposal line 153); Phase 6+ | Shipped strategy system with prefetch + splitting — pattern worth copying when scope opens |

**Verdict:** our Phase 2 sketch and their shipped system agree on every
architectural principle (sparse hybrid markers, cursor-based adoption,
dev-dense/prod-sparse). Subject to the §1.3 constraints, these deltas are
actionable:

1. **Adopt marker elision as a Phase 2 deliverable, not a hope.** Our
   compiler's provenance analysis is strictly stronger than what elision
   needs — if the linker can prove a site's content shape, the marker is
   dead weight. This should become a measured exit criterion (bytes per
   route, like their audit).
2. **Source-location-addressed diagnostics** (`file:line:col` per text hole)
   is cheap for us — the compiler already has locations — and would make our
   mismatch ladder's "development: report expected/actual" tier concrete.
3. **Plan the compaction pass now.** Designing markers that are *safe to
   coalesce/remove post-adoption* (their `depth` scheme) is a constraint on
   marker grammar; it must be decided before freezing, or we can never clean
   up.
4. **`ssrMarkerless`-style proofs** slot naturally into our emission spec:
   any region whose compiled shape is exactly one host element needs no
   markers. Record as a Phase 2 elision case.
5. **The strategy-object contract for islands** (SSR-safe creation, client-
   only setup, discriminant field) is a clean pattern to copy wholesale when
   we design Phase 6 — it composes with CSP and avoids globals.
6. Their **no-manifest** stance works because server and client share one
   compiled program representation — **we keep the manifest**: skew safety,
   envelope separation, and hostile-payload hardening are proposal
   requirements (§Phase 5, invariants 11–12), not optional extras.

---

## 2. List rendering: how Octane's reconciler works

From `runtime.ts` (`reconcileKeyed`, `lis`, `mountItemsLinear`,
`batchClearItems`):

### 2.1 Their pipeline for `{items.map(...)}` (forBlock)

1. **Linear first fill.** Fresh mount skips reconciliation entirely — one
   linear append pass (`mountItemsLinear`), dispatched directly by callers.
2. **Empty/clear fast paths.** New length 0 → `batchClearItems` removes the
   whole owned range in one operation.
3. **Prefix walk.** Advance a head cursor while `old[i].key === new[i]`;
   update survivors in place. Handles append/consume patterns with **zero
   hashing**.
4. **Suffix walk.** Retreat a tail cursor while keys match from the end —
   covers prepend/pop patterns symmetrically.
5. **Middle resolution.** Only the unmatched middle goes through key-map +
   **LIS over an `Int32Array` with pooled scratch** and predecessor
   reconstruction.
6. **Doubly-linked item blocks.** Each row is a `Block` with
   `prev/nextSibling` pointers; head/tail live on the ForSlot. Moves and
   removals are **O(1) pointer operations**, not array splices.
7. **Transition journal.** Before mutating, the list's shape is journaled so
   a Suspense boundary suspending later in the render can restore the list
   whole.
8. **Compile-time flags.** `singleRoot` (compiler proved one root element per
   row), `pure`, `lite`, `indexIndependent`, `ssrMarkerless` — each unlocks
   skipping work the compiler has proven unnecessary.
9. **Universal tier.** `universal-core.ts` goes further: compiled programs are
   *shared immutable intrinsic plans*, materialized into logical records and
   committed as **one ordered host batch** — DOM topology lands in a single
   staged pass.

### 2.2 Their measured numbers (effectful-list, 30 iterations, mitata)

| op | octane-tsrx | react | solid | vue-vapor | preact |
| --- | --- | --- | --- | --- | --- |
| mount_1k (ms) | **8.7** | 10.2 | 10.1 | 10.6 | 12.3 |
| update_nodeps (ms) | 0.132 | 0.003 | 0.001 | 0.003 | 7.386 |
| update_deps (ms) | **2.22** | 2.86 | 2.88 | 2.88 | 7.65 |
| clear (ms) | **1.08** | 1.56 | 1.59 | 1.85 | 1.14 |
| remove_100_scattered (ms) | **0.41** | 0.79 | 0.93 | 1.06 | 2.12 |

(Their harness, their hardware, their fixtures — treat as directional.)

### 2.3 Our current implementation vs theirs

Our `list.ts` already shares real DNA: pooled LIS buffers, a shape fast path
(identical references ⇒ skip everything), contiguous-range removal, guarded
row syncs, canonical-keyed commit routing, and zero re-execution (our
`update_nodeps` equivalent approaches Solid's 0.001ms class because nothing
re-runs). What they have that we don't:

| Technique | Them | Us | Expected win if adopted |
| --- | --- | --- | --- |
| Prefix/suffix walks before key-mapping | yes | no — every reconcile hashes every key into a Map | Large for push/pop/shift/unshift/append-heavy workloads; those skip hashing AND LIS entirely |
| Doubly-linked row blocks | yes — O(1) pointer moves | entries in arrays; moves compute anchors from positions | Moderate-to-large on scattered reorders/removes (their 0.41ms vs react's 0.79 suggests ~2x on that op) |
| First-fill dispatch bypassing reconcile | yes | our create path does build maps on first fill? (empty old map short-circuits LIS but still builds `next`) | Small-moderate on cold mounts |
| Transition journal | yes (Suspense restore) | n/a for us yet | Relevant only when we grow async boundaries |
| `Int32Array` LIS w/ predecessor reconstruction | yes | boolean[] + tails + prev arrays (pooled) | Wash — comparable cost |
| Batch clear | yes | yes (contiguous range removal) | parity |

### 2.4 Recommended upgrades for our `list.ts` (ranked)

1. **Prefix/suffix walks ahead of the Map pass.** Pure win, no semantic
   change: identical-key prefixes/suffixes update survivors in place and
   shrink the middle that needs hashing + LIS. Common UI mutations
   (append/prepend/pop/toggle-at-end) become near-allocation-free.
2. **Doubly-linked row blocks.** Give each row record `prev/next` pointers
   and keep head/tail on the region; moves/removes become pointer surgery.
   Pairs naturally with (1) since the walks traverse the same links.
3. **First-fill fast path.** When the old map is empty, append linearly and
   return — skip seq/LIS scaffolding entirely (we partially do this; make it
   dispatch-direct like theirs).
4. Later, SSR-coupled: **markerless rows** under proven single-root shapes
   (Phase 2 elision case, see §1.3 point 4).

Before/after must be measured with a js-framework-benchmark-shaped suite
added to `bench/` mirroring their op set (mount_1k, update_nodeps,
update_deps, swap_half, reverse, clear, remove_scattered) so the comparison
stops being directional.

### 2.5 Where we should NOT chase them

- Their `update_deps` cost (2.2ms) is the price of component re-execution;
  our model doesn't pay it at all. Chasing their mount numbers by adopting
  re-render-shaped machinery would be trading away our core advantage.
- Their universal intrinsic-program tier is a large architectural investment
  tuned to their compiled-plan model; our emission already bakes structure at
  compile time, which serves the same purpose differently.

## 3. Bonus finding: their React-library strategy is porting, not shimming

Two plans confirm the ecosystem answer I proposed earlier:

- `react-library-compat-plan.md` — they **port React libraries to native
  Octane packages** (`packages/radix` is a full Radix UI port; `packages/popper`
  adapts react-popper) and run the **upstream test suites** against the ports
  as parity evidence, with audited upstream-inventory ledgers per package.
- `react-hosted-octane-compat-plan.md` — the inverse direction: `OctaneCompat`
  hosts compiled Octane islands inside React 19 trees, reading React context
  through a bootstrap-only Fiber adapter (stale-alternate resolution, provider
  walk, degrade-to-handshake on any failure) — with explicit non-goals against
  ever subscribing to Fiber internals.

For memoized-dom, the porting playbook (upstream suites as parity proof) is
the credible path to "supports React libraries" claims; the hosted-islands
playbook is the credible path to "usable inside React apps" adoption.

## 4. Action items extracted (revised for aim alignment)

1. Phase 2: add marker-elision-by-proof + post-adoption compaction to the
   marker grammar constraints before freeze — **both remain valid under skew**
   (elision degrades to cursor walking; compaction runs only after successful
   adoption). Source-location-addressed mismatch diagnostics for the dev tier.
2. Keep the manifest/state envelopes and the remount ladder exactly as
   proposed — they are what makes skew survivable, which Octane never had to
   solve. Byte-stability may be tracked as a metric on matching builds, never
   adopted as the correctness foundation.
3. Phase 6: reuse the strategy-object contract pattern for island triggers if
   islands ever leave the non-goal list.
4. Runtime: prefix/suffix walks + DLL blocks + first-fill dispatch in
   `list.ts`; add a benchmark suite shaped like their effectful-list ops.
5. Ecosystem (future): adopt their upstream-parity porting playbook if we
   pursue React-library compatibility claims.
