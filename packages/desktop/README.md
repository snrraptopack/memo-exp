# Desktop presentation host

The desktop target uses the existing compiler analysis and JavaScript semantic
runtime with a retained Blitz document in Rust. Application authoring remains
ordinary TSX, CSS, events, refs and `mount()` from the framework runtime.

This branch currently implements the Rust document foundation and ordered wire
acceptance for complete mount/write/move/retire publications, with bounded worker
queues and a private headless process for transport contracts. A
portable JavaScript publication client, selectable execution bundler and internal
accepted core lifecycle are also implemented. The compiler now lowers analyzed
JSX to native templates and executes the first fixed-host/module-cell component
phase. The Vite counter example now uses ordinary mount and processed CSS in the
graphical Blitz host. The current executable supports click/capture callbacks;
ordinary component calls now mount as accepted nested native owners and replay
reactive props through the shared core prop box. Inline and component-return
host/component branches use accepted native replacement. Editing events, refs,
and full event targets remain unfinished. Nested component children and forwarded
content references and direct JSX-valued props mount into native regions. Mapped
host/component rows and delegated render callbacks now consume shared list plans
and retained native ranges. Web mounting and the optimized DOM list implementation
retain their existing contracts.

## Run the visual dashboard

```powershell
bun run desktop:dashboard
```

The launcher reuses the cached graphical host, just like the counter. Edit
`examples/dashboard/App.tsx` and `style.css`; application source uses only the
normal `mount('app', App)` call and an ordinary CSS import. Node selection uses
the same `MEMOIZED_DESKTOP_RUNTIME` setting described below.

The fixed-content dashboard exercises nested HTML, repeated `Avatar` and
`StatusBadge` components with ordinary props, grid/flex layouts, a table,
responsive cards, typography, six CSS shape specimens and an inline SVG chart.
Resize across 1050px and 650px, scroll through both shape labs, and inspect text
and edges. These are native physical viewport breakpoints. Layout contracts using
the same stylesheet pass at 1280, 900 and 600 pixels. The SVG contract verifies
paths survive native parsing and an attribute-driven rebuild with stable document
identity; painted appearance still needs visual inspection.

Navigation and project rows are visual fixtures, not an interaction demo. Static
component regions are exercised there. Conditional/forwarded content and mapped
rows are exercised by separate contracts and the counter. External image loading
and browser layout parity remain explicit gates.

## Run the counter

```powershell
# Rebuild native code once after Rust changes. This is separate from app startup.
bun run desktop:build:native

# TSX/CSS edits rebuild through Vite and reuse the running native process.
bun run desktop:dev

# Select Node execution; application TSX/CSS and mount remain identical.
$env:MEMOIZED_DESKTOP_RUNTIME = 'node'
bun run desktop:dev
```

The counter includes a generic list component receiving an ordinary `renderItem`
callback, keyed rows with click handlers, and reverse-order and remove/restore
controls. Each row adds its value to shared module state.

Run `bun run desktop:todo` for a separate ordinary TSX/CSS example. It supports
adding numbered tasks, editing their labels, toggling completion, filtering,
reversing, removing and clearing completed tasks. Each row has a local click count
that follows its key across moves. The entry still uses `mount('app', App)`;
free-text entry awaits the native input/default contract.

Edit `examples/counter/App.tsx`, `main.ts` and `style.css` within this package.
The launcher builds its execution module once, pins the actual shared core and
presentation module, then watches Vite application outputs. Bun runs the build
script and tests; Vite processes application CSS/plugins for either execution
engine. No Cargo command runs on a JS/CSS edit. The internal Vite build API also
accepts an ESM custom backend and ordinary Vite configuration; a ready-made
QuickJS host or Node-compatible APIs for that engine are not included.
The example runner uses Node-compatible file/module/process APIs, so its ready
execution choices are Bun and Node. A custom engine must provide its own launcher
capabilities as well as its transport adapter; the emitted semantic engine does
not supply Node APIs to QuickJS.

Reloads replace the whole root after accepted retirement. Canonical module cells
stay in the same application runtime; local native focus/selection is not
preserved. Content-hashed JS files handle Bun and Node module caches, including
returning to an already loaded revision. Long-session ESM cache reclamation and
generated asset cleanup remain M8 work. Resource URLs/fonts/images and full CSS
module binding integration are not claimed by this first CSS example.

For startup diagnostics in PowerShell, set `$env:MEMOIZED_DESKTOP_TRACE='1'`
before `bun run desktop:dev`. The trace separates context creation, GPU readiness,
scene acceptance and first content-frame submission. GPU initialization runs on
a bounded worker; surface creation and completion remain on the window thread.
Driver/context setup and first-content latency still need improvement. Frame
submission does not establish that pixels have reached the display.
GPU trace lines distinguish device creation, surface configuration and shader
compilation. Resize notifications coalesce at the next frame, and GPU completion
polling no longer waits indefinitely on the window thread. Text quality is not
lowered during resizing. Rapid-drag visual quality and black-flash recovery remain
verification gates; these changes do not establish that those symptoms are gone.

Window readiness has its own bounded startup handshake. The five-second scene
acceptance deadline starts after readiness; startup never implies publication
acceptance. A Windows graphical probe accepted this counter after 15.6 seconds
including native initialization. This does not measure first paint or click
latency. macOS/Linux use the same cross-platform shell dependencies but have not
been run on this machine.

## Native checks

Run from the repository root with the installed Rust 1.96.0 toolchain:

```powershell
# Build workspace dependencies first on a fresh checkout (`bun run build`).
# After compiler edits, rebuild its two packaged entries before desktop tests.
bun run --cwd packages/runtime build
bun run --cwd packages/compiler build
bun run --cwd packages/desktop native:check
bun run --cwd packages/desktop native:test
bun run --cwd packages/desktop native:fmt
bun run --cwd packages/desktop test
bun run --cwd packages/desktop typecheck

# Build the host once, then test JS engines against the cached executable.
cargo +1.96.0 build --manifest-path packages/desktop/rust/Cargo.toml --locked --jobs 2
bun run --cwd packages/desktop test:process
```

The crate pins Blitz revision `45496d9288b063719ebeae4e0761273f7881b3d7` and keeps
its dependency graph in `rust/Cargo.lock`. Check and test builds reuse the same
`rust/target` cache. The initial feature selection enables system fonts for text;
the optional `window` feature adds Blitz shell, winit and Vello painting. Resources
still need the application asset provider integration. Cold dependency compilation
is not app startup or a TSX refresh measurement.

## Compiler template lowering

The compiler's separate `@memoized-dom/compiler/desktop` build entry exports
`lowerNativeTemplate` and `compileDesktop` for the compiler/build adapter. Applications do not import
it. The default compiler entry continues to provide browser compilation; neither
entry imports desktop package source or a native toolchain.

Lowering consumes normalized/analyzed JSX, existing expression-source facts and
the shared ordered-attribute/direct-child planners. It assigns parent-before-child
source indices, keeps fragment roots without a wrapper, shares the web SVG
namespace classifier, and uses comment anchors for structural insertion.
Dynamic/member component calls remain source plans, rather than invented tags.

Immutable wire templates contain the element/text/comment backbone. Attributes,
spreads, refs, events and dynamic text retain ordered AST steps. The component
emitter executes fixed-host attributes/events/text, static component regions and
inline conditional regions, forwarded content, mapped host/component rows and
delegated render callbacks. Ref steps remain a capability gate. Even literal
attributes retain their positions around spreads;
event/ref addresses point into that same ordered program. Event metadata lives
in `packages/compiler/src/desktop/events.ts`. No callback executes at compile time,
and no function/ref value is serialized to Rust.

Tests cover source immutability, fragment/source indices, SVG/foreignObject,
decoded literals/text joins, shared exact/conservative source facts and retained
component/list/conditional/forwarded plans. The built package's templates are
mounted/written/retired against the real Rust host, including compiled nested
components, comment insertion and stale child-generation refusal. This remains
structural and identity evidence rather than browser pixel parity.

## Generated component execution

`compileDesktop` now emits real component closures with the existing shared
module-state cell lowering, component render planner, prop contract and access-table
serializer. Its current scope includes synchronous roots, fixed hosts/fragments,
scalar module state, ordered attributes/spreads, class values, CSS style strings,
explicit event callbacks and nested/repeated component calls. Static and reactive
props, inline conditions and shared component return plans retain their existing
object/positional ABI, defaults and authored spread
order. Generated factories bind the existing core prop box through the native
lifecycle adapter, while parent views call the existing `setProps` writer before
child invalidation. This works through linked imported components; it does not add
a desktop state channel.
Shared cell
operations publish only writes that execute. Templates
carry a structural SHA-256 revision so changed backbones do not reuse an immutable
native template key. Existing browser compiler snapshots remain unchanged; shared
callback forwarding and missing caller-reader attribution are corrected for both
targets.

Structural callback props use the existing shared callback contract: a callee
maps its items to an ordinary captured prop invocation, and the caller supplies
a synchronous inline function returning one JSX element. Wrappers can forward
that prop, including through proven static object spreads. The private native
descriptor holds a row factory and key reader; applications never construct it.
Its row factory is the same one used for direct maps. A stable descriptor retains
keyed rows and rebinds item/index after acceptance. A changed descriptor replaces
its comment-anchored content through the existing slot controller. Refusal keeps
accepted rows, descendant owners and event addresses active.

Caller-owned access tables include the callback's render reads, helper summaries
and nested component reads. Lexical shadowing and event/ref callbacks do not add
render-reader routes. An empty list does not evaluate callback row content. Keys,
callback parameters and body shapes retain the shared compiler's restrictions;
unsupported retained/async callback forms remain diagnostic. These contracts do
not establish physical focus/selection retention.

The compiler-private `src/runtime/view.ts` registers parent-before-child core
entities and owns native addresses, accepted attribute/text snapshots and callback
bindings. Child paths use the shared `App/Card`, `App/Card[1]` identity convention.
Their templates, region mounts and initial values join one transaction; activation,
event lookup, update waiting and cleanup traverse the accepted subtree. It has no
state-cell store, dependency resolver or subscription engine. Handlers activate after acceptance. Changes racing
the first acknowledgment schedule a core render after preparation activation.
Queued snapshots remove attributes introduced by earlier pending work. At eight
pending jobs, later source changes coalesce and resume through core invalidation
when a credit frees. Known accepted values suppress redundant scalar writes;
pending work uses complete snapshots for ordering correctness.

Candidate subtrees used for structural replacement may be created with deferred
core attachment. Their ordinary component props remain in the view until the native
retire/mount transaction is accepted, then the old stable-ID subtree is removed and
the candidate attaches parent-before-child through the same core registry and props
functions. Refusal discards only the staged views. Conditional compiler emission is
implemented for inline JSX conditions and shared component return plans. The stable
conditional entity uses existing access-table routing; each selected branch receives
a private native generation while nested components keep normal semantic IDs. Writes
during a pending switch are coalesced after acceptance, so an old component cannot
queue a stale update behind its retirement.

Ordinary nested content such as `<Panel><p>{count}</p></Panel>` becomes a stable
caller-closure factory passed through the existing prop box. A callee's `{children}`
mounts that factory at a native comment boundary. Forwarding it to another component
and mounting it more than once retain independent ranges, event bindings and
cleanup. Unused content stays lazy. Slot factory changes use the same accepted
replacement controller as conditions, so refusal preserves the current content.
The counter example's `Panel` exercises nested content and a JSX heading prop
through normal mount and CSS. Direct
JSX-valued props such as `header={<h2>Heading</h2>}` and `children={<Panel />}` use
the same factory emission. Ordered spreads retain their normal override behavior.
Component-local JSX constants, arrays and finite object/array selections use the
shared compiler normalizer. Static object-literal spreads can carry and forward
JSX values, including nested spreads; both targets reuse the same property mapper.
Positional components evaluate their ordered prop object once before extraction.
Conditional slot source writes receive caller replay destinations in the existing
core access table, reaching native ranges below their receiving controller. This
currently replays the caller subtree rather than targeting only that slot.

The private `NativeList` presentation controller retains row ranges by key through
the existing core registry and native mount/move/retire operations. It uses the
shared primitive key encoder; other keys receive process-local identities.
Reorders retain row views, nested owners and local bindings. Reinserted keys use
fresh native generations so retired event addresses stay inactive. New rows attach
to core only after structural acceptance, and retained item/index bindings advance
at that boundary. Refusal discards additions and resumes the accepted rows.
Source changes during pending work replay through core invalidation. No list source
resolver or reactive engine is added. The placement planner uses temporary neighbor
links; it does not change or claim the web reconciler's LIS/mutation optimizations.
Private process fixtures verify atomic refusal, correction, range moves, descendant
retirement and keyed state on the real Rust host with Bun, Node and the custom
adapter. The compiler consumes `ComponentListSites`, shared callback normalization
and occurrence allocation to emit row factories and item/index binding updates.
Props and proven static sources work, including optional maps, nested member
lists, destructuring, const row derivations, ordered spread keys, repeated sites,
inherited SVG namespaces and nested components/slots/conditions. No parallel list
source analysis is added. Row click/capture events use the ordinary accepted-source
dispatcher, including synchronous cancellation and propagation controls. Module
cell writes use existing access tables. Row/prop/store writes, including proven
static event spreads and scalar callback props, now use the shared handler
execution guards and completion publication. Literal object/array module state
belongs to the existing per-application cells; component-local mutable state
invalidates its existing core owner. Indexed reads inside TypeScript expression
wrappers use that same cell. Read-only helpers do not become render-time publishers.

One connection-owned generation high-water mark observes all accepted mounts.
New roots and rows allocate above it, so repeated Vite root replacements and
conditions inside rows cannot reuse a retired native address. The project graph
selects the only registered root; imported modules can define multiple ordinary
components without being treated as another application root. Physical
focus/selection parity and large-list throughput remain gates.
Applications do not import these controllers or supply native frames.

Derived replay, retained/async callbacks, effects, nonliteral owned module
initializers, opaque JSX prop bags, refs and external assets receive
capability diagnostics rather than stale behavior. Dynamic spread refs,
innerHTML and style objects currently produce explicit adapter errors. These are
current emission limits, not new application syntax or restrictions on the web.

The real process tests compile ordinary TSX, bundle the generated module for Bun,
Node and a custom CommonJS adapter, then mount, dispatch callbacks, replace inline
and component-return branches, mount linked/repeated children, move/remove compiled
rows with their event addresses, and retire against
the cached Rust host. The bootstrap
is a private ABI fixture, not an application example or native platform event test.
Applications keep existing `mount()` authoring. The Vite/window example above
exercises that entry wiring; broader input/default and revision contracts remain M4
work.

Automated contracts own their source and CSS under `tests/fixtures` and
`rust/tests/document_contracts/fixtures`. They do not load the editable examples.
The test-owned Todo is compiled by Vite and executed against the real headless
Rust host under Bun and Node, including cross-module mutations, keyed state,
filter attributes, empty content and repeated root replacement. It verifies
accepted routing/publication, not physical platform clicks or editing.

## JavaScript execution backends

Bun is the default execution engine and JavaScript test/check runner. Vite owns
application builds, CSS processing and watched rebuilds.
Node uses the same Node-compatible process adapter. Engine choice does not change
TSX, CSS, event/ref authoring, compiler semantics or the shared reactive runtime.
The selected adapter is resolved at build time; other adapters do not enter the
emitted application.

`src/dev/bundle.ts` exports `bundleExecutionEntry({ entry, outfile, runtime })`.
This is a private transport-test fixture helper, not the application build path.
Its `runtime` defaults to `'bun'` and
can be `'node'` or a custom backend record:

```ts
runtime: {
  name: 'quickjs',
  command: ['qjs', '--module'],
  moduleFormat: 'esm',
  hostAdapter: './build/quickjs-host.ts',
  external: ['std', 'os'],
}
```

A custom backend declares an executable/argument vector, module format and adapter
file. Optional `bundleTarget` chooses `'node'` or `'browser'` resolution;
custom backends default to browser-style JavaScript. Optional `external` lists
modules actually provided by that engine. Commands execute without shell
interpolation. A name by itself does not invent missing engine APIs.

The adapter exports `connectNativeHost(NativeProcessOptions)`, returning the
`PublicationTransport` contract from `src/host/transport.ts`: send a complete
JSON packet with bounded UTF-8 framing, attach reply/failure observers, schedule a
cancelable deadline, and idempotently dispose the owned host. The client imports
no Bun/Node APIs, TextEncoder or browser globals. The Node-compatible adapter owns
process APIs, framing and deadlines and runs under both Bun and Node.

QuickJS/Hermes/custom engines can implement that same adapter without copying the
publication client or shared runtime. A ready-made QuickJS adapter is not included;
the example requires the supplied file. Runtime selection and bundling do not
promise Node API/npm compatibility for another engine. Bun and Node, plus a
separately selected custom CommonJS adapter, have real native process contracts.

## JavaScript publication ownership

### Internal lifecycle, unchanged application mounting

`src/runtime/application.ts` connects publication acceptance to the existing core
render preparation, refs, effects and cleanup. It does not introduce another
application entry point. Application code keeps the framework's existing
`mount(target, component, options)` API. The compiler/build supplies the desktop
host internally; applications do not import `NativeApplication` or candidates.
This connection owner also remembers accepted and pending immutable template keys
for every root, component and future structural publication. Refused declarations
are released for retry; mounting does not maintain a separate cache.

Candidate creation uses shared core preparation and consumed-resource readiness.
Native acceptance commits host connection flags before activating shared refs;
effects wait while presentation publications are outstanding. Known refusal
discards a new candidate without activating it, or preserves ownership when
retirement was refused. Updated semantic values are not rolled back: their effects
wait for a corrected accepted scene. Accepted retirement releases core-owned refs,
effects, subscriptions and cleanup. Idle connection loss also tears down the
application, and a lifecycle failure after native acceptance closes the host.

The adapter holds existing effect callbacks through the core effect-boundary hook;
it owns no cell store, access resolver, subscription bridge or reactive scheduler.
The only shared-source addition is exporting existing preparation/read-scope
functions from `runtime/core`. The web mount and DOM list implementations are
unchanged. Process fixtures verify this internal ABI under Bun, Node and a selected
custom CommonJS adapter against the real cached Rust host. The separate Vite
process contract adds compiled cross-module TSX, CSS-plugin processing and normal
root replacement. The graphical launch probe does not prove full platform-event,
ref or first-paint parity.

### Transport ownership

`PublicationClient` snapshots candidate packets before enqueueing and sends one
at a time. At most eight publications are admitted by default, with an explicit
local pressure error. Byte/operation bounds are checked before I/O. Acceptance
requires the matching native reply and completion of that packet's stream write.
Only acceptance advances sequence order; it still does not mean layout/paint.

Compiled view/list/conditional controllers share those connection credits. When
full, the application holds one retry callback per live presentation, without
storing value snapshots. Settlement resumes that presentation through existing
core invalidation so it reads current source state. Disposed presentations release
their retry; connection close clears all retries. Direct client callers still
receive the bounded local pressure error. No new reactive scheduler or publication
capacity increase is involved.

Refusal clears dependent pending snapshots before a dirty view retries. This
also applies to forwarded synthetic views, whose current text and attributes
must be compared against the accepted baseline after rejection.

Refusal leaves the sequence correctable and rejects queued dependent work, which
may reference the refused mount/template. The semantic adapter must recompute
that candidate; the client never reconstructs reactive state or replays it.
Malformed/out-of-order/fatal replies, write failure, native exit or a missing
acknowledgment deadline fail all pending jobs and dispose the connection. The
default deadline is five seconds and belongs to the outstanding job, not a frame
scheduler. There are no retry or polling timers. Close is idempotent.

The streaming reply decoder checks the prefix before allocation, retains one
bounded frame and handles split/adjacent UTF-8 packets. Partial EOF, invalid UTF-8
and malformed JSON are terminal. Process stderr drains continuously with only a
bounded diagnostic tail; native subprocesses use hidden Windows console startup.

## Retained document and source identities

Rust keeps one `BaseDocument` containing the actual presentation tree. The host
adds the document's HTML/head/body shell once. There is no alternate CSS property
language, paragraph tree or reactive engine in this package.

| Record | Shape and responsibility |
| --- | --- |
| Template | Stable key and ordered source nodes; each node has an optional preceding parent index |
| Element source | Blitz qualified tag name and qualified attributes, preserving namespaces |
| Text source | Plain text destination |
| Comment source | Non-layout anchor, including structural-region destinations |
| Owner | Framework-owned instance ID and positive generation |
| Node reference | Owner ID/generation plus source index; raw engine allocation IDs are not incoming source identities |
| Instance | Source-index-to-versioned-Blitz-ID vector, start/end comments and owning destination |
| Destination | Document body, a source element's children, or the position before a source comment |

Templates validate names, duplicate attributes, parent ordering and parent kinds
before any engine allocation. Each instance has comment boundaries, including empty
and multi-root fragments. Children inserted at an element or region belong to that
destination; moves stay within it. The boundary comments add no element wrapper.

Blitz supplies element, style, text and layout behavior. A native ref exposed to
JavaScript will need an adapter for each ordinary method; these Rust records do not
claim to implement `HTMLElement`, browser geometry reads or a JavaScript `Document`.

## Writes, moves and retirement

`NativeDocument::update` validates the complete text/attribute write set before
opening a live mutator. A refusal leaves earlier candidate writes and redraw
requests unapplied. Attributes use Blitz replacement/removal, including ordinary
class/style strings. CSS inside style elements goes directly to the engine.

Instance moves retain the complete sibling range and its existing source IDs,
including descendant and empty ranges. Retirement destroys the range's native
allocations and clears every descendant instance whose boundary was destroyed.
Generation high-water marks survive retirement, so a reused instance ID cannot
accept writes from a previous generation.

Registry cleanup uses a reverse boundary index rather than scanning unrelated
instances. Finding sibling ranges and removing engine children still have their
own costs; this batch does not establish large-list throughput. Generation marks
remain for the lifetime of this native document.

Unexpected failure after entering live application is terminal. Rust reports
unknown acceptance, retains the failed state and rejects subsequent work; it does
not claim rollback. The publication session and native driver close in that state;
the JavaScript client fails pending jobs and terminates the transport.
Structural acceptance
and completed layout/paint remain separate:
`resolve()` runs Blitz's style/text/layout work explicitly.

## Ordered wire publication

`PublicationSession` owns the native document for one connection. It accepts a
complete JSON packet through `publish(bytes)`, validates decoding and sequencing,
then calls the combined native transaction validator. It exposes the
document for immutable inspection, with no mutable escape hatch.

The operation array supports text/attributes and structural publication:

```json
{
  "version": 1,
  "sequence": 1,
  "operations": [
    {
      "op": "text",
      "target": { "owner": { "id": "App", "generation": 1 }, "source": 1 },
      "value": "Count: 1"
    }
  ]
}
```

`setAttribute` carries the same target, a qualified `name` with `namespace`,
`local` and optional `prefix`, and a string `value`. `removeAttribute` carries
the target/name without a value. Removal is an explicit operation; a missing or
null set value is refused rather than treated as removal. Names and node kinds
are checked by the existing document layer. Namespace strings reach Blitz intact.

`mount` carries `owner`, an immutable `template` key and a `target` destination.
Destinations are `{"kind":"body"}`, or `{"kind":"element","source":...}` /
`{"kind":"region","source":...}` using the same source reference shape.
`moveBefore` carries `owner`/`before`; `moveToEnd` and `retire` carry `owner`.
The entire operation order validates against live and candidate ownership before
the first native mutation. Version 1's original `writes` array spelling remains
an alias; specifying both array names refuses as a duplicate field.

Optional `templates` declares immutable source templates in the same packet:

```json
{
  "key": "counter:label",
  "nodes": [
    { "parent": null, "node": { "kind": "text", "value": "Count: 0" } }
  ]
}
```

Source nodes use `kind` element/text/comment. Elements contain a qualified `name`
and an `attributes` array of qualified name/string value pairs; text/comments
contain a string `value`. The existing native template validator checks topology,
names and duplicate attributes. Mount operations can reference declarations in
their own packet or accepted declarations from earlier sequences.

The session stores accepted templates by key, so additional instances mount without
resending source payloads. Declaring an existing or duplicate candidate key refuses;
changed compiled content needs a new template key. Refusal publishes neither scene
changes nor template declarations. Accepted templates live until session disposal,
including after all of their instances retire. Reload/cache lifetime remains a
dev-workflow gate; no unbounded-refresh performance result is claimed.

Successful application returns the serializable acknowledgment
`{"version":1,"sequence":1,"status":"accepted"}`. Sequences begin at 1 and
advance only after complete application. Refusal leaves the expected sequence
available for correction; duplicate and future sequences refuse without applying
work. Empty publications advance ordering without a redraw. The acknowledgment
establishes structural acceptance, not completed layout or paint.

Unknown fields/operations, duplicate fields, missing required fields and invalid
JSON refuse. Limits are 1 MiB of UTF-8 packet bytes, 4,096 operations and 256 UTF-8
bytes per owner ID. Sequence/generation counters must be positive JavaScript safe
integers, and source indices must fit unsigned 32-bit integers. The last safe
sequence accepts once; further publication requires a new connection/document.

An ambiguous live failure closes the session and returns `AcceptanceUnknown`;
subsequent packets refuse. The native process driver also closes the session after
a lost acknowledgment rather than replaying possibly applied work. The JavaScript
client implements bounded pending-job ownership and failure handling with the
accepted compiler/core lifecycle described above.

## Process stream framing

`FrameReader` and `FrameWriter` use a four-byte unsigned big-endian length followed
by that many UTF-8 JSON bytes. Payload length is 1 through 1,048,576 bytes; the
prefix is separate. The reader checks the untrusted length before allocating a
payload. It handles split reads and interruptions; incomplete headers/payloads,
invalid lengths and I/O errors terminate the stream. Clean EOF is accepted only
between frames. A failed stream does not try to find another boundary.

The writer bounds JSON serialization in memory before emitting a prefix. Local
encoding/size errors emit no bytes. Once prefix/payload I/O begins, any write or
flush failure closes the writer. The JSON codec independently checks the payload
limit after framing.

`PublicationSession::publish_to` applies a packet and writes one structural
acceptance frame. A known-closed reply stream refuses before native application.
Failure sending acceptance returns `AcknowledgmentFailed`, closes the session and
prevents replay: applied native state may remain, while the sender's acceptance is
unknown. This lower-level helper does not send refusal frames. The worker driver
described below sends explicit refusal/fatal replies through its outbound queue.

These blocking `Read`/`Write` adapters serve transport workers or a headless host.
No blocking pipe wait belongs on the UI thread. `ProcessDriver` provides bounded
queues and worker-failure propagation. The graphical mode uses the same driver
with nonblocking event-loop wakes and accepted compiler/core lifetimes.

## Native worker driver

`ProcessDriver` owns one publication session on the document thread. Named reader
and writer workers own blocking stream I/O. The reader queues at most eight complete
frames and may hold one additional bounded frame while waiting for capacity.
Backpressure blocks only that worker. The document thread's `poll()` checks queues
without waiting and applies at most eight packets per call.

Eight reply slots include the writer's in-flight reply. The document thread reserves
a slot before applying a publication; when all slots are occupied it pauses
admission. A successful writer flush releases a slot and wakes the document thread.
This keeps a healthy burst bounded without losing acceptance or busy polling while
the parent is stalled. The supplied wake callback must schedule the owning thread
without blocking; the graphical host uses Blitz's native event-loop proxy.

Refusal replies have `version`, `status: "refused"`, `expectedSequence`, a stable
machine `code`, and a diagnostic capped at 512 characters. Invalid JSON does not
have a guessed sequence. The JavaScript client must associate replies with its
outstanding serialized requests. Refusal leaves the slot available for correction.
Fatal native failures send `status: "fatal"` where the stream is still available,
then stop admission. Read/write errors and worker panics wake and close the session;
a broken reply stream cannot guarantee delivery of its fatal diagnostic.

Clean input EOF is queued behind complete frames, allowing already accepted replies
to drain. Closing/dropping the driver stops native admission and provider work
without joining blocked workers on the UI thread. Generic `Read`/`Write` cannot
interrupt an OS syscall: the process/stream owner must close or terminate an
unresponsive peer. `finish_headless()` is an explicit blocking writer join for a
terminating headless process or test, never a UI callback.

There is one host executable, with private `--headless` contract and `--window`
graphical modes. The optional Cargo feature is cross-platform, not Windows-only.
Native tests launch that actual executable with process pipes and verify refusal,
corrected publication, immutable template reuse and reply draining on EOF. This
mode is not an application API or a mounted TSX demo. A normal desktop launch and
native painting still require M3.

## Combined native transactions

`NativeDocument::transact` accepts an authored sequence of `Operation` records:
mount, write, move-before, move-to-end and retire. It validates the entire sequence
before applying the first operation. A new mount may supply element/comment
destinations and text/attribute sources to later operations in the same batch.

Validation stages only new/retired owners, changed generation marks and candidate
mount containment edges. Existing sources and descendant boundaries are read from
the actual Blitz tree. It does not clone the accepted registry or maintain another
rendered tree. Same-destination moves preserve containment; cross-destination moves
refuse. Retirement invalidates existing and candidate descendants, including empty
and comment-anchored fragments. A replacement generation mounted outside a retired
parent survives that parent's retirement.

An invalid later operation leaves every earlier candidate mount/write/move/retire
unapplied, without consuming generations or requesting redraw. After validation,
the batch reuses the existing native operations under exclusive document ownership.
Adjacent writes share one mutator and retain authored order. An unexpected error
during application is terminal, including an inner error that would be an ordinary
refusal outside a prepared batch; no partial application is reported as rollback.

Structural operations use their established individual mutators. A per-document
provider boundary now contains their outward requests until complete application;
adjacent writes still share one mutator. The wire session uses this same transaction
path, with no second topology validator.

## Controlled native providers

The document installs wrappers around its configured Blitz shell/net providers.
Protected application holds resource requests, redraw, title, cursor and IME
changes across nested native operations. Successful outer application dispatches
queued resources, releases the final platform settings and requests one redraw.
Synchronous resource callbacks may enqueue further requests or redraw without
calling a backend under the gate's mutex.

Unexpected failure discards queued work, suppresses late provider calls and keeps
the document terminal. Failure while releasing already applied work is still
unknown acceptance; requests already dispatched cannot be rolled back. The gate
has a total resource budget of 4,096 requests per protected application, including
synchronous reentrant requests; overflow is a fatal application failure.

The net wrapper preserves `is_noop()`, so Blitz's critical-resource accounting
keeps the configured backend's meaning. Aborted queued requests do not start.
When no abort signal was supplied, the document owns one and signals it on
failure, session close and disposal. A supplied signal retains its identity and
caller ownership; closing the document does not abort an unrelated shared signal.
Cancellation depends on the backend honoring those signals.

The complete shell trait forwards real capabilities outside publication.
Synchronous clipboard/dialog/window queries cannot be deferred into a scene
batch: an unexpected call there fails explicitly. Native event/default processing
needs its separate accepted interaction boundary in M4. Resource backends used
by the UI driver must enqueue work without blocking the UI thread; provider
containment alone is not a process/event-loop integration or asset loader.

## Current boundary

The document API, wire session, native worker driver and headless process contracts
are the current scope. Combined native transaction validation/application and
structural wire publication use bounded framing and reply-capacity admission.
Shell/resource work is contained across complete application. The portable client
and selected execution adapter implement process/pending-job teardown. Compiler
acceptance/lifecycle and ordinary mounting execute against the real headless
host. Vite CSS and graphical launch now work; complete native interaction, refs
and first-paint verification remain M3/M4 gates;
platform input ordering/cancellation follows in M4.

The desktop build selects the private runtime entry for ordinary
`import { mount } from '@memoized-dom/runtime'`. Compiled roots register in the
same realm-wide metadata WeakMap as browser roots. The launcher binds a single
configured string mount target before loading the authored entry; element targets
and DOM node inspection are not implemented. Its internal host identity exposes
`id` and accepted `isConnected`, not a fabricated HTMLElement. Ordinary JSX/ref
types and browser mounting remain unchanged.

Mount/unmount return synchronously. The launcher observes acceptance privately.
Unmount requested before creation acceptance waits in order; a refused retirement
retains the accepted owner and can be retried. Accepted retirement releases the
target. Remount increments the owner generation and reuses already accepted
templates on that connection. Bun, Node and the selected custom adapter exercise
the authored mount entry against Rust; these are not platform-click tests.

Blitz creates a text input's editor during layout construction. Tests verify both
pre-layout value initialization and later editor updates through the engine.
Attribute writes alone are not a proof of browser input parity: live/default value
distinctions, user edits, composition and stale controlled writes need the M4
contracts before the JavaScript control adapter is claimed compatible.

Read the canonical [research](../../wiki/blitz/research.md),
[plan](../../wiki/blitz/plan.md), and [completed milestones](../../wiki/blitz/milestones.md).
