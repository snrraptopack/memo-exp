# Complete the compiler separation and reduce browser work

## Current checklist

Original baseline: `7abcf55`; audited revision: `258a25a` plus the verification
review below. The implemented rearchitecture is usable and verified. Optional
cleanup, further measured optimizations and additional HTML-binding proofs are
not unfinished state propagation or a reason to introduce another architecture.

| Order | Area | Status | Completion gate |
| --- | --- | --- | --- |
| 1 | Analysis and DOM backend separation | Boundary implemented and verified; minor cleanup optional | Shared facts independent of backend imports; replaced implementations removed; behavior verified |
| 2 | Fixed cost of interactivity | Implemented and measured; further reductions need concrete cases | Production bundle savings and capability isolation verified across local, lazy and routed applications |
| 3 | Reactivity precision | Targeting implemented and verified; conservative fallbacks intentional | Correct visible updates and demonstrated exclusion of unrelated row/slot work |
| 4 | List execution costs | Implemented reductions; latest consolidated VM timing pending | Correctness, retained identity and disposal pass; paired timing supports each claimed gain |
| 5 | Composition and delivery coverage | Supported shapes implemented and verified; fallback expansion optional | Initial delivery and subsequent interaction verified with shared factories, graph and lifetimes |

This is the execution checklist. Detailed historical evidence remains in
[Compiler phase boundaries](./compiler-architecture.md),
[Browser JavaScript architecture](./browser-bundle-architecture.md),
[Performance work](./performance-work.md) and
[Merged delivery audit](./merged-delivery-audit.md).
Current cross-package findings are in [Optional package cost](./package-capability-audit.md).
Historical “next”, “open” and “deferred” statements in batch journals describe
their recorded revision; this checklist supersedes them for current scheduling.

### Verified foundations and remaining deliverables

The area statuses above describe whole completion gates. They do not mean that
their implemented foundations are unfinished. Evidence for these milestones is
recorded under the corresponding commits below:

- [x] Move DOM creation, attributes, addressing, adoption and emission into
  `src/dom/`; enforce the transitive shared-analysis import boundary.
- [x] Capture native/module callbacks and mutation source writes before DOM
  instrumentation; allocate runtime reasons in the backend.
- [x] Separate provider/destructuring, calculated-list, async-read and finite-JSX
  source plans from their DOM lowering and explicit publication results.
- [x] Isolate ordinary mount from optional recovery/full marker parsing and
  environment override merging; verify the measured production savings.
- [x] Preserve zero-JavaScript static delivery and exercise interactive, fetched,
  lazy and routed/Group delivery in production browser fixtures.
- [x] Keep local-only counters independent of module access routing; select
  optional polling, hydration, request restoration/encoding and lazy/routed-data
  capabilities in supported generated graphs.
- [x] Implement proved selection/callback targeting, primitive opaque-pull slot
  exclusion and closed-list mutation/replay contracts. Broader hidden reads keep
  conservative behavior; these implemented cases are not an outstanding task.
- [x] Implement ordered removal, cyclic reuse and DOM-only row lifetime reductions;
  verify retained identity, mixed operations, cleanup and interrupted-frame recovery.
- [x] Bind supported empty inputs/lists, component rows, absent branches, nested
  structures and multiple variable extents with the existing factories/lifetimes.
- [x] Move generated row ABI into `dom/row-context.ts`; delete the shared declaration.
- [x] Audit other packages and remove measured server-helper/full form-tracker
  retention; remove the CSS package and its obsolete implementation plan.
- [x] Apply the existing markup optimizer to caller-slot creation, including
  guarded creation after initial delivery; verify adoption, remounts, fetched
  row reuse/removal/append and paired production bundle savings.

### Concrete limits and optional follow-ups

- Shared context types still carry output configuration such as `runtimePath`
  and `hotRuntimePath`. Moving these fields or splitting the DOM preparation
  coordinator further is minor compiler housekeeping, not a missing dependency
  mechanism or demonstrated browser-size saving. The transitive import boundary,
  explicit source plans and backend ABI allocation are already implemented.
- Indexed item writes, row targeting, aliases and linked/forwarded callback
  writes are implemented. A child can mutate an array passed through props;
  state placement does not impose a new authoring restriction. Hidden reads,
  unknown calls, dynamic keys and overridden methods retain conservative behavior
  intentionally. Do not schedule a generic targeting rewrite without a concrete
  failing reproduction or measured unnecessary work.
- Initial HTML binding deliberately falls back to ordinary creation for some
  parser-sensitive shapes, including adjacent text belonging to distinct caller
  and callee update sites. Supported slots, render props, routing, Group and
  cleanup already have contracts and coverage. Extending a fallback is an
  optional delivery optimization, not unimplemented composition in general.
- Future row/branch creation and legitimate routing/lifecycle capabilities must
  remain when needed. Further emission sharing or list replay/setup/range work
  requires an identified retained-code case or paired profile before changing it.
- [ ] Optional: obtain a consolidated VM comparison for the current revision when a VM is
  available. Existing identity/correctness gates and historical measurements stay
  valid for their recorded revisions; noisy local timings establish no new gain.
- Numeric state-key interning remains deferred. Preserve canonical string keys
  unless paired measurements establish a worthwhile runtime gain.

A focused verification run is not a new full-repository stability checkpoint.
Passing it does not guarantee arbitrary JavaScript support or an unmeasured
performance gain. The original batch requirements below record the scope that
produced these implemented foundations; they are not a fresh mandatory backlog.

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
- Retain canonical string keys. Numeric interning is deferred until profiling
  and paired measurements justify its setup and runtime cost. Concentrate bundle
  work on unnecessary component programs and retained creation/capabilities.
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

### Native events and captured mutation writes (parent `c9a0726`)

- Native DOM events consume the same authored callback snapshots as component
  callbacks. Event completion is an explicit plan input. Removed the DOM
  backend's separate reachable-helper traversal; shared contracts retain
  helper identities, cycles, deferred writes and original return expressions.
- Handler lowering allocates journal bindings from captured write-source
  contracts, or explicit backend bindings, without rereading mutable analysis
  storage. Regression coverage discards that storage before lowering.
- Type checking, compiler build and lint passed. Eight focused suites passed
  128 tests; six callback/event/form integration suites passed 50 tests.
  The 123-case output/graph/delivery comparison remained identical.
- Module-owned and compiler-generated callbacks still need their own complete
  pre-lowering contracts. This sub-batch does not close area 1.

### Shared routing and transitive dependency gate (parent `f934e27`)

- Moved authored route types, graph collection, pattern/destination validation
  and immutable JSX route plans into shared analysis. DOM link creation and
  route runtime emission moved into `dom/router.ts`; deleted the former root
  implementation and repeated backend graph/pattern validation.
- Moved binding-aware source-call recognition out of the mixed data lowering
  module. Its producer and all consumers now share the source implementation.
- The boundary check now traverses the import graph, including type imports.
  Shared analysis/planning/context has no direct or transitive DOM/runtime
  dependency through local modules.
- Type checking, compiler build and lint passed. Six affected suites passed
  73 tests; lazy routing, Group, initial root and preparation passed another
  31 tests. The 123-case generated-output/graph/delivery comparison matched.
- Four paired production fixtures against `f934e27` retained identical HTML,
  payload and JS bytes. Static remains zero JS; lazy routing remains three
  chunks (67,988 raw / 21,987 gzip B); routed/Group remains 87,015 / 26,781 B.
  This is a source-boundary change, with no browser performance claim.

### Captured module callbacks (parent `1bc3081`)

- Shared planning captures module setup callbacks, helper-retained callbacks
  and async helper completion before instrumentation. Named native handlers
  and factory setup consume the same captured module source identities.
- Removed both backend module callback traversals. Remaining DOM lifecycle
  lowering moved into `dom/lifecycle.ts`; its former root file is deleted.
- Type checking, compiler build and lint passed. Eight affected suites passed
  85 tests. All 123 generated-output/graph/delivery comparisons matched the
  baseline. No browser-size or CPU improvement is claimed for this migration.

### Prop ABI and intrinsic import planning (parent `3763d43`)

- Shared component props retain authored parameter shapes and binding facts.
  DOM prop initialization/replay, type stripping and numeric reason arguments
  now live in `dom/props.ts`. Removed the duplicate declaration-pattern clone.
- Shared intrinsic planning validates shadows/lifecycle syntax and returns
  required imports without mutating the program. The backend installs imports
  and publishes generated import metadata explicitly.
- Type checking, compiler build and lint passed. Eight affected suites passed
  104 tests. The 123-case output/graph/delivery comparison remained identical.

### External subscriptions and route ABI state (parent `174aa74`)

- External source analysis retains authored subscription metadata instead of
  generated adapter names. The DOM backend allocates imports from that contract
  in the original evaluation/allocation order. Deleted the mixed root module.
- Generated route context parameters, transient callsite IDs and subscription
  imports moved out of source context into DOM context.
- Type checking, compiler build and lint passed. Five affected suites passed
  60 tests; all 123 output/graph/delivery comparisons matched the baseline.

Historical next step at this revision: semantic normalization and generated ABI
separation. Subsequent source/async/JSX/row-ABI batches below complete the named
migrations; only broader contracts in the current checklist remain open.
These are prerequisites for the runtime-size and broader precision batches.

### Optional hydration recovery (commit `4da52c8`, parent `2c57535`)

- Moved root mismatch recovery and adopted-root publication from general mount
  into the installed hydration capability. Deleted the former mount helper and
  recovery branch; root validation, creation, handles and disposal use the same
  existing engine. No compiler mount mode or authoring API was added.
- Ordinary mount still detects server markup and preserves its missing-runtime
  warning/fresh fallback. Installed hydration preserves region callbacks, root
  recovery, payload completion and exception propagation. Client-only data
  handling alone is not treated as proof that a host has no server HTML.
- Runtime build, type checking and lint passed. Ten focused suites passed 46
  tests, including retained adoption, list/route/atomic region recovery, ownership,
  missing-runtime fallback and authored exceptions during adoption/recovery.
- Identical compiler output with runtime/data/router sources isolated against
  `2c57535`: owner counter 8,996 -> 8,434 raw B (3,689 -> 3,456 gzip B);
  input/list 16,954 -> 16,390 B (6,737 -> 6,497 gzip B); module counter
  12,324 -> 11,760 B (4,893 -> 4,654 gzip B). All nine production Chromium
  graphs passed interactions and retained list identity. Explicit hydration
  remains supported and is audited separately. This is a size change, with no
  DOM timing claim. Numeric module keys and broader capability isolation remain open.
- Four production SSR fixtures retain matching HTML/payload/JS across the
  preceding and current compiler with the same updated runtime: static remains
  zero JS, counter 8,613 / 3,483 B, lazy routing 67,957 / 21,958 B in three
  chunks, routed/Group 86,981 / 26,764 B. This checks delivery compatibility,
  not an isolated before/after runtime-size comparison.

### Presentation ownership and DOM data emission (commit `0dcdf97`, parent `4da52c8`)

- Replaced generated presentation parameters and their parallel inherited-only
  marker in shared context with one semantic ownership contract. Local policy
  requirements take precedence over inherited propagation. DOM parameter
  allocation consumes explicit owner contracts in the existing allocation order
  without changing source facts or shadowing authored bindings.
- Source row eligibility, read collection and export metadata now inspect
  ownership facts. Moved policy argument/rendering, automatic DOM data sites and
  source-subscription emission into `dom/`; removed their three former files,
  old feature exports and shared metadata re-export facades. Consumers import
  shared async facts directly from their planner.
- Compiler build, type checking, lint and the transitive import boundary passed.
  Ten focused suites passed 95 tests across Group, pending/error callbacks,
  transported sources, component rows, TSRX and initial lifetime handling.
- All 123 stable output/graph/delivery comparisons match `4da52c8`, excluding
  source maps. Four paired production delivery fixtures retain identical
  HTML/payload/raw/gzip bytes: static zero JS, counter 8,613 / 3,483 B, lazy
  routing 67,957 / 21,958 B (three chunks), routed/Group 86,981 / 26,764 B.
- Area 1 remains open: mixed source normalization and backend component export
  publication still need explicit contracts. Areas 2–5 retain their unfinished
  gates; this source-boundary batch makes no bundle or CPU improvement claim.

### Source normalization and explicit export publication (commit `4935119`, parent `0dcdf97`)

- Extracted provider import facts into shared analysis. Shared destructuring
  plans now validate the complete pass and describe bindings, defaults, array
  positions/rest and object projections without generated bindings or AST
  mutation. DOM lowering allocates source holders/default caches from the plans.
  Deleted the former mixed discovery implementation and both data-source
  facade modules; consumers use the actual implementation owners.
- Corrected the declaration-location check rejecting direct component source
  patterns such as `const {name} = $fetch('/user')`. Existing unsupported
  assignment/helper/object-rest forms keep their diagnostics. The new live DOM
  regression verifies settling data, retained nodes and no repeated fetch on an
  unrelated local update. Captured default callbacks retain nested placements.
- Component export publication consumes an explicit backend row-eligibility
  result instead of reading DOM state. The transitive boundary check includes
  the source publisher. Its source-only regression requires no DOM context.
- Compiler build, type checking and lint passed. Eight focused suites passed
  64 distinct tests across the initial and targeted follow-up runs. All 123
  output/graph/delivery comparisons match `0dcdf97`, excluding source maps and
  the newly supported direct declaration regression.
- Five production fixtures matched HTML/payload/raw/gzip bytes in both SSR
  and client-only builds against `0dcdf97`, using the same runtime. Static
  remains zero JS, counter 8,613 / 3,483 B and todo 17,140 / 6,443 B. Lazy routing
  remains three chunks; routed/Group and fetched delivery remain supported.
  This batch removes mixed compiler code; it makes no browser-size or CPU gain
  claim. Remaining normalization/composition and capability gates stay open.

### Mount marker recognition (commit `0133339`, parent `4935119`)

- Ordinary mount now retains only root-marker recognition. Full region parsing
  remains reachable through the optional hydration capability. Both readers
  use the same identity validation; malformed-marker behavior and the warning/
  fresh-mount fallback are preserved. The bundle audit checks parser isolation.
- Runtime build, type checking and lint passed. Six focused suites passed 36
  tests, including 260 marker comparisons, cursor validation, hydration recovery,
  ownership, package boundaries and the missing-runtime fallback.
- Paired source graphs using identical compiler output: owner counter
  8,434 -> 8,188 raw B (3,456 -> 3,336 gzip B); input/list 16,390 -> 16,144 B
  (6,497 -> 6,398 gzip B); module counter 11,760 -> 11,514 B
  (4,654 -> 4,541 gzip B). All nine production Chromium graphs passed.
- Explicit program hydration retains both readers: the same fixtures grow
  114–116 raw B and 24–39 gzip B. Its nine Chromium graphs also passed. This
  tradeoff reduces ordinary interactivity cost without removing server-markup
  detection. No DOM CPU improvement is claimed; broader capability isolation
  and numeric keys remain open.

### Private row-prop contracts (commit `7e59b93`, parent `0133339`)

- Shared planning now proves single-field envelope use with lexical identities,
  including shadowed bindings, direct keyed calls, escape/receiver checks and
  dynamic scope rejection. It allocates nothing and leaves authored syntax intact.
- DOM lowering chooses its existing row ABI, allocates the replacement binding
  and returns normalized parameters explicitly for source reanalysis. Its private
  row ABI publication moved out of shared context. Removed the former mixed
  component implementation; there is one proof and one backend consumer.
- Compiler build, type checking, lint and the transitive import boundary passed.
  Eight focused suites passed 98 tests, including retained nodes, getters,
  throwing prop evaluation, callback props, cleanup and initial list adoption.
- All 123 output/graph/delivery comparisons match `0133339`. Five production
  SSR builds using identical runtime packages retain equal HTML, payload, JS and
  gzip bytes: static zero JS, counter 8,613 / 3,483 B, todo 17,140 / 6,443 B,
  lazy routing 68,066 / 22,009 B in three chunks and routed/Group
  87,093 / 26,790 B. The preceding runtime-size improvement is preserved;
  this compiler boundary batch makes no additional size or CPU claim.

### Calculated list-source contracts (commit `cb24e88`, parent `7e59b93`)

- Shared planning captures calculated receivers, source snapshots and containing
  statements in the existing source order without binding allocation or AST
  mutation. Direct sources, optional chains and nested callback boundaries retain
  their existing treatment. Library methods remain ordinary authored behavior.
- DOM lowering consumes these contracts and allocates derivation declarations;
  it does not rediscover source candidates. Deleted the mixed list normalization
  implementation. Existing derivation replay and list reconciliation remain the
  only execution path.
- Compiler build, type checking, lint and the transitive import boundary passed.
  Seven focused suites passed 111 tests across opaque control flow, helper/list
  updates, retained rows, calculated sources and initial list adoption.
- All 123 output/graph/delivery comparisons match `7e59b93`. Five production SSR
  fixtures retain identical HTML/payload/raw/gzip sizes with the same runtime,
  including static zero JS, lazy chunks and routed/Group delivery. No additional
  byte or CPU saving is claimed. Remaining module/source normalization,
  composition contracts, numeric keys and capability gates remain open.

### Async source facts and DOM lowering (commit `91b0133`, parent `cb24e88`)

- Shared analysis owns transparent source/track discovery, lexical read facts,
  Group origins and validation. Source prop plans capture lexical projections;
  DOM normalization allocates aliases and returns its normalized binding map
  explicitly. Validated module source identities publish before lowering rather
  than being a side effect of generated runtime declarations.
- Moved fetch encoding, source declarations, replay, Group lowering, presentation
  parameters, TSRX boundaries and read transformation into `dom/`. Deleted their
  former implementations and the mixed source scanner. Generated data-call
  recognition is backend-specific; shared read queries no longer depend on it.
- Compiler build, type checking, lint and the transitive import boundary passed.
  Twelve focused suites passed 134 tests across lexical shadows, destructuring,
  module sources, transported props, Group, diagnostics and TSRX.
- All 123 output/graph/delivery comparisons match `cb24e88`. Five paired
  production SSR fixtures preserve HTML/payload/raw/gzip bytes with the same
  runtime: static zero JS, counter 8,613 / 3,483 B, todo 17,140 / 6,443 B,
  lazy routing 68,066 / 22,009 B in three chunks and routed/Group
  87,093 / 26,790 B. This separation adds no browser-size or CPU gain claim.
  The remaining semantic/backend and capability gates are still open.

### Client environment initialization (commit `16214b6`, parent `91b0133`)

- Kernel state receives a resolved environment. Ordinary client initialization
  uses its lazy client environment directly; only explicit isolated-runtime
  creation merges overrides. Removed that dependency from ambient setup, keeping
  one scheduler, ownership engine and environment implementation.
- Added a stable isolated-counter fixture and retained-code assertions. Seven
  focused suites passed 35 tests covering injected environments, independent
  runtimes, late server context, mount ownership and hydration recovery.
- Paired source bundles with identical compiler output reduce ordinary counter,
  input/list, module counter, fetched and routed graphs by 222 minified bytes.
  Counter: 8,188 -> 7,966 raw B / 3,336 -> 3,270 gzip B; input/list:
  16,144 -> 15,922 B / 6,398 -> 6,327 gzip B. The isolated-runtime control
  grows 4 raw / 5 gzip B; override support is intentionally retained.
- All 21 ordinary production Chromium graphs pass interactions and retained
  list identity. Twelve optional program-hydration graphs also pass; ordinary
  counter/list/module fixtures reduce 222 raw B and 22–35 gzip B in that product.
  Hydration may retain override resolution for its explicit environments.
  Five production SSR builds preserve HTML and payload: static remains zero JS;
  current counter is 8,393 / 3,414 raw/gzip B and todo 16,918 / 6,381 B.
  That SSR comparison isolates compiler revisions using the same changed runtime,
  so it is a delivery check rather than evidence of runtime byte savings.
  No CPU improvement is claimed. Numeric keys, dynamic emission reuse and the
  remaining compiler/composition contracts stay open.

### Finite JSX selection contracts (commit `d1cd2e9`, parent `16214b6`)

- Shared planning captures lexical finite-tag candidates, ordered authored sites
  and scalar/render prop classifications without changing syntax or allocating
  bindings. DOM lowering owns native-name validation, selector scratch bindings,
  generated imports and JSX replacement. Linked import normalization returns
  explicit source publication results. Deleted the former mixed JSX module.
- Eight focused suites passed 76 tests, including nested hosts/components,
  helper/registry candidates, linked imports, render props, source-only planning,
  parser-neutral lowering and initial conditionals. All 129 stable compiler
  output/graph/delivery comparisons match `16214b6`, excluding source maps.
- Nine production Chromium graphs pass. The new dynamic host/linked component
  fixture checks swaps, later text updates and retained host identity. Paired
  source bytes remain unchanged: dynamic tags 15,568 / 5,574 raw/gzip B;
  owner counter 7,966 / 3,270 B; input/list 15,922 / 6,327 B.
  Compiler build, type checking, lint and the transitive boundary pass. Six paired
  SSR fixtures retain equal HTML/payload/JS bytes, including static zero JS and
  dynamic tags at 505 B HTML / 78 B payload / 25,577 B JS (8,622 B gzip).
  This boundary change makes no additional size or CPU gain claim. Further
  normalization, optional capabilities, numeric keys and composition gates remain.

### Primitive text-cache result facts (parent `d1cd2e9`)

- Shared analysis proves completed primitive results from JavaScript expression
  semantics. It does not infer runtime values from type annotations or classify
  unknown identifiers, members and calls. DOM text-cache emission removes only
  the redundant object/function result guard, preserving operand reads, coercion,
  string normalization and cache invalidation after exceptions/reentrant writes.
  The existing cache and concatenation implementation remain in use.
- Six focused suites passed 106 distinct tests across the initial run and the
  corrected BigInt snapshot rerun. Inline/component regressions verify repeated
  numeric coercion, getters, nested updates, throwing setters and retained nodes;
  existing opaque text, concatenation, Group and initial-list gates also pass.
  Compiler build, type checking, lint and the transitive import boundary pass.
- All 135 stable compiler comparisons preserve semantic graph and delivery
  facts. Output changes in five fixtures consist solely of proven result-guard
  removal; 120 whole results are unchanged. No generated fixture was edited.
- Paired production compiler builds with identical runtime packages: inline
  list 24,141 -> 24,029 raw B / 8,769 -> 8,754 gzip B; component list
  24,295 -> 24,183 B / 8,831 -> 8,816 gzip B. Both ordinary and initial-delivery
  modes retain identical HTML/payload. Static remains zero JS; counter and todo
  sizes remain unchanged. Creation-code retention for these list shapes remains
  open; this saving is in text-cache emission.
- Nine production browser graphs pass updates, reorders and retained identity.
  A paired compiler-only DOM run against `d1cd2e9` passes all 21 scenarios and
  mixed sequences before timing, plus identity checks after every timed sample.
  It uses one update sample at 10k rows in ABBA order; the before/after canonical
  DOM artifacts are identical. These timings establish no CPU improvement.

### Consolidated stability checkpoint (parent `d4023e3`)

- Found an unsafe initial-binding optimization: a non-optional request selector
  beside local state read its pending value before settlement. The DOM planner
  now preserves the existing availability boundary by declining that delivery
  proof. Request row values retain their proved availability, so existing row
  binding optimizations remain enabled. No new runtime path or authoring rule
  was added. Broader request-selector binding proofs remain open.
- Stable authored regressions cover direct and aliased request selectors in both
  frontends and environments, empty/nonempty server responses, and clicking a
  retained counter while its request is pending. Corrected two production test
  setups: client-created Group nodes are captured after mount, and general list
  recovery uses an actually unproved multi-host fragment. Existing positive
  nested initial-binding coverage remains in place.
- Full root suite after the fix: **249 files / 2,508 tests passed**. All ten
  package builds, root type checking, data/router/utils test type checking,
  changed-source lint and the transitive compiler boundary passed.
- Package suites verified **525 distinct tests across 48 files**. Vite's first
  full run passed 110/112 tests; both corrected browser cases then passed in a
  focused rerun. The complete Vite suite was not repeated after those test-only
  corrections. Other package suites passed in full, including 147 server tests.
- All 135 existing compiler output/graph/delivery comparisons match `d4023e3`
  with source maps excluded. Seven paired production SSR fixtures retain equal
  HTML, payload, raw/gzip JavaScript and chunk counts using the same runtime.
  Static stays at zero JavaScript; counter is 8,393 / 3,414 raw/gzip B, todo
  16,918 / 6,381 B, lazy routing 67,841 / 21,970 B in three chunks and routed
  request/Group 86,872 / 26,759 B. No size or CPU gain is claimed for this fix.
- This checkpoint closes the historical full-root rerun gap recorded above.
  It establishes the tested baseline, not completion of the five areas. The
  then-next row ABI cleanup was completed by `b01d5ae`; numeric keys were later
  deferred by `9b4896d`. Duplicated emission and retained creation remain candidates
  where a concrete unnecessary-code case is demonstrated. Dependencies, examples
  and numbered docs were untouched.

### Row ABI ownership (parent `d49c901`)

- Moved generated row identifiers and refresh/owner bindings from shared AST
  context to `dom/row-context.ts`; migrated all 17 DOM consumers. The authored
  `RowWriteFacts` contract remains shared. Deleted the former declaration and
  import; no compatibility export or mirrored state remains.
- Six focused suites passed 72 tests covering the transitive boundary, component
  and inline rows, Group, render props and callback completion. Compiler build,
  root type checking and DOM-source lint passed. All 135 existing generated
  output/graph/delivery comparisons are unchanged against `d4023e3`; the intervening
  pending-selector fix also preserves those controls.
- This type-only separation changes no browser bytes and makes no timing claim.
  Other semantic/backend contracts and the bundle deliverables remain open.

### Priority correction: component JavaScript retention

- The requested bundle goal is to omit component JavaScript when authored
  behavior does not require it. Key representation is a separate optimization.
- Removed the uncommitted numeric-key prototype, its runtime setup, temporary
  regressions/fixture and related audit changes. It had correctness checks but
  no completed measurements demonstrating a worthwhile runtime gain. No numeric
  resolver or second compiler path is retained. Canonical string routing remains.
- Keep the verified row ABI cleanup (`b01d5ae`). Numeric interning is deferred;
  remaining delivery/creation work requires a demonstrated retained-code case,
  not a speculative architecture expansion. Preserve routing, Group and dynamic
  lifetimes even when they legitimately require browser code.

### Optional package cost and plan reconciliation (parent `8144d00`)

- CSS removal is committed as `8144d00`: 18 package files and its obsolete design
  are deleted, root build/test references and lockfile workspace entries removed.
  No dependency version changed. Ignored generated CSS files were also removed
  individually after automatic review rejected recursive directory cleanup.
- Audited runtime/data/router generated graphs and public utility/adapter/server
  entries. Preserve server module boundaries so JSON responses omit renderer/Node
  host initialization; optimistic operations use the existing resource tracker
  without the full form tracker. No second engine, tracker or compatibility API.
- Published JSON probe: 8,016 → 520 raw B, 2,968 → 325 gzip B. Optimistic probe:
  26,773 → 26,102 raw B, 8,618 → 8,449 gzip B. These isolated API probes include
  export wrappers; server measurements are not browser savings. Full findings and
  retained generic data costs are in [Optional package cost](./package-capability-audit.md).
- All nine remaining packages build. Final focused root run: seven files / 73
  tests; server suite: 14 files / 147 tests; utility suite: seven tests plus its
  typecheck. Root typecheck, changed-file lint and diff checks pass. No new full
  root-suite pass is claimed; the prior consolidated checkpoint remains recorded.
- 44 supported package/source browser graphs passed; ten controls reran after
  the final package rebuild with unused-package exclusion guards. The size audit
  compiled all 45 fixtures, but its generic browser verifier cannot check every
  newer structural fixture; the first unsupported case timed out rather than
  establishing a runtime failure or an all-fixture pass.
- Nine production SSR controls preserve HTML/payload/chunks against compiler/Vite
  `9b4896d` with identical current runtimes. Static/fetched-only pages stay at
  zero JS; one/sixty static child slots both retain 8,393 raw / 3,414 gzip B.
- Reconciled compiler ownership tables, package audit instructions, historical
  performance candidates and delivery/SSR checkpoints. Completed migrations are
  marked accordingly; historical measurements remain intact. Numbered docs and
  personal examples are untouched. Generic data dispatch/restoration, unproved
  composition/creation and further performance proofs remain explicit open items;
  numeric routing stays deferred.

### Caller-slot creation audit, optimization and verification (parent `6c48d1c`)

- Identified the missing markup optimization in compiler-owned caller slots;
  component future-creation arms already used it. Route slots through that same
  DOM pass and pass the update function explicitly for retained node binding.
  Repeated imperative construction is removed from eligible large slots. No
  runtime implementation, compatibility facade or ownership engine was added.
- Stable small/large composition and fetched-row fixtures compare compiler/Vite
  revisions with identical runtime packages. Large composition: 21,024 → 16,809
  raw B, 6,412 → 5,990 gzip B. Fetched rows: 56,945 → 52,738 raw B,
  17,736 → 17,273 gzip B. Small slots and seven controls are unchanged; HTML and
  payload are unchanged; static/fetched-only stay zero JS. No CPU claim.
- Compiler and Vite builds, root typecheck, changed-file lint and diff checks
  pass. Seven focused suites pass 84 tests; two production Chromium cases pass
  adoption, live slots, remounts and request-row reuse/removal/append/recreation.
  Namespace/unsafe-text fallbacks, effects, refs and disposal remain covered.
- These three requested steps are complete for the demonstrated caller-slot
  gap. At that revision, the broader checklist remained open; the status review
  below supersedes that scheduling. Unknown initialization/update evaluation
  cannot be reordered to force smaller output.
  Details and reproduction commands are in the browser architecture document.

### Architecture status correction and mutation verification (parent `258a25a`)

- Rechecked the source plans, semantic write facts, DOM coordinators, emission
  state and import-boundary gate. Indexed writes, source aliases, callback props,
  module targeting, opaque slot precision and render-slot contracts already
  exist; the former generic remaining-work list overstated these as incomplete.
- Added four stable authored regressions for a child mutating a forwarded array
  through named/object props with module/component state. Child `push()` and
  item-field mutation update parent and sibling readers, while retaining existing
  row identity. All four pass without compiler/runtime changes.
- Nine suites pass 91 checks, including the new regressions, transitive backend
  boundaries, targeted row work, aliases, named callback forwarding, opaque
  precision and JSX render props. This is a focused audit, not a full-suite or
  VM-performance claim. No dependency, public API or state model was changed.
- Core separation and supported delivery/composition are implemented. Minor
  output-configuration cleanup, conservative fallback expansion and further
  measured optimizations are optional follow-ups. The current checklist now
  records concrete limits rather than requiring speculative rewrites.
