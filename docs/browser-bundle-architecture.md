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

## Current checkpoint — 2026-10-06

The first separation of HTML and browser execution is implemented. Proven static
pages ship zero JavaScript. Supported interactive roots bind server/build HTML;
closed static composition no longer adds browser factories. The linker emits
one browser graph, and runtime scheduling, ownership and settlement remain
shared. The entire compiler is not yet independent of the DOM backend.

Zero JavaScript is an automatic result for proven noninteractive pages, not a
constraint on authoring. Routing, `Group`, pending/error presentation, retries
and navigation retain their semantics and browser program. Reducing their
required code remains the goal; removing those features or forcing their pages
to fit a zero-JavaScript subset is not the goal.

Latest verified production SSR fixtures, all emitted browser chunks:

| Fixture | Browser JS B | Gzip sum B |
|---|---:|---:|
| Static page | 0 | 0 |
| Counter | 8,613 | 3,483 |
| Counter with 60 static cards | 8,611 | 3,483 |
| Interactive composition | 10,300 | 4,074 |
| Input / list | 17,140 | 6,443 |
| Noninteractive fetched page | 0 | 0 |
| Noninteractive fetched composition | 0 | 0 |
| Interactive fetched page | 31,496 | 10,595 |
| Interactive fetched page with request-selected host branches | 35,341 | 11,843 |
| Interactive fetched page with a local conditional | 33,702 | 11,362 |
| Interactive fetched list | 46,171 | 15,468 |
| Interactive fetched list with fixed siblings | 46,687 | 15,546 |
| Interactive local list beside fetched text | 46,913 | 15,763 |
| Routed fetched page with Group | 85,056 | 26,209 |

The static-card result demonstrates the architecture change: more static
content grows HTML without growing the counter's browser program. Fixed
interactive fetched layouts now use initial bindings with the shared data
envelope. Request-selected conditionals with one host root per alternative also
bind their selected nodes. Fetched lists with fixed host rows in dedicated
containers bind arbitrary initial row counts through the shared list engine. A
single fetched list can also bind fixed siblings in the same host.
Multiple unknown extents, nested regions, component rows and routing/Group retain
general adoption and creation instructions.
Their remaining cost needs deeper binding/reachability
planning while preserving routing and data presentation.

| Area | Status |
|---|---|
| Shared source/render facts and one browser graph | Implemented foundations; some emission planning remains DOM-specific |
| Closed static HTML, primitive props and supported composition | Implemented and verified in production Chrome |
| Initial host, conditional and list bindings | Implemented first supported shapes; uncertain/nested shapes retain creation |
| Request-dependent HTML plus minimal browser bindings | Noninteractive fetch pages, fixed interactive fetched layouts, single-host conditional branches and fetched lists with fixed siblings implemented; multiple unknown extents, nested/component rows and routed/Group shapes retain general adoption |
| Runtime capabilities | Shared data settlement, optional promise reads/payload/polling, unused cursor removal, lean markup adoption and lazy state-cell storage implemented |

Callback props, escaping mutable values, hidden reads and unknown initialization
still require conservative ownership/creation proofs. Supported refs, inline
effects and cleanup retain their existing lifetime owner beside bound HTML. Fixed-shape
composed factories now bind initial instances and create later conditional
instances. Broader composition remains open. Mobile/desktop emission is
not implemented. DOM performance work remains in `performance-work.md`; these
bundle results do not establish faster CPU timings. A current VM comparison is
still outstanding.

## Implemented initial-content boundary

### Single browser graph and SSR delivery — 2026-10-04

Architecture batch: `9ec8f6a`. The linker emits each module once into `output`
and `maps`. Six alternate output/map tables across the compiler and Vite host,
their virtual resolver/loader and the second module compile were removed. SSR
and static HTML use the same shell helper. No alternate bootstrap template is
kept. New server-only identity checks prevent mixing build artifacts.

Paired production SSR audit against adapter `cc5ce13`, with the current compiler
and runtime used on both sides. These are byte counts for every emitted client
chunk, including shared and future code; gzip compresses each chunk separately.
They isolate adapter delivery changes rather than compare whole repository
revisions. Server JavaScript is excluded. Each response was actually rendered;
the request-data case resolved its API data.

| Fixture | Before JS B / gzip sum B | After JS B / gzip sum B | After HTML B | After payload B |
|---|---:|---:|---:|---:|
| Static | 18,264 / 6,433 | 0 / 0 | 146 | 0 |
| Counter | 20,779 / 7,328 | 8,730 / 3,517 | 218 | 0 |
| Composition | 22,556 / 7,929 | 10,417 / 4,107 | 248 | 0 |
| Input / list | 28,530 / 10,054 | 17,157 / 6,449 | 348 | 0 |
| Counter with 60 static cards | 23,979 / 7,755 | 8,728 / 3,517 | 3,078 | 0 |
| Request data | 51,453 / 16,449 | 51,453 / 16,449 | 564 | 315 |

HTML includes its payload where present. Static delivery emits no JavaScript
assets. The counter/composition/list cases each emit one browser entry. Static
composition does not increase binding code; later list/branch creation stays
available. The request-data fixture still needs the larger hydration/data
capabilities and is the next delivery area to unify and reduce.

Verification: compiler/runtime/server/Vite package builds and changed-source
lint passed; 121 server tests and 58 Vite tests passed, including production
Chrome adoption, event updates, later row/branch creation, CSS retention and
request data. Focused compiler/runtime tests cover both binding and creation,
node identity, cleanup and uncertain proofs. The ABBA local DOM comparison
validated all 21 scenarios and mixed sequences, plus three timed 10k operations
across all state placements. Its before/after browser bundles are byte-identical;
this batch makes no DOM timing improvement claim.

The workspace typecheck still reports missing generated fullstack declarations
and example typing errors. Package builds pass. No dependency version changed.
VM comparison remains outstanding because no VM is configured here.

Run `bun run bench:size:ssr --before-ref=cc5ce13` for the paired delivery audit.
Reports live in `bench/package-size/dist/ssr/`. DOM comparison reports live in
`bench/dom/dist/compare/cc5ce138-both/`.

### Shared planning

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
entry. Development retains HMR. Production SSR now selects the same initial-content
plan before browser emission; request-dependent content still evaluates per request.

The production Hello test emits **zero JavaScript assets** and renders in Chrome
with JavaScript disabled. A larger page with forty instances of an imported
component also emits zero JS assets. HTML and CSS remain visible. These tests
use independent fixtures, never example sources.

Document hosts validate their HTML shell before browser emission. The linker
then emits one program in `output` and one set of authored maps in `maps`.
The same DOM emitter consumes binding addresses when initial content is proved,
and creation instructions when browser work requires them. It no longer compiles
each eligible module a second time, stores an alternate output table, or creates
a virtual copy of the browser graph.

A closed root with live child components retains its static ancestors and
closed composition in HTML. Placement markers describe children whose initial
work needs browser execution; proved interactive children bind existing nodes.
The shared runtime owns both retained and newly created nodes. Direct JS entries
have no HTML document to bind and retain their required creation instructions.
Development keeps HMR and server compilation retains request ownership.

Production SSR templates carry the compiler identity for their sole browser
program. The server validates that identity against the responding root before
delivery; it does not select between two templates or silently use a different
bootstrap. A static page emits zero JavaScript assets. A closed interactive page
ships bindings without the general hydration bootstrap or a data payload.
Request-dependent roots use the existing shared render session and hydration
capabilities. These remaining capabilities are not a second generated browser
graph; deeper unification of request-dependent binding plans remains open.

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
before any retained nodes move. The selected browser program carries its
authored source maps. Fixtures never read examples.

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

The first version required one direct host root with known initialization
and host-only children. Later conditional, list and composition batches below
extend that proof. DOM properties/styles, refs, effects and opaque setup still
need their ordinary behavior unless a later section explicitly covers them.
Empty dynamic text has a comment placeholder replaced with a text node. Runtime
binding validates all required addresses and node kinds before replacing any
placeholder. Events, batching, module routing and mount/unmount ownership reuse
the existing compiler/runtime paths. This is not a separate event scheduler.

This is still a partial architecture change. Unproved live children start as
HTML markers and create their initial DOM through the existing runtime. Proven
composition can now bind its initial HTML as described below. Request state
serialization remains separate work. The compiler does not prove arbitrary JS
static.

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

That first structural boundary accepts closed selectors and plain host branches.
At that revision, nested structural bindings, fragment branches, composed
children, lists and unproved setup/ref/lifecycle/opaque behavior still used
general creation. The list boundary below extends this work; additional
placement/lifetime proofs and request HTML/state delivery remain required.

## Initial HTML for lists

The closed-value planner now represents arrays without executing authored code
and uses the shared list callback normalization contract to expand initial rows.
Unchanged lists, including composed static rows and const row derivations, can
ship HTML with zero browser JS. Duplicate keys, unknown calls, sparse/spread
arrays and unproved reads retain browser execution rather than silently removing
their runtime behavior.

For nonempty interactive arrays with plain host rows, the initial plan records
the list extent separately from a reusable row placement plan. HTML contains the
initial rows between list anchors. Browser descriptors identify those anchors;
row descriptors use paths relative to the supplied row root. Descriptor code is
emitted once per row factory, rather than once per initial item. Item and index
reads remain live even though their first values are closed.

The same row factory binds initially and creates later rows. Cached text starts
from the adopted node's data on binding and from the authored expression on fresh
creation. Row events use existing delegation; module readers retain their row
entities. Default object/value identity remains unchanged, explicit item keys
keep keyed reconciliation, and proven index keys retain positional reconciliation.
Initial rows are not moved or recreated. Empty-text comments are replaced with
text nodes by the shared binding validator.

`initial-list.ts` is an optional validator around the shared list DOM/reconcile
contracts. It is absent from ordinary JS-entry graphs. The shared runtime still
retains its SSR row protocol and mismatch error; this batch does not remove those
costs. Initial extents own unbound rows during interrupted construction. Disposal
drains them, completed rows and anchors. Successful binding releases the initial
node array and cleanup closure, so later removal does not retain detached rows.
Ordinary row factories continue receiving three arguments; initial factories get
their root as a fourth compiler-private argument.

Same-revision Vite products, raw JS bytes / gzip sum:

| Row identity / static cards | Initial HTML plus binding JS | Ordinary DOM creation JS |
|---|---:|---:|
| Keyed / 1 | 25,773 / 9,346 | 25,216 / 9,188 |
| Keyed / 60 | 25,777 / 9,346 | 28,652 / 9,579 |
| Positional / 1 | 18,524 / 6,935 | 17,963 / 6,779 |
| Positional / 60 | 18,528 / 6,935 | 21,399 / 7,158 |

Both list products have 408 B initial HTML with one card and 3,644 B with sixty.
Adding static content costs four binding JS bytes, versus 3,436 creation bytes.
The tiny binding products currently cost 557–561 raw JS bytes more than ordinary
creation because of validation and retained future creation. This is a static
content scaling improvement, not a claim that every list bundle is smaller.
The forty-row composed static fixture ships 701 B HTML and zero JS.

Against `47751b1`, the existing positional input/list grows from 17,356 / 6,697
to 17,853 / 6,873 because its ordinary list runtime shares the initial-range
protocol. Its controlled input still prevents initial HTML binding. The owner
keyed-list fixture now has initial HTML but grows from 24,701 / 9,153 to
25,311 / 9,241. Generalizing the node binder to accept row roots adds 21 raw
bytes to bound owner/module counters: 8,730 / 3,517 and 12,028 / 4,652.
Ordinary counter creation, composed counters and mixed roots are unchanged.
Hello, unchanged names and closed static composition remain zero JS. Reducing
the shared list/ownership runtime and the retained creation program remains
necessary; none of these costs is hidden by changing the existing fixtures.

All twenty-three production integration checks pass, including Chrome checks of
both list identities, initial HTML with JS disabled, no initial application
element creation, replacement/reorder/append/clear, later row events and retained
outer nodes. Self-contained compiled fixtures also cover default object identity,
module readers, independent ranges, empty row text, unmount and conservative
fallbacks. Runtime tests cover shape/count mismatches before factories, ordinary
factory arity, failed frames including `throw undefined`, and disposal before or
during binding. Existing keyed/positional, SSR list and compiler golden suites
remain passing.

At `3e8f1fb`, empty interactive arrays, destructured interactive callbacks, nested structures,
composed interactive rows and unproved refs/setup/lifecycle/opaque expressions
still use general creation. Controlled inputs, nested placement, composition and
request HTML plus serialized state are outstanding architecture work.

## Empty list and controlled input binding

Closed empty lists now emit and bind their anchors. No initial row is evaluated,
so there is no need to infer a symbolic host shape from an absent item. Future
rows use the existing factory and reconciler, including composed/destructured
rows with effects and cleanup. The stricter plain-host proof still applies to
nonempty initial lists.

Closed initial values on text, search, email, URL, password and telephone inputs
now have a binding operation. It assigns the authored current value, then removes
the serialized `value` attribute. This establishes the browser's dirty-value
flag and restores the ordinary factory's empty default value. Native form reset
therefore matches property-only creation. Later updates retain the existing slot
guards and source routing. This optional helper is absent from ordinary creation
graphs. Initial binding uses authored state; pre-JavaScript input event replay
is not implemented.

Other input types, static HTML-only input property writes, nested/composed
nonempty binding and request HTML plus serialized state remain outstanding.
Static unchanged pages and closed static lists still ship zero JS.

Against `3e8f1fb`, the unchanged input/list fixture now emits 351 B HTML
(249 B gzip), instead of 180 / 150 B. JavaScript changes from 17,853 / 6,873 B
to 17,941 / 6,799 B: 88 B more minified and 74 B less gzip. This is a fixed
binding cost, not evidence that the list runtime is small enough.

| Empty todo / static cards | Initial HTML, minified / gzip B | Binding JS, minified / gzip B | Ordinary creation JS, minified / gzip B |
|---|---:|---:|---:|
| One | 353 / 254 | 18,003 / 6,821 | 17,368 / 6,618 |
| Sixty | 3,589 / 427 | 18,008 / 6,821 | 20,776 / 6,999 |

Fifty-nine more static cards add five binding JS bytes versus 3,408 ordinary
creation JS bytes. Ordinary JS-entry and Vite HTML products have different
bootstrap costs; compare growth within each product. Existing counter, module
state, composition and non-input list measurements are unchanged.

Focused compiler/DOM suites, ordinary emission goldens, keyed/positional SSR
hydration and ownership/error recovery checks pass. All twenty-four production
integration checks pass, including Chrome with JS disabled and interactions
after binding. Twelve published/source browser graphs pass the interaction
audit. Self-contained fixtures verify whitespace rejection, duplicate todo
values, retained nodes, clear/reinsert, primitive input values, native reset,
conditional input reentry and lifecycle work in later composed rows.

The local DOM comparison against `3e8f1fb` completed in ABBA order with three
samples for update and append1k at 10k rows across all state/row placements plus
vanilla. All twenty-one correctness scenarios and mixed sequences passed before
timing; every sample checked text, classes, order and retained identity. Local
timings vary and this binding batch makes no CPU speed claim.

At the end of the input/empty-list batch, the next boundary was list hydration adoption. Both
reconcilers should keep the shared DOM/ownership protocol while an optional
hydration controller owns SSR row validation and adoption. Browser list graphs
still retain that validation machinery today. This work is not implemented by
the input/empty-list batch.

## List adoption owned by the hydration host

The shared list DOM protocol now asks the optional hydration controller to claim
a list. Its transaction owns primitive-key validation, server row order,
per-row cursor push/pop and final range validation. Ordinary row creation calls
its factory directly. Both positional and keyed reconcilers retain their shared
DOM movement, scheduling, identity and cleanup operations. Server rendering still
writes the same markers; initial build HTML still uses its separate validated
node range. Successful adoption releases the list transaction before later
client-created rows.

An authored factory error stays primary if cursor validation also fails,
including a thrown `undefined`. Disposing during a row factory still cleans
its returned entry and prevents further reconciliation. Mismatched keys/order
and extra server rows retain the existing mount recovery. This boundary removes
the SSR list validator and mismatch class from initial-list binding graphs.
Ordinary mount still includes marker detection and its own mismatch class.

Whole application measurements against `7a81e98`, minified / gzip bytes:

| Product | Before JS B | After JS B |
|---|---:|---:|
| HTML-bound input/list | 17,941 / 6,799 | 17,157 / 6,449 |
| HTML-bound owner keyed list | 25,311 / 9,241 | 24,525 / 8,893 |
| HTML-bound positional list, one card | 18,524 / 6,935 | 17,739 / 6,589 |
| HTML-bound empty todo, one card | 18,003 / 6,821 | 17,219 / 6,473 |
| Published browser input/list, ordinary mount | 17,481 / 6,979 | 16,932 / 6,749 |
| Published browser owner keyed list, ordinary mount | 24,898 / 9,725 | 24,334 / 9,484 |

Counters, module state and composition graphs are unchanged. Closed static HTML
products still ship zero JS. The large fixed list/ownership cost remains;
this boundary does not establish that the overall runtime is small enough.

Moving the validator also has an explicit hydration-inclusive cost. Source
graphs including `@memoized-dom/runtime/hydrate`, compiled from the same stable
fixtures and compressed once, measure:

| Hydration-inclusive source graph | Before JS B | After JS B |
|---|---:|---:|
| Owner counter | 19,623 / 7,011 | 20,318 / 7,277 |
| Input/list | 28,142 / 10,213 | 28,287 / 10,269 |
| Owner keyed list | 35,590 / 12,933 | 35,724 / 12,996 |

The current full hydration document retains the new list method even for a
counter. This is a cost of the existing general hydration entry; more precise
structural hydration capabilities remain future work. `bench:size:audit --hydrate`
now reports that product separately so future browser savings cannot
hide hydration growth. Ordinary SSR rendering remains covered independently.

Runtime build, changed-source lint, existing keyed/positional reconciliation,
compiled initial binding, SSR isolation/concurrency, hydration cursor/recovery
and production integration checks pass. Eleven new host tests cover retained
identity, later client creation, extra rows, unconsumed row content, unstable
keys, disposal during creation and primary error preservation. Published
positional and keyed integration cases also recover extra server rows and keep
subsequent append working. All twenty-four production initial-HTML checks pass.
All twelve published/source browser graphs also pass interaction checks in each
audit, with and without the hydration capability installed.

The local DOM comparison uses the baseline runtime with the same compiler and
authored inputs, three samples in ABBA order for create/update/append1k/clear at
10k rows. All twenty-one correctness scenarios and mixed sequences pass before
timing, with text/class/order/retained-identity checks after every sample.
Vanilla also changes substantially between order pairs. These local results
make no CPU speed claim; payload reduction is the verified gain.

Local DOM comparison against `47751b1` uses five samples in ABBA order for
10k-row update/swap/append1k/clear across all eight state/row variants and vanilla.
All twenty-one correctness scenarios and mixed sequences run before timing;
each timed sample checks text, classes, order and retained identity afterward.
The first before run is broadly slower, including vanilla append at 6.0 ms versus
3.5 ms; the reverse-order pair has vanilla append at 3.7 versus 4.3 ms and mixed
framework changes. This drift supports no CPU improvement or regression claim.
Artifacts and both exact bundle hashes are recorded in ignored
`bench/dom/dist/compare/47751b12-both/results.{json,md}`. These general DOM fixtures
use ordinary creation; production Chrome checks above cover initial HTML binding.

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

### Composed initial bindings

The semantic content plan now preserves component calls, defining module/local
identity and live prop facts. DOM emission derives addresses relative to each
instance's host root. Nested imported aliases, repeated factories and derived
props reuse their existing handlers, prop replay, access routing and ownership;
their initial elements are supplied by HTML. Potentially live text/attribute
slots are merged conservatively across instances. Closed static children omit
their client calls and registrations, while instance suffixes still count those
authored placements.

The proof currently requires a module-owned component with one direct host
root, outside structural rows/branches. Authored children slots, escaped factory
references, future unbound uses, differing initial branch/list extents, refs,
effects and unknown initialization keep the previous mixed/ordinary products.
Component-owned inline lists can bind inside an eligible child and retain their
normal creation path for later rows. No authored function is evaluated during
planning, and ordinary JS-entry output remains a separate compiler product.

Production payload comparison against the previous hydration-host batch:

| Fixture | Before JS raw / gzip B | After JS raw / gzip B | Before / after HTML B |
|---|---:|---:|---:|
| Composed counters | 11,344 / 4,469 | 10,417 / 4,107 | 180 / 251 |
| One static card + counter | 8,799 / 3,481 | 8,857 / 3,558 | 267 / 265 |
| Sixty static cards + counter | 8,799 / 3,481 | 8,858 / 3,561 | 3,503 / 3,501 |

The small shell grows 77–80 gzip JS bytes; binding the child replaces the
previous marker/creation product. Adding 59 static cards adds one raw JS byte.
Static composition remains zero JS. Owner/module counters, inputs and keyed/
positional list products are unchanged. The ordinary package/source interaction
audit is unchanged and passes all twelve graphs. Tests cover node identity,
independent instances, nested alias/derived props, captured and imported callback
writes, later rows, disposal and conservative fallback. All 25 production HTML
checks pass, including real Chrome composition interaction without initial
element creation. These are payload/correctness results, not a CPU speed claim.

### Data capability retention and shared settlement

The fetch-only browser graph previously retained the promise controller through
the default runtime constructor. The runtime now has one request/cache boundary
and one provider lifetime/settlement coordinator. `$read` installs its capability
on that same object, with its store created only when the first read runs. The
full public runtime API still exposes both methods. The old independent fetch
and promise settlement loops and the separate module-disposer registry were
removed. There is no second scheduler or cache implementation.

The independent loops had a correctness defect: fetch completion could start a
read after the read loop had already returned, and read completion could start
a fetch after the fetch loop had returned. Both authored regressions fail on
`744e70d` and pass with the shared coordinator. Explicit deadlines span the
whole settlement; existing provider defaults remain five and thirty seconds.

Paired source measurements use the current compiler, the same authored fixtures,
mount plus optional hydration, and runtime/data sources archived from `744e70d`
with their original package metadata:

| Fixture | Before raw / gzip B | After raw / gzip B |
|---|---:|---:|
| Fetch-only page | 51,329 / 16,516 | 48,778 / 15,978 |
| Promise-read page | 51,378 / 16,527 | 51,545 / 16,581 |

The promise page grows 167 raw and 54 gzip bytes to retain the shared coordinator.
The six existing static/counter/input/composition/list source graphs are unchanged.
The distributed fetch graph falls from 51,013 / 16,545 to 48,478 / 15,978 bytes.
Packaging alone was ruled out: the equivalent source graph had no material size
advantage before this change. Fetch snapshot/ownership adapters remain shared
with forms and reads; this batch does not remove all data support or general
hydration from request-dependent pages. These are bundle and correctness results,
not a CPU speed claim. Production static HTML remains zero JavaScript.

The unchanged production SSR fixture/build also falls from the clean `744e70d`
measurement of 51,453 / 16,449 browser bytes to 48,915 / 15,892. Served HTML
remains 564 bytes including the same 315-byte data envelope. The SSR delivery
harness uses current data code on both adapter sides, so its two adapter rows
both show the new size; the runtime comparison uses the previous clean result.

### Remove the unused hydration sibling cursor

Production adoption uses `HydrationNodePlan` for compiler creation order and
`HydrationMarkerIndex` for structural identities. Each claimed range also used
to construct a `LocalHydrationCursor`, but no production consumer read it. That
second node-claim/range-walking implementation, its helper and its range field
were removed. Root lookup now returns the bounded range directly. Cursor tests
were migrated to the actual creation plan and marker index, retaining node
identity, namespace failures, failed-claim position, nested/empty boundaries,
row extents and duplicate/missing marker checks.

Source baseline `f043146`, identical current compiler/fixtures, mount plus the
optional hydration entry, whole-bundle raw/gzip bytes:

| Fixture | Before raw / gzip B | After raw / gzip B |
|---|---:|---:|
| Fetch-only page | 48,778 / 15,978 | 47,386 / 15,689 |
| Promise-read page | 51,545 / 16,581 | 50,154 / 16,287 |
| Static JS-entry shell | 17,761 / 6,313 | 16,372 / 6,012 |
| Owner counter | 20,318 / 7,279 | 18,929 / 6,979 |
| Input/list | 28,287 / 10,269 | 26,896 / 9,968 |
| Module counter | 23,648 / 8,458 | 22,261 / 8,159 |
| Composition | 22,109 / 7,875 | 20,721 / 7,579 |
| Keyed owner list | 35,724 / 12,992 | 34,322 / 12,674 |

The distributed fetch graph falls from 48,478 / 15,978 to 47,080 / 15,618 bytes.
This removes unused runtime work without replacing the adopted-node validator
or adding another hydration implementation. The static JS-entry fixture above
deliberately includes mount/hydration; production static HTML still ships zero
JavaScript. These are bundle measurements; fewer range allocations are not a
measured hydration speed claim.

Without the hydration entry, all eight source bundles are byte-identical to
`f043146`. Both audit modes pass their 24 browser graphs. The hydration/SSR
suite passes all 16 files; migrated plan/list checks also cover namespace
failure without DOM mutation. The production Chrome test restores request data
without a second fetch, removes the consumed payload, retains the server's
main/title/button nodes and updates the counter after adoption. The existing
initial-binding test still covers later branch and row creation.

The production SSR fetch fixture falls from 48,915 / 15,892 to 47,524 / 15,560
browser bytes, with the same 564-byte HTML and 315-byte payload. Static and closed
binding SSR fixtures remain unchanged, including zero-JavaScript static output.

### Traverse markup without retaining server value parsing

Markup hydration previously built a complete `MarkupChild` tree, decoded every
text and attribute value, then recursively converted the tree to node
expectations. Adoption uses only node type, tag and namespace. The shared
`walkMarkup` traversal now supplies those claims directly to the existing
`HydrationNodePlan`. Server `parseMarkup` uses the same traversal to build its
value-bearing tree; attribute/entity decoding is retained only on the server.
The old tag parser and hydration tree-to-expectation walk were removed. Runtime
source has over eighty fewer lines after including the shared traversal.

Source baseline `56fc150`, identical current compiler and authored fixtures,
mount plus the optional hydration entry, whole-bundle raw/gzip bytes:

| Fixture | Before raw / gzip B | After raw / gzip B |
|---|---:|---:|
| Fetch-only page | 47,386 / 15,689 | 46,279 / 15,334 |
| Fetch plus sixteen markup cards | 49,068 / 15,997 | 47,961 / 15,639 |
| Promise-read page | 50,154 / 16,287 | 49,047 / 15,946 |
| Owner counter | 18,929 / 6,979 | 17,820 / 6,616 |

The distributed fetch graph falls from 47,080 / 15,618 to 45,997 / 15,266 bytes.
Production SSR falls from 47,524 / 15,560 to 46,441 / 15,232, with the same
564-byte HTML and 315-byte payload. Production static output still ships zero
JavaScript; closed initial-binding outputs are unchanged. All nine client-only
source bundles, including the markup fixture, are byte-identical to the baseline.
The audit checks that the new fixture actually emits `materializeMarkup`.

Both audit modes pass all 27 browser graphs. The markup tests compare creation
order, namespaces and decoded server values with native Chrome, including
quoted angle brackets, entities, void elements, SVG and MathML. The production
Chrome test adopts all sixteen server cards without creating elements, retains
their identity through a counter update, consumes the data payload and performs
no second fetch. Hydration tests pass 69 checks in sixteen files; server tests
pass 121 checks. These are bundle and correctness results, not a CPU speed claim.

The new audit also exposed an existing compiler text issue: authored
`<p>Ready &amp; waiting.</p>` emits `Ready &amp;amp; waiting.` in its markup
string and displays the entity spelling. This is reproducible without the
runtime change. The audit uses `{'Ready & waiting.'}` to measure this batch;
literal JSX entity normalization needs a compiler fix shared by initial HTML,
ordinary DOM emission and SSR, rather than a special case in the runtime parser.

### Shared JSX literal semantics

That entity issue is now fixed at the compiler AST boundary, before initial
render planning or DOM emission. Authored text folds source indentation before
decoding entities, so explicit non-breaking/space entities survive. Quoted JSX
attributes decode from their original spelling and receive a correct JavaScript
literal for lowering. Re-entering or cloning the AST does not decode twice.
Expression strings such as `{'&amp;'}` remain literal JavaScript strings.
Host content, component slots and initial HTML now consume these semantic
values directly; the emission-owned text normalizer was removed.

The compiler declares the already locked `entities@7.0.1` decoder as a direct
dependency. Existing package versions are unchanged; the frozen offline install
reports no installation changes. This dependency is compiler-only.
The audit and production SSR fixtures now use authored `&amp;` rather than the
expression workaround. Regressions cover both frontends, props, slots, explicit
whitespace, unknown entities, initial HTML, server markup and retained-node
hydration. Browser bundles for the existing fixtures remain unchanged.
The focused compiler/composition/markup suites pass 183 tests; production
HTML/SSR passes 28 tests. Both audit modes verify eighteen browser graphs each,
and all eighteen source bundle hashes match the saved previous-compiler output.

### Optional transfer production on the shared data runtime

The browser needs to restore server data; it normally does not produce a new
transfer envelope. `FetchStore.serialize`, its JSON transfer checks and record
producer were moved to `serialization.ts`. This is one producer over the same
fetch store, not a second cache or runtime. The existing runtime-to-hydration
WeakMap now stores that fetch store directly, removing two adapter closures.

Public `createDataRuntime`, `getActiveDataRuntime` and `setActiveDataRuntime`
still expose the complete API on the same object. Internal fetch initialization
and `$read` install only the capabilities they need. Server rendering uses the
public runtime and retains serialization; browser restoration stays in the core.
Transfer safety checks, redacted errors and source identities are unchanged.

Source baseline `8a61ddd`, same compiler and authored fixtures, mount plus
hydration, whole-bundle raw/gzip bytes:

| Fixture | Before raw / gzip B | After raw / gzip B |
|---|---:|---:|
| Fetch-only page | 46,279 / 15,334 | 44,900 / 14,872 |
| Fetch plus sixteen markup cards | 47,961 / 15,639 | 46,582 / 15,192 |
| Promise-read page | 49,047 / 15,946 | 47,642 / 15,461 |

Without hydration the source fetch fixture falls from 37,519 / 12,524 to
36,140 / 12,069 bytes. All six non-data fixture sizes are unchanged in both
audit modes. Production SSR fetch output falls from 46,441 / 15,232 to
45,062 / 14,775 browser bytes; HTML remains 564 bytes with a 315-byte payload.
Production static output remains zero JavaScript. Public runtime consumers
retain the producer because they explicitly expose serialization.

The new tests install capabilities after requests/reads exist, verify unchanged
runtime identity and one network call, restore serialized data without a fetch,
clear the shared boundary and check that getters, rich objects and cycles remain
excluded from transfer. Data tests/type checks pass all 63 tests; both audit
modes pass all 27 browser graphs. These are bundle and correctness results,
not a CPU speed claim. All 121 server tests and the three production SSR tests
pass, including native Chrome adoption and no duplicate request. Request-dependent
binding planning remains open.

### Retain composed creation only where future instances require it

An initial component and a later conditional instance previously forced the
whole page to retain ordinary browser creation. The semantic plan now records
which composed factories can be instantiated again and propagates that fact
to their descendants. The DOM backend binds existing instances and creates
later instances through the same factory, scheduler and lifetime machinery.
Static surrounding markup is omitted from the browser program.

Props that appeared closed at an initial placement stay updateable when that
factory has future callers. Otherwise a newly created instance could capture
the first caller's value. Escaped factories, incompatible initial extents and
recreated factories with unproved structural shapes keep ordinary rendering.
Request-dependent roots still use general hydration; this batch does not
replace their creation program.

This exposed a scalar-forwarding bug: a parameter forwarded through a wrapper
was treated as positive JSX evidence. One shared caller-evidence resolver now
propagates scalar and JSX contracts through local and imported wrapper chains.
The former local usage accumulator and linker accumulator were replaced by
that resolver. Real JSX slots retain their ownership and updates; conflicting
scalar/JSX contracts remain errors.

Production Vite HTML builds, compiler/Vite baseline `77f0fa4`, identical current
runtime and authored fixtures, all emitted browser chunks:

| Fixture | Before JS raw / gzip sum B | After JS raw / gzip sum B | After HTML raw / gzip B |
|---|---:|---:|---:|
| Future composition, one static card | 15,529 / 5,820 | 14,251 / 5,362 | 495 / 291 |
| Future composition, sixty static cards | 21,158 / 6,875 | 14,257 / 5,368 | 3,731 / 465 |

The static-name control remains zero JavaScript. The existing sixty-card mixed
composition control remains 8,858 / 3,561 bytes. The ordinary JS-entry creation
outputs are unchanged: 14,859 / 5,532 and 20,488 / 6,585 bytes respectively.
`bench:size:html` now accepts `--before-ref=<commit>` and repeated
`--fixture=<name>` arguments, so the compiler/Vite comparison is reproducible
without changing the checkout or hand-editing generated code. Baseline source
is archived under the ignored benchmark output directory; the current runtime
is held constant. These are bundle measurements, not CPU timing claims.

Focused composition, planning, conditional/list and frontend suites pass 91
tests. Tests cover initially visible/hidden instances, recreated local state,
prop updates, imported and local descendants, retained DOM identity, cleanup,
real JSX wrapper slots and conflicting contracts. All eighteen hydration-entry
browser graphs pass. Production SSR passes four tests, including Chrome binding
without initial element creation and later child recreation. The HTML suite
passes its checks; one existing Chrome test timed out under concurrent machine
load and passed alone with a 60-second test limit. Numbered docs are unchanged.

### Request-dependent HTML without a browser program

The same initial-render proof now carries an unknown request value through
supported text/attribute slots and component props. It recognizes the actual
framework `$fetch` binding, including import aliases and shadows. It does not
fetch at build time or invent data. GET requests need closed options; callbacks,
validators, opaque calls, request-derived structure, refs, effects and exposed
mutable values retain browser execution. Routing and `Group` remain supported
through ordinary hydration; their interactive and presentation semantics are
preserved. This is a limited automatic optimization, not a new authoring mode.

Delivery uses the existing compiler metadata, Vite shell adapter and server
factory inside `RenderSession`. The absence of precomputed HTML means the
factory must run for each request. No alternate renderer, cache, bootstrap or
scheduler was added. The session waits for settlement, omits all hydration
markers and payload production, and rejects incomplete data. `serve()` buffers
these responses so failures occur before committing headers. No user-supplied
contract key or new public API is required. Client-only builds and development
retain their browser entry.

Failure testing exposed scheduled SSR exceptions that escaped the render
promise. The session now uses the kernel's existing scheduler to keep the same
microtask ordering and forward update errors into its abort/disposal lifecycle.
A failed request rejects its render without affecting a concurrent successful
request. Ordinary hydration receives the same fix. A retained DOM runtime gets
its normal scheduler back when handed to its caller.

Production compiler/Vite baseline `4cb1f6e`, identical current runtime/data/server
packages and stable authored fixtures; every emitted browser chunk is counted:

| Fixture | Before JS raw / gzip sum B | After JS raw / gzip sum B | Before / after payload B | Before / after served HTML B |
|---|---:|---:|---:|---:|
| Fetched text | 45,062 / 14,775 | 0 / 0 | 315 / 0 | 564 / 111 |
| Fetched composition | 43,274 / 14,123 | 0 / 0 | 315 / 0 | 599 / 179 |
| Interactive fetched page | 45,257 / 14,839 | 45,257 / 14,839 | 315 / 315 | 595 / 595 |
| Routed fetched page with Group | 93,268 / 28,377 | 93,268 / 28,377 | 315 / 315 | 783 / 783 |
| Counter | 8,730 / 3,517 | 8,730 / 3,517 | 0 / 0 | 218 / 218 |
| Static page | 0 / 0 | 0 / 0 | 0 / 0 | 146 / 146 |

`bench:size:ssr --before-ref=4cb1f6e` archives compiler/Vite source and holds the
other packages fixed. Repeated `--fixture=<name>` selections are supported. The
HTML and SSR audits share one baseline loader instead of duplicating archive
and bundle machinery. These are delivered-byte measurements, not CPU timings.

Compiler tests cover both frontends, aliases, composition and rejected browser
behavior. Server checks cover concurrent request isolation, cancellation,
timeout, stale builds, stream settlement, synchronous-render rejection and
failures before response commit. Production Chrome verifies fetched HTML/CSS
with no JavaScript or duplicate browser request, and route navigation with
`Group` retains fetched data through normal hydration. Numbered docs are unchanged.

The focused compiler checks pass 62 tests; the server suite plus added isolation
cases pass 128. Production SSR passes six cases, and HTML-first production
passes 26. Runtime, compiler, server and Vite builds/type checks pass. The routed
`Group` fixture's retained 93,268 browser bytes establish an explicit next target:
reduce required hydration, creation and capabilities while preserving navigation,
pending/error behavior and retries. It is not a zero-JavaScript target.

### Optional route preparation without restricting navigation

Ordinary compiled routes no longer retain preparation execution, lazy-module
caches and routed payload restoration when none of those capabilities are used.
The existing navigation engine consults a small preparation capability; the
preparation module installs its runner and owns its hydration bridge. Public
`createRouteRuntime()` construction retains full preparation support for authored
metadata. Both constructors delegate to the same engine, with the same state,
readiness, blockers, navigation and scroll behavior. No second renderer or route
algorithm was introduced. Router publication now preserves source modules so
consumer bundlers can remove unused feature initialization.

Paired esbuild source graphs against `802d42c`, identical current compiler and
authored fixtures, hydration included:

| Fixture | Before raw / gzip B | After raw / gzip B |
|---|---:|---:|
| Routed fetched page with Group | 94,366 / 29,582 | 90,247 / 28,351 |
| Fetched page with Group | 45,083 / 14,927 | 45,083 / 14,927 |
| Owner counter | 17,820 / 6,616 | 17,820 / 6,616 |

All nine before/current/published browser graphs pass interaction checks,
including navigation away from Group and back. The audit rejects preparation
execution in ordinary route graphs. Separate minified source and published
constructor bundles verify lazy-load failure, retry and subsequent navigation
using only the public constructor import. Router tests pass 112 cases plus type
checking; focused preparation, lazy-module, Group error/boundary and navigation
readiness tests pass 39 cases. Production SSR and concurrent isolation pass
seven cases.

The production Vite routed Group fixture now emits 89,162 B raw / 27,139 B gzip
across all browser chunks, with the same 783 B served HTML and 315 B payload.
The preceding production measurement was 93,268 / 28,377 B. This comparison uses
the recorded production baseline; the independently reproducible source
comparison above isolates this router change. The SSR audit's `--before-ref`
archives compiler/Vite only and therefore uses the current router on both sides.
Counter and interactive-fetch production controls remain 8,730 / 3,517 B and
45,257 / 14,839 B. These are delivered bytes, not CPU performance claims.

Routing and Group retain browser execution, pending/error presentation and retry
behavior. Numbered documentation and dependency versions are unchanged.

### Path interpolation without matching initialization

A URL helper audit showed that path helpers already exclude the navigation
engine. No ambient-runtime change was needed. The remaining coupling was inside
the shared pattern template: constructing a parameterized URL also built both
matching expressions and a static match object. Matching now creates those
values on first use; interpolation and matching still share one bounded template
cache. Static matching creates no regular expression. Pattern fields keep a
stable object shape, and cached matching reads its expression directly.

Paired esbuild source graphs against `37263c6`, current compiler and identical
authored fixtures:

| Fixture | Before raw / gzip B | After raw / gzip B |
|---|---:|---:|
| Reactive link helper, client creation | 15,636 / 6,145 | 15,372 / 5,993 |
| Reactive link helper, hydration included | 24,397 / 9,041 | 24,133 / 8,898 |
| Routed fetched Group, hydration included | 90,247 / 28,351 | 90,359 / 28,389 |
| Owner counter, hydration included | 17,820 / 6,616 | 17,820 / 6,616 |

The full routing graph grows by 112 raw / 38 gzip bytes for deferred matching;
this is not a reduction in every app. The helper no longer ships matching
expression construction. The combined production routed Group checkpoint is
89,274 / 27,165 B, versus the earlier 93,268 / 28,377 B; HTML and payload remain
783 and 315 B. All emitted browser chunks are counted.

Router tests pass 113 cases plus type checking. Twelve bundled-constructor,
compiled navigation, destination identity and route-fragment hydration tests
pass; production SSR passes six cases. All nine paired/published hydration-entry
browser graphs pass. A new regression alternates interpolation, exact/prefix
matching, escaped literals and wildcards on shared templates, including retained
static match identity. The helper audit rejects retained matching expressions.

The existing path/matcher benchmarks were run before and after with archived
router source and identical benchmark fixtures. Separate processes showed a
large shift in unchanged trie code, so those results do not establish a CPU
improvement. An additional interleaved Node diagnostic, seven samples of 100,000
calls with alternating order and equivalent-output checks, did not reproduce
that shift across two fresh processes. Dynamic, wildcard and prefix differences
changed direction or were small; no end-to-end speed claim is made.

The largest retained modules remain the navigation engine (about 23.5 KB
minified raw), fetch resource lifecycle (12.2 KB) and hydration (6.6 KB).
Continue reducing their required work and shared orchestration, preserving
Group readiness/error/retry behavior and request isolation. Numbered docs and
dependency versions remain unchanged.

### Shared navigation preparation and settlement

Direct navigation, browser history traversal, Navigation API traversal and
memory-history traversal now call one preparation coordinator. It owns gate
execution, supersession checks, redirect resolution and awaiting render
readiness. Host callbacks still own publication, rollback and retry: browser
history recovery cannot be replaced by a memory-history commit. This removes
100 net source lines without introducing a second navigation engine.

Paired hydration-entry source graphs against `b01ce15`, identical compiler and
fixtures: routed Group falls from 90,359 / 28,389 B raw/gzip to 88,569 / 28,116 B.
Fetched Group remains 45,083 / 14,927 B; the owner counter remains 17,820 / 6,616 B.
All nine browser graphs pass. Router tests pass 113 cases and type checking;
prepared/lazy route, readiness and bundled-constructor tests pass 25 cases;
production SSR/fullstack browser tests pass seven. The change keeps entry
failures separate from post-commit Group failures, so a Group retry does not
duplicate history or replay route gates.

### Fetch writes on the existing resource controller

Replacement and mutation now use one writer over the existing controller,
cache entry and notification queue. Public runtime construction installs that
capability before exposing resource methods; compiler-emitted transparent
mutation calls the same writer. Read-only fetch/Group graphs omit the writer.
There is no second store, request lifecycle or Group implementation.

Paired hydration-entry source graphs against `38e3896`, with the same compiler
and authored fixtures:

| Fixture | Before raw / gzip B | After raw / gzip B |
|---|---:|---:|
| Fetched Group | 45,083 / 14,927 | 44,299 / 14,826 |
| Routed fetched Group | 88,569 / 28,116 | 87,785 / 28,034 |
| Fetched text | 44,900 / 14,872 | 44,116 / 14,775 |
| Owner counter | 17,820 / 6,616 | 17,820 / 6,616 |

All twelve before/current/published browser graphs pass. The audit rejects the
write implementation in these read-only source graphs. Published current Group,
routed Group and fetched-text graphs measure 44,021 / 14,792 B,
87,108 / 27,868 B and 43,838 / 14,731 B respectively. These are esbuild browser
graphs including hydration, not production SSR asset totals.

Data tests pass 65 cases plus type checking; focused Group, route-readiness and
transparent-mutation tests pass 32 cases. Two minified source/published
constructor bundles verify that public resource update and mutate remain
available after tree shaking. Production initial SSR and concurrent isolation
pass seven cases. Coverage includes paused sources, shared entries, callbacks
that throw, handles created before public capability exposure and older reads
that ignore cancellation. A throwing write leaves its pending request running;
a successful local write prevents an older response from replacing it.

### Markup optimization for retained creation

Factories that bind initial HTML and create later instances now pass their
creation arm through the existing static-markup optimizer. The initial arm
continues to select bound nodes; markup parsing and fresh-only static writes
remain guarded by the creation arm. Parser safety, namespace checks and the
minimum savings threshold use the same optimizer as ordinary DOM creation.
This adds no browser runtime helper or alternate component implementation.

Production Vite HTML-entry measurements against compiler/Vite `6943cb7`, with
the current runtime held constant and identical authored fixtures. JavaScript
totals include every served chunk; gzip compresses each chunk separately:

| Fixture | Before JS raw / gzip B | After JS raw / gzip B | Served HTML B |
|---|---:|---:|---:|
| Recreated component with one static card | 15,015 / 5,584 | 15,015 / 5,584 | 563 |
| Recreated component with 24 static cards | 21,964 / 6,671 | 15,747 / 5,673 | 2,753 |
| Small recreated child with 60 surrounding static cards | 14,257 / 5,368 | 14,257 / 5,368 | 3,731 |
| Owner counter | 8,730 / 3,517 | 8,730 / 3,517 | 221 |
| Static variable-derived greeting | 0 / 0 | 0 / 0 | 120 |

HTML is unchanged. Ordinary JS-entry creation for the 24-card fixture remains
16,127 / 5,782 B; it already used the same markup optimization. Tiny factories
retain their existing output rather than paying the markup helper's fixed cost.
Markup needed for future instances remains in the browser program: this batch
compresses its creation representation, it does not remove required content.

Forty-nine focused composition, conditional/list binding, parser-regression and
hydration tests pass. Six production SSR/browser cases pass, including an
imported recreated child with 24 cards. Checks cover initial mounting without
element creation, retained server-node identity, prop updates, child state,
removal/recreation, state reset and disposal. Group routing and restored request
data also remain covered by the production suite. Compiler and Vite builds and
their build type checks pass. These measurements establish delivered-byte
savings; they are not CPU timing claims. Numbered docs remain unchanged.

### Compiler-selected hydration capabilities

The hydration document previously retained list transactions and markup parsing
for every SSR entry. These operations are now capabilities passed to the same
document, marker index, node plan and payload restoration coordinator. General
hydration installs both. Production Vite bootstraps import only those required
by emitted helper usage across the linked graph, including future factories.
External host code, dynamic imports and authored runtime escapes retain full
support. Development keeps the general entry so HMR can introduce new features.
The bootstrap runs as an imported module before the authored mount call.

Capability installations accumulate on the existing realm bridge: loading a
narrower program cannot remove list support needed by an earlier root. Mismatch
recovery, payload restoration, deferred reads and Group routing still use their
existing implementations. Client-only graphs do not import the adoption engine.

Paired esbuild source graphs against `9f844f2`, same current compiler and authored
fixtures. Before uses the general hydration entry; after uses its compiler-selected
capabilities. Every whole application is compressed once:

| Fixture | Before raw / gzip B | After raw / gzip B |
|---|---:|---:|
| Owner counter | 17,820 / 6,616 | 16,626 / 6,006 |
| Composition | 19,613 / 7,220 | 18,418 / 6,603 |
| Positional input/list | 25,789 / 9,623 | 25,284 / 9,280 |
| Keyed owner list | 33,215 / 12,341 | 32,710 / 11,990 |
| Routed fetched Group | 87,785 / 28,036 | 86,589 / 27,458 |
| Fetched markup | 45,798 / 15,092 | 45,547 / 14,957 |

All eighteen before/current/published browser graphs pass. Metafiles reject
list adoption or markup parsing when the compiler reports no requirement. The
ordinary client-creation counter, keyed list and positional list source graphs
remain 9,070 / 3,716 B, 24,442 / 9,508 B and 17,029 / 6,766 B respectively.

The general compatibility entry grows: the counter graph is 18,263 / 6,759 B
versus 17,820 / 6,616 B; the keyed graph is 33,656 / 12,473 B versus
33,215 / 12,341 B. Optional dispatch, capability validation and cumulative
installation cost bytes when every capability is retained. This is not a
reduction for manual general-entry consumers.

Production SSR compares compiler/Vite `9f844f2` against current compiler/Vite
while holding the current runtime constant. Request-interactive JS falls from
44,913 / 14,874 B to 43,253 / 14,098 B; routed Group falls from
87,156 / 27,025 B to 85,495 / 26,284 B. Served HTML and payload remain
595 / 315 B and 783 / 315 B. The initial counter and todo binding products
remain 8,730 / 3,517 B and 17,157 / 6,449 B; neither needs general hydration.

Eighty-six focused tests pass, including capability planning, list and markup
adoption, throwing factories, failed-frame disposal, structural recovery and
cumulative installation. Nine Vite integration cases pass, including seven
production cases. The new production keyed-list case verifies retained server
rows through reverse/append and recovers a malformed row without refetching
restored data. Runtime, compiler and Vite builds and build type checks pass.
These are payload measurements, not CPU speed claims. Numbered docs remain unchanged.

### Shared list DOM disposal

Keyed and positional reconcilers now ask their existing DOM owner to release
the initial range and both anchors. Row ownership, failed-frame cleanup and
entity teardown remain in the reconciler that owns them. The DOM owner returns
its collected failures to that reconciler's existing error reporter, preserving
the order and shape of aggregate errors. This removes duplicated anchor cleanup
without adding another lifetime manager or changing the reconciliation algorithm.

Paired ordinary client source graphs against `674001c`, same compiler and
authored fixtures:

| Fixture | Before raw / gzip B | After raw / gzip B |
|---|---:|---:|
| Owner counter | 9,070 / 3,716 | 9,070 / 3,716 |
| Positional input/list | 17,029 / 6,765 | 17,028 / 6,772 |
| Keyed owner list | 24,442 / 9,507 | 24,409 / 9,519 |
| Both list types in one app | 28,703 / 10,952 | 28,550 / 10,929 |

The mixed graph loses 153 raw / 23 gzip bytes. Single-list raw sizes shrink,
but gzip grows by seven and twelve bytes; this is a cleanup of shared ownership,
not a substantial bundle improvement by itself. All twelve before/current/
published graphs pass, including retained keyed rows and positional rows in the
same app. The fixture asserts that both reconcilers are actually emitted.

Eight cleanup/reentrancy/ownership suites pass 99 cases. Four initial-list and
adoption suites pass 33 cases, including two new checks that initial release
and both anchor removals may throw while disposal still completes and preserves
all three errors in order. Repeated disposal does not run release twice. The
runtime build and build type check pass. This batch does not change scheduling,
list selection, key evaluation or list reconciliation fast paths.

Two local runtime-only ABBA diagnostics against `674001c` used Chrome,
three samples per cell, all eight compiled state-placement variants and
vanilla. All 21 scenarios and mixed sequences validated before timing; every
timed sample checked text, classes, order and retained identity. The first
measured 10k replacement and reversal; a sequential follow-up isolated
replacement after other checks finished. Results were mixed, with slower
module-component replacement samples and large outliers. Even unchanged
vanilla replacement medians ranged from 30.8 to 51.7 ms in the follow-up.
No CPU gain or stable regression conclusion is claimed. These diagnostics
used the intermediate cleanup implementation; final cleanup reuses `dom.end`
and `dom.open` to avoid adding two closure-captured anchor slots. Final bundle
checks pass all twelve graphs, four final ownership suites pass 47 cases, and
the production keyed-list adoption/recovery case passes. CPU confirmation
for the final capture change remains for a stable environment.

### Implementation record

| Order | Work | Required evidence |
|---|---|---|
| 1, first boundary implemented | Separate initial content from browser execution; emit closed static pages as HTML | Hello and larger static composition ship zero JS; CSS, unknown effects, dev HMR and direct JS consumers remain correct |
| 2, first mixed boundary implemented | Extend the semantic plan beyond closed-root/primitive-prop placements with interaction roots, source/slot reachability, captures and lifetime requirements | Static parent with interactive child; unused state; callbacks, hidden reads, refs and cleanup; explain every retained client region |
| 3, direct host roots and first conditional/list boundaries implemented | Extend HTML plus browser binding/event/update output to composed children and remaining structural regions | Static markup absent from client factories; counter and input/todo fixtures; later branches/lists, event ordering, coherent commits and recovery |
| 4, first noninteractive request boundary implemented | Extend the same separation to request HTML and serialized state without restricting routing or Group | Zero-JS static SSR, minimal mixed-page interaction JS, async isolation, payload safety and hydration correctness |
| 5, first compiler-selected adoption capabilities implemented | Reduce runtime capabilities required by the derived browser program | Scheduling/lifetime core, optional access routing/host adapters, positional versus keyed lists, opaque fallback and retained identity |

Each step gets before/after whole-application measurements. Keep a keyed list,
composed app and module-state app beside the tiny example so reducing one case
does not hide growth elsewhere. Numeric key interning and code compression are
secondary: the earlier measured gzip savings were small compared with the
runtime and creation work above. Runtime module preservation is already in
place and remains useful, but no longer sets the order of architecture work.

## Verified milestone — 2026-10-06

The initial-content/browser-program boundary has reached a verified milestone. Its
boundaries, composition/future creation, request delivery and optional adoption
capabilities are implemented and checked. The architecture remains active:
separating JSX semantics from emission, reducing runtime fixed costs and refining
capability selection are required follow-up work. This checkpoint does not claim
that every compiler pass is backend-independent or that remaining bundle costs
are solved.

### Ownership and duplication audit

| Concern | Shared implementation and retained boundary |
|---|---|
| Initial content | `planning/initial-render.ts` captures authored content before DOM emission; JSX conditional/list callback plans are shared. HTML emission and DOM binding addresses remain backend responsibilities. |
| Initial binding and future creation | The same component/row factories and lifetime machinery bind existing nodes or create later instances. Retained markup uses the ordinary markup optimizer. |
| Hydration | General and selected entries install one payload coordinator, hydration document, marker index and node plan. Selection supplies list/markup capabilities to that engine. |
| Mounting | Initial and general mount share validation, mounted handles and disposal in `mount-core.ts`. Their retained differences are planned-address binding versus marker adoption and recovery. |
| Lists | Keyed and positional algorithms share DOM range/anchor ownership. Each retains the reconciliation logic required by its identity contract. |
| Data and routing | Optional resource writes use the existing resource controller/entry; navigation hosts use the same route preparation/settlement coordinator. |

The final audit removed impossible optional restoration states from the payload
coordinator. No unused second adoption engine or reconciler was found in these
paths. Lint reports no errors or unused-code warnings across compiler, runtime,
Vite, data, router and server source; existing type/style warnings remain.
Snapshot iteration during disposal is intentional because cleanup can mutate
the registry. This audit covers the rearchitecture paths, not an assertion that
every public export in the repository is removable or globally unused.

### Combined lifecycle gate

The lazy-route browser test now owns stable fixture sources and has no dependency
on an example directory. Development and production share those authored sources.
Both navigation and a direct SSR detail visit check Group data restoration,
lazy component loading, initial input identity, state updates through a bound
ref, effect rerun/cleanup, external getter polling, route disposal and state reset
on re-entry. Removal stops both effect execution and opaque getter reads.

This gate exposed a false write in an effect's returned disposer: an opaque
imported call emitted broad invalidation, which rerendered the owner and invoked
cleanup again until the cycle guard fired. Proven returned inline/named disposers
now share the callback's existing consumption boundary. Explicit writes, visible
helper writes and deferred callbacks retain mutation publication. Reassigned or
escaped named functions remain conservative. Six regression cases check cleanup
forms, deferred publication and a visible cleanup write reaching another component.

Fifteen focused suites pass 146 cases across effects, refs, callback boundaries,
cleanup, initial planning and hydration. Nine development/production browser
cases pass, including all eight production SSR cases. Runtime/compiler builds
and build type checks pass. The final combined lifecycle cases also check that
opaque reads stop after route removal. Numbered documentation is unchanged.

### Final delivered-byte checkpoint

Production Vite SSR compares compiler/Vite `9f844f2` with `0c97ba6`, holding
current runtime/data/server packages constant. Identical fixtures and shells;
all emitted browser chunks counted once, gzip compressed per chunk. Server
JavaScript is excluded. Served HTML and data payloads are unchanged.

| Fixture | Before JS raw / gzip B | Final JS raw / gzip B |
|---|---:|---:|
| Static composition | 0 / 0 | 0 / 0 |
| Owner counter | 8,730 / 3,517 | 8,730 / 3,517 |
| Counter with 60 static cards | 8,728 / 3,517 | 8,728 / 3,517 |
| Interactive composition | 10,417 / 4,107 | 10,417 / 4,107 |
| Input / todo list | 17,156 / 6,449 | 17,156 / 6,449 |
| Noninteractive fetched page/composition | 0 / 0 | 0 / 0 |
| Interactive fetched page | 44,905 / 14,873 | 43,245 / 14,095 |
| Routed fetched Group | 87,148 / 27,022 | 85,487 / 26,281 |

The ordinary source audit against runtime `674001c` again passes all twelve
before/current/published graphs. Final raw/gzip values remain counter
9,070/3,716 B, positional input/list 17,028/6,772 B, keyed list 24,409/9,519 B,
and both list types 28,550/10,929 B. Single-list gzip growth reported above remains.

The selected-hydration source audit against `9f844f2` passes all eighteen graphs.
Final raw/gzip values are counter 16,618/6,003 B, composition 18,410/6,600 B,
positional input/list 25,275/9,278 B, keyed list 32,669/11,997 B, routed Group
86,581/27,442 B and fetched markup 45,539/14,955 B. These whole-source esbuild
graphs differ from production SSR delivery and are compressed once each.

General hydration retains its capability-dispatch cost: counter 18,255/6,755 B
versus 17,820/6,616 B, keyed list 33,615/12,482 B versus 33,215/12,341 B.
Manual consumers of the full entry do not receive a universal size reduction.

### Explicit limitations and subsequent work

- Zero JS requires proven noninteractivity in an HTML-associated build. Direct
  JavaScript entry consumers retain client creation factories.
- Refs, effects, unknown host behavior, request-derived structure and escaped
  values may retain general creation/adoption. Routing, Group and navigation
  remain supported browser features.
- Production selects adoption capabilities conservatively across linked and
  future code. External/dynamic runtime access retains full support; development
  keeps full support for HMR. This is feature selection, not serialized closures
  or resumability of arbitrary application execution.
- Shared semantic contracts exist, but portions of JSX analysis and transformation
  still use DOM context. A complete portable backend IR and mobile/desktop backends
  are future work.
- Scheduling, access routing, lifetime management, keyed reconciliation and
  opaque polling still carry measurable fixed costs. Further reductions need
  whole-application evidence and existing correctness gates.
- Local DOM timing diagnostics remain noisy. No CPU speed gain is claimed;
  confirmation of the final list cleanup on a stable machine remains outstanding.

Reproduce the final payload checks using the commands in
`bench/package-size/README.md`. The existing correctness/performance backlog
remains in `performance-work.md` and continues alongside the architecture work.

### Active batch: direct child semantics

JSX child planning now returns text expressions, authored nodes, list sites,
conditions and forwarded slots without creating DOM variables or invoking an
emitter. Host elements and fragments consume that plan through one DOM
materializer, preserving post-order node creation and authored insertion order.
The previous combined classifier/emitter was removed. This is a concrete
semantic boundary; attributes, handler contracts and some planning context
still require further separation.

The compiler build and eight focused suites (58 cases) pass, covering pure
planning, composition, initial list binding, render callbacks, literals,
conditional regions and initial-bound DOM updates. This refactor does not
claim a runtime speed or bundle-size reduction.

### Active batch: optional state-cell storage

Lifted module-state cells now initialize their per-application map in the
existing extension store on first use. The kernel no longer allocates or clears
a second map in every application. Extension disposal already resets this
storage; concurrent request identity and canonical write routing are unchanged.

Against `fe0d72b`, source counter output changes from 9,070/3,716 to
9,056/3,709 B (raw/gzip); keyed owner list from 24,409/9,519 to 24,395/9,514;
routed request/Group from 79,010/25,244 to 78,996/25,240. All nine source,
baseline and package browser graphs pass interaction and retained-node checks.
The runtime build and four focused suites (22 cases) pass, including concurrent
SSR cell isolation, compiler cell lowering and runtime disposal/reuse. These
small byte savings do not establish a CPU improvement for applications using
cells, which now perform an extension lookup.

### Active batch: emitted capability requirements

Capability discovery now walks the finished backend program, including retained
future factories. Identifier allocation no longer maintains a second mutable
record of every helper expression constructed. Static computed helper names
are recognized; unknown generated lookups retain both adoption features.
External/dynamic authored host code still uses the linker's existing conservative
policy. This changes neither the hydration engine nor its ownership contract.

The compiler build and five focused suites (68 cases) pass. The selected-adoption
counter, keyed-list and fetched-markup audit also passes all nine browser graphs.
No over-retention was reproduced in the existing fixture probe and no current
fixture byte reduction is attributed to this change. That audit's source-before
uses the full hydration bootstrap; its differences measure the already-existing
bootstrap selection, not this batch's requirement discovery.
All eight production SSR integration cases also pass after the three batches,
including request delivery, composition and routed lifecycle/ref/opaque behavior.

Architecture completion remains outstanding. The next semantic boundaries are
ordered attribute planning and handler facts that still carry DOM context;
runtime scheduling/access/lifetime costs remain candidates requiring measured
whole-application evidence. These three batches remove specific coupling and
unconditional storage, not all remaining architecture work.

### Ordered attribute semantic boundary

Authored attribute planning now records ordered spreads/values, event kinds and
the final spread's override boundary. It does not construct props objects or
call backend instrumentation. One object emitter consumes the plan for hosts,
component calls and component rows. It clones values before ref/event lowering,
so backend changes cannot mutate the plan or alter the recorded read sources.
The old combined attribute builder was removed.

The compiler build and seven suites (86 cases) pass, covering spread semantics,
refs, render props, private/component rows and initial composition. New tests
execute the emitted object to check override order and verify plan preservation
under instrumentation. This batch changes a compiler boundary, not runtime
algorithms; payload and DOM comparison checks follow with the handler batch.

### Handler facts and backend instrumentation

Write scopes now contain semantic effects and event-fallback intent, not an
emitted event-origin statement. Row write facts share one authored shape with
the DOM row context, while generated row/owner IDs and refresh bindings are
provided separately to lowering. Guard flags and temporary bindings belong to
the emission stage. Commit instrumentation moved out of `handlers/` into
`emission/handler-execution.ts`.

Targeted item mutations are captured as source/key/site facts during analysis.
Only emission inserts the key-journal operation. The regression test clears
the mutable journal context after planning and supplies captured target bindings
to lowering; it also verifies authored source and the analyzed clone contain no
journal call before emission. No second write analyzer or commit engine was added.

The compiler build and changed-source lint pass. Ten initial handler/reactivity
suites pass 160 cases. A broad root run passes 2,137 cases and finds 11 obsolete
code-generation assertions in six files. Baseline `8368dc8` emits identical code
for their checked sources: unreasoned invalidation uses `invalidateEntity`,
nonvolatile registration uses `registerEntity`, and positional lists omit key
selectors. The corrected assertions plus final handler/lifecycle suites pass
112 cases across 12 suites. Pinned Octane upstream tests are now excluded from
root Vitest discovery; our authored benchmark tests remain included.

The compiler-only ABBA DOM comparison against `8368dc8` validates all 21 scenarios
and mixed selection/reorder/removal sequences, then measures update, swap and
reverse at 10k rows with three samples per cell. All eight state/row variants
and vanilla pass retained-node checks after every sample. Browser artifacts
are byte-identical; noisy timing differences cannot represent a compiler speed
change in this batch.

Paired production SSR delivery against the same compiler/Vite baseline holds
current runtime/data/server constant. HTML, payload and all browser chunks are
unchanged for six graphs: static 0/0 B JS raw/gzip, counter 8,716/3,512,
composition 10,403/4,100, todo 17,142/6,442, interactive request 43,231/14,090
and routed request/Group 85,473/26,277. These batches establish semantic/backend
boundaries without increasing delivered browser code. Broader analysis context,
request-dependent binding and remaining fixed runtime costs are still active.

Final browser verification passes all eight production SSR cases and the
self-contained development lazy-route lifecycle case. Test discovery now
ignores generated benchmark archives and compiled-fixture output; the Vite
test configuration anchors its root to the package. The authored benchmark UI
export test still passes. Attribute emission also drops an unused source-copy
array and result wrapper: source values remain available directly in its
semantic plan. The compiler build and five final attribute/ref/composition
suites pass 56 cases after that removal.

### Fixed request-dependent bindings — 2026-10-06

Fixed interactive layouts can now combine fetched values with the existing
initial-node binding program, including composed children. The server settles
the request and sends HTML plus its data envelope; the browser restores that
envelope before binding the retained elements. Payload restoration lives in one
optional runtime module shared with general hydration. Entry import/call
lowering runs after authored import analysis, preserving aliases and avoiding
generated imports being mistaken for user dependencies.

Empty fetched text retains an `mmd:empty` address. The node serializer and retained
string writer use the same representation, scoped to the matching request
contract. General SSR still uses its existing markers, recovery and settlement.
Fixed scalar reads retain their normal data gates without inventing a new
presentation region. Unproved structure, routing, Group and authored
pending/error policies retain the general program. Client-only builds cannot
select a request binding without a paired server entry.

The paired production audit against compiler/Vite commit `4cadf24`, holding
current runtime/data/server constant, measures the fetched-name counter at
43,185 → 31,886 B raw JS and 14,087 → 10,661 B gzip. Served HTML falls from
595 to 535 B; the 315 B payload is preserved. Static JS remains zero. Counter,
composition, todo and routed Group outputs are unchanged in that paired audit.
The optional initializer adds 22 raw bytes to the small initial mount relative
to the preceding runtime; the comparison holds that runtime change constant.
These are delivery measurements, not CPU performance claims.

Verification covers compiler planning on both frontends, alias hygiene, gated
direct fetched text, shared restoration, failed adopters, mount ownership,
ordinary payload hydration, result/stream parity and request isolation. Chrome
checks retained nodes, counter events, empty/nonempty fetched text, no duplicate
fetch, client-only fallback, keyed-list recovery and routing/Group lifecycles.
The compiler, runtime, server and Vite builds pass without dependency changes.

### Mutation-journal backend ownership — 2026-10-06

Read analysis now records only the journal's source, key path, authored call
and semantic causes. It no longer allocates a generated JavaScript variable.
Handler and list emission share one binding per owner/source, allocated by the
backend. Captured journal facts remain immutable when factory context is
consumed; ambiguous multi-list sources keep their conservative fallback.

The compiler build, changed-source lint and nine targeted suites pass 99 cases.
The paired DOM run against `088dc31` validates all 21 scenarios and mixed
selection/reverse/removal/append sequences, with retained-node checks after
every timed sample. All eight compiled variants and vanilla pass. Browser
artifacts are byte-identical, so noisy local timing differences are not a
compiler performance gain or regression.

### Optional opaque polling ownership — 2026-10-06

Opaque polling now owns its per-runtime IDs and frame state in its optional
module. Ordinary entity registration no longer maintains a polling set in the
kernel. The feature uses the existing registry and disposal hooks, seeds earlier
registrations for compatibility, and stops queued frames after replacement or
disposal. Failed renders still leave a recovery frame scheduled. There is no
second entity registry or commit scheduler.

Against runtime commit `b0cfce2`, source browser bundles for the owner counter,
input list and request-data fixtures each drop 144 raw bytes (49–52 B gzip).
The opaque fixture grows 317 raw bytes / 140 B gzip: capability ownership moves
cost out of ordinary applications, but adds hook coordination to opaque ones.
The fixture audit records both sides rather than attributing a universal saving.

The runtime build and changed-source lint pass. Lifetime, opaque reactivity and
kernel teardown checks pass 29 cases; recovery, concurrent SSR isolation and
prepared-region checks pass another 55 cases. All 12 production SSR browser
cases pass. The paired DOM comparison validates all 21 scenarios and mixed
selection/reorder/removal sequences across eight compiled variants and vanilla,
including retained-node checks after every timed sample. Local update, swap and
reverse timings are mixed and noisy; this batch establishes no CPU speed claim.

### Native-operation guard bindings — 2026-10-06

Closed-list analysis now records the owner/source and required native-operation
guards without allocating a JavaScript variable. Structural replay captures a
boolean guard requirement; factory, handler and region emission share one
backend binding for that source. Guard and changed-key bindings use one backend
allocator, replacing the narrower journal allocator. Method/iterator/species
checks, sticky escape distrust and fresh-record recovery are unchanged.

The compiler build, changed-source lint and six suites pass 97 cases, including
captured-plan independence and synchronous/deferred operation execution. The
compiler-only DOM comparison against `8d99edd` passes all 21 scenarios, mixed
sequences and retained identity after every timed sample. Its browser artifacts
are byte-identical; this removes compiler coupling without a delivered-byte or
runtime speed claim.

### Registration getter correction — 2026-10-06

The broad root run passes 2,163 cases across 225 passing files and finds one
regression in the new polling ownership: first registration reads the authored
`volatile` getter twice. The assertion is preserved. General registration now
seeds earlier owners before registering the new entity, and registry seeding
skips the entity whose flag was already observed. Scheduling retains the
registration runtime even when the getter changes the ambient runtime.

The corrected host-callback suite covers both true and false getters and ambient
owner changes. Its rerun with lifetime, teardown, opaque reactivity, failed-render
recovery and concurrent SSR isolation passes 50 cases across eight files. The
runtime build and changed-source lint pass. Six opaque/counter browser graphs
pass after the correction. Against `b0cfce2`, the ordinary source counter still
drops 144 raw bytes; the opaque graph now grows 326 raw bytes / 150 B gzip.
The full 226-file run was not repeated after this focused correction.

### Access-reader planning without discarded emission — 2026-10-06

Manifest discovery now consumes canonical reader routes directly. It no longer
constructs and discards an `installAccessTable` statement or keeps an extra
mutable reader table on compiler context. Analysis returns a captured reader
plan; one backend serializer emits it. Structural readers, targeted selection,
effects, computed values and linked module routing retain their existing routes.

The compiler build, changed-source lint and five focused suites pass 32 cases.
New contract checks plan without a generated-name allocator, retain reader facts
after context mutation and omit the runtime helper for an empty plan. All 39
production HTML/SSR browser cases pass. The nine-fixture paired production audit
against `85ecdb2` preserves every HTML, payload and delivered-JavaScript byte
count. The checkpoint table above records the current measurements. This removes
discarded compiler work; it does not establish a runtime timing gain.

### Request-selected conditional binding — 2026-10-06

Request data may now select an initial conditional branch when every alternative
has one host root and only host/text descendants. The placement proof captures
each alternative separately. Restored request data selects the branch once;
the existing conditional engine binds its retained nodes and creates subsequent
branches through the same factory. Locally selected regions, including an empty
initial branch, also bind beside request text. Source-read lowering preserves
proved control flow instead of wrapping it in an unplanned presentation region.

Server source anchors are serialized only for matching initial-binding delivery.
Ordinary server delivery retains general markers and the existing settlement
engine. No second browser region engine, mount path or data envelope is added.
Repeated component factories merge live text, empty-text and attribute facts
inside every alternative; a regression test first reproduced an incorrect
static classification across repeated instances.

The paired production audit against compiler/Vite `7f77863`, using the current
runtime on both sides, measures every browser chunk and an actual server response:

| Fixture | Before JS B / gzip B | After JS B / gzip B | Before / after HTML B | Payload B |
|---|---:|---:|---:|---:|
| Request-selected conditional | 46,388 / 14,806 | 35,604 / 11,871 | 785 / 704 | 315 |
| Locally selected conditional beside request text | 43,413 / 14,152 | 33,966 / 11,397 | 666 / 624 | 315 |

The nine existing controls preserve their paired HTML, payload and JavaScript
counts. The optional initial-index runtime check separately costs 18 raw bytes /
7 B gzip in the routed/Group fixture relative to the preceding checkpoint; it
does not affect fixtures that exclude conditional machinery.

Verification: compiler/runtime/server builds and changed-source lint pass.
Six compiler/region suites pass 90 cases; three server suites pass 39 cases.
The production HTML/SSR run passes 42 of 43 cases. Its remaining failure was a
duplicate generated-fixture path, pairing cached server code with another
browser build; after correcting that test path, all four affected request
conditional cases pass together. An earlier Chrome timeout passes on rerun.
Checks cover retained nodes, later branch creation, empty local regions, repeated
live props, request restoration without another fetch, keyed-list recovery and
routing/Group lifecycles. The full root suite was not repeated for this batch.

The paired DOM comparison against `7f77863` validates all 21 scenarios, mixed
operation sequences and retained identity across eight compiled variants and
vanilla. The DOM browser artifacts are byte-identical; local timing fluctuations
do not establish a speed change.

Unknown empty or fragment branches, nested regions, component descendants
inside request-selected alternatives and request-dependent row counts remain
on general adoption. This is a bounded placement extension, not architecture
closure or a CPU speed claim.

### Fetched-list placement and transfer safety — 2026-10-06

The initial render proof now captures a fixed host-row shape separately from
its unknown request row count. A fetched list must occupy its own host container;
later siblings outside that container retain stable addresses. The optional
list-binding helper validates the source closing anchor and every row extent,
then supplies retained rows to the existing keyed or positional list engine.
That engine checks the restored item count before calling factories and retains
its ordinary ordering, key, update and disposal behavior. Known local lists beside
fetched text use the same server source anchors. Conditional and list server
anchor emission share one helper.

The first address implementation added 20 raw bytes to counters. That change was
removed: terminal-anchor discovery belongs to optional list binding, leaving the
general node binder and counter bundles unchanged. The optional list helper
grows the existing input/list fixture by 101 raw bytes / 28 B gzip relative to
`2b9684d`; the row-count and marker checks remain explicit.

Event-only `$track` controls can stay with initial bindings. Reading request
metadata for pending/error presentation still retains ordinary browser work.
Module and component source lowering share one initial-placement check. Proved
module-source lists and conditionals preserve their authored structure instead
of becoming callback-wrapped value expressions with no binding address.
Browser testing exposed a previously overbroad proof: query-bearing fetches
intentionally omit transfer snapshots, so their interactive layouts must not
assume restored data. Such query, header, explicit-key and credential-bearing
fetches retain general adoption. Noninteractive request rendering remains
available; the transfer restriction applies to interactive binding delivery.

Paired production compiler/Vite audit against `2b9684d`, holding the current
runtime/data/server packages fixed and counting all emitted browser chunks:

| Fixture | Before JS B / gzip B | After JS B / gzip B | Before / after HTML B | Payload B |
|---|---:|---:|---:|---:|
| Fetched list | 58,787 / 19,022 | 46,434 / 15,501 | 872 / 730 | 370 |
| Local list beside fetched text | 58,579 / 19,238 | 47,176 / 15,792 | 737 / 647 | 315 |

The eleven existing controls preserve their paired HTML, payload and JavaScript
counts. The runtime-only cost in the input/list control is reported separately
above. Response checks confirm resolved row text and initial list content.

Rows with nested regions, component descendants or unproved callbacks and
unknown lists with sibling content in the same container retain general adoption.
The row shape proof does not guess offsets from a server response. Broader
placement and remaining runtime costs are still open.

Verification: compiler/runtime/server builds and changed-source lint pass.
Eight compiler/runtime suites pass 130 cases, including both frontends and
module/component source placements; three server suites pass 41 cases.
The full production HTML/SSR run passes 47 of 48 cases and exposes the module
lowering failure described above. After correction, all four fetched-list Chrome
cases pass together, including the module-owned case. Checks cover empty/nonempty
and keyed/positional rows, retained identity during local updates, row events,
request refresh replacement/append/clear/repopulation, no initial duplicate fetch,
and untransferred-query/general row recovery. The full root suite was not repeated.

The paired DOM comparison against `2b9684d` passes all 21 scenarios and mixed
sequences across eight compiled variants plus vanilla, with three samples in
ABBA order. Every timed sample checks text, classes, order and retained node
identity outside timing. Both revisions emit identical browser artifacts for
this suite, so these results verify unchanged behavior rather than a CPU gain.

### Remaining completion requirements

#### Closure batch 1: explicit async read facts

Async read lowering now carries source identity and unavailable-value behavior
as semantic metadata that survives owned AST cloning. List planning and source
dependency queries consume those facts without a generated runtime namespace or
helper-name recognizer. Imperative reads still throw; render sinks remain gated;
module list reads preserve their existing empty-list behavior. DOM placement
queries now belong to the DOM backend. Two overlapping helper recognizers were
removed rather than retained as compatibility fallbacks.

Compiler build and changed-source lint pass. Eight focused suites pass 126 tests,
including module/component sources, forms, opaque reads and initial composition.
The paired production audit against `bb16a52` preserves HTML, payload and browser
bytes for counter, composition, fetched list, fetched page and routed Group.
This batch makes no CPU or bundle-size improvement claim. Callback publication,
lifetime reachability and mutable backend-state separation remain open.

- Preserve the newly separated child/attribute/write facts while auditing other
  analysis-to-backend compatibility data and normalization before final backend
  planning. Journal and native-operation bindings now belong to emission.
- Keep unproved request-dependent structural extents on general adoption until
  their server placement matches the initial binding proof. Extend that proof with
  the existing region engine when justified; preserve creation, recovery,
  pending/error, retry and lifetime behavior.
- Review the remaining unconditional scheduler/access/lifetime costs using
  whole-application attribution. Remove unnecessary work with the owning
  subsystem, retaining cycle, isolation and teardown safeguards.
- Repeat delivered-byte and cross-feature correctness gates against the final
  implementation, including retained future branches/rows and direct entry use.
- Keep CPU conclusions separate from architecture closure. Current local timing
  remains noisy; a stable-machine comparison is still unavailable here.

#### Closure batch 2: lifetime owners beside retained HTML

Fixed host/composition plans now record refs, inline effects and cleanup as
browser owner requirements. Lifecycle-only children remain mounted even without
events or changing text. The normal ref/effect/cleanup engines perform setup,
reruns and reverse disposal; initial planning does not execute callbacks.
Shadowed intrinsics and unproved callback setup retain ordinary creation.

Six focused suites pass 120 tests. Counter, composition, fetched-list and fetched
interactive production bytes are unchanged against `e3ed73a`. This extends the
placement proof rather than removing required lifecycle JavaScript; generic
callback, child-slot and structural reachability still need further work.

#### Closure batch 3: variable list extents with fixed siblings

One fetched list per host can now retain fixed siblings before and after its
variable row extent. Prefix addresses remain absolute; suffix addresses resolve
from the host end through an optional helper, then use the same shape validator.
Multiple variable extents and unproved nested row shapes remain on adoption.
Ordinary counter and dedicated-list programs do not retain the new helper.

The Chrome matrix covers zero/two initial rows, retained keyed reorder, clear,
new rows, changing suffix text, a later conditional and a later fixed list.
It exposed a markup bug: region constructors in variable declarations and
nonlocal append operations were missing from ordering barriers. Markup now
keeps those barriers when absorbing static siblings. Independent creation
regressions cover list/conditional insertion between static siblings.

Production before/after against `049ee9f`, with current runtime in both builds:
the new sibling fixture falls from 58,884 to 46,950 JavaScript bytes and from
19,017 to 15,573 gzip bytes. HTML falls from 834 to 693 bytes; its 370-byte
payload is unchanged. Counter remains 8,613 bytes and dedicated fetched list
46,434 bytes. These are whole emitted browser graphs, including future code;
the gain comes from proven initial binding replacing general adoption.

#### Closure batch 4: backend storage and callback publication

DOM output, generated identifiers and constant deduplication now live in one
backend-owned state product. Their implementations moved into emission; facade
imports reference those implementations without mirrored fields or extra output.
Primitive pull planning consumes an explicit normal-completion publication set
after successful callback lowering, rather than the handler analysis cycle guard.
A regression verifies that entering the cycle guard alone grants no publication.
Transparent receiver-write planning also uses async provenance instead of
matching an emitted namespace and helper name.

Six focused suites pass 94 tests. Five paired production delivery fixtures are
byte-identical against `ea68839`, including routed Group and fetched siblings.
The prior structural batch's full local DOM comparison passes all 21 scenarios
and mixed sequences across eight compiled variants plus vanilla, with identity
checks after every timed sample. Browser artifacts are identical, so timing
differences are local noise and no CPU improvement is claimed.

#### Closure batch 5: shared request setup and fair runtime comparisons

Paused and active fetches now construct one descriptor, with paused inputs kept
unevaluated. Identity and descriptor equality share canonical header encoding.
The duplicated descriptor body and second header encoder were removed without
adding a second resource engine. Five data suites pass 30 tests, including
paused getter inputs, equivalent headers, changed headers/URLs under explicit
keys, transfer, cancellation, writes and settlement.

The source attribution audit now compares the same hydration capabilities by
default. Its former general-hydration baseline would exaggerate a later runtime
change. Older revisions can explicitly request `--baseline-hydration=general`.
Against `b6cf527`, the fair program-hydration source graphs shrink by 263 raw
bytes for both fetched and routed Group fixtures; gzip changes by 57 and 67
bytes respectively. Counter and list bytes are identical. All 12 package/source/
baseline browser graphs pass. This is a small deduplication gain; the dominant
resource, router and kernel costs remain candidates for further capability work.

### Current completion boundary — 2026-10-06

The five batches now have explicit async source facts, retained lifetime owners,
variable list placement with fixed siblings, separated backend storage and
callback publication, and one request-descriptor construction path. Alias
analysis also consumes direct-read facts, and data lowering uses owned-call
metadata; neither guesses a generated helper name or namespace.

The final production audit covers 14 fixtures against compiler/Vite `049ee9f`,
holding the current runtime/data/server packages fixed. All response checks pass.
The sibling-list fixture drops from 58,621 to 46,687 browser bytes and from
18,992 to 15,546 gzip bytes. Its HTML drops from 834 to 693 bytes, with the
370-byte payload unchanged. The other 13 compiler comparisons preserve their
HTML, payload and JavaScript counts. The current production table above includes
the separate request deduplication change; it does not attribute that runtime
change to this compiler comparison.

Combined verification passes: all ten package builds, the compiler rebuild after
the alias follow-up, 2,218 root tests across 229 files, and 396 package tests
(data 67, router 113, server 135, Vite 81). Package data/router TypeScript checks
also pass. Vite includes real Chrome production binding, lazy navigation,
Group, refs, effects, cleanup and HMR checks. Changed-source lint exits
successfully; the simple example retains an existing missing-key warning.
Workspace typechecking now prepares declarations through the configured Vite
adapter; it passes after removing the three generated fullstack declarations
and regenerating them. Tests retain self-contained fixtures. Numbered docs and
dependency versions are unchanged.

The complete architecture remains open in these concrete areas:

- Authored normalization still shares a phase with some runtime-producing read
  and callback transforms. Explicit facts remove consumers' helper guessing;
  they do not yet make the whole source pipeline backend independent.
  Group presentation policies now have an explicit source plan before lowering;
  read replay operations also carry owned creation expressions and lexical
  placement into lowering. Other callback/source transforms and TSRX boundary
  validation are still open.
- Generic callback/child-slot composition and escaping values need broader
  ownership and lifetime reachability. Named effects and unproved ref expressions
  retain ordinary creation rather than acquiring a guessed placement.
- Multiple unknown list extents, nested regions and component rows need sound
  address/shape proofs before general adoption can be removed.
- Resource, router and kernel capability costs still dominate interactive fetched
  and routed pages. The request cleanup removes duplication, not those subsystems.
  Numeric key interning also remains unimplemented.
- A stable VM timing comparison remains outstanding. The full local DOM gate
  validates all 21 scenarios and mixed sequences with retained identity, but its
  byte-identical browser artifacts establish no speed gain.

These are outstanding requirements, not reasons to mark the architecture closed.
