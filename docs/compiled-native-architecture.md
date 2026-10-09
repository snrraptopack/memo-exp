# Compiled native desktop architecture

Date: 2026-10-09. Architecture for Memoized DOM's desktop target. This is the single research document for the desktop architecture. The compiler, retained scene, GPUI window adapter, static CSS, native buttons and text inputs, and persistent paragraph shaping are implemented. Structural publication, additional controls, and native incremental geometry remain future work.

## The technique we aim to use

Compile authored TypeScript and JSX into **persistent native scene templates and direct updates to typed scene slots**. Instantiate structure when its owner mounts, retain that structure in the native host, and update the specific records affected by application state. The host retains layout and paint results and invalidates them according to their dependencies.

The compiler determines the connection between an authored expression and its native destination. Application behavior continues to execute as JavaScript. A native engine owns windows, scene records, text, geometry, input, accessibility, and GPU presentation. A transaction connects application updates to the visible scene.

The intended advantage comes from preparing structure ahead of time and retaining host work between updates. Whether that produces better performance must be established with an implementation and equivalent workloads.

```text
Authored TypeScript / JSX
             |
Shared analysis: state, reads, writes, structure, ownership
             |
             +-- DOM backend --> DOM creation and direct bindings
             |
             +-- Desktop backend
                    |
                    +-- immutable scene templates
                    +-- typed dynamic slots and structural regions
                    +-- application closures and update functions
                                 |
                       accepted scene transaction
                                 |
                       persistent native scene
                                 |
                   dependent layout and paint updates
                                 |
                        platform GPU presentation

Native input --> live handler --> authored state change --> next transaction
```

## GPUIX as an architectural reference

The reference snapshot is GPUIX commit `1a007487ac4c1f0be2ec4e090281ae01e25ec17c`, inspected on 2026-10-08. The following describes that implementation, independently of our proposal.

GPUIX connects React or Solid to Zed's Rust GPUI renderer. Its desktop bridge uses Node-API through napi-rs, and its browser bridge uses wasm-bindgen. GPUI supplies the platform rendering path, with Taffy used for flexbox layout. [Official architecture](https://www.gpuix.dev/#architecture).

```text
React / Solid behavior
    -> framework adapter
    -> shared JavaScript mutation queue with numeric element IDs
    -> serialized batch across the host bridge
    -> Rust retained element tree
    -> requested GPUI view rendering
    -> GPUI element construction, layout and GPU paint

Native event -> JavaScript callback -> another mutation batch
```

The shared queue records operations such as element creation, text/style changes, and child insertion. It flushes through `applyBatch(JSON.stringify(queue))`. [Pinned mutation queue](https://github.com/remorses/gpuix/blob/1a007487ac4c1f0be2ec4e090281ae01e25ec17c/packages/native/js/mutations.ts).

Rust retains element identity and topology, shared immutable styles, and revision information. The GPUIX view builds ephemeral GPUI elements from that retained tree when rendering is requested. Virtual lists defer offscreen subtree construction until layout requests it. This is already a retained mutation architecture; JavaScript does not need to rebuild a complete tree continuously while idle. [Pinned retained tree](https://github.com/remorses/gpuix/blob/1a007487ac4c1f0be2ec4e090281ae01e25ec17c/packages/native/src/retained_tree.rs), [pinned renderer](https://github.com/remorses/gpuix/blob/1a007487ac4c1f0be2ec4e090281ae01e25ec17c/packages/native/src/renderer.rs).

Solid already targets reactive updates directly. Our architectural hypothesis therefore concerns compiler-defined templates and slot destinations, explicit publication contracts, and retained native layout and paint work. GPUIX provides a useful comparison; our scene model and compiler interface should stand independently of its adapters and GPUI element lifecycle.

## What the existing framework contributes

Memoized DOM already analyzes lexical bindings, source reads and writes, callbacks, component relationships, list/branch structure, and presentation ownership. Shared planning lives under `packages/compiler/src/analysis/` and `packages/compiler/src/planning/`. The DOM backend coordinates lowering and emission under `packages/compiler/src/dom/`.

Those source facts are reused by the desktop compiler entry. The compiler root invokes the DOM transform; `@memoized-dom/compiler/desktop` invokes desktop lowering and emission directly. The desktop emitter encodes authored tags and source bindings without translating those tags into GPUI primitives.

The existing ownership, scheduling, preparation, and cleanup contracts establish behavior to preserve. Their implementations must be reviewed for host assumptions before reuse. DOM anchors, ranges, markup parsing, hydration addressing, and `DocumentLike` operations belong to the DOM target. Native structure requires native handles, regions, properties, refs, and publication results.

Keep authored JavaScript evaluation order, exceptions, alias behavior, and callback semantics consistent across targets. Dependency proofs can target known updates precisely. Hidden reads and unknown mutations still require a conservative update path.

## Package and compiler boundaries

Start the desktop backend in `packages/compiler/src/desktop/`, beside the DOM backend. It directly reuses the core compiler's source analysis and planning. The desktop package owns its JavaScript runtime, host bridge, examples, and Rust scene implementation.

```text
packages/compiler/
    src/analysis/       shared source facts
    src/planning/       shared semantic plans
    src/dom/            existing DOM backend
    src/desktop/        compilation and authored scene encoding

packages/desktop/
    src/runtime/        application scheduling and scene publication
    src/bridge/         host transactions and events
    src/scene/          scene wire types
    src/dev/            TSX entry building and target import resolution
    rust/src/tags.rs         native tag translation and content contracts
    rust/src/css.rs          source selector matching and static cascade
    rust/src/template.rs     template validation and native preparation
    rust/src/presentation.rs immutable flow and text-group plans
    rust/src/lib.rs          live instances and atomic publication
    rust/gpui/src/styles.rs   CSS values to GPUI style refinements
    rust/gpui/src/renderer.rs GPUI element phases, focus, input, bounds
    rust/gpui/src/text.rs     persistent GPUI paragraph shaping cache
    rust/gpui/src/input/      retained editing state and platform input handler
```

Expose desktop compilation through a separate `@memoized-dom/compiler/desktop` entry. The compiler root continues to expose DOM compilation. Both backends use the existing core modules; desktop compilation does not invoke the DOM emitter. A separately exported shared pipeline can follow once desktop fixtures establish its required inputs and outputs.

Keep the dependency direction explicit: desktop compilation depends on shared analysis; shared analysis does not depend on either backend. Desktop application execution does not import compiler tooling or parsing dependencies. A build/example runner imports the desktop compiler entry separately from the application runtime.

Reuse the same semantic analysis and ownership contracts across targets. Separately built entry points and enforced import boundaries establish this separation; directory placement alone does not. Extract desktop emission into its own tooling package only when working fixtures demonstrate a useful shared pipeline boundary.

## Native tag translation

`packages/desktop/rust/src/tags.rs` is the authoritative translation registry. The compiler emits element records containing the original tag string, parent index, text leaves, typed slots, and event sites. It checks the supported source syntax and callback contracts. Rust resolves each tag, validates content and event placement, and prepares a native presentation plan before installing the template. Unsupported tags therefore fail at native installation today, rather than at compilation. Error messages identify the template, node, and tag. Future build-time validation should consume the same native definitions instead of maintaining a second semantic registry in TypeScript.

| Authored tag | Native meaning | Current content contract | Presentation preparation |
| --- | --- | --- | --- |
| `div` | Generic block container | Supported flow content | Container item with ordered child items |
| `p` | Paragraph | Text and inline spans | One paragraph item and combined text group |
| `span` | Inline range | Text and nested spans | Remains within its containing text group; no independent flex box |
| `button` | Button control | Text and inline spans | Control item, combined label group, permitted click site |
| `input` (text type) | Editable single-line control | Empty | Retained editor entity, value slot, native change event |
| Semantic blocks (`main`, `section`, `article`, etc.) | Explicit block flow contracts | Supported flow content | Ordered native containers |
| `h1`–`h6`, `pre`, `dt` | Text blocks | Supported phrasing content | Paragraph groups with native default styles |
| `strong`, `em`, `code`, `mark`, etc. | Styled inline ranges | Supported phrasing content | UTF-8 text runs within one paragraph |
| `br`, `hr` | Line break / separator | Empty | Paragraph newline / styled block |
| `ul`, `ol`, `li`, `dl`, `dd` | List / definition flow | Explicit list or flow rules | Retained items; ordered and bullet marker text |
| `container` | Prototype alias for `div` | Same as `div` | Same as `div` |
| `text` | Prototype alias for `span` | Same as `span` | Same inline behavior |

The registry defines supported tags, CSS defaults, and recognized HTML names with pending native behavior. Links, images, forms, non-text input types, tables, media, and other unfinished controls fail explicitly. Adding their names to the pending catalogue does not enable them. The implemented content model is a desktop subset: buttons and inputs are separate controls, paragraphs contain phrasing content, and `li` requires a list parent. Controls use GPUI focus and accessibility roles; headings and paragraph labels use GPUI accessibility nodes. Full HTML semantics, landmark roles, paragraph selection, and rich editing remain unimplemented.

Adjacent text expressions and spans inside a paragraph form one text group. Rust retains their source records, text-slot addresses, and UTF-8 run boundaries. A text change rebuilds the affected group once per accepted transaction; its revision advances when content or run boundaries change. Other groups retain their revisions and identities. In a block container, consecutive phrasing children form an anonymous paragraph before the next block or control. A root span receives its own paragraph presentation item. These rules preserve authored order without treating every string as a separate layout child.

`template.rs` validates immutable definitions. `presentation.rs` prepares flow items and text-group membership once per installed template. Live instances retain group content independently. `text.rs` adds effective text styles, native text runs, font size, line height, wrapping width, and scale to the shaping key. A content revision alone never establishes that geometry or shaping is reusable.

To expand the registry, define the tag's content model and layout category, then implement its native preparation, supported properties, input behavior, focus and accessibility semantics. Add fixtures that exercise rejection, retained identity, and publication failure as well as visible behavior. A tag with no working implementation must remain unsupported; adding a name alone does not enable it.

## GPUI rendering from the developer perspective

GPUI keeps application data in entities. An entity implementing `Render` produces elements for a requested frame; `RenderOnce` supplies reusable element recipes. The ordinary element tree and its callbacks are temporary. Stable element IDs associate appropriate framework state across frames, but do not make every element allocation or layout result persistent. Our retained scene and caches therefore belong outside the returned element tree. [Pinned element lifecycle](https://github.com/zed-industries/zed/blob/9ab0715969e9854f2efe61a9d782e7698e5fe6d2/crates/gpui/src/element.rs).

The standard application pattern is `gpui_platform::application().run(...)`, `cx.open_window(...)`, and `cx.new(...)` to create a root view. Its render method composes elements through styling and child-builder traits. Our window follows this pattern: the root view owns the accepted scene and renderer caches, and returns a custom scene element for each requested frame. [Pinned application example](https://github.com/zed-industries/zed/blob/9ab0715969e9854f2efe61a9d782e7698e5fe6d2/crates/gpui/examples/hello_world.rs).

The custom element must participate in GPUI's actual phases:

| Phase | GPUI contract | Implemented scene adapter responsibility |
| --- | --- | --- |
| `request_layout` | Return a layout ID and request state | Build GPUI styled elements from prepared flow; measure paragraphs through GPUI |
| `prepaint` | Receive computed bounds and prepare frame state | Delegate GPUI clipping, hitboxes and accessibility; observe actual Taffy bounds |
| `paint` | Emit drawing using layout/prepaint state | Delegate visual painting and draw cached native shaped lines |

The adapter can initially use GPUI layout participation while native incremental geometry is developed. `Window::request_layout` registers style and child layout IDs for the current frame; `request_measured_layout` provides a measurement callback receiving known dimensions and available space. Reusing our own measured results is possible only when their inputs match. Do not retain a GPUI frame's layout IDs as native scene handles. Hitboxes and mouse listeners also participate in the current frame and must refer back to a live instance generation and event site. These are adapter obligations, not capabilities established by retaining templates alone. [Pinned window layout and input APIs](https://github.com/zed-industries/zed/blob/9ab0715969e9854f2efe61a9d782e7698e5fe6d2/crates/gpui/src/window.rs).

GPUI text provides `Text` for uniform content and `StyledText::with_runs` for styled runs within one string. Run lengths are UTF-8 byte lengths and must cover the complete string on valid character boundaries. Our paragraph adapter uses GPUI's text system directly with retained source ranges and inherited inline refinements. It caches both intrinsic and constrained measurement probes; unchanged redraws reuse shaped lines. GPUI uses one font size for a shaping call, so per-span font sizes require additional implementation and currently receive an explicit diagnostic. [Pinned text implementation](https://github.com/zed-industries/zed/blob/9ab0715969e9854f2efe61a9d782e7698e5fe6d2/crates/gpui/src/elements/text.rs).

GPUI's `canvas` supplies prepaint and paint callbacks for short custom drawing, but does not implement our scene's control, text, layout, or ownership contracts. Custom `Element` implementations coordinate our scene and cached paragraphs. The GPUI crate remains separate from tag translation and transaction staging, so headless fixtures validate native semantics without requiring a window. [Pinned canvas implementation](https://github.com/zed-industries/zed/blob/9ab0715969e9854f2efe61a9d782e7698e5fe6d2/crates/gpui/src/elements/canvas.rs).

Application developers author supported JSX, ordinary CSS imports, and local JavaScript callbacks, then call the normal `mount('root', App)` from `@memoized-dom/runtime`. The desktop build redirects that import to the target runtime; `runDesktopEntry` owns entry evaluation and root publication. Developers do not construct GPUI elements or maintain renderer caches. The window runner routes native events to live instance generations, waits for window closure, and disposes the application and host. Tests can still dispatch the same event sites directly.

Text input uses GPUI's `EntityInputHandler` and `ElementInputHandler`, following the pinned platform integration rather than a webview. The retained editor owns selection, grapheme movement/deletion, horizontal scrolling, clipboard actions, IME marked text, and shaped-line reuse. Platform ranges are UTF-16; scene text and glyph run ranges remain UTF-8. Composition selection is relative to the inserted composition string. [Pinned GPUI text-input example](https://github.com/zed-industries/zed/blob/9ab0715969e9854f2efe61a9d782e7698e5fe6d2/crates/gpui/examples/input.rs).

Authored `<input type="text" value={value} onChange={...} />` emits a typed value destination and change event. `onInput` is an alias; one change handler is permitted. The exported `DesktopInputEvent` describes the serializable `target.value` and `currentTarget.value` payload. Changes are emitted for committed native edits, while IME preedit remains native. An edit carries a monotonically increasing number; after callback evaluation and scene publication, the runner acknowledges it. Older acknowledgments cannot reset newer edits. The latest acknowledgment reconciles a bound value with accepted authored state, including callback transformations or rejected publication. Unbound inputs retain their native value. Retiring an owner also retires its editor and focus identity.

## Styling through GPUI and Taffy

Research checked on 2026-10-08 against the pinned GPUI source and the local window crate's lockfile. The window experiment resolves Taffy 0.13.0. Desktop styling should use GPUI's existing style types and Taffy's existing layout algorithms. Keep ordinary authored CSS; reuse the framework's existing CSS processing and add the translation needed to supply native style values.

The verified GPUI path is `Style` -> `ToTaffy::to_taffy` -> Taffy layout -> bounds -> GPUI painting. GPUI already translates dimensions, margins, padding, border widths, alignment, gaps, flex properties and its grid representation into Taffy fields. The conversion also handles rem resolution and device-pixel snapping. The adapter should pass styles through GPUI's layout APIs so this behavior remains intact. [Pinned GPUI layout conversion](https://github.com/zed-industries/zed/blob/9ab0715969e9854f2efe61a9d782e7698e5fe6d2/crates/gpui/src/taffy.rs).

Taffy supplies CSS block, flexbox and grid layout. Its input is a typed style for each node; its output is geometry. Text measurement connects through a measure callback. Its high-level tree provides layout caching, while its lower-level traits allow integration with an existing scene tree. These are existing capabilities to reuse. [Taffy 0.13.0 documentation](https://docs.rs/taffy/0.13.0/taffy/).

Taffy 0.13.0 has an optional `parse` feature. It implements `FromStr` for individual style values, including display/flex keywords and grid placement/tracks. Our window crate enables it and uses those existing parsers. It does not accept a complete stylesheet, select `.class`/`#id` nodes, or resolve the cascade. CSS Syntax tokenization uses `cssparser`, the same parser Taffy's feature uses. The adapter normalizes unitless zero in track values to `0px` because this Taffy version rejects it. [Taffy feature declarations](https://github.com/DioxusLabs/taffy/blob/v0.13.0/Cargo.toml), [keyword parsing](https://github.com/DioxusLabs/taffy/blob/v0.13.0/src/style/mod.rs), [grid parsing](https://github.com/DioxusLabs/taffy/blob/v0.13.0/src/style/grid.rs).

GPUI owns visual styles such as backgrounds, border colors/radii, text color/fonts and decoration. Its `Styled` trait writes `StyleRefinement` fields; its style implementation paints the resulting visuals. Hover and focus refinements also belong to GPUI's interaction machinery. Taffy computes the geometry for those elements. [Pinned styling API](https://github.com/zed-industries/zed/blob/9ab0715969e9854f2efe61a9d782e7698e5fe6d2/crates/gpui/src/styled.rs), [pinned style and painting implementation](https://github.com/zed-industries/zed/blob/9ab0715969e9854f2efe61a9d782e7698e5fe6d2/crates/gpui/src/style.rs).

The compiler reuses `@tsrx/core.parseStyle` for imported CSS and `packages/compiler/src/ast/tsrx/style.ts` for scoped TSRX styles. It preserves ordinary class/id attributes, stable scope classes, static inline CSS strings, and static style objects. Immutable templates carry selectors and declarations. Rust resolves specificity, source order, `!important`, shorthands, and the supported target hover/focus states once during installation. GPUI inherits text refinements through the native element hierarchy; inline ranges inherit those refinements within their paragraph.

`rust/gpui/src/styles.rs` translates prepared CSS into GPUI fields for block/flex/grid layout, dimensions, spacing, alignment, overflow, borders, colors, fonts, decoration, opacity, and cursors. GPUI supplies layout and painting. Grid currently supports equal repeated `1fr` or `minmax(0, 1fr)` tracks, matching GPUI's own representation. Lengths support px, rem, percentages where applicable, zero, and auto. Unsupported properties, values, selectors, at-rules, inline box styles, and inline interaction styles fail explicitly. Dynamic style/class expressions, variables, media queries, and general grid tracks remain unimplemented; their future updates must use the scene transaction contract. This is an adapter for ordinary CSS, not a new styling syntax or layout engine.

## Compiler output

Each component or structural region produces a template describing its fixed native structure. A template contains primitive kinds, parent/child relationships, immutable style references, event binding sites, and declarations for dynamic slots. Branches and repeated rows reference their own templates.

A template is a reusable definition. Mounting creates a live instance with an owner, native handles, and application closures. Static structure is installed once per instance. Dynamic text, properties, styles, and child regions remain addressable throughout that instance's lifetime.

The desktop backend emits three connected parts:

| Output | Responsibility |
| --- | --- |
| Scene template | Describe fixed structure, static values, slot types, and structural boundaries |
| Setup and behavior | Initialize authored state, bind live callbacks, establish ownership and cleanup |
| Update functions | Evaluate affected expressions and stage changes to known native destinations |

Slots name their type and invalidation consequences. A text slot affects text content and potentially measurement; a background slot affects paint; a branch slot controls a child region. The host validates operations against the installed template schema.

Template identity, slot identity, and live instance identity are distinct. Several rows can instantiate the same template while holding different state, callbacks, and handles. Compiler identifiers must not accidentally become process-global instance identities.

## Persistent native scene

The native scene is the authoritative host state. It stores live topology, properties, geometry, clips, text resources, and interaction identities. These records survive presentation frames.

Use typed records for common fields and separate storage for variable text, images, and custom control data. Share immutable template/style records across instances. Start with straightforward indexed storage; choose more specialized layouts only after observing actual access patterns.

Every externally addressable handle includes an instance generation or equivalent lifetime protection. A delayed event, acknowledgment, or asynchronous result must not reach a new object that reused a retired index. Each window and application owns its scene and event registry.

Branches and lists retain their necessary live topology. The compiler can prepare their operations, but runtime state still determines which branch exists, which rows are live, and how those rows are ordered.

## A concrete state update

Consider a button displaying an authored counter.

1. The compiler emits a button/text template, a numeric state binding, an event handler site, and a text update function.
2. Mounting creates one scene instance and connects its handler to the live owner.
3. A native click carries the button's instance identity and handler identity to JavaScript.
4. The authored callback changes the counter. Compiler-directed scheduling marks its dependent text update.
5. The update function evaluates the text with the framework's normal semantics and stages a typed text-slot change when publication is necessary.
6. The host accepts the transaction, updates the record, and marks text shaping and measurement dirty.
7. A changed measurement invalidates dependent geometry. Unchanged measurements allow unaffected geometry to remain cached.
8. The host refreshes affected paint records and presents the resulting scene.

The button and its owner remain the same instance. A background-color change follows the paint path without requesting text shaping. A row movement follows the structural path without reconstructing the row's authored state.

## Structural regions and lifetime

Branch replacement prepares a candidate subtree and its ownership before publication. Acceptance makes the new subtree visible and retires the old one. A failed preparation or rejected transaction leaves the previous visible subtree intact; staged owners and host resources are released.

Keyed rows preserve the association between a key, its application owner, and its native instance. Reordering changes placement while preserving state, focus where applicable, and handler identity. Removing a row retires its subscriptions, callbacks, pending work, and native resources according to the same lifetime contract. Positional lists preserve their own established semantics.

Cleanup must run exactly once for each retired owner. Late asynchronous work checks ownership before publishing. Reentrant callbacks cannot resurrect a retired handle or publish against an obsolete scene generation.

Virtualization needs a separate authoring contract. Deferring paint and layout does not automatically permit deferring component setup, effects, or data work. Define which row lifetimes are visible, retained, or suspended before using viewport visibility to change execution.

## Transaction and acknowledgment contract

The bridge exposes template installation, instance creation, typed slot updates, region insertion/movement/removal, disposal, and event registration. Commands refer to installed definitions and live handles. Their encoding can evolve while the operation semantics remain stable.

An update transaction carries its application/window identity, sequence, expected scene generation, and ordered operations. The host checks handles, slot types, structural constraints, and resources before committing. Validation and staging must be sufficient to prevent partial visible publication when an operation fails.

The publication sequence is:

```text
Authored mutation
    -> dependency scheduling and expression evaluation
    -> staged scene operations
    -> host validation and resource preparation
    -> atomic scene acceptance
    -> publication acknowledgment
    -> dependent layout and presentation
```

Host acceptance, completed layout, and presentation are separate milestones. Value caches that suppress later writes advance only after acceptance. A rejected update retains a pending publication or reports failure through the owning operation. Scene transactions do not automatically roll back arbitrary authored JavaScript side effects.

Native refs expose supported host operations. A bounds-reading effect waits for the corresponding layout acknowledgment; a focus request needs a live accepted control. Callbacks cannot synchronously read geometry for a transaction the host has not processed.

Repeated pure writes to one slot can be coalesced within a transaction when their contract permits it. Structural operations, focus transitions, event delivery, and authored expression evaluation preserve their required ordering.

## Layout and paint invalidation

Track content/measurement, structure, geometry, paint, hit testing, and accessibility as distinct work domains. Their dependencies determine what must be recomputed.

| Change | Initial invalidation | Possible dependent work |
| --- | --- | --- |
| Text content or font | Shaping and measurement | Parent/sibling geometry, paint, accessibility |
| Background color | Paint | Compositing where required |
| Width or layout constraint | Geometry | Descendant layout, clips, hit testing, paint |
| Child insertion or movement | Structure and layout | Ordering, focus traversal, accessibility |
| Scroll offset | Visible placement and clipping | Hit testing, visibility, paint |

Intrinsic dimensions can affect ancestors and siblings. A local write therefore does not guarantee that layout work stays local. An initial implementation may use a general layout engine behind the scene interface, then add proven incremental behavior without changing application contracts.

Retain shaped text, measured results, and paint records using the inputs that actually determine them. Font changes, scale changes, wrapping constraints, inherited properties, clipping, and ordering invalidate the appropriate caches. Retained CPU work and partial GPU presentation are separate mechanisms; the GPU may still draw the complete frame.

## Input, scheduling, and platform services

The host owns hit testing, pointer capture, focus traversal, selection, caret presentation, and IME integration. Native feedback can update presentation without an authored callback. Application-defined behavior dispatches through the live handler registry and participates in normal state scheduling.

Begin with a clear platform event-loop integration and one ordered publication path. Render on demand when accepted changes, platform damage, or active animation require it. Idle applications should not reconstruct scene descriptions or poll authored state unnecessarily.

The renderer consumes a stable accepted scene. If JavaScript and rendering use different threads, event sequencing, scene publication, acknowledgments, and resource retirement need explicit synchronization. Thread separation is an implementation choice to evaluate after the initial path works, subject to each platform's UI-thread requirements.

Use native window, GPU, text, and accessibility services behind interfaces owned by the scene engine. Rust is the proposed host implementation language; the JavaScript engine and binding mechanism remain open choices. The compiler continues to emit JavaScript for ordinary application behavior.

Define supported primitive and style semantics explicitly. Desktop refs and input events need their own typed contracts. Text editing, font fallback, keyboard navigation, DPI changes, and accessibility must be exercised as architectural behavior rather than added after the drawing path is assumed complete.

## First implementation and validation

The implementation compiles fixed authored-tag scenes, static CSS, primitive text/value expressions, and synchronous component-local control handlers. Rust translates the explicit flow/text/control registry above. The compiler reuses core parsing, CSS processing, declaration normalization, lexical state discovery, callback write analysis, and expression-source planning. Unsupported structural expressions, props, dynamic styles, asynchronous callbacks, and eager reactive derivations receive diagnostics while their desktop contracts are developed.

`packages/desktop` contains a Bun runtime and a Rust process host. The host installs immutable templates, retains scene instances, validates text slots and generations, and stages affected instances before accepting a transaction. Runtime value caches advance after host acceptance. The initial JSON-line bridge is inspectable and establishes operation semantics; it is not a transport performance result.

The example lives in `packages/desktop/examples/counter/main.ts`, `App.tsx`, and `app.css`. Both the window and headless runners build this same normal mount entry. The window demonstrates native counter buttons, an editable text input with echoed state, headings, paragraphs, styled inline runs, Unicode text, line breaks, flex spacing, constrained width, and equal grid columns. The smoke test observes actual Taffy bounds, dispatches a counter update, and checks that unchanged redraws add no shaping work. Its debug-only input commands invoke the same native handler used by platform input, exercising rapid Unicode edits, backspace, selection, IME preedit/commit, and callback publication. Physical pointer/keyboard and installed IME behavior still need interactive platform testing. Branch/list publication and additional control types remain future work.

Run the current prototype from the repository root:

```sh
bun run test:desktop
bun run desktop:dev
bun run desktop:test:window
bun run desktop:counter
```

The desktop test command runs Bun compiler/runtime/bridge tests and type checks, plus Cargo tests for the Rust scene engine. The Rust host uses the installed Rust 1.96.0 toolchain pinned in its directory. Generated templates are shared module constants; an application installs each template object once, then mounts independent live instances.

The separate window crate depends on [Zed commit `9ab0715969e9854f2efe61a9d782e7698e5fe6d2`](https://github.com/zed-industries/zed/tree/9ab0715969e9854f2efe61a9d782e7698e5fe6d2/crates/gpui). Its first build compiles GPUI's platform dependencies. The headless crate remains independently buildable. The adapter constructs temporary GPUI elements on requested frames while retaining templates, styles, scene records, focus handles, and paragraph shaping. Native incremental geometry and retained paint plans still need implementation and measurement; this prototype does not establish a performance advantage over GPUIX.

Build one native window with containers, rectangles, text, clipping, pointer input, and an editable text control. Implement templates, live instances, typed slots, publication acknowledgments, and disposal before expanding the control set.

Compile fixtures for a counter, child prop update, branch replacement, keyed row movement, and text editing. Verify visible state, instance identity, callback ordering, cleanup, focus, measurement dependencies, and rejected publication. Exercise delayed events, asynchronous cancellation, reentrant updates, and handle reuse.

Instrument update functions, bridge calls, touched scene records, layout visits, text shaping, and paint regeneration. The resulting traces must show that unrelated instances remain untouched where dependency proofs permit it. Measure input-to-presentation latency, frame work, idle CPU activity, and repeated mount/disposal behavior.

Use GPUI/Taffy for the current layout, text and presentation path. Evaluate native geometry reuse, bridge encoding, and thread arrangement with those fixtures. Comparisons with GPUIX must match visible behavior and lifecycle guarantees. Performance claims follow those measurements; the core commitment is compiled structure, direct native slot updates, persistent host records, and coherent publication.

## Stability priorities after native text input

The process bridge now shares one shutdown among concurrent callers, rejects new work during shutdown, validates response envelopes, and retires a failed connection and its outstanding requests. Explicit native transaction rejection remains recoverable. Crash diagnostics retain only their final 16,384 UTF-16 code units. Fault-injection tests cover concurrent shutdown, native crashes, invalid envelopes, and recovery after rejection. Startup/request deadlines, backpressure, and ambiguous publication after connection loss remain unresolved; a lost acknowledgment must not be treated as proof that a transaction was rejected.

Review findings checked against the implementation on 2026-10-09:

| Finding | Current evidence | Decision |
| --- | --- | --- |
| Application publication sends one operation per transaction | Addressed by `runtime/publication.ts`: concurrent ready owners prepare one microtask batch; installations form ordered barriers | Retain rejection, callback ordering, and disposal tests as structural operations are added |
| Shared state does not invalidate other owners | Event metadata currently tracks component-local lexical writes; `app.flush()` alone does not invalidate other instances | Establish source ownership and dependency subscriptions before claiming shared-state support; do not blindly flush every owner |
| Child components cannot attach inside their parents | Component tags, props, branches, and lists receive compiler diagnostics; current instances render as independent roots | Add typed region destinations and child attachment, then props, conditional replacement, and keyed lists with explicit ownership |
| Styles cannot reach the native renderer | Obsolete: templates carry attributes, declarations, and stylesheet rules; Rust prepares GPUI/Taffy styles | Extend validated CSS semantics and dynamic destinations without introducing a second authoring style language |
| Editing depends on round trips for caret and IME | Obsolete for implemented text inputs: native entities retain editing state and use numbered reconciliation | Test transformed/rejected bound values, focus retirement, physical IME, clipboard, resizing, and DPI; additional controls are still pending |
| Headless and window hosts duplicate the whole engine | Both use the same Rust scene library and `bridge.rs`; only their platform loops differ | Keep independent headless builds. Share protocol semantics and parity tests; shipping the diagnostic executable is unnecessary |
| JSON pipes have a proven frame-rate ceiling | No matched workload or timing evidence exists yet | Instrument publication latency, payloads, allocations, layout, and shaping before changing transport |

The application publication queue evaluates all participating destinations before sending a batch, preserves installation and operation ordering, and advances participating value caches only after one successful acknowledgment. A throwing destination restores already prepared owners; native rejection leaves the whole batch pending at the same sequence. Later invalidations survive an in-flight batch. A mismatched acknowledgment retires publication because acceptance is ambiguous. Ready sibling mounts and disposals can share transactions. Repeated callbacks on one owner retain execution order and return values while final pure slot writes can coalesce. Retirement suppresses updates that have not been prepared; already accepted updates precede disposal. Unrelated owners retain identity and avoid unnecessary reads. Rust integration tests verify that two sibling mounts, updates, and disposals each advance one native sequence. This scheduler does not discover dependencies on shared state, and it does not defer already running authored callbacks to an animation frame.

Nested components need more than a portal field. A parent region defines the attachment destination, child order, live ownership, and allowed content. Rust must reject cycles and retired destinations atomically. Removing a parent retires its descendants and focus/input state. Reordering keyed children preserves instance identity; replacing a branch retires the previous owner. These rules should be exercised in compiler, headless scene, and native window fixtures before expanding the tag catalogue.

In-process integration remains a later experiment. GPUI constructs its app on the platform main thread; replacing pipes with a DLL also requires an event-loop, thread, callback, and memory-lifetime design. Bun currently describes `bun:ffi` and thread-safe callbacks as experimental. Its documented conversion and marshaling work does not support a claim of zero overhead. [Bun FFI documentation](https://bun.com/docs/runtime/ffi).
