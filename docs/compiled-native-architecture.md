# Compiled native desktop architecture

Date: 2026-10-08. Architecture proposal for Memoized DOM's desktop target. This is the single research document for the desktop architecture. The desktop backend and native scene engine described here are proposed work.

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

Those source facts are the starting point for desktop compilation. The current public compiler entry still invokes the DOM transform. The desktop target needs its own lowering and emission path, with explicit shared inputs; the existing separation does not mean a desktop emitter is implemented.

The existing ownership, scheduling, preparation, and cleanup contracts establish behavior to preserve. Their implementations must be reviewed for host assumptions before reuse. DOM anchors, ranges, markup parsing, hydration addressing, and `DocumentLike` operations belong to the DOM target. Native structure requires native handles, regions, properties, refs, and publication results.

Keep authored JavaScript evaluation order, exceptions, alias behavior, and callback semantics consistent across targets. Dependency proofs can target known updates precisely. Hidden reads and unknown mutations still require a conservative update path.

## Package and compiler boundaries

Place the desktop backend in `packages/desktop/src/compiler/`. The desktop package also owns its JavaScript runtime, host bridge, launcher, and Rust scene implementation. Desktop-specific emission and host dependencies belong to that package.

```text
packages/compiler/
    src/analysis/       shared source facts
    src/planning/       shared semantic plans
    src/dom/            existing DOM backend

packages/desktop/
    src/compiler/       desktop lowering and emission
    src/runtime/        application scheduling and scene publication
    src/bridge/         host transactions and events
    rust/               scene engine and GPUI integration
```

Provide a separately built shared-analysis entry in the compiler package, proposed as `@memoized-dom/compiler/analysis`. The desktop compiler imports that entry. Its exported plans and transitive executable imports must be independent of DOM lowering and desktop host code. The compiler's current root entry includes DOM compilation and does not provide this boundary yet.

Expose desktop build tooling through `@memoized-dom/desktop/compiler`, independently of the desktop application's runtime entry. Keep the dependency direction explicit: desktop compilation depends on shared analysis; shared analysis does not depend on either backend. Desktop application execution does not import the compiler tooling.

Reuse the same semantic analysis and ownership contracts across targets. Separately built entry points and enforced import boundaries establish this separation; directory placement alone does not. The public entry points above are proposed interfaces to implement and verify.

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

Build one native window with containers, rectangles, text, clipping, pointer input, and an editable text control. Implement templates, live instances, typed slots, publication acknowledgments, and disposal before expanding the control set.

Compile fixtures for a counter, child prop update, branch replacement, keyed row movement, and text editing. Verify visible state, instance identity, callback ordering, cleanup, focus, measurement dependencies, and rejected publication. Exercise delayed events, asynchronous cancellation, reentrant updates, and handle reuse.

Instrument update functions, bridge calls, touched scene records, layout visits, text shaping, and paint regeneration. The resulting traces must show that unrelated instances remain untouched where dependency proofs permit it. Measure input-to-presentation latency, frame work, idle CPU activity, and repeated mount/disposal behavior.

Choose the layout implementation, text services, GPU backend, bridge encoding, and thread arrangement using those fixtures. Comparisons with GPUIX must match visible behavior and lifecycle guarantees. Performance claims follow those measurements; the core commitment is compiled structure, direct native slot updates, persistent host records, and coherent publication.
