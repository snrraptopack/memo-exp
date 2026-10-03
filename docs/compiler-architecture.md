# Compiler phase boundaries

## Direction

Separate authored-language meaning from the code a rendering target needs.
Normalized JSX, lexical reads/writes, opaque and async provenance, component
composition and control-flow plans belong to shared analysis/planning. Node
creation, factory ABI, registration, templates, hydration operations and target
runtime imports belong to backend lowering/emission.

The current compiler remains the implementation being migrated. The DOM and
existing SSR paths remain functional. Native/mobile/desktop backends are not
implemented by this change.

## Implemented boundary

```mermaid
flowchart LR
  A[Parse and normalize authored code] --> B[Analyze bindings and component facts]
  B --> C[Prepare reads and callbacks]
  C --> D[Plan returns, sources, placement, replay and region shapes]
  D --> E[DOM creation and handler lowering]
  E --> P[Finalize callback publication facts]
  P --> U[Emit updater gates and component factory]
  U --> F[Finalize module and print]
```

`planning/component-render.ts` takes normalized component paths and exact
expression-source contracts from semantic planning. Its
`ModuleRenderPlan` contains component names/source paths and the existing return
contract: direct JSX or a branch selector, branch content and replaced source
statements, plus `ComponentExpressionSources`, an optional `ComponentPullPlan`,
`ComponentPlacement`, `ComponentRegionReplay`, `ComponentRegionShapes` and
`ComponentListSites`. `ComponentRenderInputs`
names the separate fact producers at the module planning boundary.
Contracts are read-only. No generated identifiers, DOM node operations,
registration policy or runtime
namespace is allocated by this pass.

`emission/dom.ts` consumes the complete module plan. Component emission receives
one `PlannedComponent`, and no longer discovers return control flow. All return
plans are validated before any factory is replaced. This removes dependence on
which earlier component has already been emitted.

`planning/expression-sources.ts` captures owner state/props, resolved derivation
roots, opaque/transparent/module sources and callee proof inputs before factory
mutation. The source-query implementation in `analysis/expression-sources.ts`
has no `Ctx` dependency. Its queries return sorted root names, `[]` for no exact
reactive sources, or `null` for unknown attribution. The DOM emitter translates
those roots to numeric and structural runtime reasons; it no longer rebuilds
derivation maps for each slot or reads mutable analysis maps for that proof.

Queries still walk their expression: text normalization combines and clones
expressions during emission. No expression cache assumes a mutable AST is
unchanged. Summarized helpers retain their existing proof; an unindexed cloned
global call remains conservative. This boundary preserves current behavior;
it does not broaden which calls or getters the compiler regards as safe.

Exact sources and opaque pull independence are separate facts.
`planning/primitive-pull.ts` snapshots primitive initializer/write dependencies,
lexical eligibility and authored callback completion before backend mutation.
`analysis/primitive-pull.ts` resolves those dependencies after the emitter
supplies the finalized callback-publication decisions. Finalized queries do not
read mutable `Ctx` or re-inspect authored initializers/writes. Escaped callbacks,
throws, hidden reads, shadowing, dynamic scope and unsupported values remain
conservative. This is an explicit two-phase contract: finalizing before handler
lowering finishes would miss publication; capturing completion after lowering
would mistake generated calls for authored effects.

The shared primitive grammar in `analysis/plain-scalar.ts` also serves list
allocation proofs through the existing context adapter. Both consumers retain
their own lexical eligibility rules. Async provenance, effects and ownership
retain their current collectors.

`planning/component-placement.ts` captures listed-component status, row item
bindings and paths, common key paths, collection ownership, external reactive
inputs, local-effect presence and route ownership before factory mutation.
Local and linked callers feed the same contract. Unknown or incompatible key
paths retain the conservative fallback; the planner does not broaden key proofs.
The backend attaches runtime IDs and chooses factory ABI and ownership cleanup.

`analysis/route-selectors.ts` collects imported route reads in one traversal per
component, including multiple aliases. Dynamic or indirect reads fall back to
whole-route subscriptions for that source only. Captured selectors contain
semantic paths and literal query arguments; emission constructs their runtime
expressions without re-analyzing bindings. Other async/effect facts still use
their existing collectors.

`planning/region-replay.ts` snapshots the inputs that decide how structural
content replays: component-owned roots and volatility, module index eligibility,
canonical source keys and binding-checked fixed-position list sources.
`analysis/region-replay.ts` queries those facts without `Ctx`. Fixed-position
proofs stay tied to the indexed map call and source name; cloned calls remain
unproven. Prelude-bearing lists keep general replay. Queries still accept the
current source expression so transparent lowering and cloned content do not
inherit a proof from a matching name alone.

Nested row, branch, route, render-callback and content-slot emission scopes
inherit the lexical owner's replay contract. The DOM backend supplies reason
availability and enclosing-owner forwarding, then constructs reconciliation,
index refresh or conditional updates. Conditional queries retain the existing
root-name and volatility rules; this change does not broaden getter/callback
proofs. Region identities, targeted mutation journals and DOM-only cleanup/ABI
still have their existing mixed ownership.

Canonical key resolution is shared by live context consumers and captured
replay facts through `context/state-keys.ts`; there is one implementation.
The former context-based conditional owner-read helper is removed now that
its consumer uses the captured contract.

`lists/callback-plan.ts` owns callback parameter validation, row derivation
substitution and ordered expression preludes. It returns a `ListCallbackPlan`
without mutating source. The shared list-analysis adapter applies an explicit
normalized-body replacement for the existing const-only normalization case;
expression-bearing blocks remain available to read collection and transparent
source lowering. List source/target/key queries consume captured semantic inputs
through the shared site planner.

`jsx/conditional-plan.ts` owns branch flattening, source-order selection,
renderable text wrapping and branch key validation. `ConditionalBranchPlan`
contains neither a region suffix nor DOM operations. Read analysis combines
this shape with its source occurrence counter; DOM emission supplies its own
counter and runtime owner.

`planning/region-shapes.ts` prepares JSX-bearing shapes after shared read/callback
lowering, before factory emission. It walks normalized row and branch content,
including the cloned JSX produced by row substitutions and text wrappers.
Emission consumes the resulting shapes through `ComponentRegionShapes`. Newly
cloned attribute/slot content and delegated non-JSX callback syntax use the same
pure normalizers on demand; they do not inherit lexical optimization proofs.
These lookups use no mutable `Ctx`, generated IDs or backend statement buffers.
Shape plans reference AST nodes owned by this compilation, rather than frozen
trees reusable across backends.

`lists/site-plan.ts` owns source classification, row component/delegated-callback
recognition and ordered key extraction. `planning/list-sites.ts` captures local
and opaque roots, module state kinds, frozen initializers, known component names
and prop reference contracts once per component before any factory is replaced.
`ComponentListSites` queries those facts without `Ctx`; DOM list emission no
longer calls the context-based `analyzeMapSite` adapter. Shared read collection
uses the same semantic planner through that adapter. Map matching is shared
with delegated-callback discovery through `lists/source-shapes.ts`.

Analyzed source identities are copied by exact map-call identity. Queries use
the current source expression, preserving later transparent async expansion.
Clones acquire no cached identity; nested member lists require explicit parent
row ownership. Key/spread ordering, deferred getter evaluation, optional sources
and callback item/index validation retain their existing rules. Occurrence
suffix allocation and the explicit normalized-body replacement stay in a
separate adapter. No DOM instructions or generated names are allocated by the
site planner.

This boundary still recognizes already lowered transparent-data helper calls
using the captured runtime namespace identifier. That compatibility is an
explicit remaining dependency on shared runtime-producing normalization;
semantic async provenance must eventually replace it. These source contracts
do not constitute a complete target-neutral IR or broaden optimization proofs.

`lists/item-write.ts` supplies one indexed-item write parser for journal
discovery and handler key construction. `analysis/list-mutation-journals.ts`
collects candidate paths once per component, rather than walking its complete
body for each eligible list. Candidate eligibility describes owned state and a
direct key path without allocating generated names or DOM operations. It is
only a candidate: handler routing still checks lexical origins, plain-data
assignments, accessors and key-changing writes before publishing a targeted
reason. Unknown receiver effects keep content-safe reconciliation.

The final unique-source journals are copied and frozen before backend use.
`ComponentListSites.mutationFor` indexes them by the original map call; cloned
maps acquire no journal. Nested factories inherit this lookup with other list
facts. Handler routing consumes captured source lookups. The redundant mutable
per-call journal map is removed from `Ctx`; one source registry remains for
shared discovery and closed-record analysis. Two independent list consumers
of one source still disable the journal.

Runtime journal binding names and reason addresses are still allocated by the
read-analysis adapter to preserve allocation order and generated output. They
are explicit compatibility data in the snapshot. Fully separating publication
and binding allocation from shared discovery remains work for a later phase.

`analysis/owner-list-structure.ts` proves a separate closed-binding property:
every array write preserves retained contents, and each inline row render reads
only own primitive item fields or its index. Dense literal allocation, explicit
indexed reorders/replacements and literal truncation are supported. Minimum
extents bound every indexed access, preventing inherited indexed getters after
truncation. Aliases, field writes (including loop/destructuring targets), opaque
methods/factories, spreads, getters, external row reads and component rows retain
ordinary replay. Dynamic scope and HMR disable the proof.

The analysis records original list-call/source identity and ensures the owner
has a numeric reason for that source. `planRegionReplays` captures that source
and reason before emission. Clones, changed source expressions and callback
preludes cannot acquire the proof. The DOM emitter uses the existing
`reasonsOnly` protocol with a hoisted reason array: any unrelated, opaque or
full-update cause retains content replay. Runtime key/order validation,
replacement-item updates and index sensitivity remain unchanged. Supporting
content-mutating sources needs a per-write publication proof; component rows
also need a props/hidden-read proof. No new runtime API is introduced.

`RegionSourcePlans` carries replay, shape and list-site contracts to nested emission
scopes. `newEmitScope` inherits only those source contracts from its caller;
creation statements, node IDs, updater slots and disposal lists stay fresh for
each factory. Ownership counters keep their existing explicit sharing rules.

AST references are owned by one compilation and consumed by its emitter. The
read-only contract does not imply that referenced AST nodes are frozen or that
one consumed plan can be reused by a second backend. A multi-backend build must
give each lowering its own owned tree or immutable semantic representation.

## Remaining coupling

Runtime keyed reconciliation can exploit observed ordering without inferring
authored method behavior. A displaced first row seeds an old-position cursor;
subsequent keys must match its predicted ordered record before reuse. A mismatch
falls back to position/cache lookup, and interrupted frames retain membership
checks. This is distinct from compiler structural-write proof: it does not waive
key evaluation, retained content replay or index refresh, and works with any
producer whose evaluated order satisfies the checks.

Removal-only frames reuse the general path's consumed-record marker. The marker
is installed before retained props/content callbacks and stays active through
removed-row cleanup, so key refresh cannot read the old snapshot using a new
survivor position. Unconsumed rows still expose their previous bindings. A
completed frame publishes the new snapshot before releasing the marker;
interrupted frames retain ownership for general recovery or unmount. Ordered
subsequence and suffix-range removal still avoid map transfer and LIS.

| Concern | Current ownership | Next boundary |
| --- | --- | --- |
| Exact slot-source inputs | Semantic snapshot consumed through `ComponentExpressionSources` | Extend shared facts to other consumers while preserving lexical identity |
| Primitive pull safety | Authored fact plan plus explicit late callback-publication input | Move callback analysis/lowering to a shared phase with target-specific publication |
| Async provenance and effects | Existing collectors and shared `Ctx` | Distinct fact contracts with explicit pass dependencies |
| Component placement and route selectors | Semantic snapshot consumed by component emission | Extend to structural regions and composition without moving host ABI into shared plans |
| Structural replay eligibility | Semantic contract inherited by lexical emission scopes | Extend to callback shape, branch structure and mutation journals |
| List syntax, sources, targets and keys | Pure normalizers plus captured per-component semantic contracts, including clone lookups | Replace lowered async-helper recognition with semantic provenance and extend to mutation journals |
| Mutation journals | Shared candidate/path analysis and frozen backend snapshots; one source registry | Move binding allocation and reason publication behind explicit backend contracts |
| Retained row replay for owner writes | Closed structural-only sources capture original-call/source/reason facts; other numeric/journal causes keep full replay | Extend to per-write content/opaque publication and component-row props while preserving mixed-cause fallback |
| Props and region identities | Shared analysis plus backend lowering | Explicit composition and publication contracts |
| DOM-only row proof and ABI | Shared metadata and DOM-specific eligibility | Target-specific ownership/ABI plan derived from shared composition facts |
| Normalization and transparent read/callback lowering | Mixed semantic and runtime-producing transforms | Authored semantic normalization followed by explicit target lowering |
| Generated IDs, headers, imports and output buffers | Same `Ctx` as source analysis | Mutable emission state separate from analyzed facts and configuration |
| Generated-header coverage | Deferred header insertion after some rewrites | Passes explicitly cover authored, generated or complete module trees |

These boundaries are not implemented merely by moving files or renaming `Ctx`.
Move one fact's producer and consumers together; then remove the former answer
from emission. Preserve parser origins and binding identity across AST rewrites.
Facts requiring callback analysis must be finalized after that analysis, before
their backend consumer runs.

## Migration order and gates

1. Return/control-flow planning is implemented. Keep generated output unchanged.
2. Exact slot-source inputs now have a separate contract. Continue consolidating
   expression facts and trace writes through reason publication to
   list validation and row replay. VM evidence points to rotation, first-row
   removal and broad retained work. Remove duplicated work only after proving
   what each stage contributes; preserve hidden reads and mixed dirty causes.
3. Plan host children/attributes, structural sites and composition independently
   of runtime construction. Keep refs, effects, data policies and route ownership
   explicit in those contracts.
4. Split configuration/analyzed facts from mutable backend state. Move generated
   module finalization behind the backend boundary, including header coverage.
5. Introduce another target only when its concrete host/lifecycle contracts exist.

Each step requires self-contained contract tests and cross-feature execution:
opaque props/pulls, linked helpers, effects/refs, async rows, routes/request cells,
hydration and failed-render ownership. Compiler-regenerated benchmark output is
compared for unintended changes. Browser gates verify text/classes/order and
retained nodes. Benchmarks measure the complete path; an isolated simplification
does not establish an overall speedup. Dependency versions and pinned upstream
benchmarks stay unchanged. Bundle-size work remains deferred.

## Validation of the first boundary

Compiler build and changed-source lint passed. Six contract cases verify direct,
tail, if/else and switch returns, source non-mutation, and rejection of a later
invalid component before any factory emission. The broader compiler/DOM suite
passed 158 tests across 11 files, and SSR validation passed 18 tests across five
files. Regeneration leaves tracked benchmark output unchanged. All 25 browser
variants pass retained-node and mixed-sequence gates. This phase change makes
no runtime speed claim.

## Validation of exact source planning

Compiler build and changed-source lint passed. The selected suite passed 204
tests across 12 files, including 17 return/source contract cases, reason gates,
opaque pulls, linked helpers, alias mutations, forms/image callbacks, effects,
routes and hydration. A separate SSR gate passed 18 tests across five files.
Contract tests mutate the analysis context after planning and verify that source
queries preserve their facts, including helper/global clone conservatism.

Compiler regeneration leaves tracked DOM benchmark output unchanged. All 25
browser variants passed identity and mixed-sequence assertions. The browser
runner then exited with a Windows `EBUSY` during temporary-profile cleanup;
the assertions completed before that cleanup error. This change makes no
runtime performance claim; the VM structural-update priorities remain open.

## Validation of primitive pull planning

Compiler build and changed-source lint passed. The two selected suites passed
292 distinct tests across 20 files, including ten new pull-plan contract cases
and the existing primitive-list, opaque-control, callback, effect, linked-helper,
async-form, route, hydration and SSR cases. Contract tests check publication
snapshots, backend AST mutation, synchronous writes, transitive labels and
conservative handling of throws, hidden reads, shadowing and dynamic scope.

All 25 browser variants passed identity and mixed-sequence validation, and the
runner exited successfully. Compiler regeneration leaves tracked DOM benchmark
output unchanged. This boundary establishes no runtime speedup.

## Validation of component placement planning

Compiler build and changed-source lint passed. The selected suites passed 220
tests across 23 files, including eight new placement/route contract cases.
Coverage includes local and linked row sources, aliased props, incompatible
keys, route alias isolation, shadowing, snapshots after source/context mutation,
effects, forms, hydration and SSR.

Compiler regeneration leaves tracked DOM benchmark output unchanged. All 25
browser variants passed retained-node identity and mixed-sequence checks; the
runner exited successfully. This phase change establishes no runtime speedup.

## Validation of structural replay planning

Compiler build and changed-source lint passed. The selected suites passed 217
distinct tests across 26 files, including six new replay-contract cases. They
cover context/factory mutation after capture, lexical shadowing, cloned calls,
canonical keys, prelude/local/member fallbacks, nested lists/conditionals,
render props/children, opaque slots, effects, forms, routes, hydration and SSR.
The six replay cases also passed after canonical key resolution was shared.

Compiler regeneration leaves tracked DOM benchmark output unchanged. All 25
browser variants passed retained-node identity and mixed-sequence checks and
the runner exited successfully. Runtime timing gains remain unverified.

## Validation of region shape planning

Compiler build and changed-source lint passed. The selected suites passed 224
tests across 29 files, including eleven new shape-contract cases. The contract
cases verify non-mutation, ordered callback preludes, const substitutions,
runtime-only parameter clones, shadowing diagnostics, branch selection order,
empty/text branches, keyed-list exclusions and cloned/nested shape lookups.
Execution coverage includes nested composition, render callbacks/props, opaque
slots, effects, forms, routes, hydration and SSR.

Compiler regeneration leaves tracked DOM benchmark output unchanged. All 25
browser variants passed retained-node identity and mixed sequences, and the
runner exited successfully. This change establishes no runtime timing gain.

## Validation of list source, target and key planning

Compiler build and changed-source lint passed. The selected suites passed 312
distinct tests across 37 files, including 12 new site-plan contract cases.
Contract coverage checks non-mutation, optional/module/local sources, explicit
nested-row ownership, key/spread getter ordering, delegated callback validation,
async gating and copied original-call identities. Clearing the analysis context
after capture preserves semantic answers; a clone cannot acquire the original
call's source proof. Existing reactivity, composition, effects, routes, hydration
and SSR gates pass.

All 25 browser variants pass retained-node and mixed-sequence assertions.
Compiler regeneration leaves tracked DOM benchmark output unchanged. This
phase change establishes no runtime performance gain; VM structural priorities
remain open.

## Validation of mutation-journal planning

Compiler build and changed-source lint passed. The selected suites passed 294
distinct tests across 31 files, including 15 new mutation-plan contract cases.
Coverage includes shared item-write syntax, owned/keyed candidate requirements,
lazy scan eligibility, frozen snapshots, original-call identity and disabling
independent consumers. Existing alias, targeted-write, opaque-pull, key,
composition, async/form, effect, route, hydration and SSR cases pass.

Compiler regeneration leaves tracked DOM benchmark output unchanged. All 25
browser variants pass retained-node and mixed-sequence checks. Candidate scanning
is consolidated on the compiler side; no runtime timing gain is established.
The VM priorities remain rotations, first removal and broad retained-row work.

## Validation of contiguous cyclic reuse

Runtime build and changed-source lint passed. The selected suites passed 203
distinct tests across 19 files, including eight new cyclic-cache cases. The
lookup probe verifies one key-cache lookup for complete shifts while preserving
all authored key reads and content updates. Coverage includes failed prediction,
duplicate/recovery paths, SameValueZero keys, immutable replacement items and
an earlier row effect changing a later key. Existing exhaustive reorder,
multi-node/empty-row, cleanup, reentrant unmount, failed-frame, hydration,
reactivity and opaque fallback cases pass.

All 25 DOM browser variants pass identity and mixed-sequence checks. Compiler
regeneration leaves tracked DOM output unchanged. Reduced cache lookup work is
verified independently of timings; end-to-end gains require the next VM run.
The pinned Octane canonical and reorder smoke suites also pass for the
memoized-dom target, including per-operation identity/correctness gates.
The local single-sample timings are not used as comparative performance evidence.

## Validation of removal refresh protection

The six initial regressions failed before the runtime fix. Runtime build and
changed-source lint passed, and the selected suites passed 228 distinct tests
across 21 files, including 13 new removal-refresh cases. They verify props and
content callback reentry, cleanup refresh with replacement items, unconsumed
old-row visibility, interrupted-frame recovery/disposal and structural-only
index precision. Existing exhaustive reorder, failed-frame, cleanup/unmount,
hydration, dirty-render recovery, alias/journal fallback, mixed selection and
image-search form cases pass.

All 25 DOM browser variants pass identity and mixed-sequence checks; compiler
regeneration leaves tracked benchmark output unchanged. The pinned Octane
canonical and reorder smoke suites pass for memoized-dom. These gates establish
correctness and removal of redundant callback replay; they do not establish
comparative timing gains or complete owner-state structural-write proof.

## Validation of closed owner structural replay

Compiler build and changed-source lint passed. The selected suites passed 227
distinct cases across 17 files, including 28 self-contained owner-array cases
and one new region-plan contract case. Coverage includes synchronous/deferred
and mixed causes, multiple instances, immutable/indexed replacements, rendered
indices, aliases, getters, field/loop mutations, opaque reads, dynamic scope and
bounds after truncation. The plan retains its original-call/source/reason
contract after analysis context is cleared; cloned calls receive no proof.

All 25 regenerated DOM variants pass identity and mixed-sequence checks. The
pinned Octane canonical and reorder smoke suites pass for memoized-dom. A local
before/after compiler comparison validates every focused sample and repeats all
21 nine-variant DOM scenarios in both orders. Focused closed-array reorders have
lower medians in both orders; existing DOM browser artifacts are identical, so
their timing differences cannot be attributed to this proof. Measurements and
limitations are recorded in `docs/performance-work.md`. Per-write summaries and
component-row prop precision remain open work.
