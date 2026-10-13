# Blitz milestone and decision record

Updated: 2026-10-12. Branch: `codex/blitz-renderer`.

Follow [plan.md](plan.md) for implementation order and [research.md](research.md)
for inspected architecture. This log is append-only for completed work: correct
an inaccurate entry explicitly rather than rewriting the historical decision.
Update the status table when the corresponding completion gates pass.

## Milestone status

| Milestone | Status | Evidence |
| --- | --- | --- |
| M0 — Architecture and plan | Completed | Initial documentation batch below |
| M1 — Shared semantic/compiler boundary | Completed | Runtime/core, shared pass order and project/manifest adaptation; unchanged fixture products, source-only contracts, builds/checks and 2,558 root tests pass |
| M2 — Native document/transactions | In progress | Pinned native document, source identities and ranges; 17 Rust contracts pass; process sequencing and mixed atomic batches remain |
| M3 — Ordinary native counter | Not started | No desktop compiler/mount integration exists yet |
| M4 — Events and input | Not started | Upstream API inspected; process integration not tested |
| M5 — Modules and structural parity | Not started | Core implementations available; native adapter not built |
| M6 — CSS/browser parity | Not started | Native headless CSS smoke contract passes; browser box/fragment parity is not measured |
| M7 — Refs/libraries/lifecycle | Not started | Capability plan only |
| M8 — Dev workflow and evidence | Not started | Initial native check/test compilation recorded; application refresh/startup/input traces absent |

## M0: research and implementation contract

Completed: 2026-10-12.

### Baseline and scope

- Verified the current branch is `codex/blitz-renderer`, based on main commit
  `f3e1a794d5652d91bab27590519d6fb04f7a99cc`.
- Verified that main predates the desktop package and runtime/core export.
  Previous desktop work stays available on `codex/desktop-renderer`; it has not
  been merged wholesale.
- Preserved the preexisting `examples/fullstack/src/Main.tsx` edit.
- Added only this log, the implementation plan, and the Blitz research document.
  The older GPUI proposal remains historical context. These wiki documents are
  the authority for the new Blitz work.

### Research performed

Read current compiler preparation/analysis, project discovery, shared render/JSX
plans, runtime kernel/access/state-cell modules, environment capabilities, refs,
effects and external-source allocation. Reviewed the pinned Blitz document,
mutator, identity, event-driver, layout/damage, shell, paint and optional scripting
sources, plus the official feature status pages. The pinned source snapshot is
`45496d9288b063719ebeae4e0761273f7881b3d7`.

### Decisions recorded

| Decision | Rationale and consequence |
| --- | --- |
| Use Blitz as the selected native document/presentation engine | Keep ordinary HTML/CSS authoring and reuse upstream presentation work |
| Keep the existing JS semantic core | Cross-module cells, access tables, effects and external subscriptions are existing framework behavior |
| Extract one shared analysis coordinator before another emitter | Current main still mixes DOM preparation with source analysis; a shortened duplicate pipeline is unacceptable |
| Keep author-facing names `desktop` and normal mount selection | Engine choice belongs to build/host integration, not application source |
| Use direct native templates/mutations | Retain source identity and native control state without serializing complete HTML every update |
| Use ordinary CSS text and asset source URLs | Stylo performs CSS interpretation; do not copy the GPUI cascade/style language |
| Use a persistent process bridge initially | Reuse known transport/acceptance concepts while testing event latency independently |
| Freeze cancellation after synchronous JS dispatch | Preserve web timing; async completion does not block a native default |
| Defer relevant defaults without blocking the Rust UI thread | Avoid deadlocks and global input/paint waits |
| Validate complete operation batches before native mutation | Mutator flush does not provide transaction rollback |
| Fail the connection after ambiguous application | Never claim a failed live mutation left the old document intact |
| Build native code separately from TSX/CSS refresh | Avoid repeating native dependency compilation during ordinary app testing |
| Communicate existing-code changes before implementation | The user's requirement governs shared extractions, build wiring and any semantic changes |

### Verification and actual results

- Git branch, HEAD, remote-main ref, and working-tree status inspected.
- Checked source paths and upstream snapshot references against the current
  checkout and the inspected Blitz source checkout.
- Markdown local links and pinned upstream paths checked; `git diff --check`
  passed for the documentation batch.
- No JS/native tests were needed for this documentation-only batch.
- No Blitz crate has been built or run. No performance improvement is claimed.
- Commit identity and push verification are recorded by the completion message
  for this batch; locate the exact commit with
  `git log -- wiki/blitz/research.md wiki/blitz/plan.md wiki/blitz/milestones.md`.

### Next authorized batch

M1: communicate the shared analysis/core entry changes before editing them, capture
DOM compiler output baseline, and extract the smallest reviewed shared boundary.
Do not start by importing the previous GPUI renderer or creating another reactive
runtime.

## M1.1: shared runtime entry and host acceptance capabilities

Completed batch: 2026-10-12. Parent commit: `b850ece9d1ff226f59278ba003f1db78f71fbe1b`.
The full M1 milestone remains in progress.

### Changes and reused code

- Added `packages/runtime/src/core.ts` and the package `/core` export/build entry.
  It reexports the existing kernel, access resolver, cells, write routing, effects,
  refs and cleanup. No second runtime or subscription bridge was introduced.
- Moved computed/effect assignment comparisons unchanged from DOM setters to
  `src/comparison.ts`, with an existing-path reexport for web consumers.
- Made environment document access lazy. A core application can initialize and
  execute without a browser document; browser-only document use still rejects.
- Added optional native visibility and effect acceptance hooks, including scoped
  inheritance and explicit hook removal. Web defaults keep their current behavior.
- Deferred effects capture their originating application and exact registration.
  Retired effects and replaced conditional controllers cannot run after acceptance
  is delayed, even when the same entity ID is reused.
- Generalized only the shared internal ref lifecycle target. It can omit
  `ownerDocument`; browser node types remain the default and ref teardown uses
  the same implementation and reverse ordering.
- Added `tests/native-core-runtime.test.ts` for actual no-document execution,
  entry dependency boundaries, application cells/access routing, native opaque
  pulls, host-held effects, retired registration safety, refs and scoped hooks.

The existing-code changes were communicated before editing: core exports and
package wiring; lazy document resolution; visibility and effect-acceptance hooks;
native ref lifecycle targets; and moving comparisons out of DOM setters. Their
necessity and browser/SSR/ref/effect/list verification were stated. Application
authoring APIs, compiler files and the optimized DOM list files were not changed.

### Verification and evidence

- `bun test --isolate ./tests/native-core-runtime.test.ts`: 8 passed initially;
  all eight, including the strengthened retired-controller check, also passed in
  the full root run.
- `bun test --parallel=2 ./tests`: **2,547 passed, 0 failed**, exit code 0,
  across 252 files. Includes compiler behavior, browser/SSR lifetime, list/ref
  regressions, package dependency boundaries and a real Chromium DOM check.
- Runtime and compiler package builds passed. The compiler was rebuilt from this
  branch rather than testing against distribution files left by the GPUI branch.
- `bun check -p packages/runtime/tsconfig.build.json`: no errors in 57 files.
- Oxlint on changed runtime sources and the new test passed; `git diff --check`
  passed. The packaged `@memoized-dom/runtime/core` import resolves.
- Captured a local, ignored compiler output baseline at
  `.cache/blitz/compiler-baseline-f3e1a79.json`: all 15 Git-tracked fixture files,
  30 initial-content cases, 18 emitted outputs and 12 diagnostics. Source hashes
  accompany each case; the capture excludes generated test files. SHA-256:
  `f8c512893411efc2ae17a77485f9817691f213b37947d947ccd7e85e48aa7f3e`.
  This is evidence for the next extraction, not an output comparison already run.

### Decisions and limits

| Decision | Reason |
| --- | --- |
| Expose existing primitives instead of copying runtime code | Keep one semantic implementation and preserve application isolation |
| Leave native publication queue implementation to the desktop adapter | Acceptance is a host boundary, separate from the core dirty-work scheduler |
| Guard queued effects by registration identity rather than ID alone | A replacement owner can reuse an ID while old work is still queued |
| Restore the originating application when an effect is released | Native acknowledgments can arrive outside the original synchronous scope |
| Make `ownerDocument` optional internally | Native refs need connection/lifetime behavior without a fabricated browser document |
| Add hooks with unchanged default web behavior | Preserve the core web framework while enabling native acceptance |
| Keep compiler coordination for the next batch | Avoid claiming full M1 completion before source analysis and project discovery are shared |

No native crate/window has been added yet, and no Blitz startup or latency claim
is made. The ordinary mount-and-run example remains M3's deliverable. The user
requested continued work while away: an ACTIVE hourly heartbeat named
**Blitz renderer batches**, ID `blitz-renderer-batches`, now follows this wiki and
branch. The former desktop heartbeat was unavailable; it was not updated or
silently left targeting GPUI.

The batch commit and exact remote verification are reported in its completion
message and discoverable with `git log -- packages/runtime/src/core.ts`.
The unrelated fullstack edit remains untouched.

### Next batch

M1.2: communicate the shared compiler coordinator/project boundaries, reuse the
previous reviewed extraction where it matches current main, compare every captured
compiler fixture output/diagnostic, and rerun the relevant compiler/shared tests.
Do not mark M1 complete until its full plan gates pass.

## M1.2: shared compiler pass order with unchanged DOM products

Completed batch: 2026-10-12.
Parent commit: `2bbd85d00273a55efeea2434db72fcec440e199f`.
The full M1 milestone remains in progress until project discovery is shared.

### Changes and reused code

- Added `packages/compiler/src/analysis/pipeline.ts`, reusing the inspected shared
  extraction from the GPUI branch without its renderer, desktop lowering or runtime.
  It calls the existing source-analysis implementations in the existing DOM order.
- `dom/analyze.ts` now supplies normalization, validation and presentation ABI
  hooks; `dom/prepare.ts` supplies import/source preparation and final DOM setup.
  Their public entry functions remain available to existing callers and tests.
- Moved component-cycle validation and module/owner list source analysis into the
  common coordinator. They cannot be omitted by a native target's finishing hook.
  DOM's mixed list/static placement restriction remains its explicit validation.
- Kept analysis hooks separate from full preparation hooks, so a source-analysis
  call does not require a fabricated empty import-installation callback.
- Imported effect discovery directly rather than its discovery/emission facade.
  The existing transitive compiler boundary check verifies no DOM/runtime dependency
  entered the shared analysis graph.
- Added source-only contracts for component normalization, module/instance state,
  constant derivations, effects, access routing, imported subscription metadata,
  opaque projections, refreshed lexical facts, and state-free cycle refusal.
- Added `test-support/compiler-output-parity.ts` for historical fixture verification
  and proper comparison of project compiler products with a reference compiler.

Before editing, communicated the exact `dom/analyze.ts` and `dom/prepare.ts`
boundary and the shared coordinator destination. Communicated the additional graph
and list source-check extraction before performing it. The stated invariant was
unchanged DOM order, source facts, emitted output and diagnostics. No runtime,
optimized DOM list, server-host or user application files changed in this batch.

### Correction to the earlier baseline record

M1.1's `compileDetailed` capture supplied an option that belongs to
`compileModulesDetailed`. Its two labels were duplicate single-module cases,
not evidence of two initial-delivery modes. The new verifier caught the type
mistake. The original 30 records still match exactly, but only represent 15
distinct single-module cases.

Added a real pre-change project reference from this batch's parent commit. The
reference bundle overrides both DOM coordinator sources with their original Git
blobs; the build verifies both overrides occurred and that the new shared pipeline
is absent. This matters on Windows: the initial reference filter matched forward
slashes only, so it was corrected and verified for both path separators before
accepting the project parity result.

Compared all 15 checked-in fixtures, plus linked state/barrel and normal mount/keyed
component graphs, using both actual project `initialContent` settings. All **34
project products match**, including module outputs, source maps and metadata.
The linked graphs are required to compile, so matching failures cannot make their
parity check pass. This reference comparison produced 34 outputs and no thrown
diagnostics; the historical single-module capture includes diagnostic cases.

### Decisions and remaining scope

| Decision | Reason |
| --- | --- |
| Share pass coordination, not just individual scanner functions | Prevent a native backend from selecting an incomplete hand-ordered subset |
| Keep source cycle/list checks mandatory in the coordinator | They are semantic facts, not DOM ABI choices |
| Keep DOM normalization and runtime-producing operations in a profile | Preserve web output while supplying explicit native adaptation points |
| Test source analysis without DOM context allocation | Validate a usable shared boundary rather than only moving filenames |
| Compare proper project products to verified original source | Cover linked cells, mounting and keyed components while correcting the old capture labels |
| Leave project bootstrap and manifest target adaptation for M1.3 | Avoid claiming full host independence while discovery still invokes DOM preparation |

### Verification and evidence

- Five new source-only pipeline contracts passed, including unconditional
  state-free cycle rejection. All five also passed in the final root run.
- Historical single-module parity: all 30 captured records match main exactly
  (15 distinct cases, with emitted code/maps and authored diagnostics).
- Verified pre-change project parity: all 34 products match across both real
  initial-content settings and the linked state/mount/keyed fixtures.
- `bun test --parallel=2 ./tests`: **2,552 passed, 0 failed**, exit code 0,
  across 253 files. The package was rebuilt before this run; this includes DOM,
  SSR, module linking, effects, refs, optimized lists and real browser contracts.
- Compiler package build passed. Compiler-source Bun checking passed in 234 files;
  the new test/helper check passed in 235 files, including the existing TSRX
  declaration shim rather than fabricating new library types.
- Oxlint on the changed source, test and parity helper passed. `git diff --check`
  passed. The runtime, DOM list implementation and linker/discovery files have no
  changes in this batch; the preexisting fullstack edit remains untouched.
- Publication resumed after Git write permissions were restored on 2026-10-12.
  The completion message reports the commit and verified remote SHA; the source
  history is available with `git log -- packages/compiler/src/analysis/pipeline.ts`.

### Publication interruption and recovery

During the first completion attempt, the session changed to a restricted filesystem
profile with `.git` read-only. Staging the seven batch files failed with
`Unable to create '.git/index.lock': Permission denied`. No files were staged by
that failed command, and no push was attempted then. The next authorized run
restored Git write access, rechecked the branch and working changes, and resumed
publication of the tested batch. The unrelated fullstack edit remains untouched.

### Next batch

M1.3 will extract target-adapted project/manifest
discovery and fixed-point coordination while retaining main's current linking
behavior unless a separately communicated, measured correction is necessary.

## Required format for later completed batches

Append an entry with the milestone ID and batch title, completion date, baseline
commit, concrete changes, decisions and rationale, reused code, prior communication
of existing-code changes, actual checks/results, remaining limits and commit/push
verification. Link relevant source and commands. Preserve failures honestly and
do not mark an entire milestone complete based on one partial batch.

## M1.3: shared project discovery and manifest adaptation

Completed batch: 2026-10-12.
Parent commit: `e1d618e5985e4fc2369ae3ea1c51143f5930c242`.
M1.2 publication resumed successfully in this run; its exact commit was verified
against `origin/codex/blitz-renderer` before this implementation began.

### Changes and communication before editing

Communicated the `linker.ts` bootstrap/worklist extraction into
`linking/project.ts` and the target preparation boundary in manifest discovery
before changing them. Stated that DOM preparation order and re-export rules would
remain unchanged, with compiler product parity, linking contracts and root tests
as the verification gates.

- `linking/project.ts` now owns parsing, canonical entry IDs, duplicate detection,
  import-then-export identity bootstrap, ordinary mount resolution, reverse importer
  dependencies and the bounded fixed-point worklist. These are the implementations
  extracted from current main's linker, not a second graph resolver.
- `linking/discovery.ts` now serializes the existing source context supplied by a
  typed `ManifestAnalysisAdapter`. It no longer executes a DOM allocator or imports
  DOM preparation. Component shapes, state keys, helper summaries, access readers,
  prop usages and forwarded identities still use their existing planners.
- `dom/project.ts` supplies the existing DOM intrinsic installation, full preparation,
  row resource classification and routed-preparation behavior. The browser linker
  invokes the shared project functions through this adapter.
- `linking/options.ts` returns shared `AnalysisOptions`, without changing option
  values. The public `CompiledApplicationRoot` remains an interface and extends
  the shared source graph root shape.
- Removed obsolete serializer callback indentation and unreachable optional
  manifest wrappers. Serialized expressions and their evaluation order are unchanged.
- Added six project-sharing contracts: reordered barrels/state/helpers/mounts through
  source-only and DOM adapters; host resolution and Windows IDs; comments/CSS and
  parse preparation; root uniqueness; bounded nonconvergence; transitive executable
  dependency refusal for DOM/emission/runtime modules.

No core runtime, optimized DOM list or user application files changed. The existing
fullstack edit remains outside this batch. No Rust crate or renderer is claimed by
source-only analysis tests.

### Decisions and corrections

| Decision | Reason |
| --- | --- |
| Preserve component-only bootstrap seeding across targets | This batch extracts main's behavior; broader alias seeding from GPUI would be a separate semantic change |
| Keep target row resource and route preparation facts explicit | A native adapter must not accidentally publish DOM lifetime optimizations or fabricate DOM ABI state |
| Reuse the exact worklist ordering and convergence guard | Preserve source ordering, helper propagation and current diagnostics |
| Preserve comments, CSS and original module IDs during collection | A host-neutral graph must retain the frontend product and bundler output identity |
| Compare the full compiler product against a pre-extraction bundle | Metadata and source maps matter alongside generated code |
| Check executable dependency edges separately from public option types | Browser initial-content option types remain public compatibility surface, while shared graph execution must not load a DOM backend |

The initial host-resolution fixture expected an access reader for an unwritten
state binding. It was corrected to exercise a real imported state writer and its
reader; no compiler change was made to satisfy that mistaken expectation. The
test frontend was given its required name, and the dependency walker uses the
existing generic AST node type. Final targeted contracts and Bun checking pass.

### Verification and evidence

- Six new project contracts and the existing semantic/backend contracts:
  **17 passed, 0 failed**. Source-only contexts have no DOM emission or reason allocator.
- Captured the pre-change compiler at the parent commit before editing. All **34
  project products match**, across both initial-content settings, all 15 tracked
  fixtures and the two valid linked state/barrel/mount/keyed graphs.
- All 30 historical single-module records still match main (15 distinct cases,
  including diagnostic captures; see the M1.2 baseline correction).
- Compiler package build passed. Compiler Bun checking passed in 236 files;
  checking the new tests/helper passed in 238 files. Oxlint and diff whitespace
  checks passed.
- The first full root run returned exit code 1: **2,557 passed, 1 timed out**,
  across 254 files. The unchanged Chromium markup test timed out after its ten
  assertions; the isolated original test reproduced that timeout. A temporary
  ignored diagnostic copy confirmed all assertions finished before waiting in
  `browser.close()`. That diagnostic run closed normally and passed in 55.76s,
  with browser process exit code 0. No browser assertion or timeout was changed,
  and no unrelated browser process was terminated. The subsequent one-worker
  root rerun resolved the final gate under reduced test load.
- `bun test --parallel=1 ./tests`: **2,558 passed, 0 failed**, exit code 0,
  across 254 files, 28 snapshots and 30,435 expectation calls, in 595.69s.
  This includes the unchanged Chromium contract as well as module linking,
  hydration, SSR, keyed rows, effects and core lifetime contracts. The earlier
  timeout remains recorded above; no test was skipped or weakened.
- The final package rebuild retains the public root interface in its emitted
  declarations. Bun checking and lint passed after that interface adjustment.
  No native build was run alongside the JavaScript suite.
- M1 is complete: the runtime core entry, shared semantic pass order and shared
  project coordinator have their plan gates. This does not mark any native document,
  window, event bridge or ref transport capability complete.
- The batch completion message reports its commit and exact verified remote SHA;
  source history is available with `git log -- packages/compiler/src/linking/project.ts`.

### Next batch

M2.1 will establish the pinned Blitz native document
foundation. Begin with template/node ownership, source-to-versioned-node identities,
comment-anchored ranges and validated mutations. Keep structural acceptance distinct
from completed layout/paint; do not add a separate cascade, paragraph tree or
reactivity engine. The mounted counter and reusable window workflow follow in M3.

## M2.1: pinned native document, identities and owned ranges

Completed batch: 2026-10-12.
Parent commit: `253a9b7b8351d4f688b25e4044055558d318b458`.
Full M2 remains in progress; this is the in-process document foundation.

### Scope and communication before editing

Communicated that the batch would add only the native crate under
`packages/desktop/rust`, its package README and updates to the existing wiki.
No compiler/runtime changes were needed. Before touching the existing `bun.lock`,
communicated the need for a valid Bun workspace and the constraint that its existing
dependency records must remain unchanged. The actual lock diff adds only the desktop
workspace and its workspace package identity, six lines in total.

### Implementation and reuse

- Added one `memoized-dom-desktop` library crate, pinning Blitz to
  `45496d9288b063719ebeae4e0761273f7881b3d7` and committing Cargo's resolved lockfile.
  Verified the fetched checkout's exact Git SHA. Default features are disabled;
  the current headless document enables system fonts. No GPUI, application wrapper,
  JavaScript engine, painter or window binary was added to this foundation.
- Added focused document modules for identities, validated templates, instances,
  mounting, writes, lifetime and failures. Source templates preserve qualified
  names/attributes and explicit parent indices. Mutable engine state is Blitz's
  tree; the host keeps source IDs and lifetime records, not a second rendered tree.
- Instances own start/end comment ranges, including empty and multi-root fragments.
  Element and region destinations remain tied to their source owner/generation.
  Reordering preserves native IDs and nested ranges within the same destination.
- Whole text/attribute write sets validate first. Missing generations, indices or
  node kinds refuse before opening a mutator, so earlier candidate changes and
  redraw requests remain unapplied. CSS stays ordinary engine input.
- Retirement calls Blitz's destruction API and clears descendant source records.
  Review caught an avoidable whole-registry scan; a reverse boundary index now
  clears only owners whose native boundaries were destroyed. Engine sibling-range
  lookup/removal costs remain separate and have not been benchmarked at scale.
- Live application and layout unwinds mark the document terminal; the next operation
  fails explicitly. A contract mutates native text then injects a failure, proving
  the host does not report that partial application as rollback.
- Added a private Bun workspace manifest with real native check/test/format scripts.
  Added the desktop README documenting actual record shapes, accepted operations,
  generation lifetime, native checks and the remaining boundaries. It exposes no
  new JavaScript application API.

The compiler, runtime, optimized DOM lists and unrelated fullstack edit remain
untouched. No application reactivity, access resolver or subscription mechanism
was reimplemented in Rust.

### Decisions and discovered engine behavior

| Decision | Reason |
| --- | --- |
| Use versioned Blitz IDs behind source owner/generation/index references | Reject stale source packets without exposing allocator slots as source identity |
| Use comment-delimited instance ranges | Preserve empty/multi-root fragments and region ownership without layout wrappers |
| Keep node kinds/names/topology validation ahead of live mutation | A later invalid write must not partially publish earlier candidate changes |
| Destroy on retirement and index owner boundaries | Release native allocations and nested lifetimes while avoiding an unrelated registry scan |
| Preserve generation marks until document disposal | Retired generations remain invalid when IDs or native slots are reused |
| Keep style/layout resolution explicit | Structural acceptance is distinct from a completed native frame |
| Keep headless contracts in one integration test target | Avoid an extra native test executable for each small ownership contract |
| Record cold dependency compilation separately from cached tests | Neither is a measurement of the planned application startup/refresh path |

The first test-target check caught string attribute lookups that need Blitz's
typed local names; those test lookups were corrected. The first native run had
one failing contract: it expected an input editor before layout construction.
Inspection of the pinned construction code showed that the editor is initialized
from the value attribute during resolution. The corrected contract retains its
editor assertion and verifies both pre-layout initialization and later editor
updates. No separate input editor or eager custom control initialization was added.
Dirty/default value distinctions, composition and revision ordering remain M4 gates.

### Verification and measurements

- Initial `cargo +1.96.0 check --manifest-path packages/desktop/rust/Cargo.toml
  --jobs 2` passed against the pinned library. Cold dependency check: **17m 08s**.
- Initial test-code compilation: **16m 10s**. That run passed the terminal-failure
  unit and 15 integration cases, with the pre-layout editor assumption failing.
  The corrected focused input test passed; its changed-target rebuild took 18.54s.
- Final `bun run --cwd packages/desktop native:test`: **17 native contracts passed,
  0 failed**, exit code 0. Cached build 2.30s; unit 0.04s and integration suite 0.50s.
  Verified templates, namespaces, stale generations, write-set refusal, input values,
  ordering, empty/nested range retirement and failure behavior.
- Headless layout contract passed on the real engine: CSS variable width 140px,
  second flex item at 150px; class update width 200px and second item at 210px;
  stylesheet text update gives the second item width 120px. Source IDs persist.
  This is native evidence, not a Chromium comparison or a visible window test.
- `cargo +1.96.0 clippy --manifest-path packages/desktop/rust/Cargo.toml --locked
  --all-targets --jobs 2 -- -D warnings` passed. Package `native:check` and
  `native:fmt` passed; the final cached native check took 6.58s.
- Bun frozen installation passed. The existing shared compiler/project/backend
  contracts passed: **17 tests, 0 failed**. No heavy native linking ran alongside
  the full JavaScript suite; no JavaScript production source changed in this batch.
- Whitespace checks passed. The completion message reports the batch commit and
  exact remote SHA; source history is under `packages/desktop/rust/src/document`.

### Next batch and remaining gates

M2.2 adds versioned packet decoding, ordered sequence acceptance and a prepared
transaction combining mount, write, move and retirement. Validate the complete
candidate ownership/topology before touching the live document, control outward
provider work and terminate the connection after ambiguous application failure.
Keep validation bookkeeping minimal and reuse these source/range operations;
do not serialize application expressions or build another reactive engine.

M2 is not complete until those gates pass. The normal TSX counter/window remains
M3, and synchronous cancellation/input revision ordering remains M4. There is no
Blitz app startup, first visible frame, JS/CSS refresh or event latency measurement.

## M2.2a — Ordered wire write-set acceptance

Completed implementation/checks: 2026-10-12. M2 remains in progress.

### Scope communicated before editing

Communicated the exact boundary: new protocol modules and contracts inside the
desktop Rust crate, its dependencies and the existing desktop/wiki documentation.
The batch adds versioned text/attribute packets, ordering and acknowledgments,
reusing the existing whole-write-set validator. Compiler, shared runtime, DOM
lists and the unrelated fullstack edit are untouched. Mixed structural publication
was explicitly left as a separate gate rather than claimed complete.

### Implementation and decisions

- Added separate wire, session and error modules. The decoder accepts only known
  versioned JSON fields and text/setAttribute/removeAttribute operations. It
  preserves qualified names and passes source references to the existing document
  validator; it does not implement another access resolver or scene tree.
- Limits are 1 MiB packet bytes, 4,096 writes and 256 UTF-8 bytes per owner ID.
  Sequence/generation counters use the JavaScript safe-integer range. Source
  indices use the existing unsigned 32-bit source identity. Explicit attribute
  removal avoids interpreting a missing/null set value as deletion.
- One `PublicationSession` owns its document without a mutable escape hatch.
  Sequences begin at 1 and advance only after complete native application. Empty
  accepted sets advance ordering without redraw; duplicates and gaps do not
  apply. An ordinary refusal leaves the sequence available for correction.
- Acknowledgments serialize version/sequence/status and establish structural
  acceptance only. They do not claim a resolved layout or painted frame.
- Ambiguous application failure closes the session, returns unknown acceptance
  and prevents replay. The unit contract performs a real native text write before
  injecting an application failure and verifies the changed text remains while
  the sequence does not advance. The existing document unwind contract separately
  verifies terminal behavior after an actual panic during live application.
- Explicit close prevents replay after a lost acknowledgment. The future process
  driver still must fail its pending jobs and terminate/drop the connection;
  this batch does not fabricate an OS transport or pending-job queue.
- Protocol integration tests share the existing real engine fixtures through a
  separate test module in the same integration executable. Existing document
  contracts remain intact.

The first offline dependency resolution unintentionally downgraded existing
Serde/pkg-config records. That was corrected before final verification: existing
locked package versions remain unchanged. Cargo's locked/offline check accepted
the final graph; its diff adds the direct dependency edges and only two package
records, serde_json and zmij. No existing dependencies were upgraded/downgraded.

### Verification

- Final `bun run --cwd packages/desktop native:test`: **28 passed, 0 failed**,
  exit 0 (3 unit and 25 integration contracts). The changed crate/test rebuild
  took 37.55s; unit execution 0.11s and integration execution 1.98s. These are
  test-build/execution measurements, not application startup measurements.
- New wire coverage verifies full application before acknowledgment, retained
  native IDs, one redraw per nonempty accepted set, empty-set ordering,
  duplicate/gap rejection, late-reference refusal without earlier writes/redraw,
  correction/retry, wrong node kinds, stale owners, invalid attributes, strict
  decoding, byte/write limits, safe integers, namespace preservation, final
  sequence exhaustion and terminal-session replay refusal.
- `cargo +1.96.0 clippy --manifest-path packages/desktop/rust/Cargo.toml
  --offline --locked --all-targets --jobs 2 -- -D warnings`: passed.
- Package `native:fmt` and `native:check`: passed. Final native check 2.72s.
- No JavaScript production files changed; no full JavaScript suite was repeated
  alongside native linking. Existing real engine ownership/layout/input contracts
  all pass in the native suite.

### Remaining gates and next batch

M2.2b needs a complete prepared transaction across mount/write/move/retire, with
minimal staged affected ownership/topology records checked before any live
mutation. Process framing must bound buffering before decoding, provider control
must prevent candidate side effects, and the driver must propagate fatal/lost-ack
failure to pending work. None of those gates is marked complete by this codec.

The ordinary mounted TSX counter and visible window remain M3. Compiler/runtime
authoring and the web target did not change. Commit/remote status is reported
after the batch's checks and source-history publication.

## M2.2b — Complete native candidate topology validation

Completed implementation/checks: 2026-10-13. M2 remains in progress.

### Prior boundary communication and implementation

Communicated before editing that only the desktop native document layer would
change: shared node-kind checks, a temporary affected-owner overlay and the live
application guard. Existing compiler/runtime/web/list behavior is untouched.
Communicated adjacent-write grouping before adding its shared iterator path.

- Added `Operation` and `NativeDocument::transact`. The complete authored order
  validates before any live mount/write/move/retire. Newly mounted sources can
  supply later write and element/comment-region destinations in the same batch.
- Candidate bookkeeping contains only new/retired owners, changed generation
  marks and new mount containment edges. Live source kinds/ranges come from the
  engine. Retirement traverses only the affected native range through the existing
  reverse boundary index; it does not scan or clone the whole owner registry.
- Same-destination moves retain containment and native identity. Parent retirement
  invalidates live and candidate descendants, including empty/region instances.
  A newer generation mounted outside a retired parent survives that retirement.
- Name/kind validation is shared with ordinary writes. Adjacent transaction writes
  prepare through the existing mutation path without copying values and flush one
  mutator in authored order.
- Application reuses the established native operations. The unwind guard preserves
  an inner failure rather than clearing it on an outer return. Any unexpected
  error after complete validation makes the document terminal; a real injected
  shell failure leaves a partially applied text write and refuses all later work.

### Evidence and remaining boundaries

- First native run: **39 passed, 0 failed**. After adjacent-write grouping, final
  `bun run --cwd packages/desktop native:test`: **40 passed, 0 failed**, exit 0
  (3 unit, 37 integration). Changed-target rebuild 17.29s; execution 0.09s unit
  and 1.55s integration. Existing real engine/layout/input/wire contracts pass.
- New contracts verify whole-batch refusal with no allocation publication,
  generation consumption or redraw; same-batch destinations/writes; mixed moves
  and retirement; live/candidate descendant invalidation; old-generation rejection;
  outside replacement survival; invalid/self-containment destinations; one mutator
  for adjacent writes; and terminal failure during actual native application.
- All-target locked/offline Clippy with `-D warnings` passed. Format/native checks
  and source whitespace checks are included in the completion verification.
- No JavaScript production changes, dependency changes or full JS-suite repeat.
  The unrelated fullstack edit remains unstaged.

Structural operations still use individual established mutators. Controlled
redraw/resource providers are a remaining M2 gate; this batch does not claim one
flush or fully contained outward work for every mixed batch. M2.2c connects the
native transaction validator to versioned structural packets and acceptance.
Process framing/failure propagation remains subsequent M2 work. There is no
window or ordinary mounted application yet. Commit/remote status is reported
after publishing this tested batch; continuation proceeds without a go-ahead.

## M2.2c — Structural wire publication and immutable template acceptance

Completed implementation/checks: 2026-10-13. M2 remains in progress.

### Prior boundary communication and decisions

After publishing M2.2b, communicated continuation into the desktop protocol only:
structural packets use the native transaction validator, and immutable template
declarations become accepted only with their successful complete batch. No shared
compiler/runtime/list or application-authoring change was required.

- Split operation conversion, immutable templates and wire identities into focused
  modules. Decoding remains bounded/versioned; native template and transaction
  validators remain the authorities for source and ownership/topology checks.
- `operations` accepts text/attribute, mount, move-before, move-to-end and retire.
  The initial `writes` spelling remains an alias; both spellings together refuse.
- Optional template declarations carry source records keyed by immutable identity.
  Later instances reference accepted keys without resending nodes. Existing keys
  cannot be overwritten, and duplicate candidate keys refuse. Changed source must
  have a new key. This is a presentation-template registry, not application access
  routing or a second state system.
- Candidate declarations validate before application. Accepted registry capacity
  is reserved before live work; entries advance only after the complete native
  batch succeeds. Ordinary refusal advances neither declarations nor sequence.
  Templates live until session disposal; reload/cache lifetime remains an M8 gate.
- An actual injected shell failure during a wire mount proves unknown acceptance,
  terminal document/session state, no accepted declarations and no retry. The
  partially applied engine text remains visible to inspection; no rollback claim.

### Verification and corrected failure

- First run: 3 unit passed, 44 integration passed, 1 integration failed. The new
  strict destination test found Serde ignored extra fields on an internally tagged
  unit variant despite `deny_unknown_fields`. Replaced the body destination with an
  empty struct variant and retained the strict rejection contract.
- Corrected final `bun run --cwd packages/desktop native:test`: **48 passed,
  0 failed**, exit 0 (3 unit, 45 integration). Rebuild 20.72s; execution 0.09s
  unit and 1.69s integration. Existing write-set, ownership and real layout/input
  contracts still pass.
- New structural wire evidence covers accepted template reuse, retained native IDs
  during keyed order changes, all-or-nothing refusal before native publication,
  template immutability/topology, new element/region destinations, nested retirement,
  strict fields/alias duplication, safe generations, replacement refusal/correction
  and closure after actual partial native application.
- All-target locked/offline Clippy with warnings denied, package format/native
  checks and whitespace verification are completion gates. No dependencies or JS
  production files changed. The unrelated fullstack edit remains unstaged.

M2 still needs bounded process framing, controlled shell/resource providers and
transport fatal/lost-ack failure propagation. The codec/session remains in process,
with no mounted TSX/window claimed. Source publication is reported with exact
remote verification; autonomous continuation proceeds into the remaining boundary.

## M2.2d — Bounded framing and lost-acknowledgment closure

Completed implementation/checks: 2026-10-13. M2 remains in progress.

Communicated the exact protocol-only boundary before editing: bounded length
prefixes, allocation limits and automatic session closure if acceptance cannot be
sent. Blocking I/O is explicitly separate from the future native UI event loop.
Compiler/runtime/list code, dependencies and application authoring are unchanged.

- Added one framing module: four-byte unsigned big-endian length, followed by
  1..1,048,576 JSON payload bytes. The reader checks length before allocation,
  handles split/interrupted reads and treats partial frames/I/O errors as terminal.
  Clean EOF is allowed only at a frame boundary. There is no guessed resynchronizing.
- The writer bounds serialization memory and emits no prefix for local size/
  encoding refusal. Write/flush errors close it after I/O begins. No unrestricted
  intermediate JSON buffer bypasses the outgoing byte limit.
- `publish_to` sends structural acceptance after native application. A reply stream
  already known closed prevents application. Failure sending acceptance closes the
  session and returns unknown-acceptance diagnostics; no native scene replay.
- Kept framing separate from scene ownership and from platform scheduling. The
  public blocking adapters are for workers/headless contracts, not UI-thread waits.
  Real driver refusal replies, worker queues and pending-job disposal remain gates.

Final native suite: **57 passed, 0 failed**, exit 0 (3 unit, 54 integration).
Changed-target build 46.46s; execution 0.09s unit and 1.84s integration. New evidence
covers adjacent frames, one-byte reads/interruptions, UTF-8/newlines, truncated
prefix/payload, invalid lengths before payload reads, exact capacity, local
oversize refusal without bytes, bounded outgoing JSON, prefix/payload/flush
failure, known-closed preflight, lost acknowledgment after a real wire mount,
and one correctly framed acceptance reply. Existing real native contracts pass.

All-target locked/offline Clippy with warnings denied, format/native checks and
whitespace verification are completion gates. No full JS suite was repeated,
and the unrelated fullstack edit remains unstaged. Commit/push and exact remote
status are reported after verification. M2 still needs controlled providers and
the actual process/UI transport driver before being marked complete.

## M2.2e — Native provider containment and shutdown

Completed implementation/checks: 2026-10-13. M2 remains in progress.

### Inspection and prior boundary communication

Inspected the pinned shell/net traits and actual mutator flush/resource calls,
including redraw, title, image/stylesheet fetch and focus/blur IME changes.
Communicated the desktop-only boundary before edits: provider wrappers, the
existing native application guard and session shutdown. Communicated the direct
already-locked cursor type dependency required to forward the full shell trait.
Compiler, runtime, optimized DOM lists and application authoring are unchanged.

### Implementation and decisions

- Added focused provider gate, net and shell modules. Each document has its own
  Idle/Held/Failed state. Nested operation guards release only at the successful
  outer boundary; there is no application state, access routing or CSS parser here.
- Resource requests and redraw/title/cursor/IME changes are held during protected
  application. Final settings release with one redraw. Provider callbacks run
  outside the mutex; synchronous imports/redraw callbacks remain contained.
- A total 4,096-request budget covers queued and reentrant work in one application.
  Overflow is terminal rather than dropped or looped indefinitely. Failure discards
  queued handlers outside the mutex and recovers poison before late callbacks.
- The complete shell trait forwards capabilities outside publication. Unexpected
  synchronous interactive work during scene application fails explicitly; accepted
  input/default handling still needs its M4 boundary. No clipboard/dialog stand-in
  was invented for a live integration.
- Net `is_noop` behavior is forwarded to preserve critical-resource accounting.
  Aborted queued requests do not start. Default document-owned abort signals are
  signaled on failure/close/disposal. Supplied signals remain caller-owned; the
  document does not abort another scope's shared controller.
- Unexpected prepared-operation errors mark failure inside the guard before any
  provider release. Session closure also cancels provider work. Native disposal
  suppresses late callbacks. Already dispatched work cannot be rolled back;
  cancellation depends on the backend honoring abort signals.
- The existing platform-failure contract now verifies failure at final release:
  both the write and retirement finished before redraw failed. Its node is gone
  and acceptance remains unknown/terminal. The separate real nested-mount unwind
  test verifies a partially applied native tree with zero escaped provider work.

Cargo adds only a direct `cursor-icon` dependency edge at the existing locked
1.2.0 version; no package record or dependency version changed. No Bun lock change.

### Evidence and remaining gates

- Final `bun run --cwd packages/desktop native:test`: **69 passed, 0 failed**,
  exit 0 (11 unit, 58 integration). Changed-target build 24.12s; execution 0.21s
  unit and 2.09s integration. These are test measurements, not app startup.
- New evidence covers nested containment, real image/title flushes, one redraw,
  final title, late refusal without platform/resource work, actual live-mount
  unwind, shutdown abortion/caller ownership, cursor/IME/live query forwarding,
  no-op identity, reentrant dispatch without deadlock, total budget failure and
  poisoned-lock recovery. Existing real layout/input/wire/frame contracts pass.
- All-target locked/offline Clippy with warnings denied, package format/native
  checks and staged whitespace verification are completion gates. No full JS suite
  was repeated or run beside native linking; no JS production source changed.

The native provider gate is complete for this protected publication surface.
Real process launch, bounded UI/worker queues, refusal responses and pending-job
teardown remain M2 work. Asset loading, native input/defaults and a mounted TSX
window are not claimed by these tests. Preserve the unrelated fullstack edit.
Commit/push and exact remote verification follow this tested batch.

## M2.2f — Bounded native worker driver and real process contracts

Completed implementation/checks: 2026-10-13. M2 remains in progress.

### Boundary communicated before implementation

Communicated the desktop-only Rust driver, response codec and private headless
host mode before edits. The existing session gains only an immutable expected
sequence accessor. No compiler, shared runtime, web output, DOM list or application
authoring change was needed. The single native crate now has its planned one host
executable; a separate headless binary was not introduced.

### Implementation and decisions

- Reader/writer workers own blocking pipe I/O. The document/session stays on its
  owning thread. Nonblocking polling handles at most eight publications per turn;
  a supplied wake callback schedules work rather than using a polling timer.
- The reader bounds its queue to eight complete frames plus one frame held while
  waiting for capacity. Closing drops the receiver to release queue backpressure.
  All frame payloads retain the existing pre-allocation 1 MiB bound.
- Eight reserved reply slots include the writer's in-flight reply. Reserve before
  applying a packet; when full, pause native admission. Successful flush releases
  capacity and wakes admission. A stalled healthy peer does not force a lost
  acknowledgment, growing memory, blocking UI work or a scene replay.
- Responses preserve the accepted envelope and add explicit versioned refusal/
  fatal envelopes. Stable codes drive machine decisions; untrusted diagnostics
  are capped at 512 characters. Invalid JSON gets the expected correctable slot,
  never an unvalidated guessed sequence. The future client must match responses
  to its outstanding serialized requests.
- Live application failure sends a fatal reply when transport is available and
  closes admission. Stream errors and worker panics wake/close the session and
  cancel provider work. A failed reply stream cannot guarantee a fatal reply;
  the client must fail pending jobs rather than replay possibly applied state.
- Frame-boundary EOF follows queued packets, then drains replies. Driver disposal
  never joins workers on the document/UI thread. Generic streams cannot interrupt
  blocked OS syscalls; process ownership must close/terminate an unresponsive peer.
  The explicit blocking writer join is restricted to headless termination/tests.
- The private `--headless` mode runs this driver through stdin/stdout. It is a
  contract harness, not a mounted application API. Cargo tests launch the actual
  cached host executable with pipes; no JSON demo is presented as ordinary TSX.

### Evidence and remaining gates

- Final locked/offline native suite: **79 passed, 0 failed**, exit 0 (11 unit,
  68 integration). Changed-target build 58.96s; execution 1.10s unit and 6.30s
  integration. Initial host/binary test build 1m32s; these are build/test times,
  not measured window startup or TSX refresh latency.
- Ten new driver contracts cover refusal/correction, out-of-order replies, real
  process template reuse/EOF drain, lost acknowledgment after real native mount,
  invalid framing, native platform failure/fatal reply, bounded stalled-writer
  admission/resumption, blocked-reader close, worker panic wake and bounded
  untrusted diagnostics. Existing real native layout/input/transaction checks pass.
- All-target locked/offline Clippy with warnings denied passed (14.61s). Package
  native/format checks and staged whitespace validation complete the batch gates.
  No JavaScript production source changed, so no full JS suite was repeated or
  run beside native linking. Cargo/Bun dependency versions and locks are unchanged.

Next: the Bun process client, bounded pending-job ownership/failure and host startup/
shutdown contracts, then compiler emission and normal TSX/CSS mount in the native
window. Native event-loop wiring, visible painting, input cancellation/revisions,
asset loading and dev refresh remain unclaimed. README/research reflect this
boundary; preserve the unrelated fullstack edit. Commit/push and exact remote
verification follow the tested batch.

## M2.2g — Portable publication client and selectable execution backend

Completed implementation/checks: 2026-10-13. Compiler/window integration remains.

### Authorization and boundary communicated first

The user selected Bun as the default and requested switchable execution engines.
Communicated the desktop JavaScript client, build/launch selection and adapter
boundary before implementation. Compiler semantics, runtime/core and optimized
DOM lists are unchanged. Bun/Node process APIs stay outside the portable client.

The original repository checkout was on `codex/jsx-type-coverage` with substantial
staged user work. Created an isolated Git worktree on `codex/blitz-renderer` at
`C:/Users/babyface/Documents/Codex/2026-10-13/continue-with-the-bu-n-like/memoized-dom`.
The app worktree helper could not operate from the projectless chat directory;
ordinary Git created the checkout without switching or altering the user's files.

### Implementation and decisions

- Added explicit presentation protocol types, strict reply validation, portable
  candidate serialization and a bounded publication client. These records carry
  scene operations only; no state-cell store, access resolver or subscription
  bridge was added. Rust remains the topology/identity validation authority.
- Snapshot candidate payloads before enqueue; default capacity is eight including
  the active job. Operation/UTF-8 bounds refuse before I/O. One active publication
  owns its sequence until matching acceptance and write completion both arrive.
  An early reply cannot hide a later write failure.
- Refusal rejects dependent queued candidates without advancing the expected
  slot. A corrected publication can reuse it. The semantic adapter recomputes
  candidate work; this client never retries or rebuilds application state.
- Fatal/malformed/out-of-order replies, connection loss and per-job deadlines
  reject pending jobs and dispose the owned host. Deadline identity guards against
  a failed custom cancellation closing a later job. Synchronous adapter failure
  cannot send after close; cleanup exceptions cannot strand pending promises.
- Bun and Node share one Node-compatible process adapter. Framing retains one
  bounded reply payload, validates prefixes before allocation and treats partial
  EOF/UTF-8/JSON failure as terminal. Stderr retains a bounded tail. Native process
  spawn uses hidden Windows console startup; transport close destroys streams and
  requests native termination without blocking JavaScript.
- Execution configuration defaults to Bun or accepts Node/custom backend records.
  Custom backends declare executable arguments, ESM/CommonJS format and a host
  adapter module, with explicit bundler target/externals where needed. Commands
  use argument vectors without shell interpolation.
- The execution bundler resolves the selected private host import to that module.
  It does not inject other backends or transform compiler semantics. A separate
  custom adapter/CommonJS fixture proves selection is used during real execution.
  Bun remains the development bundler/test tool regardless of execution engine.
- QuickJS and other engines can supply the same transport adapter. A ready-made
  QuickJS adapter is not included or claimed tested. Selecting a name cannot
  invent Node APIs; unsupported custom strings refuse with an actionable error.
  Normal mount authoring remains the product contract, with M3 integration next.

### Actual evidence

- Frozen Bun installation succeeded without dependency/lock changes.
- Native host built locked/offline with `cargo +1.96.0`, jobs 2, in **7m17s** in
  this fresh checkout. No full JS suite ran beside native linking. Subsequent
  process tests reused that executable and did not invoke Cargo.
- Final portable JS contracts: **25 passed, 0 failed**, exit 0, 203ms.
- Final real process contracts: **6 passed, 0 failed**, exit 0, 1.77s. Bun and Node
  execute the same entry against the same native host; the separately selected
  custom CommonJS adapter records its actual invocation. Refusal/correction,
  accepted sequence order, missing executable, native exit and direct-write
  timing/framing contracts pass.
- The direct-write check caught Bun's synchronous small-write completion versus
  Node's potentially pending callback. The final test verifies both permitted
  outcomes against real native accepted frames instead of assuming callback timing.
- Package Bun checking passes all 15 checked source/test files. Focused Oxlint
  passes. Native formatting and staged whitespace are final batch checks.
- A browser-target bundle of the portable client contains no Bun/Node platform
  imports. Existing compiler/runtime/Rust source and Cargo/Bun locks are unchanged;
  the full root/native suites were not repeated for this desktop-only JS batch.

Updated the single canonical research, concrete plan and desktop README.
Next is desktop compiler emission, accepted core lifecycle and normal TSX/CSS
mounting in the native window. No visible window, QuickJS compatibility, production
packaging size or startup/event-latency benchmark is claimed by these contracts.
Commit/push and exact remote verification follow the tested batch.
