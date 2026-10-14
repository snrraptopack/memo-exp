# Blitz implementation plan

Updated: 2026-10-14. Branch: `codex/blitz-renderer`.

Current user-directed order: establish a richer fixed-content visual example and
measure its native layouts before expanding M4 events. The dashboard is the first
M6 visual fixture. It does not complete M6 browser parity or waive M3's component
and structural emission gates. Reuse the existing launcher and normal mount/CSS
authoring; do not introduce a drawing or styling API for this fixture.

This is the implementation plan for the architecture described in
[research.md](research.md). Completed batches and decisions belong in
[milestones.md](milestones.md). The following architecture is selected; milestones
are execution gates, not an unresolved design questionnaire.

## Product contract

Applications use the framework's ordinary TypeScript, TSX, CSS imports, component
composition, event callbacks, refs and mount calls. Selecting a desktop build is
a host/build configuration choice. Source code does not require desktop event
types, another state model, another CSS syntax, helper imports for ordinary ref
methods, or awaits on methods that return void on the web.

The compiler owns dependency analysis and presentation destinations. The shared
JavaScript core owns application state, access routing, reactive execution,
subscriptions, effects and cleanup. Rust owns the retained native document,
native editing/selection, platform input, resources, style/layout and painting.
Blitz owns HTML/CSS presentation semantics inside that Rust host.

## Change control and reuse rules

1. Start from main `f3e1a794d5652d91bab27590519d6fb04f7a99cc`. Preserve unrelated
   working edits, including `examples/fullstack/src/Main.tsx`.
2. Add desktop-specific code in its own modules. Reuse existing semantic modules
   through their real interfaces. Do not implement another kernel, access
   resolver, state-cell store, external-source bridge or effect system.
3. Before changing an existing compiler/runtime/build module, communicate the
   concrete files or boundary, why the change is needed, its behavioral impact,
   and the checks that will preserve web behavior. Record that communication in
   the completed milestone. This applies to cherry-picked/refactored old desktop
   work too. Communication is required before implementation, not after a diff.
4. Changes needed for sharing must be narrow, preserve default web behavior, and
   have compiler-output or runtime parity evidence. Do not merge the entire
   `codex/desktop-renderer` branch into this branch.
5. Preserve the optimized DOM list implementation. Native lists consume shared
   source/key plans and manipulate native ranges; they do not force a rewrite of
   browser reconciliation or introduce a generic slow path into the web target.
6. Keep code spaced and readable, with comments explaining ownership, ordering,
   failure states and non-obvious invariants. Avoid unexplained compressed code.
7. Run Bun JS tests/checking and `cargo +1.96.0` native checks. Complete one coherent
   tested batch, update the milestone log, commit and push the branch, then verify
   its remote commit. Do not run a heavy native link beside the full JS suite.

## Architecture

```text
Application TSX / modules / ordinary CSS
                       |
Shared compiler source graph, analysis, access and render plans
                       |
Desktop emitter: immutable templates, destinations, closures and access tables
                       |
Shared core: cells -> guarded writes -> dirty entities -> direct update work
                       |
Desktop host adapter: ordered publication and accepted lifecycle
                       |
Rust host: validated document operations and owner/source -> Blitz node map
                       |
Blitz document -> Stylo CSS -> Taffy/Parley layout -> native paint/window

Native input -> event packet -> synchronous JS dispatch -> cancellation reply
            -> native default / edit report -> ordinary reactive publication
```

### Code placement and dependency direction

The planned source layout is:

```text
wiki/blitz/
  research.md                         inspected architecture and rationale
  plan.md                             selected architecture and ordered gates
  milestones.md                       completion evidence and decision history

packages/compiler/src/
  analysis/                           existing source facts; shared coordinator
  linking/                            shared project discovery and identity
  planning/ jsx/ lists/ handlers/      existing target-independent plans
  dom/                                existing browser target
  desktop/                            native template/destination emission

packages/runtime/src/
  core.ts                             additive entry for existing semantic primitives
  kernel.ts access.ts state-cells.ts   existing implementations, not copies
  environment.ts refs.ts effect.ts    narrow host hooks where required
  list*.ts markup.ts setters.ts       existing browser implementation

packages/desktop/
  src/host/                           template, packet, transport and acceptance types
  src/runtime/                        core-to-native preparation/publication adapter
  src/dev/                            Vite build/watch, runtime selection and host launch
  examples/                           ordinary TSX entry and CSS fixtures
  tests/                              JS host/compiler/lifecycle contracts
  rust/Cargo.toml                      one native host crate, library and window binary
  rust/src/protocol/                  packet decoding and topology validation
  rust/src/document/                  templates, native identities and mutations
  rust/src/events/                    routing, pending defaults and acknowledgments
  rust/src/controls/                  accepted-value/edit-revision reconciliation
  rust/src/resources/                 asset bases and resource lifetime
  rust/src/window/                    Blitz shell, paint and inspection hooks
  rust/tests/                         native contract/integration checks
```

Paths denote responsibilities, not a requirement to create empty directories
before they have implementations. Application names remain `desktop`; Blitz is
the selected native engine dependency rather than a new framework authoring API.
The compiler imports neither desktop package source nor Rust source. Protocol
consumers use explicit types and generated package-local capability artifacts
when build diagnostics need them. Rust is the single authority for native host
capabilities; generated copies are checked for drift.

The native crate pins Blitz revision
`45496d9288b063719ebeae4e0761273f7881b3d7` and commits its lockfile. The initial
window path uses `blitz-shell`, `blitz-paint`, and AnyRender's Vello renderer. Use
explicit feature selection for actual controls, fonts, accessibility and resources.
Do not enable the optional Boa application engine or upstream application wrappers.

### Shared compiler integration

Extract one source-analysis coordinator from current DOM coordination, with
explicit preparation/lowering hooks. DOM keeps its existing hook implementation
and pass order. The desktop hook uses the same module state, components, helper
summaries, render callbacks, ref exclusion, volatility, computed/control-flow
analysis, read collection and graph checks. Manifest discovery and whole-project
linking use that same coordinator, not a second discovery walk.

The desktop emitter consumes shared component, attribute, child, branch and list
plans. It emits immutable template records and direct slot/property/structure
updates alongside the existing core access table and cell ABI. JSX evaluation
order, thrown exceptions and callback writes remain authored JavaScript semantics.

M3.2 establishes template lowering in the separate `compiler/desktop` build entry.
The emitted backbone carries source addresses, while ordered AST steps retain
attributes/spreads, events/refs, text and structural work. This support entry does
not yet compile a whole application. M3.3 now executes fixed-host/module-cell
closures with shared cell lowering, reader serialization and M3.1 acceptance.
Initial mount and values publish together; queued source work resumes through
core invalidation after acceptance or freed credits. M3.4 wires native root
metadata into the existing shared root registry and selects the normal mount
entry at build time. The launcher privately observes acceptance; authored mount
and unmount remain synchronous. M3.5 integrates the visible Vite CSS/window
counter. M5.1 adds static local and imported child components: delayed child
factories preserve parent-first core registration, shared owner paths and one
accepted region-mounted publication. Extend guarded instance/store publication,
conditions, forwarded content and lists through the shared plans afterward. M5.2
completes reactive prop replay with the existing
core `registerProps`/`setProps`
box for local, nested and linked imported component calls. The neutral compiler
prop initialization/replay builders are shared; no desktop prop store or dirty
scheduler exists. Keep normal `mount()` imports and calls; source-plan
descriptors alone do not close runtime capability gaps. M5.4–M5.7 now establish
staged replacement, shared inline/return conditions and lazy nested/forwarded
component children over accepted native ranges. Both targets consume the same
pure render-slot predicates and linked caller-usage mapping. The counter's
ordinary `Panel` exercises nested children. M5.8 adds direct JSX-valued props using
the same content factories and shared condition plans; target-side access-table
destinations replay their callers where native placement differs from lexical
region identity. M5.9 selects the existing JSX alias/collection normalizer and
shares static spread contract discovery/property mapping between targets. Opaque
JSX prop bags, render callbacks and keyed lists remain subsequent M5 gates.

M5.10 establishes the native keyed range lifetime prerequisite. One core list
entity retains row presentations; source resolution and callback contracts remain
in shared compiler plans. Use the existing key encoder and native range operations.
Stage additions outside core, suspend outgoing updates, and advance item/index
bindings only after structural acceptance. Refusal discards staged additions and
keeps accepted rows/events. Fresh native generations distinguish reinsertion from
retired addresses. Pending source changes replay through core invalidation. Native
placement uses temporary neighbor links without modifying web reconciliation.
The next emission batch consumes `ComponentListSites`, `planListCallback` and
`planRenderCallback` to generate these row factories and their binding updates.
Keep unsupported store/write forms diagnostic until existing guarded publication
is wired; runtime range support alone does not close the authored-list gate.
Complete M5 only after ordinary keyed Todo authoring and native focus/selection
checks also pass.

Reuse the previous desktop branch's shared extraction work only after comparing
it against current main and its web output. Reuse its template/lifecycle concepts
where they meet this plan. Its GPUI-specific tag catalogue, cascade, paragraph
grouping, style conversion and native rendering code do not become Blitz layers.

### Templates and native identities

A template contains a stable module/template key, source nodes, text/value
destinations, event registrations, structural-region descriptors and stylesheet
references. Nodes retain authored tag/namespace, parent index, attributes and text.
Stylesheet payloads contain built CSS text, source identity and resource base URL.
Styles and class updates follow ordinary CSS semantics, including attribute/style
replacement and removal.

Instances have an owner ID and generation. Rust maps each instance source index
to a versioned Blitz node ID. It also records owned root ranges and region anchors.
Blitz's document tree is the presentation tree; no second cascade, paragraph tree
or shadow browser DOM is maintained in JavaScript.

Structural regions have non-layout comment boundaries. Component fragments and
forwarded children insert their roots at these boundaries with no artificial
element wrapper. Keyed moves retain node identity, focus, selection and native
editing state. Retirement removes native ranges and source mappings only after
acceptance. Events from retired generations are ignored.

### Native publication and failure states

The initial transport is a persistent JavaScript-to-Rust process connection with
versioned packets and ordered scene sequences. Bun is the default execution
backend, with Node using the same Node-compatible host adapter. Custom engines
declare their command, module format and host adapter through build configuration.
The portable publication client depends on that adapter's send/observe/deadline/
dispose capabilities, not Bun/Node APIs. Engine-specific APIs remain in the
selected adapter; unused adapters do not enter the application bundle. Bun remains
the JavaScript test/check runner. Vite owns application graph compilation, CSS
processing, plugins and watched builds independently of the execution engine.
Application and CSS builds must not depend on Bun.build. The existing Bun
transport fixture bundler remains a private ABI test helper only.
Runtime selection does not promise Node API compatibility for a custom engine.
The interface does not define application authoring. Keep mutation batches small and do not
rebuild/send the entire document on each update.

Frames have a four-byte unsigned big-endian payload length followed by UTF-8 JSON,
bounded to 1 through 1,048,576 payload bytes before allocation. Stream readers and
writers run off the UI thread; bounded queues hand complete packets/replies to the
native event loop. Partial frames and I/O failure close the connection. Immutable
templates declare once by key, with later instance mounts referring to accepted
keys. Candidate declarations become accepted only with their complete scene batch.
The connection-owning `NativeApplication` filters accepted and already-pending
keys for every publication source. Root mounting does not own a separate cache;
refusal releases pending keys for an exact retry.

| State | Required behavior |
| --- | --- |
| Collected | JS has computed candidate updates; accepted caches and lifecycle remain unchanged |
| Validated | Rust has checked all references, operations and final topology against staged affected records |
| Applied | Rust applies the complete prepared operation batch with no concurrent paint/input dispatch between its mutations |
| Accepted | Rust acknowledges the sequence; JS advances caches, activates refs/effects and retires accepted old owners |
| Painted | Blitz resolves and paints accepted state; native frame/geometry metadata advances separately |
| Refused before application | Accepted state remains unchanged; caller receives an explicit diagnostic and can correct/retry |
| Failed after application or lost acknowledgment | Acceptance is unknown; retire the connection and fail pending jobs rather than retry the sequence |

Validate a minimal staged ownership/topology model before touching the Blitz
document. It is protocol bookkeeping, not another rendered scene. Prepare the
operation list and allocations before live application where practical. Keep
resource requests and redraw notifications on a controlled host provider so
unaccepted candidate work cannot leak effects. CSS parsing follows browser rules;
ignored declarations are not fabricated host refusals.

No blanket rollback claim is made for `DocumentMutator`. Unexpected failures
after mutation use the fatal connection state. Ordinary explicit validation
refusal preserves the accepted document and JS lifetime contract.

### Event routing and cancellation

Each native event packet carries dispatch ID, type, native timestamp, live source
identity, composed source path, cancelability and necessary input/pointer payload.
The JS adapter creates ordinary target/currentTarget snapshots and dispatches
through the framework's existing callback/write machinery. It routes once through
the path; native bubbling must not repeat the same JS ancestor dispatch.

Cancellation freezes at the end of synchronous JS dispatch, including synchronous
prefixes of async handlers. Send the result immediately. Async handler completion
continues through the existing application scope and error path; it must not
delay a key's default or make `preventDefault()` after an await take effect.

For a cancelable native default, intercept upstream default execution and retain
the operation under its dispatch ID. On acknowledgment, recheck source generation
and applicable control state; apply the uncanceled default exactly once. Generated
native events reenter routing with their own identity and cannot repeat the
original default. Reject duplicate/unknown acknowledgments. Bound pending queues;
overflow or lost dispatch acknowledgment fails the connection rather than silently
dropping user input or choosing an arbitrary cancellation result.

The Rust UI thread never blocks waiting for JavaScript. Publication, pointer,
wheel, redraw and native editing reports remain independently serviceable.
Order dependent keyboard defaults per control. Native input reports carry edit
revisions; skip stale controlled-value writes while a newer edit/composition exists.
IME preedit stays local, and committed edits notify JS without waiting for a full
scene repaint. Reuse the previous input reconciliation contracts where applicable;
Blitz owns the actual editor instead of creating another editor beside it.

### Core runtime, lifecycle and refs

Expose the existing semantic modules through `@memoized-dom/runtime/core`.
The native build selects the desktop mount/presentation implementation for the
ordinary framework mount import. Web and server builds retain their existing
selection. Application source and general JSX event/ref types do not change.

Add only the host lifecycle capabilities required by accepted native publication:
ref activation and effects after acceptance, native visibility/frame scheduling,
and host operations separate from source invalidation. Keep the current web
defaults and ordering. Ref cleanup, reverse teardown, subscriptions and staged
candidate disposal remain the existing core contracts.

Keep the existing public `mount(target, component, options)` signature. Candidate
preparation, publication and retirement are private compiler/host operations;
applications do not import them, choose a different mounting function or await
ordinary ref methods. Engine and presentation selection belong in build/launch
configuration. M3.1 implements the internal acceptance boundary first; that batch
alone does not complete the ordinary mounted window gate.

Native refs expose implemented ordinary methods directly. `focus()` and `blur()`
return void, with internal transport/error reporting. Do not export desktop focus
helpers or awaited versions of browser geometry methods. Initial ref acceptance,
focus preparation, disconnected handles and owner retirement have explicit checks.
The initial bridge does not claim synchronous layout reads or a full `Document`.
Compiler diagnostics cover provable unsupported uses; unresolved dynamic uses
receive explicit adapter errors. Expand real capabilities before claiming a
browser-dependent library works.

### CSS, assets and external libraries

Reuse existing TSX CSS extraction/scoping and normal CSS build output. Transport
that output to Stylo without translating it into an alternate property language.
Resolve stylesheet URLs against their module/asset base; retain source identity
for updates and diagnostics. Relative fonts/images are build assets. Initial
resource handling uses package/build resources and opt-in network access; resource
completion schedules Blitz's normal document work.

Ordinary library functions and existing external subscription metadata stay on
the core path. Uncompiled singleton state remains ordinary library state, not
automatically application-isolated cells. Package component source integration
uses explicit package exports and the shared project resolver; do not compile
every dependency or demand libraries rebuild with our compiler. Native document
capabilities are a separate compatibility requirement.

### Development workflow and measurement

Provide three separate operations: native dependency/build setup, application
development/watch, and production packaging. The dev command starts a previously
built native host and rebuilds only changed JS/CSS. It invokes incremental Cargo
only for native source/dependency changes or a missing host binary. Application
refresh disposes and remounts through a coherent accepted generation; failed builds
leave the prior accepted application visible. State-preserving HMR is outside the
initial refresh contract.

Record cold native compilation, incremental native compilation, JS/CSS build and
refresh, process-ready time and first visible frame separately. Repeated desktop
tests reuse the binary. A single command that rebuilds every package and relinks
native dependencies for every TSX edit is not the planned dev workflow.

## Ordered milestones

Each milestone can contain multiple reviewable commits. Update the log after
each completed batch; completing one batch does not mark the whole milestone
complete unless every gate below passed.

| ID | Deliverable | Completion evidence |
| --- | --- | --- |
| M0 | Architecture research, plan and milestone records | Main baseline verified; real compiler/runtime and pinned Blitz surfaces inspected; documents and links checked; no production changes |
| M1 | Shared semantic/compiler boundary | One analysis/project coordinator and core entry; no duplicated engine; unchanged DOM output on all compiler fixtures; targeted shared tests, root tests, package builds/checks pass |
| M2 | Native document/transaction foundation | Pinned Blitz library builds; template/identity/range mapping; mount/text/property/order/dispose contracts; explicit refusal leaves document intact; ambiguous application failure terminates connection; Rust tests and headless layout checks pass |
| M3 | Ordinary counter through native mount | Desktop emission uses shared plans and access tables; normal TSX mount and CSS show in a window; counter update/ref disposal verified; native host is reusable between runs |
| M4 | Event defaults and native text input | Synchronous cancellation timing, async continuations, acknowledged defaults, bursts, native editing, composition and stale-value reconciliation pass JS/Rust and real platform tests |
| M5 | Cross-module and structural parity | Cells/helpers through imports and barrels; branches/fragments/forwarded content/render callbacks; keyed Todo insert/move/remove preserves row state/focus/selection; atomic refusal/cleanup tests pass |
| M6 | CSS and browser layout parity | Raw scoped/built CSS, variables/media/layers/selectors/resources; wide/narrow Todo and inline fixtures compared with Chromium boxes/fragments; unsupported cases diagnosed; no custom cascade or paragraph engine |
| M7 | Refs, lifecycle and library contracts | Ordinary void focus/blur, ref retirement and lifecycle acceptance; core subscriptions and opaque pulls; real packaged dependency fixture; capabilities documented without claiming a full browser DOM |
| M8 | Reliable dev workflow and comparative evidence | TSX/CSS edit refresh avoids Cargo; native edit uses incremental Cargo; process failure/close is bounded; compiler/web regression gates pass; startup/update/input traces recorded with reproducible commands |

M4 follows the first window but precedes broad structural/features work so the
process/event architecture is validated early. M5 must verify core state and
lifetime before adding broad CSS/resource coverage. M7 extends capabilities from
real library/ref fixtures rather than speculative browser API copying.

## Verification and records

Before M1, capture main's DOM compiler output for the fixture corpus. Every shared
extraction compares output to that baseline and explains any intentional change
before implementation. Runtime parity fixtures exercise the same source behavior
through web and native hosts, including rejected staged subtrees and disposal.

Native checks distinguish structural acceptance from completed layout/paint and
match full owner generations. Browser comparisons use the same authored CSS/content
and document their UA/font normalization. Event tests compare cancellation timing,
focus, edits and selection, not merely a successful screenshot.

For every completed batch, record files changed, actual decisions, reuse, prior
change communication, commands and results, limitations, commit and remote status.
Only record completed evidence as completed. A missing toolchain, failed build or
contract mismatch is a real blocker/failure entry, not an implementation milestone.

No production renderer switch, wholesale branch merge, or alteration of existing
web semantics is implied by completing this documentation milestone.
