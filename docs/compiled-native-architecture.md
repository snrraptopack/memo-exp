# GPUIX architecture and Memoized DOM bundle research

Date: 2026-10-08. Proposal for Memoized DOM, with GPUIX used as a comparative reference rather than a dependency or architectural requirement. No native engine is implemented by this document.

## How GPUIX works

Source snapshot: upstream commit `1a007487ac4c1f0be2ec4e090281ae01e25ec17c`, inspected on 2026-10-08. Implementation statements below refer to that snapshot. This is the single research document for this investigation.

GPUIX connects React or Solid to Zed's Rust GPUI renderer. Desktop uses Node-API through napi-rs; the browser target uses wasm-bindgen. GPU rendering uses the platform backend, with Taffy providing flexbox layout. This renders native elements rather than a DOM document. [Official architecture](https://www.gpuix.dev/#architecture).

```text
Authored React / Solid components
  -> adapter: React reconciliation / Solid direct reactive updates
  -> shared JavaScript mutation queue, numeric host IDs
  -> JSON batch across Node-API or WebAssembly
  -> typed Rust operations and shared style resolution
  -> retained native element tree, one lock per desktop batch
  -> invalidation of GPUI view
  -> ephemeral GPUI elements, layout and GPU paint

Native input -> host callback -> authored JavaScript behavior -> next batch
```

Its shared JavaScript queue stores mutation tuples such as `createElement`, `setText`, `setStyle`, and `insertBefore`. Flushing calls `applyBatch(JSON.stringify(queue))`. Host IDs are numeric, and the queue shares the transport across adapters. [Pinned mutation queue](https://github.com/remorses/gpuix/blob/1a007487ac4c1f0be2ec4e090281ae01e25ec17c/packages/native/js/mutations.ts).

The Rust batch path decodes operations and resolves styles before changing elements. Desktop acquires the retained-tree mutex once per batch, then requests invalidation. `GpuixView::render()` builds ephemeral GPUI elements from the retained root; GPUI lays out and paints the requested frame. Native events return through the host callback. Requested rendering, animation, and native interaction should be distinguished from an assumption that JavaScript reconciles continuously while idle. [Pinned renderer](https://github.com/remorses/gpuix/blob/1a007487ac4c1f0be2ec4e090281ae01e25ec17c/packages/native/src/renderer.rs).

The retained tree already uses a fast numeric-key map, shared immutable styles, and revision information. Virtual lists defer offscreen GPUI element construction, layout, and paint; the documented React path still retains the complete keyed children in React and Rust. Consequently, virtualization saves frame work without eliminating all initial JavaScript allocation or transfer. [Pinned retained tree](https://github.com/remorses/gpuix/blob/1a007487ac4c1f0be2ec4e090281ae01e25ec17c/packages/native/src/retained_tree.rs), [virtualization contract](https://www.gpuix.dev/#how-virtualization-works).

Solid already provides fine-grained updates, so avoiding React reconciliation alone would not establish an advantage over GPUIX. The relevant experiments are compiler-prepared structure, fewer bridge commands, retained geometry/paint work, and build-time capability selection. They are hypotheses until compared on equivalent fixtures. Browser JavaScript bytes and desktop executable size need separate budgets: the latter also includes the JavaScript engine, native libraries, text/rendering facilities, and packaging.

Do not propose optimizations against an obsolete GPUIX baseline. Its serialization report records shipped typed decoding and style sharing, with parse/apply falling from 127.1 ms to 30.1 ms and retained-tree memory from 224.5 MB to 42.6 MB for its large chat fixture. A codec-only MessagePack comparison was much smaller, reported as 1.24x. Those are the project's measurements, not measurements reproduced on this Windows machine. The report contains historical sections labelled “today”; the opening shipped-results section and pinned implementation establish the current path. [GPUIX serialization benchmark](https://github.com/remorses/gpuix/blob/1a007487ac4c1f0be2ec4e090281ae01e25ec17c/docs/serialization-benchmark.md).

Current work focuses on browser bundle size. Native implementation is deferred; the native sections preserve one proposal for later evaluation. The existing rearchitecture checklist remains the execution record.

Latest routed/Group result: **20,139 B gzip in the source graph**, down from 23,132 B (12.9%). The identified default-router control retention has been removed, along with dynamic match validation, public option parsing, general navigation/query serialization and full snapshot subscriptions from compiler-only graphs. The completed changes and verification are recorded below.

## Design

Compile UI structure into persistent native scene templates and compile behavior into direct updates to typed scene slots. The native engine owns layout, input, text, hit testing, and drawing. JavaScript owns authored application behavior and compiler-directed state updates. Changes cross a narrow, transactional interface; an application does not reconstruct an element description tree every frame.

```text
Plain TypeScript / JSX
          |
Shared source analysis, structural plans, ownership
          |
          +-- DOM emitter --> direct DOM / initial HTML bindings
          |
          +-- Native emitter
                 |
                 +-- immutable scene templates / static style records
                 +-- closures for authored state and guarded slot updates
                 +-- manifest selecting runtime and native capabilities
                                      |
                       accepted slot / structural changes
                                      |
                         persistent native scene arena
                                      |
                 affected layout + retained paint commands
                                      |
                           platform GPU presentation
```

The scene arena is the actual host state, analogous to DOM nodes. It is not a second speculative tree diffed against host nodes. Dynamic branches and lists still need live topology and lifetime ownership; eliminating that necessary information is not the objective.

## A concrete update

A counter template declares a button, its text record, style references, hit-test identity, and the event binding. Mount instantiates that template once. The generated callback changes its plain number and marks the compiler-known update closure. The closure compares the new text against its acknowledged value and writes the text slot.

The host marks that text's shaping/measurement dirty and invalidates geometry dependents when its measured size changes. If the dimensions stay equal, unrelated layout can remain cached. A background-color change only dirties the relevant paint data. Neither update rebuilds the application's scene structure.

Native pointer feedback and caret animation can change host presentation without a JavaScript callback. An authored click still dispatches to JavaScript, so its actual application semantics are preserved.

## Seven architectural decisions

1. **One source analysis, target-specific lowering.** Keep lexical state identity, dependency facts, derivations, callback writes, and owner semantics shared. DOM anchors, HTML parsing, and DOM refs stay in the DOM backend. Native templates, typed handles, style schemas, and native refs belong in a native backend. Do not emulate `DocumentLike` to reuse DOM lowering.
2. **Persistent compact host storage.** Use typed records and side tables for variable-sized text/images/custom data. Static styles are immutable template data. Event kinds can use compact masks with handler IDs held separately. Handles carry generation information or equivalent lifetime protection so delayed events cannot target reused records. Dense storage is a candidate to measure, not an assumption that every allocation should be a flat array.
3. **Direct, typed updates.** The compiler names each dynamic slot and emits only the relevant setter. Static structural/style definitions are installed once. A compact buffer with typed values is a candidate ABI; compare it with simpler batching on real small and large updates. Queue commands, decode allocation, and bridge crossings can cost more than the choice of JSON versus binary.
4. **Separate dirtiness domains.** Track content/measurement, structure, geometry, paint, hit testing, and accessibility work separately. Geometry invalidation follows real dependencies: intrinsic dimensions can affect ancestors and siblings. Avoid promising that every update costs only the changed node. Layout libraries may supply an initial implementation behind our interface; replace or specialize their work only where profiles justify it.
5. **Retain paint work.** Cache scene paint records and glyph results across frames. Update affected records and reuse unchanged commands. A GPU may still draw/present the complete frame; CPU-side reuse and partial surface presentation are separate techniques. Invalidate clips, inherited paint properties, ordering, and focus/selection correctly.
6. **Control publication and scheduling.** Drain state updates coherently, then publish an accepted host transaction. Render failures do not publish partial structure or advance value caches for rejected changes. Bounds-reading refs/effects have an explicit host acknowledgment phase. The rendering thread can consume a stable scene snapshot while the behavior thread prepares the next transaction. Add thread separation only when its latency and synchronization costs are justified.
7. **Select features at build time.** Emit a capability manifest for both JavaScript and the native executable. The compiler selects required runtime operations and native feature modules across all reachable/lazy application code. A public general-purpose constructor remains complete when it escapes to unknown code. One ownership/transaction engine supplies both specialized compiled applications and full public APIs; avoid maintaining divergent semantics.

Ordinary authored TypeScript can continue running in a JavaScript engine. This design removes generic UI reconstruction from that engine; it does not require changing JavaScript semantics through a blanket translation to Rust. The engine is independently replaceable and measured for derived-list speed, modern language features, host APIs, startup, and executable size.

## Platform scope and dependencies

Own the scene model, source-to-slot mapping, update ABI, lifetime engine, and capability selection. Start with rectangles, rounded borders, text, clipping, pointer input, and one editable text control. Native text input, IME, font fallback, selection, accessibility, and DPI are first-class contracts, even while the primitive set is small.

Use platform text/window/GPU facilities or independent libraries behind narrow interfaces. Candidate reusable components include [Taffy for layout](https://github.com/DioxusLabs/taffy), [Parley for text layout](https://github.com/linebender/parley), and [Vello for 2D rendering](https://github.com/linebender/vello). These demonstrate separable building blocks, not a chosen stack or a claim that combining them yields the smallest executable. Measure dependency contribution and consider system text services before embedding an entire text stack. Core primitives should not require markdown, syntax highlighting, editor features, SVG parsing, or developer automation unless the application uses them.

## Browser-size baseline before the first change

At framework HEAD `937eefbee194741e14aa6475464fe014d15da225`, before the router change below, rebuilt the runtime and compiler successfully, then ran:

```powershell
bun run bench/package-size/audit.ts --verify --fixture=static --fixture=owner-counter --fixture=input-list --fixture=owner-list --fixture=request-data --fixture=request-routed-group
```

All 12 selected package/source browser graphs passed the suite's applicable interaction checks, including input reset, whitespace rejection, duplicate values, and retained list identity. These are correctness and byte measurements, not CPU timings or native tests. Runtime/compiler builds were refreshed; source graphs below read current runtime/data/router source. Package graphs use the workspace's distributed exports and are reported separately by the audit.

| Client-only fixture, source graph | Whole minified JS B | Whole gzip B |
|---|---:|---:|
| Static DOM creation | 5,413 | 2,310 |
| Owner-local counter | 7,966 | 3,270 |
| Positional input/list | 15,922 | 6,327 |
| Keyed owner list | 23,301 | 9,077 |
| Fetched data | 28,006 | 9,696 |
| Fetched data, routing, Group | 72,131 | 23,132 |

The static row measures JavaScript that creates a document. Proven static HTML delivery is a different product and already ships zero JavaScript, as documented in [browser delivery architecture](./browser-bundle-architecture.md). This run did not repeat the production SSR audit.

The audit writes an ignored report to `bench/package-size/dist/audit/results.md`, with JSON and per-fixture esbuild metafiles beside it. Each run replaces those artifacts; the tables here preserve the pre-change measurements. Their top source contributions identify investigation targets:

| Fixture | Largest retained modules, minified raw B |
|---|---|
| Counter | Kernel 4,379; mount core 1,442; ordinary mount 671 |
| Keyed list | Keyed list 9,084; kernel 4,579; list update 1,921; list DOM 1,639 |
| Fetched data | Resource 7,545; kernel 4,498; request 2,185; conditional 2,051 |
| Routed Group | Router runtime 21,547; resource 7,572; route path 4,846; scroll 3,954 |

Attribution is raw emitted bytes, not removable code or additive gzip savings. A large module may contain behavior the fixture needs. Follow each retained function into generated calls before splitting it, then remeasure whole bundles and verify the affected behavior.

## What the original 23 KB bundle retained

The original figure was **23,132 B gzip for the complete client-only fetched/routed/Group fixture**, not the core runtime. It includes authored/generated application code, runtime ownership, data, and routing. Measurements and checks are in [browser-size baseline](#browser-size-baseline-before-the-first-change).

The fixture declares a fetched name, a pending Group, and two literal routes (`/` and `/about`). Inspection of the pre-change compiler output showed these six router namespace members:

```text
createRouteManifest
ensureRouterConnected
replaceRouteResolver
route
routeRegionIdentity
subscribeRouteSelected
```

Nonetheless, the emitted bundle retains the `blockNavigation`, `navigateRelative`, and `installResolver` methods on its default runtime object. Blocker installation and synchronous-blocker diagnostics also survive. The authored fixture declares no blocker or relative-navigation API call.

The retention chain is:

```text
compiled route operations
  -> router/internal
  -> active runtime selection
  -> defaultRouteRuntime = createRouteRuntime()
  -> returned complete RouteRuntime object
  -> public methods and the implementation they reference
```

Source evidence at that baseline: `packages/router/src/default-runtime.ts:3`, `packages/router/src/runtime.ts:312`, and the returned runtime object at `packages/router/src/runtime.ts:1677`. The pre-change inspection is summarized above; temporary inspection files were removed after consolidation. Audit bundle files are replaced on each run.

This is concrete evidence of unused public API retention in this fixture. It is not a byte count for everything that can safely disappear. Blocker checks are also integrated into shared navigation, so removing only a method property would not remove the complete blocker path. Some history, query/hash handling, error recovery, scroll behavior, and request/Group lifetime work is implicit framework behavior even when not explicitly authored.

The source metafile attributes 21,547 raw minified bytes to router runtime, 7,572 to data resources, 4,846 to route path handling, 3,954 to scroll, and 2,826 to the manifest. Those are attribution numbers; they are not separately compressed or wholly unused.

Other boundaries already work: this fixture's bundle omits the routed server endpoint and server-request-context marker. Previous capability checks establish omission of unnecessary resource-write implementations, transfer/restoration machinery, and build tooling from supported client-only graphs. Do not classify those whole subsystems as new leaks based on the total size.

## Browser architecture improvement

Compiled applications now reach a core router with shared state, transactions and lifetimes. Blocker processing, navigation observers, general and relative navigation, resolver installation, explicit history controls, manual matches, dynamic match validation and full snapshot subscriptions are separately reachable. Imported public operations activate their required controls on the same engine. Explicit public constructors and escaped public runtime objects expose the complete API. Required browser navigation recovery and scroll behavior remain in the engine.

The compiler already knows literal route patterns and parent relationships. Emit their resolver/matching plan ahead of time rather than build a general manifest in the browser. Preserve normalization, query/hash behavior, base paths, unknown locations, inherited matches, and lazy module registration. General dynamic route APIs retain general path machinery when used. The first measured implementation is recorded below.

Apply the same principle to resources and native features: a read-only compiled fetch should reach its required settlement/cache/cancellation contract, while schema validation, mutable operations, transfer, and dynamic public construction are selected when needed. Avoid creating a separate read-only engine with different errors or cleanup.

## First implemented bundle reduction

The DOM emitter now writes validated full route patterns, local parameter names, parent-chain indexes, and existing lazy/preparation metadata. It calls `createPreparedRouteMatcher` instead of `createRouteManifest`. The public manifest builder uses that same matching implementation after validating dynamic definitions. The public router constructor supplies manifest construction to the shared engine; the compiled default runtime no longer imports it. There is one matching engine and one navigation engine.

This first batch moved manifest graph validation/composition and its public build-by-ID API out of compiled browser graphs. General navigation still needs path building. The shared trie is still built in the browser; this is not a fully prebuilt trie. This batch left the unused public-method retention in place; the subsequent changes below remove it.

After rebuilding router/compiler, the identical fixture measured:

| Fetched/routed/Group graph | Raw B before | Raw B after | Gzip B before | Gzip B after | Gzip saved |
|---|---:|---:|---:|---:|---:|
| Source | 72,131 | 69,794 | 23,132 | 22,389 | 743 (3.2%) |
| Package | 71,525 | 69,228 | 23,039 | 22,314 | 725 (3.1%) |

The five non-router source controls in the baseline table retain exactly the same raw/gzip sizes. The added lazy-route fixture measures 52,698 raw / 17,250 gzip B in the source graph and 52,232 raw / 17,183 gzip B in the package graph; no paired baseline was taken for that fixture, so it establishes correctness and current size rather than a claimed saving.

```powershell
bun run bench/package-size/audit.ts --verify --fixture=static --fixture=owner-counter --fixture=input-list --fixture=owner-list --fixture=request-data --fixture=request-routed-group --fixture=route-lazy
```

All 14 package/source graphs pass browser interaction checks. The router package passes 126 tests and its TypeScript check; 10 focused root suites pass 68 tests covering compiler routes, nested runtime behavior, lazy retries, routed preparations/readiness, destination identity, hydration fragments, bundle boundaries, and shared-analysis boundaries. Bundled source/package public-constructor controls verify blockers and relative navigation still work, while metafiles verify that compiled graphs retain the shared prepared matcher and omit public manifest construction. These establish the reported byte reduction and tested behavior, not a CPU-speed gain.

Two selected production Chrome tests also pass: lazy route lifecycles with compiler-selected hydration, and routing/Group request presentation with client navigation. The root `bun run typecheck` passes. These are focused checks, not a new full-repository stability checkpoint. Router/compiler builds pass; targeted lint has no errors and reports array/spread style warnings.

## Completed router control and match changes

The default runtime no longer returns blocker, observer, general/relative-navigation, resolver-installation, explicit back/forward, manual-match, snapshot or full-subscription methods. Their modules attach operations to that same object only when used. A private control context supplies the shared engine's publication, preparation, guards and recovery operations; it does not introduce a second state store or navigation engine. The public constructor and `getActiveRouteRuntime()` still expose the full API and preserve runtime identity.

Compiler-only navigation with no observer capability now skips event-record allocation through guarded calls. With no blocker capability it skips blocker-set allocation, snapshots and redirect processing. No timing gain is claimed from these structural reductions.

The compiler emits `replacePreparedRouteResolver` for the validated matcher. Its already-frozen match records are reused, and the engine merges route parameters without repeating per-record validation/copying. Custom resolvers, public construction, escaped public runtime objects and manual matches select the existing validation/copying implementation. Parameter collisions introduced by linked component routes are rejected during source analysis. Public options/environment overload parsing also moved to the public constructor.

Literal-link compiled graphs omit general programmatic navigation and its query serializer. Public `navigate` still builds parameterized paths, repeated query values and hashes when selected. Compiler-selected subscriptions remain in the engine; full snapshots and subscriptions use an optional hook in the same coherent publication loop. Reentrant listener replacement is covered by a regression test, including unsubscribe-all, navigation and resubscription during publication. Linked route analysis also rejects children under a terminal catch-all parent.

The final identical fetched/routed/Group fixture measures:

| Graph | Original raw B | Final raw B | Original gzip B | Final gzip B | Total gzip saved |
|---|---:|---:|---:|---:|---:|
| Source | 72,131 | 61,393 | 23,132 | 20,139 | 2,993 (12.9%) |
| Package | 71,525 | 61,020 | 23,039 | 20,074 | 2,965 (12.9%) |

The later work saves another 2,250 gzip B in source and 2,240 gzip B in package, beyond the first manifest reduction. The lazy-route fixture falls from the first batch's 52,698 raw / 17,250 gzip B to 44,304 raw / 15,048 gzip B in source, and from 52,232 raw / 17,183 gzip B to 44,043 raw / 14,994 gzip B in package. All five non-router controls retain their baseline raw/gzip sizes.

Source/package metafiles prove omission of `navigation-blockers`, `navigation-observers`, `relative-navigation`, `resolver-installation`, `history-controls`, `runtime-controls`, `match-controls`, `match-validation`, `general-navigation`, `snapshot-controls` and query serialization from compiled-only route graphs. A blocker-only public entry includes blockers while omitting unrelated controls. Custom resolver controls retain validation, reject duplicate active IDs, copy mutable records and preserve the previous route after a failed publication. Complete escaped runtimes keep all public methods, preserve identity, and reject controls after disposal.

The final seven-fixture audit passes all 14 package/source browser graphs, including routed/Group and lazy navigation. Router tests and their TypeScript check pass (127 tests). Compiler/router bundle tests pass (33 tests); the other focused root suites passed during this change, including route readiness, preparations, destination identity, hydration fragments and package boundaries. The root TypeScript check also passes after the final code changes. Six real-browser history/scroll cases pass, including pending traversal, failed traversal recovery, Navigation API entry keys, late-resource hash restoration and obsolete restoration cancellation. Two selected production Chrome tests passed earlier in the investigation for lazy route hydration and routing/Group client navigation. The build-based bundle tests use a 30-second deadline after one earlier 5-second deadline was exceeded during parallel audits.

The broad size-only audit built all 90 graphs across 45 stable fixtures during the control split. It was not an all-fixture browser interaction run; the final selected browser run supplies the interaction evidence above. No paired saving is claimed for fixtures without a captured baseline.

The remaining bytes include shared navigation/history recovery and readiness, URL handling, scroll restoration, fetched-resource settlement/cache/cancellation, Group lifetime work and generated application code. The fetched-resource module remains large, but size attribution alone does not prove that its complete cache/abort/refresh/public-resource contract can be removed. Existing boundaries already omit resource-write execution, transfer/restoration and server endpoint machinery in supported client-only graphs. No speculative deletion of those contracts was used to reach the reported savings.

## Validation

When native work resumes, build a small independent native scene engine and compile four fixtures: counter, child prop update, branch replacement, and keyed row movement. Verify state, identity, cleanup, focus, and failed publication. Establish a release-build empty host, then measure bytes added by each capability and each fixture.

For further browser experiments, identify a retained operation and its authoring/host contract before changing it. Compare identical package/source fixtures and verify production navigation, history, failure recovery and public API controls. Preserve shared transactions and required behavior. A smaller fixture alone is not a valid result if it silently removes promised browser behavior.

For native speed, record callback-to-presentation latency, layout/paint reuse, bridge commands/bytes, allocations, startup, idle CPU, and memory after repeated disposal. GPUIX can be one competitor in that comparison; the architecture should stand on its own measurements.

