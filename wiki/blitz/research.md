# Blitz architecture research

Updated: 2026-10-12. Branch: `codex/blitz-renderer`.

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

The exact analysis order currently lives in `dom/analyze.ts`; preparation in
`dom/prepare.ts` mixes source work with DOM lowering. Manifest discovery also
imports DOM preparation. Therefore a second emitter cannot safely reproduce a
shortened list of passes or pretend the whole compiler is already host-neutral.
The selected approach is one shared coordinator with explicit target preparation
hooks, extracted with unchanged DOM output. The previous desktop branch provides
an implementation reference for this extraction.

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

Its current `NodeId` includes a slot version to reject stale storage identities.
We still need our mapping from owner generation and source node to that ID;
Blitz identity does not encode our component or keyed-row lifetime.
[Node identities](https://github.com/DioxusLabs/blitz/blob/45496d9288b063719ebeae4e0761273f7881b3d7/packages/blitz-traits/src/node_id.rs).

The source includes an optional Boa-based JavaScript module for its browser app.
That is separate from driving a Rust document and is not our chosen execution
model. We retain Bun and the existing JavaScript runtime.
[Optional scripting crate](https://github.com/DioxusLabs/blitz/blob/45496d9288b063719ebeae4e0761273f7881b3d7/packages/blitz-vibey-script/Cargo.toml).

## Retention and rendering

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

No Blitz integration, startup, rebuild or event-latency measurements have been
completed in this branch. GPUI's development build cost is prior experience;
it is not evidence that Blitz will compile or start faster. The plan separates
cold native compilation, incremental native compilation, JS/CSS refresh, process
startup and time to first visible frame so these claims can be tested.

## Architecture decision

Build a Blitz-backed native document adapter using our shared compiler analysis
and JavaScript application runtime. Establish transaction and event contracts
before broad native features. Keep the web target stable, preserve the prior
GPUI branch as a reference, and avoid bringing its presentation layer into this
implementation. Complete milestones only with their stated evidence.
