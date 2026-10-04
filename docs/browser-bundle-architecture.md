# Browser JavaScript architecture

## Architecture decision

Interactivity determines the browser program. Initial content belongs in HTML;
JavaScript belongs to the events, state, effects and changes that need browser
execution. A static Hello application must ship zero application JavaScript,
including framework runtime code. Increasing static composition should increase
HTML, without creating client component factories for that content.

Separating initial rendering from interaction is the first architecture step.
Runtime module splitting, smaller lists and string interning are secondary.
The former static client shell's 9.8 KB raw / 3.9 KB gzip is an unnecessary
browser creation cost, not an acceptable floor or a bundle-size target.

The performance batches and open correctness/performance work are recorded in
`performance-work.md`. This document starts the bundle work without discarding
those improvements. Correctness safeguards for arbitrary keys, getter reads,
opaque calls, reentry, failed renders and cleanup belong to the paths that need
them; they cannot be deleted merely because a small example does not exercise them.

## Implemented initial-content boundary

Linked compilation captures `InitialRenderPlan` before DOM emission. Its HTML
case contains target-independent text/element content, attributes and children,
plus the mount target and entry identity. It is independent of component factory
ABI, runtime registrations and DOM creation statements. The browser case records
the first requirement that prevented a closed initial-content proof, including
events, refs, lifecycle work or unknown initialization.

The proof supports unchanged `let` bindings, closed constants, primitive arithmetic,
string concatenation/interpolation, simple branches,
objects used as props and component composition across linked modules. It never
calls authored functions or evaluates source with JavaScript `eval`. Unknown
calls, getters, external imports and module side effects retain browser execution,
even if the JSX has no events. Host properties and
unsupported HTML parser shapes also retain the DOM path.

`emitInitialHtml()` is a separate backend over that content plan. HTML escaping
and parser constraints belong to the backend; parser shape constraints are
shared with existing DOM template emission. The Vite production HTML pipeline
uses this result before bundling. For a proven static entry and an unambiguous
empty div host directly inside body, it inserts HTML and omits the mount script.
CSS remains an HTML build dependency, including scoped TSRX styles. Additional
scripts, mount options, consumed handles and uncertain shells keep the browser
entry. Development retains HMR; fullstack SSR uses its existing request path.

The production Hello test emits **zero JavaScript assets** and renders in Chrome
with JavaScript disabled. A larger page with forty instances of an imported
component also emits zero JS assets. HTML and CSS remain visible. These tests
use independent fixtures, never example sources.

Mixed pages now have a separate compiler-generated browser target. A closed,
event-free root with live child components retains its static ancestors and
closed composition in HTML. The content plan carries browser placement markers;
DOM emission creates only those child regions and adopts the original static
nodes into the mounted application. No extra wrapper elements are introduced.
The Vite HTML entry selects a separate virtual module graph only after proving
the shell can receive that HTML. Ordinary JS entries retain their original
factories. Development and server compilation do not generate the alternate
browser target.

The mixed proof uses lexical binding identity and captured write information.
Aliases of written state cannot become static HTML. It currently requires a
direct JSX root return, closed primitive boundary props and no dynamic module
loading/evaluation. Object mutation/escape, callback props, content slots and root
structural regions retain the ordinary browser program. Child refs/effects keep
their normal component owner and cleanup. Unknown root or module setup also
retains browser execution. Compiler directives retain their routing/conditional
semantics rather than becoming HTML attributes.

Production Chrome tests verify original static node identity and independent
state updates in repeated children. Mount/unmount tests verify ownership and
removal of the retained static nodes. Invalid placement markers are checked
before any retained nodes move. The alternate browser product also carries its
own authored source maps. Fixtures never read examples.

Compiler, runtime and Vite builds and changed-source lint pass. The selected
initial-plan, HTML ownership, production browser, mounting, markup/hydration,
Vite integration and SSR isolation/concurrency suites pass 105 tests across
nine files. A skipped static instance of the same component also preserves the
following interactive instances' source identities.

Direct interactive host roots now have a `bindings` product. The compiler emits
closed initial values as HTML and derives child-node addresses from that exact
content plan. Its browser factory binds only the returned root, event targets,
dynamic attributes and dynamic text. It emits no DOM creation or child appends
for that tree. Unchanged variables and closed derived expressions do not get
text/attribute update code. Captured writes and aliases of mutable dependencies
retain updates; object reads stay conservative. HTML and DOM emission share the
same adjacent-text join contract, including numeric coercion.

This target currently requires one direct host root with known initialization
and host-only children. Composed children, later structural regions, DOM
properties/styles, refs, effects and opaque setup retain the ordinary target.
Empty dynamic text has a comment placeholder replaced with a text node. Runtime
binding validates all required addresses and node kinds before replacing any
placeholder. Events, batching, module routing and mount/unmount ownership reuse
the existing compiler/runtime paths. This is not a separate event scheduler.

This is still a partial architecture change. Live children currently start as
HTML markers and create their initial DOM through the existing runtime. Their
full initial HTML, state serialization and binding-only browser code remain
unfinished; direct host-root bindings are implemented first. The compiler does
not yet prove arbitrary JS static.

`bun run bench:size:html` measures production HTML and every emitted JS chunk
separately, using published packages and stable authored fixtures. Its reports
are written to `bench/package-size/dist/html/results.{json,md}`. The older
`bench:size:audit` remains useful for attributing the current DOM runtime, but
its direct browser mounting fixtures do not measure the HTML-first pipeline.

Production measurements for the implemented boundary (default Vite minification):

| Authored page | HTML raw / gzip B | All emitted JS raw / gzip sum B |
|---|---:|---:|
| Static shell | 149 / 129 | 0 / 0 |
| Forty composed static cards | 2,046 / 258 | 0 / 0 |
| Unchanged name and derived greeting | 120 / 112 | 0 / 0 |
| Owner counter, earlier DOM creation target | 180 / 151 | 10,588 / 4,209 |
| Interactive input/list | 180 / 150 | 24,850 / 9,180 |

Growing static composition around the same interactive counter now grows HTML
without growing JavaScript. The same authored graphs built through an ordinary
JS entry provide a DOM-creation comparison:

| Static cards + one counter | HTML raw / gzip B | HTML-associated JS raw / gzip sum B | Ordinary DOM-creation JS raw / gzip sum B |
|---|---:|---:|---:|
| 1 card | 267 / 209 | 11,315 / 4,446 | 10,643 / 4,128 |
| 60 cards | 3,503 / 380 | 11,315 / 4,446 | 15,849 / 4,855 |

The adoption helper increases JS for the tiny mixed fixture. Removing static
creation code reduces the larger fixture, and its browser payload is constant
across the two static sizes. This demonstrates the static/interactivity boundary;
the existing interactive runtime cost remains substantial. These are distinct
HTML/DOM-creation build products, not a gzip-only total-payload speed claim.

Direct host binding measurements use the same ordinary DOM-creation comparison.
They include the existing kernel, mounting, events and binding validation helper;
the interactive runtime has not been replaced by a smaller browser core.

| Static host cards + local counter | HTML raw / gzip B | HTML-associated JS raw / gzip sum B | Ordinary DOM-creation JS raw / gzip sum B |
|---|---:|---:|---:|
| 1 card | 275 / 209 | 11,139 / 4,466 | 10,156 / 3,981 |
| 60 cards | 3,511 / 378 | 11,141 / 4,465 | 13,548 / 4,353 |

These measurements demonstrate that static host content grows HTML, with only
two bytes of extra node-address digits in JS. They do **not** demonstrate a
smaller tiny counter bundle: before binding, the owner counter shipped
10,588 / 4,209 B; binding ships 11,139 / 4,464 B. Its initial state is now visible
without JS, and static content no longer contributes creation code. Removing
the fixed runtime cost remains an architectural requirement.

Regression checks cover unchanged names, derived mutable aliases, object
mutation conservatism, empty text, duplicate host-attribute fallback and shared
text coercion. Production Chrome checks cover initial content with JavaScript
disabled, retained root/button/text identity, multiple writes, early returns,
module routing and recovery after an authored throw. The throwing path is
compared with the ordinary compiler target: this batch preserves that existing
commit behavior rather than changing it. Compiler, runtime and Vite builds and
changed-source lint pass.

## Optional host scope and opaque polling

The shared kernel now exposes a core registration used by compiler-proven
non-polling entities. General registration installs the optional opaque-pull
driver; existing programmatic registrations keep their volatility behavior.
Components select that capability from their captured volatility fact. Module
computeds, rows and effect registrations without polling use the core path.
There is one entity registry, dirty queue, reason store, commit drain and
teardown implementation. Scheduling policy and failure safeguards are shared.

Request context propagation is an optional host adapter. Its named storage cell
initializes on explicit `runWithApplicationRuntime` use, preserving late
AsyncLocalStorage installation. Ordinary browser updates resolve the ambient
runtime without importing scoped-storage machinery. Bundled owner-counter
metafiles now contain neither `application-scope`, `async-storage` nor `volatile`.
The opaque mutable-clock fixture retains the pull driver; required routing,
props and list capabilities remain present in their respective fixtures.

This separation also corrected runtime ownership of delayed work. A queued
commit or opaque frame now runs against its originating runtime, even if another
runtime is currently active. Context is restored after success or failure.
Queued work from a disposed application cannot drain another application's
dirty queue. This was reproduced with identical entity IDs in distinct
runtimes; the three initial ownership tests failed before the fix. Additional
checks cover disposal, property-read order, concurrent requests and loading the
server host after client scoped storage has already initialized.

Production HTML-entry measurements against `7873aef`, same authored fixtures,
default Vite minification, all emitted JS included:

| Fixture | Before JS raw / gzip sum B | After JS raw / gzip sum B |
|---|---:|---:|
| Owner counter with initial HTML | 11,139 / 4,464 | 10,422 / 4,209 |
| Module counter with initial HTML | 14,509 / 5,599 | 13,745 / 5,349 |
| Input/list | 24,850 / 9,180 | 24,118 / 8,926 |
| Composed counter | 11,940 / 4,656 | 11,217 / 4,411 |
| Owner keyed list | 24,948 / 9,192 | 24,218 / 8,945 |

Static pages continue to ship zero JS. One versus sixty static host cards
around a local counter ship 10,422 versus 10,424 B of JS; growth is still only
two bytes of binding-address digits. HTML compression varies slightly with
generated asset names. The live measurements are in the existing HTML audit.
This reduces retained capabilities; the interactive kernel and mounting cost
remain substantial. It does not complete the small browser-core architecture.

Runtime/compiler builds, focused regression suites, all twenty production HTML
checks in Chrome and twelve published/source browser interaction graphs pass.
The interaction audit verifies input reset, duplicate list values, keyed node
identity, local/module counters and composed prop delivery. No CPU performance
claim follows from these bundle measurements.

## Initial HTML mounting operation

The HTML-associated browser entry now selects `mountInitial` from its captured
initial-content proof. Application source continues to call `mount`; the ordinary
output keeps that call. Only the separate `mixed` and `bindings` products select
the smaller operation, after the same Vite shell validation as before. Development,
server builds, mount options and uncertain initialization retain general mounting.
Aliases and configured runtime paths are preserved in the emitted entry.

`mount-core.ts` owns root metadata, host/root validation, application handles,
creation failure cleanup and unmount. General mounting layers SSR marker detection,
the optional hydration bridge and mismatch recovery over this core. Initial HTML
mounting uses the same core with its compiler-generated binding/adoption factory.
It does not carry an SSR marker parser, mismatch error class or hydration warning
branch. The package graph tests verify both products; general mounting still
includes the required SSR detection and fallback behavior.

An ownership regression reproduced during this separation: after switching to a
second application runtime, calling the first handle's `unmount()` disposed the
second runtime's matching entity ID. Handles now retain their original runtime
for teardown, including cleanup callbacks and error paths, and restore the caller
afterwards. Both mounting operations share this fix, duplicate-root protection and
failure cleanup.

Production HTML-entry measurements against `8881926`, using the same fixtures,
default Vite minification and every emitted JS asset:

| Fixture | Before JS raw / gzip sum B | After JS raw / gzip sum B |
|---|---:|---:|
| Owner counter with initial HTML | 10,422 / 4,209 | 8,978 / 3,603 |
| Module counter with initial HTML | 13,745 / 5,349 | 12,289 / 4,757 |
| Mixed static cards and counter (1 or 60 cards) | 10,596 / 4,191 | 9,152 / 3,598 |
| Input/list (ordinary mounting) | 24,118 / 8,926 | 24,173 / 8,963 |
| Composed counter (ordinary mounting) | 11,217 / 4,411 | 11,272 / 4,447 |
| Owner keyed list (ordinary mounting) | 24,218 / 8,945 | 24,273 / 8,984 |

The ownership correction adds 55 raw bytes to ordinary mounting fixtures. The
HTML product avoids the general mount capability and saves 1,444 raw bytes in
the local counter. This does not imply faster DOM updates. Static fixtures still
ship zero JS. One versus sixty static host cards around the local counter ship
8,978 versus 8,980 B; the remaining two bytes describe a node address. The shared
interactive kernel remains the next substantial cost, and live composed children
still create their initial DOM rather than bind complete initial HTML.

Runtime, compiler and Vite builds pass. The selected suites pass 121 tests across
thirteen files, including twenty production HTML/browser checks. They cover
retained DOM identity and interaction, alias/custom-runtime entry selection,
fallback proofs, mounting validation, teardown failures, optional hydration,
SSR concurrency and application isolation. Changed-source lint has no errors;
the root factory's existing general `Function` types retain four warnings.

## Optional exact-cause invalidation

The compiler now distinguishes full-owner invalidation from an update carrying
exact causes. The existing captured handler write plan selects `invalidateEntity`
when no cause payload is emitted. Numeric owner reasons still select `markDirty`.
Event-origin refreshes, effect scheduling, row/owner refreshes and external-source
notifications also use the full operation when they carry no exact payload.
The change consumes existing semantic facts rather than introducing another
dependency analysis or scheduler.

`reasoned-invalidation.ts` preserves the general runtime API and supplies the
merging operation to the shared kernel enqueue path. Exact list-item/structure
routes supply that same operation; ordinary module-write routing does not. There
is no new global capability state or runtime subscription. Full invalidation
clears pending exact causes, and later exact writes in the same batch cannot
weaken it. Commit, reason consumption, render recovery, cycle bounds, ownership
and teardown remain in the shared kernel. The per-runtime cause store remains
available even in a full-update-only program.

Production HTML-entry measurements against `ae4896b`, unchanged fixtures and
default Vite minification, including every emitted JS asset:

| Fixture | Before JS raw / gzip sum B | After JS raw / gzip sum B |
|---|---:|---:|
| Owner counter with initial HTML | 8,978 / 3,603 | 8,625 / 3,473 |
| Module counter with initial HTML | 12,289 / 4,757 | 11,923 / 4,618 |
| Mixed static cards and counter (1 or 60 cards) | 9,152 / 3,598 | 8,799 / 3,481 |
| Input/list | 24,173 / 8,963 | 24,225 / 8,995 |
| Composed counter | 11,272 / 4,447 | 11,344 / 4,469 |
| Owner keyed list | 24,273 / 8,984 | 24,327 / 9,006 |

Small full-update paths lose 353–366 raw bytes. Graphs retaining exact causes
gain 52–72 raw bytes for the explicit enqueue boundary. This is a capability
separation with a measured tradeoff, not a universal payload reduction or a DOM
timing claim. Static pages remain zero JS, and one versus sixty static host cards
around a local counter ship 8,625 versus 8,627 B. The kernel, mounting/binding
cost and the general keyed-list implementation still require further work.

Runtime/compiler builds and changed-production-source lint pass. The selected
compiler/runtime, exact-slot, cleanup, list, router/data, SSR-isolation and opaque
pull suites pass. All twelve package/source browser audit graphs pass interaction
and retained-node checks. All twenty production HTML checks passed across the
suite and an isolated rerun: the mixed-child Chrome check initially exceeded the
30-second limit under load, then passed in 7.7 seconds with a 90-second command
timeout. A separate DOM regression also verifies independent reasoned children
after a skipped static instance, retaining the original surrounding HTML.

## Explicit positional DOM rows

List meaning now includes a captured positional-identity proof. An explicit
`key={index}` qualifies when the callback binds the item directly, has no
replayed prelude, and has no spread or additional key reads. DOM emission selects
`createPositionalListRegion` only when the existing lightweight inline-row proof
also excludes entities, refs, nested regions and child lifetimes. Other keys and
resource-bearing rows retain the general keyed reconciler. Omitted keys continue
to mean item identity; duplicate primitive items still require explicit keys.

The positional capability stores entries by index and retains their nodes when
values are replaced or reordered. It batches new suffix nodes, removes a retired
suffix through the shared bounded-range operation, and retains broad content
replay and targeted index refresh. It contains no keyed Map, key encoder,
synthetic-key allocator or LIS machinery. Both reconcilers share list anchors,
row creation, server markers, adoption validation and range removal in
`list-dom.ts`, and both use the existing scheduler and compiler row factories.
Failed creation/update frames remain disposable and replay conservatively on
retry. An updater that starts another complete positional frame cancels the
remaining outer replay.

Hydration testing also exposed a pre-existing keyed append bug: the append path
captured the adoption document and later created its inert fragment after
adoption had finished. Appending could create rows without attaching them. Both
paths now obtain the active document for new fragments. Compiled regressions
verify adoption without creation/movement, retained positional identity, append,
clear, reinsertion and mismatched-marker recovery.

Production HTML-product JavaScript, same fixtures and Vite settings as `0010c01`;
raw bytes / sum of independently gzipped JavaScript assets:

| Fixture | Before | After |
|---|---:|---:|
| Input and positional todo list | 24,225 / 8,995 | 17,356 / 6,697 |
| Owner keyed list | 24,327 / 9,006 | 24,701 / 9,153 |
| Owner counter | 8,625 / 3,473 | 8,625 / 3,473 |
| Module counter | 11,923 / 4,618 | 11,923 / 4,618 |
| Composed counter | 11,344 / 4,469 | 11,344 / 4,469 |
| Mixed root with one or sixty static cards | 8,799 / 3,481 | 8,799 / 3,481 |
| Closed static/name/composition pages | 0 / 0 | 0 / 0 |

The todo graph loses 6,869 raw bytes (28%) and 2,298 gzip bytes (26%). Sharing the
DOM protocol adds 374 raw bytes to the keyed fixture; this batch does not shrink
every application. Runtime/compiler builds, positional capability attribution,
compiled interaction/hydration and existing keyed lifetime/recovery suites pass.
The twelve published/source Chrome audit graphs pass. The local DOM comparison
against `0010c01` validates all existing scenarios and mixed sequences before
timing, then checks every timed sample's content, classes, order and retained
identity. Five samples and ABBA order cover update, swap, clear and append at
10,000 rows across eight placements plus vanilla. Later runs slow substantially
even for vanilla; these timings establish no CPU gain. Reports remain in ignored
`bench/dom/dist/compare/0010c017-both/` and `bench/package-size/dist/`.

Structural initial HTML and browser binding are still separate unfinished work:
this todo fixture currently creates its initial DOM from JavaScript. Removing
that creation program and reducing the shared kernel remain necessary.

## Initial HTML for conditional regions

The bindings target now represents root-owned conditional regions as a selected
initial branch between explicit HTML comments. It uses the shared conditional
normalizer for ternaries, chains and logical JSX, rather than independently
guessing branch indices. The DOM address plan accounts for both anchors and the
selected branch when locating later siblings and text. All descriptor paths,
element kinds and structural comment identities are checked before any empty
text marker is replaced or events are attached.

For a proven host branch, one browser factory binds retained nodes on first
activation and creates fresh nodes on later activation. Static surrounding
markup is absent from the browser factory; branch markup remains because future
switches must recreate it. Creation-only text, attributes and appends are guarded
on first activation, while the branch's events and updater share their usual
state captures. Closed branch attributes have no updater. The existing
conditional owner, access routing, scheduler and cleanup handle later changes.
The ordinary JavaScript entry, development HMR and SSR targets retain their
existing creation/adoption paths.

Conditional lifetime handling also now stops after a selector, identity read,
factory or DOM insertion disposes the region. A factory that returns after
unmount has its returned entry cleaned. Cleanup is retired before invoking
authored disposal, so reentrant unmount cannot call it twice; a throwing disposer
does not prevent anchor/content teardown. Initial-construction failures remove
anchors while preserving the original failure, including `throw undefined`.
Failed branch selection can retry. This is not rollback of arbitrary authored
factory work or support for arbitrary nested reconciliation from disposal hooks.

Current production products for the same conditional graphs, raw JS bytes /
gzip sum, with one or sixty static cards outside a switchable branch:

| Static cards | Initial HTML plus binding JS | Ordinary DOM creation JS |
|---|---:|---:|
| 1 | 12,741 / 4,879 | 12,926 / 4,942 |
| 60 | 12,747 / 4,882 | 16,388 / 5,336 |

This comparison uses the same compiler/runtime revision and Vite settings. It
compares two rendering products, not old versus new CPU performance. Increasing
surrounding static content adds six JS bytes to the binding program and 3,462
bytes to ordinary creation. The stable owner counter grows from 8,625 / 3,473 at
`4f3fdd6` to 8,709 / 3,508; the module counter grows from 11,923 / 4,618 to
12,007 / 4,644. Structural comment validation costs 84 raw bytes in these
non-structural binding programs. Ordinary counters, positional/keyed lists,
composed counters and mixed roots keep their preceding payload sizes. The shared
conditional runtime itself grows with the initial-range and lifetime safeguards;
these costs are included in both conditional product figures. Closed static
pages remain zero JS.

All twenty-one production HTML integration checks pass, including Chrome checks of content with
JavaScript disabled, initial branch identity with no application element creation,
branch replacement/reentry with current state, and retained outer nodes. Compiled
DOM tests cover empty branches, independent regions, chain selection, later text
addresses, module routing and conservative fallbacks. Conditional lifetime,
ordinary conditional/directive, SSR adoption, existing binding and compiler
snapshot suites pass. Vite's detached `link` feature probe is excluded from the
application-element creation count; root/branch identity is independently checked.

The first structural boundary accepts closed selectors and plain host branches.
Nested structural bindings, fragment branches, composed children, list initial
HTML and unproved setup/ref/lifecycle/opaque behavior still use general creation.
Extending those placement/lifetime proofs and request HTML/state delivery remains
required; this is not completion of the architecture plan.

## Historical browser-creation baseline

The stable `bench:size:audit` fixtures include ordinary client mounting and
compiler root metadata. JavaScript is minified, then each whole bundle is
compressed once. Published browser exports and runtime-source attribution are
measured separately. Measurements on 2026-10-04:

| Authored graph | Before raw / gzip B | After module preservation raw / gzip B |
|---|---:|---:|
| Static client shell | 9,794 / 3,919 | 9,794 / 3,918 |
| Component-owned counter | 11,455 / 4,573 | 9,961 / 3,988 |
| Input and positional todo list | 27,298 / 10,540 | 24,623 / 9,594 |
| Module-state counter | 14,806 / 5,758 | 13,340 / 5,176 |
| Component composition | 12,631 / 4,971 | 11,318 / 4,449 |
| Component-owned keyed list | 27,240 / 10,497 | 24,567 / 9,560 |

The real Vite Todo bundle decreases from 35,697 / 12,784 B to 35,144 / 12,584 B.
It still exceeds the existing 30,000 / 11,000 B budget. The budget remains in
place and reports failure; the larger architecture work is not finished.

Preserving runtime modules prevents unused native-list initialization and other
features from surviving merely because a needed helper shares their output
chunk. Public exports and runtime behavior are unchanged. The distributed ESM
package has more individual files and more import/export text, so summing all
package files increases. Rebundled application payload is the relevant shipping
measurement; sums of separately gzipped modules are not an application size.

Runtime build and changed-source lint pass. The selected package, mounting,
props/effects, native-helper, SSR isolation/concurrency and hydration suites pass
77 tests across ten files. All twelve package/source browser graphs pass actual
interaction checks, including duplicate todo values, input reset, counter/prop
updates and retained DOM identity. This validates the packaging change, not the
unimplemented compiler/runtime architecture steps below.

## What the small Marko example exposes

The supplied example has two active state sources, `items` and `temp`. `count`
has no observable read or write. Its client output connects the item source to
a positional loop and the temporary source to the input value. Row text is
handled by small binding functions; appending does not require a keyed Map or
LIS reorder algorithm.

The memoized-dom equivalent in the audit explicitly uses `key={index}` to match
positional identity and allow duplicate strings. Our default key is item identity;
silently changing it to positional identity would change application semantics.
At the original baseline, that explicit positional key still shipped the general
keyed runtime. The positional DOM-row capability above now removes that machinery
when the identity and row-lifetime proofs hold.

For that graph, source attribution assigns approximately 10.4 KB minified to
`list.ts`, 4.9 KB to the kernel, 2.4 KB to mounting and 1.6 KB to generated app
code. The kernel also reaches environment, dirty-reason and scoped-storage
machinery. Reducing emitted identifier names cannot remove those costs.

Marko's reported 3.61 KB JavaScript / 374 B HTML is a useful target, but the
compression mode, included dependencies and HTML/state payload were not supplied.
[Marko documents separate server/browser compilation and serialized state](https://markojs.com/docs/introduction/welcome-to-marko),
and [its bundler excludes static content from browser JavaScript](https://markojs.com/docs/explanation/fine-grained-bundling).
An exact comparison must record all initial and interaction-loaded JS, HTML,
serialized state, compression and rendering mode. Client-created DOM must still
ship creation instructions; an HTML-first page can omit them from JavaScript.

## Compiler contracts

Extend the existing captured render/source/write plans with explicit interaction
and lifetime facts. Do not add another mutable analysis context or rediscover
semantics inside each runtime emitter.

| Fact captured before emission | Backend decision it enables |
|---|---|
| Source writes and the DOM slots/derivations they can affect | Emit a source-specific update group instead of a broad component replay |
| Unknown reads, escaped values and opaque calls | Retain the general update/pull path only for the affected work |
| Key semantics, row extent and lifecycle requirements | Select positional or keyed reconciliation and required ownership helpers |
| Effects, refs, cleanup, children and external subscriptions | Retain an owner even when its own DOM has no update slots |
| Module-state readers versus owner-local writes | Include access routing only when cross-owner resolution is needed |
| Fresh client creation versus existing server/build HTML | Emit creation or adoption/binding instructions independently |

The existing `ModuleRenderPlan` is a partial phase boundary, not a complete
target-independent intermediate representation. Its expression-source queries,
region shapes, placements and handler write plans are the starting point.
Interactivity facts describe observable work, not runtime helper names. DOM,
server and future backends consume the same semantic contracts and select their
own operations. Feature requirements are derived from emitted operations rather
than an unrelated list of compiler flags that can drift from actual calls.

## Browser runtime boundaries

1. **Owner updates and lifetime.** A small core should provide scheduled,
   deduplicated updates and disposal. Local state does not require wildcard
   access resolution. Static components without descendants or lifetime work
   should not create empty update closures or render entities. Static parents
   with dynamic children still need correct ownership.
2. **State routing.** Module writes, wildcard readers and payload routing remain
   an optional capability. Compiler-derived direct local causes already work;
   the small counter graph confirms access routing can be absent.
3. **Structural regions.** Positional lists should have a smaller implementation
   without keyed maps, duplicate-key checks, key encoding or LIS. Keyed lists
   retain those capabilities. Selection requires semantic proof, not recognizing
   application helper names or assuming an unchanged length means unchanged rows.
4. **Host context.** Browser creation, server request isolation and hydration
   should be separate host adapters around the same ownership contracts. The
   current browser graph still reaches the synchronous storage registry and
   mount's hydration detection. Splitting these requires preserving multiple
   applications, deferred callbacks and late host initialization.
5. **Optional behavior.** Effects/refs, preparation, transparent data, props,
   routes and opaque pulls remain separate modules. Their initialization must
   stay with the feature that owns it, and the package build must preserve that
   boundary.

These are capabilities, not a second framework implementation. Shared scheduling,
error recovery and lifecycle contracts remain authoritative. The full runtime
continues to handle sources the compiler cannot prove.

## Creation and interaction output

Compile creation and future interaction as separate programs over one semantic
plan. This does not mean rerunning initial expressions in a generic `_update()`:
initial getter evaluation, child creation, refs and effects have observable order.
Simple binding code can be shared only where that order is preserved.

For client-created applications, emit compact templates plus the required node
bindings and updates. For server-rendered or build-rendered pages, emit HTML and
ship only bindings, events, state and code that can affect future interactions.
Static HTML does not require a client component factory solely to recreate it.
Creation templates remain necessary for branches/lists that can appear later.

Scheduling still commits coherent writes after the authored handler boundary.
Replacing a grouped update with immediate writes after every assignment would
change multi-write handler behavior, early-return behavior and effect ordering.
Source-specific update groups must retain batching and opaque fallbacks.

## Implementation order and gates

| Order | Work | Required evidence |
|---|---|---|
| 1, first boundary implemented | Separate initial content from browser execution; emit closed static pages as HTML | Hello and larger static composition ship zero JS; CSS, unknown effects, dev HMR and direct JS consumers remain correct |
| 2, first mixed boundary implemented | Extend the semantic plan beyond closed-root/primitive-prop placements with interaction roots, source/slot reachability, captures and lifetime requirements | Static parent with interactive child; unused state; callbacks, hidden reads, refs and cleanup; explain every retained client region |
| 3, direct host roots and first conditional boundary implemented | Extend HTML plus browser binding/event/update output to composed children and remaining structural regions | Static markup absent from client factories; counter and input/todo fixtures; later branches/lists, event ordering, coherent commits and recovery |
| 4 | Extend the same separation to request HTML and serialized state | Zero-JS static SSR, minimal mixed-page interaction JS, async isolation, payload safety and hydration correctness |
| 5 | Reduce runtime capabilities required by the derived browser program | Scheduling/lifetime core, optional access routing/host adapters, positional versus keyed lists, opaque fallback and retained identity |

Each step gets before/after whole-application measurements. Keep a keyed list,
composed app and module-state app beside the tiny example so reducing one case
does not hide growth elsewhere. Numeric key interning and code compression are
secondary: the earlier measured gzip savings were small compared with the
runtime and creation work above. Runtime module preservation is already in
place and remains useful, but no longer sets the order of architecture work.
