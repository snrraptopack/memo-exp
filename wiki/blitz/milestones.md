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
| M2 — Native document/transactions | Not started | No Blitz native crate exists yet |
| M3 — Ordinary native counter | Not started | No desktop compiler/mount integration exists yet |
| M4 — Events and input | Not started | Upstream API inspected; process integration not tested |
| M5 — Modules and structural parity | Not started | Core implementations available; native adapter not built |
| M6 — CSS/browser parity | Not started | No Blitz application fixture measured |
| M7 — Refs/libraries/lifecycle | Not started | Capability plan only |
| M8 — Dev workflow and evidence | Not started | No Blitz build/startup/input timings recorded |

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
