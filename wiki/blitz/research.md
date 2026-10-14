# Blitz architecture research

Updated: 2026-10-14. Branch: `codex/blitz-renderer`.

This is the canonical research for the Blitz implementation. [plan.md](plan.md)
defines the implementation architecture and order. [milestones.md](milestones.md)
records completed work and the decisions made during it. This file distinguishes
existing code, inspected upstream behavior, and the architecture we intend to
implement. A planned capability is not an implemented capability.

## Aim and starting point

Memoized DOM is a web framework. Desktop applications retain ordinary TypeScript,
JSX, CSS, component composition, events, refs, and mounting. Native presentation
must serve those authoring semantics. Application code does not import desktop
event types, use special styling rules, or await ordinary void ref methods.

The branch starts at main commit `f3e1a794d5652d91bab27590519d6fb04f7a99cc`.
That main includes the native server-host selection and documentation updates.
It does not include `packages/desktop`, a desktop compiler entry, or the runtime
`/core` entry developed on `codex/desktop-renderer`. Those are reference work,
not code silently available on this branch.

The earlier [compiled native proposal](../../docs/compiled-native-architecture.md)
describes the GPUI direction at this main revision. It remains historical context;
it is not the implementation plan for Blitz. The completed GPUI work is preserved
on its branch. We will inspect and reuse appropriate work without merging its
presentation engine or all of its shared changes indiscriminately.

## What our compiler already contributes

| Existing source | Responsibility | Reuse in the desktop target |
| --- | --- | --- |
| `packages/compiler/src/ast/` | ESTree frontends, traversal, binding-aware analysis and printing | Parse and emit the same authored source |
| `context/model.ts` and `context.ts` | Source facts, canonical state identities and analysis options | Maintain one source-analysis model |
| `analysis/` | State, expression sources, helper effects, volatility, read routing and component relationships | Determine what changes and who must update |
| `planning/component-render.ts` | Component returns, placement, regions, callbacks and replay requirements | Plan the same component behavior before host emission |
| `planning/dynamic-tags.ts`, `jsx/attributes.ts`, `jsx/children.ts` | Tag candidates, ordered attributes and child classifications | Preserve JSX evaluation and structural semantics |
| `lists/`, `planning/list-sites.ts`, `planning/calculated-list-sources.ts` | List identities, keys, callbacks and calculated sources | Supply native structural updates without changing DOM list execution |
| `linking/`, `linker.ts`, `component-linker.ts` | Module collection, canonical imports/exports and fixed-point summaries | Preserve reactivity through relative application modules |
| `analysis/external-reactivity.ts` | Subscription metadata for external values | Keep the existing external-source integration |

At the main baseline, the exact analysis order lived in `dom/analyze.ts`, and
`dom/prepare.ts` mixed source work with DOM lowering. Manifest discovery also
imported DOM preparation. Therefore a second emitter cannot safely reproduce a
shortened list of passes or pretend the whole compiler is already host-neutral.
The selected approach is one shared coordinator with explicit target preparation
hooks, extracted with unchanged DOM output. The previous desktop branch provides
an implementation reference for this extraction.

The M1.2 batch now implements that coordinator in `analysis/pipeline.ts`.
DOM supplies normalization, presentation-parameter allocation and placement
validation through its profile. Module/instance state, ref exclusion, opacity,
computeds, control flow, effects, reads, cycle checks and list ownership analysis
run in the shared order. Cycle and list source checks are not optional target
finishing hooks. A non-DOM profile can produce source facts without a DOM allocator.

M1.3 adds `linking/project.ts` for source parsing, identity bootstrap, ordinary
mount resolution and the fixed-point importer worklist. Manifest serialization
uses the same source context through a `ManifestAnalysisAdapter`; it no longer
loads DOM preparation or allocates a DOM context itself. `dom/project.ts` supplies
the existing intrinsic installation, preparation, row resource classification
and routed-preparation hooks. Source-only contracts verify canonical state/helper
facts and access readers through reordered modules and barrels without an emitter.

Bootstrap keeps main's component-only alias seeding on every target. It does not
adopt the older GPUI branch's broader seeding or cycle diagnostics silently.
State/helper aliases are refined by the existing worklist. Native emission will
consume this coordinator through its own preparation adapter, rather than copying
the resolver or the serializer. The public project option types still describe
browser initial-content selection; type-only references do not load that backend.

Module cells, access tables and instrumented writes must be present in desktop
output. Native node creation does not replace them. Rust receives presentation
updates, not JavaScript expressions or a second reactive graph.

## What our runtime already contributes

| Existing source | Responsibility | Desktop ownership |
| --- | --- | --- |
| `packages/runtime/src/kernel.ts`, `application-scope.ts` | Application scope, entity registry, dirty work, commit ordering and lifetime | Use the same application runtime |
| `access.ts` and `reasoned-invalidation.ts` | Canonical source-to-entity routing and dirty reasons | Use the same access resolver |
| `state-cells.ts` | Application-owned module values under canonical keys | Preserve cross-module reactivity and application isolation |
| `events.ts` | Callback write publication through the access resolver | Keep ordinary and external writes on the same invalidation path |
| `effect.ts`, `cleanup.ts`, `refs.ts` | Effect and ref ownership, activation and teardown | Reuse with an explicit accepted-host lifecycle boundary |
| `volatile.ts` | Conservative opaque-source pulling | Supply native visibility/frame capabilities to the same policy |
| `list*.ts`, DOM setters and markup helpers | Optimized browser structure and node operations | Keep on the web target; do not rewrite to accommodate Blitz |

`RenderEnvironment` on main requires a `DocumentLike`, and `refs.ts` contains
document-connected activation behavior. Some reusable semantics and browser
assumptions are mixed. Desktop should not fabricate a browser document merely
to satisfy these types. Narrow, tested host hooks and a core export entry are
required. These are changes to existing code and must be communicated before
implementation, as specified in the plan.

The core scheduler's synchronous computation and native acceptance are separate
phases. JavaScript computes candidate presentation work; native acceptance
determines when refs, effects and accepted-value caches can advance. A native
publication queue is a host adapter, not another reactive scheduler.

External subscriptions are already compiler-generated: `dom/external-reactivity.ts`
allocates the configured adapter import, and `dom/component.ts` emits subscription
activation with core cleanup and invalidation. Reuse that analyzed metadata and
subscription contract in the native emitter; there is no separate generic runtime
subscription engine to copy or replace.

### Implemented runtime boundary on the Blitz branch

The first M1 batch now exports those existing primitives through
`@memoized-dom/runtime/core`. It does not import browser mounting, hydration,
DOM lists/setters, or server storage initialization. Document resolution is lazy;
actually requesting an absent browser document still fails explicitly.

`RenderEnvironment.visible` supplies native visibility to the existing opaque
pull policy, and `effectBoundary` lets a host hold effect execution for acceptance.
Omitted hooks retain web behavior. Delayed execution captures its originating
application and exact entity registration, so an old queued effect cannot run
against a replacement with the same ID. Shared refs accept a minimal native
connection target without requiring `ownerDocument`; ordinary authoring types
still default to browser nodes. Computed comparisons moved unchanged into a
shared module and remain exported from the existing setters path.

This establishes the semantic runtime surface, not a running desktop app or an
implemented Blitz publication adapter. M1.2 adds shared compiler coordination;
M1.3 adds project/manifest adaptation. The original capture contains all 15
checked-in compiler fixtures twice, recording 18 emitted results and 12 diagnostics.
Its `initialContent` labels did not change single-module compilation: that option
belongs to project compilation. M1.2 verified those historical records and added
a proper project comparison against the pre-change compiler: both initial-content
settings across those fixtures and two linked-module graphs, 34 matching products.

## What Blitz supplies

Source inspected: `45496d9288b063719ebeae4e0761273f7881b3d7`, workspace version
`0.3.0-beta.2`. Published `blitz-dom` documentation describes `0.2.4` and differs
in node identity and event-handler signatures. Implementation will use the pinned
source revision and committed Cargo lockfile.
[Workspace source](https://github.com/DioxusLabs/blitz/blob/45496d9288b063719ebeae4e0761273f7881b3d7/Cargo.toml),
[published documentation](https://docs.rs/blitz-dom/0.2.4/blitz_dom/).

| Layer | Work it owns |
| --- | --- |
| `blitz-dom` | Retained document nodes, computed styles, layout, document interaction and controls |
| Stylo | CSS parsing, selectors, cascade, media/device restyling and computed values |
| Taffy / `stylo_taffy` | Box layout from computed CSS |
| Parley | Text shaping, inline formatting and editable-text infrastructure |
| `blitz-paint` | Document painting through AnyRender |
| `blitz-shell` | Winit windows/input and optional accessibility, clipboard and file services |

`BaseDocument` is externally driven. `DocumentMutator` creates element, text and
comment nodes, updates attributes/text/styles, moves children and removes nodes.
This fits compiler-generated templates and direct slot updates without generating
an HTML string for every render. Application ownership still belongs to our core.
[Document mutations](https://github.com/DioxusLabs/blitz/blob/45496d9288b063719ebeae4e0761273f7881b3d7/packages/blitz-dom/src/mutator.rs).

The pinned mutator distinguishes detaching a node from destroying it.
`remove_node` retains its allocation, while `remove_and_drop_node_with` reports
each destroyed descendant. Native retirement must use the destruction path and
clear every corresponding source mapping; a keyed move must retain those nodes.
The mutator's drop path flushes work and requests redraw, so validation must happen
before constructing a mutator for live application. These are integration
requirements for M2, not completed native capabilities.
[Pinned removal and flush paths](https://github.com/DioxusLabs/blitz/blob/45496d9288b063719ebeae4e0761273f7881b3d7/packages/blitz-dom/src/mutator.rs).

Its current `NodeId` includes a slot version to reject stale storage identities.
We still need our mapping from owner generation and source node to that ID;
Blitz identity does not encode our component or keyed-row lifetime.
[Node identities](https://github.com/DioxusLabs/blitz/blob/45496d9288b063719ebeae4e0761273f7881b3d7/packages/blitz-traits/src/node_id.rs).

The source includes an optional Boa-based JavaScript module for its browser app.
That is separate from driving a Rust document and is not our chosen execution
model. We retain the existing JavaScript semantic runtime, with Bun as the default
execution backend and JavaScript test/check runner. Vite owns application builds,
CSS processing and watched rebuilds. Execution is selectable: Node uses the
same Node-compatible host adapter; custom engines supply a module implementing the
portable publication transport. The bundler selects one adapter without rewriting
application TSX or duplicating state/access routing. QuickJS/Hermes remain custom
engine candidates, not promises of an already included adapter or full Node APIs.
[Optional scripting crate](https://github.com/DioxusLabs/blitz/blob/45496d9288b063719ebeae4e0761273f7881b3d7/packages/blitz-vibey-script/Cargo.toml).

## Retention and rendering

### Implemented Vite/window boundary

The existing Vite collector resolves the application source graph once. An
explicit desktop target sends that same graph to `compileDesktopProject`, which
uses the shared project discovery/worklist and source analysis. The browser
target retains its existing emission branch. The existing mount scan exposes
the authored string target to create a real native container with that id.

Vite processes ordinary CSS imports and extracted CSS through its CSS/plugins
pipeline. The launcher reads the emitted CSS asset manifest, then installs the
result as real owner-scoped style/text sources. Blitz's Stylo parser/cascade owns
their interpretation; no application CSS bypasses Vite or enters a second style
engine. Native tests verify measured layout and stylesheet removal on retirement.

A separately emitted execution module holds one shared semantic core and native
presentation identity across accepted whole-root reloads. Application imports
use that pinned identity. Runtime selection changes the transport adapter/command,
not authored mount or build semantics. CSS-only rebuilds remount the last compiled
root; content-hashed JS revisions load fresh modules, with remembered factories
for already cached revisions. ESM revision-cache reclamation remains unfinished.

The graphical host uses bounded pipe workers and event-loop wakes. Readiness is
sent after native window/renderer initialization, before the launcher evaluates
the application. Scene acceptance keeps its separate deadline. Native clicks are
captured before default handling, sent with accepted owner/source/generation and
scene sequence, and resumed only after a synchronous cancellation decision.
This first bridge supports click/capture and common event control methods. It
does not yet implement a complete MouseEvent, live HTMLElement refs, native edit
reports, composition, resource loading or browser-layout parity fixtures. M3/M4
are therefore still partial; successful window acceptance is not first-paint or
interaction-latency evidence.

Blitz already implements damage-driven incremental layout, enabled by default
at this snapshot. Resolution performs style traversal, damage propagation,
formatting-context construction, box/text layout, transforms and paint-tree work.
Unchanged subtrees can avoid work. Text changes can damage their paragraph and
ancestors, so precise compiler writes do not imply constant-time layout.
[Resolution pipeline](https://github.com/DioxusLabs/blitz/blob/45496d9288b063719ebeae4e0761273f7881b3d7/packages/blitz-dom/src/resolve.rs),
[damage tracking](https://github.com/DioxusLabs/blitz/blob/45496d9288b063719ebeae4e0761273f7881b3d7/packages/blitz-dom/src/layout/damage.rs),
[configuration](https://github.com/DioxusLabs/blitz/blob/45496d9288b063719ebeae4e0761273f7881b3d7/packages/blitz-dom/src/config.rs).

We will let Blitz build anonymous boxes and inline formatting from the authored
document tree. We will not pre-group paragraphs, compute a second cascade, or
translate CSS to GPUI style structures. Component/fragment regions use comment
anchors, not layout wrappers. Stylesheet source and resource base URLs travel to
Rust as ordinary CSS rather than a reduced selector language.

## Events and the process boundary

The upstream event driver invokes a synchronous Rust handler, then runs an
uncanceled default. It provides document ancestry and event cancellation state.
Simply sending its event to JavaScript and returning would run defaults before
JavaScript can call `preventDefault()`.
[Inspected event driver](https://github.com/DioxusLabs/blitz/blob/45496d9288b063719ebeae4e0761273f7881b3d7/packages/blitz-dom/src/events/driver.rs).

The plan defines a deferred-default adapter: route the native event to JavaScript,
freeze cancellation at the end of synchronous dispatch, acknowledge it, and apply
the native default once if still valid. The Rust UI thread stays available for
publications and input while that acknowledgment is pending. Async continuations
must not hold up the cancellation decision or move its timing beyond web semantics.

Native editing, composition and selection are retained locally. Input reports
carry edit revisions; older accepted property writes cannot erase newer edits.
Cancelable keyboard defaults are ordered at their control, rather than imposing
a global wait on unrelated pointer, scroll and paint work. These requirements
need real integration tests; upstream browser-like event names alone do not
establish browser timing across a process boundary.

## Publication is our responsibility

Mutator flush is not rollback. A mutator changes its document and can perform
resource/platform work during application. We must validate owner/source identity,
operations and final topology before applying the prepared batch. Invalid CSS
declarations follow CSS parsing rules; they are not automatically transaction
failures. Unsupported host operations receive explicit capability diagnostics.

An unexpected failure after applying live mutations is a fatal connection error,
not a refusal claiming the previous document remains intact. No JavaScript
accepted-value cache advances without the corresponding acceptance. Resource
completion and layout/paint are tracked separately from structural acceptance.
The concrete transaction states are in the plan.

## Limits established by the research

Blitz is still beta and its published support tables contain gaps. They are useful
inputs, not acceptance results for our app. Selects, some input types, observer
APIs and some CSS behaviors remain incomplete. HTML controls are engine-rendered;
they are not automatically operating-system widgets.
[Element status](https://blitz.is/status/elements),
[event status](https://blitz.is/status/events),
[CSS status](https://blitz.is/status/css).

Rust-side focus, geometry and queries do not automatically supply the JavaScript
`HTMLElement` interface. Ordinary refs retain their web authoring types and calls,
but each native operation must have a real implementation. Synchronous geometry
requires a synchronous bridge or a precise shared snapshot contract; the initial
process bridge will not replace it with an awaited browser method or pretend a
stale frame is a synchronous browser layout read.

Ordinary JavaScript libraries and existing subscription metadata can use our
shared core. Browser-dependent libraries require actual ref/document capabilities.
Package component compilation and exported metadata resolution are distinct from
bundling inert third-party code. No library is required to adopt a new reactive
engine or desktop-specific authoring API.

### Implemented native document boundary

M2.1 now drives the pinned `BaseDocument` through `packages/desktop/rust`.
Validated source templates instantiate qualified elements, text and comments.
Owner/generation/source references map to live versioned engine IDs; instance
boundaries preserve fragment ordering without element wrappers. Whole text/attribute
write sets validate before application. Native destruction clears affected owner
records through a boundary index, while generation marks reject retired identities.
Unexpected live failure leaves a terminal document rather than claiming rollback.

The native tests exercise actual CSS variables, class changes and stylesheet text
updates through headless engine layout. They do not establish browser box parity,
window painting or JavaScript ref/event behavior.

M2.2a adds a strict versioned JSON write-set decoder and one owning publication
session. It reuses the document validator and mutator rather than adding another
source resolver. Sequence advancement happens after complete live application;
ordinary refusal permits a corrected sequence, while ambiguous application failure
closes the session. Packet/operation limits and JavaScript-safe identity counters
bound this wire surface. Tests verify refusal without redraw, duplicate/gap
rejection, qualified attributes and closed-session replay refusal. The process
reader/writer, structural wire transactions and controlled resource providers
remain M2 work; the native session is not a running process integration.

M2.2b adds combined native transaction validation/application. Its temporary
overlay stages affected ownership/generation facts and candidate containment edges;
accepted source kinds and descendant boundaries come from Blitz. The whole authored
sequence validates before live work, and adjacent writes reuse one mutator. Native
contracts cover candidate targets, nested retirement, retained IDs, replacement
generations and late refusal without earlier effects. The existing mutators still
perform individual structural flushes: controlled provider work remains a gate.

M2.2c connects structural packets to the same native transaction validator. The
session accepts immutable template declarations by key only after their complete
batch applies; later instances reference accepted keys without resending source
nodes. Qualified names/attributes and source topology use the native template
validator. There is no second topology walk in the protocol or another application
access resolver. Ordinary refusal advances neither the sequence nor declarations;
actual partial native failure closes the session. Process transport/provider control
and window integration remain gates; this in-process codec is not a running app.

M2.2d adds bounded stream framing and acceptance-send failure handling. Four-byte
big-endian payload lengths reject oversize/empty declarations before allocation;
JSON serialization is bounded before sending. Split/interrupted reads and terminal
truncation/write/flush failures have native contracts. Failure sending acceptance
after real native application closes the session rather than replaying applied
work. The stream adapters are blocking transport/headless primitives, not a UI
event loop or actual process launch. Worker queues, pending-job teardown and
controlled native providers remain gates before a mounted window is claimed.

M2.2e implements per-document provider containment using Blitz's real shell/net
traits. Nested operations hold requests until complete application; the final
title/cursor/IME settings and one redraw release with successful work. A real
nested engine mount followed by unwind verifies queued resources/platform changes
do not escape, while native nodes remain partially applied and terminal. Reentrant
callbacks run outside the mutex with a bounded total resource budget. Backend
no-op identity and caller abort ownership are preserved; default document-owned
signals abort on shutdown. Already dispatched work cannot be rolled back, and the
actual UI driver still needs nonblocking workers, queues and asset handling.

M2.2f adds the native stream driver and one host executable's private headless mode.
The document stays on its owning thread; reader/writer workers exchange bounded
frames and replies. Publication reserves reply capacity before live application;
writer progress releases capacity and schedules the document without a timer.
Ordinary refusal reports the correctable expected sequence without guessing fields
from invalid JSON. Live failure/lost acknowledgment stops admission with no replay.
Frame-boundary EOF drains replies in order. Generic stream shutdown does not claim
to interrupt a blocked OS read/write. M2.2g's process adapter/client now owns peer
termination and pending-job failure, including deadlines. Real process contracts precede the
mounted TSX window; these workers do not constitute its event-loop integration.

Input editors are initialized during Blitz layout construction. The native contract
checks values written before first layout and subsequent editor updates. The future
input adapter must read live editor state and implement the planned revision/default
contracts; an attribute table alone is not browser input parity.
[Pinned editor construction](https://github.com/DioxusLabs/blitz/blob/45496d9288b063719ebeae4e0761273f7881b3d7/packages/blitz-dom/src/layout/construct.rs).

The first dependency check took 17m 08s; the first test-code compilation took
16m 10s on this machine. The cached final test build took 2.30s and the 17 native
tests passed. These are check/test compilation measurements, not app startup,
window rebuild or event-latency measurements. GPUI's development build cost is
prior experience, not evidence that Blitz starts or compiles faster. The planned
JS/CSS refresh path must reuse the native host; no refresh/startup comparison has
been measured yet.

## Architecture decision

M3.3 adds the first executable compiler phase: fixed hosts, scalar module cells,
ordered attributes and callback/text closures. Existing identifier allocation,
ordered-object emission and access serialization moved into neutral emission
modules; the same cell lowering now accepts a neutral context. Pure text/class
normalizers and attribute-name maps are shared with DOM, without importing DOM
setters into core. Real compiled TSX runs under Bun, Node and a custom adapter
against Rust. Presentation snapshots and accepted callback binding are host
bookkeeping, not another reactive engine. Instance/store guards, scopes, replay,
refs and structural execution remain diagnosed emission gates. M3.4 now wires
ordinary mount into the headless host. Visible window wiring and native platform
events are not yet claimed complete.

M3.2 lowers shared JSX plans to the native immutable template format. Parent and
source indices, fragment roots and structural comment addresses belong to this
target; literal decoding, text joins, ordered attributes and expression-source
facts remain shared. The web SVG classifier moved unchanged to `jsx/namespaces.ts`
instead of being copied into desktop code. A separate compiler support entry
ships this lowering without importing desktop package source or changing app
mounting. Attributes/spreads, events/refs and dynamic/structural expressions stay
as ordered AST work until component JavaScript emission. Real native mounting,
text writes, region insertion and generation retirement are tested; this does not
claim executed source callbacks, broad CSS materialization or a visible window.

The M3.1 implementation connects native acceptance to the existing core render
preparation and effect-boundary capability. New candidates must wait for consumed
resource readiness and native acceptance before shared refs/effects activate.
Refused retirement preserves the accepted lifetime; connection loss disposes
owned core lifetimes even while the publication queue is idle. This is an internal
compiler/host boundary, not another application mounting API. The existing
`mount(target, component, options)` authoring contract remains unchanged. Bun,
Node and a separately selected CommonJS adapter exercise the lifecycle against
the same real Rust host. The milestone log records the actual checks and remaining
emitter/window gates; these internal fixtures do not constitute compiled TSX.

M2.2g adds the engine-neutral JavaScript publication client and execution selection.
The client snapshots bounded candidate batches, admits one active send/reply and
advances ordering only on matching native acceptance plus complete write. Refusal
rejects queued dependent work without replay and leaves the sequence correctable.
Fatal/malformed/out-of-order replies, process loss and per-job deadlines close the
connection and fail pending jobs. Bun and Node use one process adapter; a custom
adapter and CommonJS bundle verify real build-time selection against the same
native host. Compiler/lifecycle integration and ordinary TSX mounting remain M3
gates. No new reactive engine, access resolver or external-source bridge is added.

Build a Blitz-backed native document adapter using our shared compiler analysis
and JavaScript application runtime. Establish transaction and event contracts
before broad native features. Keep the web target stable, preserve the prior
GPUI branch as a reference, and avoid bringing its presentation layer into this
implementation. Complete milestones only with their stated evidence.

M3.4 connects ordinary mount authoring to native compiled root metadata. The
existing `mount-core.ts` realm-wide WeakMap implementation moved into the
host-neutral `root-factories.ts`; browser mounting keeps its typed wrapper and
uses that same store. Native roots register the shared reader/root identity,
not their template hash or authored function name. The build selects a private
runtime entry; application source retains `mount('app', App)` and synchronous
unmount. Accepted template knowledge is connection-local presentation bookkeeping,
not another document tree. Real process contracts cover mount, callback update,
retirement and remount under each supported execution selection.

Inspection of the pinned shell confirms `WindowConfig` accepts the engine's
`Document` trait, whose `inner`/`inner_mut` guards expose one retained BaseDocument
and whose `poll` integrates scheduled work. `EventDriver` invokes the handler
before running native defaults synchronously. The cross-process adapter must
therefore hold cancellable defaults and resume them after JavaScript dispatch
without a blocking pipe read on the UI thread. Merely forwarding a callback
after a default has run does not satisfy event cancellation. Window/CSS painting
and native event/default ordering remain uncompleted gates; this batch does not
claim platform input verification.
