# Complete the compiler separation and reduce browser work

## Current checklist

Baseline: `7abcf55`. All five areas remain open. Existing initial HTML binding
is a foundation, not completion of the compiler or runtime rearchitecture.

| Order | Area | Status | Completion gate |
| --- | --- | --- | --- |
| 1 | Analysis and DOM backend separation | In progress | Shared facts independent of backend imports; replaced implementations removed; behavior verified |
| 2 | Fixed cost of interactivity | Open | Production bundle savings and capability isolation verified across local, lazy and routed applications |
| 3 | Reactivity precision | Open | Correct visible updates and demonstrated exclusion of unrelated row/slot work |
| 4 | List execution costs | Open | Correctness, retained identity and disposal pass; paired timing supports each claimed gain |
| 5 | Composition and delivery coverage | Open | Initial delivery and subsequent interaction verified with shared factories, graph and lifetimes |

This is the execution checklist. Detailed historical evidence remains in
[Compiler phase boundaries](./compiler-architecture.md),
[Browser JavaScript architecture](./browser-bundle-architecture.md),
[Performance work](./performance-work.md) and
[Merged delivery audit](./merged-delivery-audit.md).

## Architecture boundary

Use `packages/compiler/src/dom/` for DOM-specific planning, lowering and emission:

- Move node creation, templates, attributes, DOM-only row eligibility, initial
  node addresses, adoption, DOM factory ABI and DOM runtime imports there.
- Keep authored JSX structure, lexical bindings, reads/writes, derivations,
  async provenance, callback behavior and ownership requirements in shared
  analysis/planning.
- Separate shared structural facts from HTML-specific shape validation and
  serialization. HTML delivery code belongs to the HTML/DOM backend.
- Split analyzed program facts from mutable backend state. Generated identifiers,
  numeric runtime reasons, headers and output buffers belong to the backend.
- Check import boundaries: shared analysis/planning must not import DOM/backend
  modules or DOM runtime types, including indirectly through a context facade.
- Move producers and consumers together and delete former implementations.
  Keep no compatibility facades, mirrored fields or second compiler path.

Future mobile/desktop targets are outside these batches. Preserve the existing
DOM and SSR behavior while making shared contracts usable by another target.

## 1. Finish analysis and backend separation

- Capture remaining native-event, helper and normalization callback contracts
  before lowering.
- Give mutation journals explicit shared source/write contracts; allocate journal
  bindings and runtime reasons in the DOM backend.
- Separate module semantic normalization and validation from generated imports,
  headers and module finalization.
- Preserve lexical identity and authored evaluation order across transformations.
  Backend publication results must be explicit inputs, not mutations to shared facts.

Completion: dependency checks pass, migrated consumers use shared contracts,
former implementations are removed, representative generated behavior is unchanged.

## 2. Reduce the fixed cost of interactivity

- Audit retained code in static, counter, input/list, fetched and routed/Group fixtures.
- Make local-only updates independent of the module access resolver; retain one
  scheduler and ownership engine.
- Isolate optional adoption, request restoration, routing and opaque polling.
- Intern graph-known state keys at linking time with deterministic build-wide
  numeric IDs, including lazy modules. Conservative dynamic resolution remains
  an optional capability where exact targets cannot be proven.
- Share dynamic initialization/update emission only when evaluation order,
  getter calls and adoption semantics are preserved.

Completion: production audits show targeted savings; static delivery stays zero
JavaScript; lazy loading, multiple applications and routed/request flows pass.

## 3. Improve reactivity precision

- Carry exact sources, affected keys, structural/content changes and callback
  completion information into backend update plans.
- Extend targeting across aliases, component callback props, module state and
  component-row props where proof is available.
- Restrict opaque polling to affected work when dependencies can be established;
  preserve conservative updates for hidden reads and unknown mutations.
- Preserve writable bindings, exceptions, deferred callbacks and mixed causes.

Completion: independent authored regressions verify visible updates; instrumentation
shows unrelated rows/slots are skipped in newly supported cases.

## 4. Reduce list execution costs

- Profile creation, replacement, removal, clear, swap, rotation and reverse separately.
- Reduce unnecessary retained-row replay, closure/event setup and DOM-range work
  using batch 3 contracts.
- Preserve key evaluation, index refresh, cleanup and interrupted-frame recovery.
- Compare component/inline rows, module/component state and mutable/immutable
  operations; retain pinned Octane and compiler-generated adapters.

Completion: identity, text, classes, order and disposal pass after every operation;
paired measurements support each performance claim.

## 5. Finish composition and delivery coverage

- Extend ownership/publication contracts to structural caller slots, JSX render
  props and escaping render values.
- Support remaining initial-delivery shapes with the same factories and lifetimes.
- Verify routing, Group, pending/error states, retry, navigation, refs and cleanup
  together with composition.
- Remove superseded creation/adoption scaffolding replaced by unified contracts.

Completion: production browser tests cover initial delivery and later interaction,
without duplicate graphs, ownership engines or obsolete implementations.

## Verification and commit rules

- Use stable authored fixtures; never read test sources from examples or manually
  edit compiled output.
- Run builds and browser benchmarks serially on this machine.
- Each batch requires focused regressions, affected builds, type checking and
  boundary/lint checks.
- Compare production bytes with the preceding batch using identical fixtures
  and explicit compiler/runtime isolation.
- Performance changes require paired DOM measurements and relevant Octane cases;
  noisy results are inconclusive, not a CPU gain.
- Validate selection → reorder → remove → append and retained identity outside timing.
- Commit coherent verified sub-batches. Record commits, removed code, results and
  remaining limitations here before marking an area complete.
- Consolidate VM verification after local gates; VM availability does not block work.

## Defaults

Preserve public authoring APIs; update internal compiler/runtime contracts together.
Leave dependencies, personal examples and numbered documentation untouched.
Correct stale architecture checkpoints while retaining historical measurements.
An item is complete only when implementation, cleanup and verification pass.

## Batch evidence

### DOM directory and source context sub-batch

Parent: `a09eded` (the saved execution checklist). Area 1 remains in progress.

- Moved DOM program coordination/finalization, node/region emission, component
  ABI builders, refs, attributes/SVG handling, native HTML shape proofs and
  initial address/delivery planning into `src/dom/`; removed their former files.
- Shared context no longer allocates DOM output state or host plans. Shared
  initial-content types/source identities have their own planning module.
- Stable-source replay analysis now records an authored call contract; runtime
  calls are lowered in the DOM backend. Render-prop identity lookup is shared.
- Added the shared analysis/planning/context import guard and a source-only
  context construction check. No compatibility re-exports were added.
- Compiler build, root type checking and changed-source lint passed.
- Full root run: 2,427 passed, five failed. Four failures were stale expectations
  or a former helper import already present in the baseline; one import needed
  updating after extracting render-prop identity. All five were addressed, and
  the eight affected suites passed 114 checks afterward. The entire root suite
  was not rerun after those corrections.
- Compared 124 source-compiler cases with `a09eded`: emitted code, initial plans
  and delivery contracts were identical. Six paired production SSR fixtures
  retained identical HTML/payload/raw/gzip bytes, including zero-JS static,
  counter (8,613/3,483 B), todo (17,140/6,443 B) and routing/Group.
- Replaced an obsolete closed nested-slot fallback assertion with a real DOM
  test covering initial binding, keyed reversal, hide/recreate and stable host identity.

### Source causes and backend allocation (parent `352f1d0`)

- Shared analysis now collects symbolic source causes. The DOM backend alone
  allocates sorted numeric runtime reasons after analysis. Structural replay
  contracts carry source names rather than runtime indices.
- Moved callback instrumentation/publication storage and reason lookup out of
  shared context. Deleted its former numeric allocator/lookup implementation.
- Type checking, compiler build and lint passed. Eight affected suites passed
  128 tests, including source-only construction, deterministic allocation,
  structural/content writes, effects and selective slot updates.
- Compared 123 stable fixture/target combinations with `a09eded`: generated
  code, graph metadata, initial plans and delivery contracts were unchanged.
  Source maps were excluded; the earlier replay relocation changes mappings
  for two request-rebinding fixtures without changing emitted behavior.

Next in area 1: extend authored callback contracts to native events and
remaining normalization; finish explicit journal/ownership inputs.
These are prerequisites for the runtime-size and broader precision batches.
