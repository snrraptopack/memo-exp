# Hydration Marker Protocol — Draft Specification

Status: draft v0.2 for debate (Phase 2 deliverable — proposal exit criterion
"A written, versioned hydration protocol exists"). §2/§3 grammar is now
implemented in the runtime anchor layer and the server serializer (Phase 2
proper, first increment). Implemented today: `mmd:r` root pair (server
serializer), `mmd:g` conditional/route pairs, `mmd:l` list pairs, `mmd:w`
row markers, uniform `/mmd` closes. Deviations from v0.1, adopted
deliberately:

1. **Row markers use the single-opening form** (`mmd:w:<listId>:<key>`, no
   close): row extent runs to the next sibling `mmd:w` marker or the list's
   `/mmd` close. The marker is prepended into the row's node list at
   creation, so every reconcile path (fragment batch, LIS insertion,
   reorder) carries it — pairs would desync under per-node relocation.
2. **Component-owner pairs (`mmd:c`) and data-site singles (`mmd:d`) are
   deferred to mount adoption**: RFC §16.7 records that data sites need no
   marker category (deterministic entity metadata plus the existing
   structural markers suffice), and component boundaries are only required
   when compiled factories begin consuming the cursor.
3. The runtime emits the same anchors on client and server — CSR and SSR
   DOM stay structurally identical, which the parity corpus requires. The
   parity harness canonicalizes comments away, so corpus tests are
   unaffected.
4. **Phase 3 adoption primitives implemented:** `createHydrationCursor`
   validates local DOM order; `HydrationNodePlan` serves ordinary nodes in
   compiler post-order; `HydrationMarkerIndex` locates nested `c/g/l/w`
   owners by canonical identity and validates pair/row boundaries. All are
   read-only and report owner-scoped mismatches.
5. **Static-root adoption implemented:** `hydrate(target, root)` consumes
   `mmd:r`, returns the existing host/text nodes (`===`), installs events and
   updates on the active browser runtime, and restores `client-create` mode
   after the synchronous factory pass. Fragments and nested structural
   ranges reject explicitly until their dedicated adoption slices; no
   silent marker skipping or root remount occurs.

Owner: SSR layer
Inputs: `ssr-proposal.md` §Phase 2/3, `octane-comparison.md` §1 (compaction,
elision, source-location diagnostics), slice 1.9 key encoding, RFC §16.3
exact-site identities (`owner/$data/<n>`, structural region ids)

---

## 1. Goals and constraints

The protocol binds server-rendered DOM regions to client runtime entities so
adoption can locate boundaries without executing component logic or diffing.

Hard constraints (each traces to a decision already made):

1. **Skew-safe**: client walks its own compiled shape; markers accelerate
   location but correctness never depends on server markers matching
   (mismatch ladder applies). Elision therefore degrades speed, never
   correctness.
2. **Compaction-safe grammar**: after successful adoption, adjacent marker
   pairs coalesce (Octane-style depth scheme). The grammar must make
   coalescing loss-free — see §5.
3. **Elision-ready**: any region whose compiled shape is provably one host
   element (or otherwise reconstructible) emits no markers at all. The
   client-side cursor validates tag/kind at every step, so elided regions
   under skew degrade to slower walking plus the ladder.
4. **Identity vocabulary fixed by prior slices**: component owners
   (`App`, `App/TodoList`), keyed rows (`…/Row[n:42]` via slice-1.9
   encoding), conditional/route regions (`…/when0`, `…/route0`),
   data sites (`…/$data/0`).
5. **No ambient globals**: payload delivery stays on the scoped JSON channel;
   markers themselves carry only structural identity, never application data.
6. **CSP-safe**: comments only; no inline attributes beyond one optional
   development diagnostic attribute.

## 2. Marker categories

Every dynamic region the compiler emits gets at most one opening and one
closing marker. Static DOM between boundaries belongs to the enclosing
region's local cursor and is never individually marked.

| Category | Opens/closes | Identity carried | Example |
| --- | --- | --- | --- |
| Application root | pair around all root nodes | root id (`data-mmd-root` channel links to it) | `<!--mmd:r:App-->…<!--/mmd-->` |
| Component owner | pair around the component's created nodes | entity id | `<!--mmd:c:App/TodoList-->…<!--/mmd-->` |
| Conditional / route region | pair around active branch content | region id (`…/when0`) | `<!--mmd:g:App/header/when0-->…<!--/mmd-->` |
| Keyed list | pair around all rows | list region id | `<!--mmd:l:App/todos-->…<!--/mmd-->` |
| Keyed row | pair around row nodes | list id + encoded key | `<!--mmd:w:App/todos:s:first-->…<!--/mmd-->` |
| Data site (scalar/attribute sink) | single opening marker before the sink | `$data` site id | `<!--mmd:d:App/$data/0-->` |
| Text hole (unmarked static text position) | none — resolved by local cursor order | — | — |

Notes:

- Attribute/property sinks cannot host child markers; their `$data` opening
  marker precedes the owning element, and the guarded setter resolves the
  sink by cursor position within the site.
- Multi-root components emit one root-level range per root node inside the
  application-root pair.
- Empty regions (conditional with no branch taken, empty list) still emit
  their pair — an empty range is a valid adopted state.

## 3. Grammar

```
marker        ::= "<!--" body "-->"
body          ::= kind ":" identity [":" attr]
kind          ::= "r" | "c" | "g" | "l" | "w" | "d"
close         ::= "<!--/mmd-->"
identity      ::= entity-id characters excluding ":" and ">" (see §3.1)
```

- Opening markers carry kind + identity; closing markers are uniform
  (`<!--/mmd-->`) — the stack discipline of ranges makes identity on closes
  redundant, and uniform closes keep post-adoption coalescing trivial.
- Row markers (`w:`) embed the slice-1.9 encoded key directly
  (`s:first`, `n:42`), so adoption matches rows without consulting the
  manifest.
- Identities are compiler-canonical entity ids; user-controlled strings may
  only appear through the slice-1.9 escaped encoding.

### 3.1 Character safety

Entity ids are built from authored identifiers and encoded keys. Authored
identifiers are validated identifier characters; keys are percent-escaped by
the slice-1.9 contract. Neither can contain `:` (the field separator) —
identifier grammar excludes it, and the encoder escapes it as `%3A`.

### 3.2 Development-mode dense diagnostics

Development builds add one attribute-carrying comment form and per-text-hole
position markers:

```
<!--mmd:d:App/$data/0 @ src/App.tsx:42:5-->
```

Production builds omit the `@ …` suffix entirely. The suffix never affects
parsing of identity.

### 3.3 Versioning

The marker stream itself carries no version — the **manifest does**
(`protocolVersion`, `buildId`). Marker grammar changes bump the manifest
protocol version; adoption refuses older/newer protocols via the existing
envelope gate (full client creation, state preserved if independently valid).

## 4. What the manifest carries

Minimal — most identity lives in the HTML:

```jsonc
{
  "protocolVersion": 1,
  "buildId": "<hash>",
  // Only exceptions and metadata the client cannot derive:
  "roots": ["App"],
  // Optional debug aid in dev payloads only:
  "sites": { "App/$data/0": "src/App.tsx:42:5" }
}
```

Everything else (region tree, row keys, site ids) is reconstructed from the
markers + the client's own compiled graph during cursor adoption.

## 5. Post-adoption compaction

After an island/root adopts successfully:

1. Walk adopted ranges innermost-out; replace each `open…close` pair with a
   single `<!--mmd:x:id-->` tombstone (or remove entirely when the enclosing
   region proves sole ownership).
2. Nested ranges compact by depth: removing an outer pair must not orphan
   inner pairs — inner pairs promote upward (their identity is preserved;
   outer identity is derivable from the client graph and no longer needed).
3. Compaction runs once per root, after effects settle; later structural
   updates operate purely on runtime entities and ignore/reuse tombstones.

Grammar constraint enforced by design: closes are uniform and opens carry no
positional state, so removal is always order-independent.

## 6. Elision rules (production)

A region emits no markers when the compiler proves ALL of:

1. every possible branch renders exactly one host element of a statically
   known tag (conditionals), or the region is a static subtree;
2. the region owns no keyed rows;
3. no `$data` site exists inside (attribute sinks defer assignment anyway);
4. no refs/effects/policies attach inside.

Elision decisions are derived per-tier from each build's own graph — under
skew, proofs may differ between tiers, which is safe by constraint 1 (§1):
the client cursor validates tag/kind and the ladder recovers.

## 7. Diagnostics (development)

- Mismatch warnings cite the marker identity AND the source location from the
  dev suffix: `hydration: text hole expected 'Hello Ada', found '' at
  App/$data/0 (src/App.tsx:42:5)`.
- Missing/unexpected markers report nearest enclosing boundary.
- All diagnostics are dev-build-only; production follows the remount ladder
  silently.

## 8. Serialization requirements (server)

- `@memoized-dom/server` gains a marker-aware serialization mode (today's
  `serialize()` skips comments — introduced for anchor hygiene in slice 1.5
  and must become mode-dependent).
- LinkeDOM serializes comments verbatim; no escaping concerns exist for
  comment bodies beyond forbidding `>` ambiguity — identities are validated
  identifier+encoded-key strings, so injection is structurally impossible
  (adversarial tests required regardless, per Phase 5).

## 9. Overhead measurement plan (exit criterion)

Fixtures mirroring the proposal tiers, measured as bytes of markers / bytes
of total HTML, prod and dev modes:

- small (one component, one conditional),
- medium (dashboard: 3 components, 2 conditionals, 1 group),
- list-heavy (1k keyed rows, nested lists),
- elided variant of each (proofs applied).

Targets set after first measurement; regression-tracked in `bench/`.

## 10. Test matrix (exit criteria mapping)

- snapshot tests per marker category (compiler emission);
- server/client identity compatibility through both tiers of the parity
  corpus (harness gains a marker-aware comparison mode);
- skew fixtures: old-server/new-client and reverse, exercising ladder rows;
- compaction test: adopt → compact → assert tombstone invariants;
- text/fragments/empty-regions/lists/routes/multi-root coverage per proposal.

## 11. Open questions

1. Tombstone vs full removal default after compaction (tombstone keeps
   re-adoption cheap; removal is cleanest DOM).
2. Whether `w:` row markers should also close with identity for O(1)
   forward-matching instead of stack pairing (cost: two identity carriers per
   row).
3. Interaction between elision and the Group policy arms (a pending arm is a
   region whose content differs per state — likely never elidable, confirm).
