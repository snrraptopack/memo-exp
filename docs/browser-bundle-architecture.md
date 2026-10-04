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

The proof supports closed constants, string interpolation, simple branches,
objects used as props and component composition across linked modules. It never
calls authored functions or evaluates source with JavaScript `eval`. Unknown
calls, getters, external imports and module side effects retain browser execution,
even if the JSX has no events. Host properties, mixed adjacent text coercion and
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

Compiler and Vite package builds and changed-source lint pass. Verification
passes 88 tests across eight files: initial plans, production HTML builds,
existing Vite integration, mounting, DOM templates, hydration templates and
SSR isolation/concurrency. The production browser test verifies visible text,
CSS and no script requests with JavaScript disabled.

This is the first implementation boundary. An interactive descendant currently
keeps the full browser graph, including static ancestors. Extracting minimal
browser regions and adopting existing HTML is unfinished. The HTML proof is
conservative; it is not yet a complete interaction analysis for arbitrary JS.
The existing DOM program remains available to direct JS entry consumers.

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
| Owner counter | 180 / 151 | 10,588 / 4,209 |
| Interactive input/list | 180 / 150 | 24,850 / 9,180 |

The interactive measurements show the remaining architecture work: the first
boundary has removed JavaScript from closed static pages, while interactive
graphs still pay for DOM creation and the existing runtime.

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
Despite the explicit positional key, we currently ship the general keyed runtime.

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
| 2, next | Extend the semantic plan with interaction roots, source/slot reachability, captures and lifetime requirements | Static parent with interactive child; unused state; callbacks, hidden reads, refs and cleanup; explain every retained client region |
| 3 | Emit HTML plus a browser binding/event/update program that adopts the needed nodes | Static markup absent from client factories; counter and input/todo fixtures; later branches/lists, event ordering, coherent commits and recovery |
| 4 | Extend the same separation to request HTML and serialized state | Zero-JS static SSR, minimal mixed-page interaction JS, async isolation, payload safety and hydration correctness |
| 5 | Reduce runtime capabilities required by the derived browser program | Scheduling/lifetime core, optional access routing/host adapters, positional versus keyed lists, opaque fallback and retained identity |

Each step gets before/after whole-application measurements. Keep a keyed list,
composed app and module-state app beside the tiny example so reducing one case
does not hide growth elsewhere. Numeric key interning and code compression are
secondary: the earlier measured gzip savings were small compared with the
runtime and creation work above. Runtime module preservation is already in
place and remains useful, but no longer sets the order of architecture work.
