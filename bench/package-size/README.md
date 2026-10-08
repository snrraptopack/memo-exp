# Package Size

This suite measures the built production runtime graph, the externalized
compiler and Vite adapter artifacts, and the bundled multi-module todo
example. For split ESM graphs it follows static imports and sums each file's
raw and gzip size.

Run package builds, then run the size benchmark. The benchmark builds the real
Vite todo application into its own isolated output before measuring it:

```bash
bun run build
bun run bench:size
```

The compiler figure excludes its external parser dependencies. The Vite
adapter excludes Vite and the compiler package. The todo figure is the useful
browser check: compiler and development tooling must not appear in it.

The runtime is reported as separate client, hydration, HMR, and server graphs.
They are not added to the todo figure: Vite rebundles and recompresses the
client runtime with the compiled application.

These are three different numbers:

- the runtime client graph excludes hydration and Node host integration;
- the hydration and server graphs are explicit opt-in boundaries;
- a production application retains only the runtime closure reached by its
  generated calls;
- an application bundle includes that closure plus generated application code
  and authored dependencies.

Gzip sizes are not additive, so the package graph gzip sizes must not be
reported as the runtime's contribution to an application bundle.

The benchmark fails if the Todo browser JavaScript exceeds 30,000 B raw or
11,000 B gzip. On 2026-10-04 it measured 35,144 B raw / 12,584 B gzip after
preserving runtime module boundaries, down from 35,697 B raw / 12,784 B gzip.
It still fails the budget. The ceiling is unchanged; the runtime architecture
needs further reduction. The earlier 2026-09-30 measurement was 29,869 B raw /
10,850 B gzip, before subsequent runtime growth.
It also rejects hydration, HMR, and Node host markers in that
browser output.

The live measurements printed by `bun run bench:size` are authoritative. Todo
build output is under `dist/todo/`, keeping separate audit results intact.

## Stable browser audit

After building the compiler and runtime, run:

```bash
bun run bench:size:audit --verify
```

This compiles self-contained static, counter, positional input/list, composition
and keyed-list fixtures. It reports whole-bundle raw, gzip and Brotli sizes for
published browser exports and an equivalent runtime-source graph. Metafiles
attribute minified bytes to runtime modules and generated application code.
Compression savings cannot be calculated by adding per-module gzip figures.

`bench:size:html` measures HTML and the single browser program selected for each
document, alongside a direct JS-entry compilation. The host-scope/polling batch compares the same stable fixtures against
`7873aef`; results and interpretation are recorded in
`../../docs/browser-bundle-architecture.md`. Published/source attribution checks
also verify that ordinary counters omit request storage and the opaque driver,
while opaque sources retain polling. HTML-associated and ordinary DOM-creation
figures measure different products and should be identified when reporting them.

`bun run bench:size:ssr --before-ref=cc5ce13` compares the previous Vite SSR
adapter with the current adapter using the same compiler, runtime, fixtures and
HTML shells. It measures actual served HTML, payload bytes, and all emitted
client chunks, including shared and future code. Each chunk is compressed
separately. This isolates delivery changes; it is not a comparison of entire
repository revisions. The baseline adapter is extracted into an ignored source
snapshot. Results are written to `dist/ssr/results.md` and `results.json`.

`--verify` checks selected supported package/source browser graphs in Chromium, including
input reset, rejected whitespace, duplicate todo values, counter/prop updates and
retained list nodes. Use `PUPPETEER_EXECUTABLE_PATH` to select Chromium. Omit the
flag for size-only runs. Artifacts, checkout metadata and results live in
ignored `dist/audit/`; examples are not test inputs.
Its interaction verifier does not cover every newer structural/composition fixture;
use their dedicated production tests. The current audit verified 44 graphs from
22 supported fixtures, not all fixture interactions.

`bun run bench:size:capabilities` audits optional public utility, adapter and server
APIs independently in source/published graphs. Server probes measure server code,
not browser payload. Findings, limits and paired evidence are in
[Optional package cost](../../docs/package-capability-audit.md). The removed CSS
package is no longer a probe or workspace dependency.

Include the optional hydration capability in these same graphs with:

```bash
bun run bench:size:audit --hydrate --verify
```

This writes a separate `dist/audit-hydration/` report. Browser verification checks
client interactions with the capability installed; the hydration test suites
cover actual server-node adoption and mismatch recovery. Record both reports
when moving work across the browser/hydration boundary, since reducing one graph
can increase the other.

Measure compiler-selected adoption capabilities separately with:

```bash
bun run bench:size:audit --hydrate-program --verify --before-ref=9f844f2
```

This writes `dist/audit-program-hydration/`. The baseline uses the preceding
general hydration entry; current source and published graphs use the same
bootstrap generator as production Vite. Compiler helper requirements select
list/markup adoption, with full support for unproved host code. Metafiles enforce
omission of unneeded adoption implementations. Keep the general `--hydrate`
report and ordinary client report as controls; the compatibility entry has a
small dispatch cost. Production SSR tests cover actual adoption and recovery.

`--fixture=mixed-lists` exercises keyed and positional regions in one app. Its
browser checks preserve both sets of retained nodes through keyed reverse and
positional append, and assert that both list capabilities are emitted. Keep
this fixture alongside single-list controls when factoring shared lifecycle
code: compression can improve in the mixed graph while growing slightly in a
single-list graph.

Select individual stable fixtures with repeated `--fixture=<name>` arguments.
For example, `--fixture=route-helper --fixture=request-routed-group` compares a
reactive link constructed by `buildRoutePath` with full routed Group navigation.
The helper fixture verifies parameter updates and excludes matching expressions;
the routing fixture retains matching and verifies navigation away and back.

The audit includes stable fetch, promise-read, Group and routed Group fixtures. Compare runtime/data/router
source changes against a commit with:

```bash
bun run bench:size:audit --hydrate --verify --before-ref=744e70d
```

`source-before` uses the archived runtime/data sources and package metadata;
`source` uses current sources. Both use the current compiler and identical
authored fixtures. `package` measures current distributed exports. Source
attribution is raw output bytes; whole-bundle gzip savings are measured separately.

The explicit-index input/list fixture now selects the compiler's positional
DOM-only capability. Metafiles verify that it omits the general keyed reconciler
and key encoder. Keep the owner keyed-list fixture alongside it: shared list DOM
and hydration factoring increases that graph slightly. The before/after HTML
product measurements and tradeoff are documented in the architecture record.

The HTML audit also measures one versus sixty static cards around a switchable
conditional. It reports initial HTML plus binding JS and ordinary DOM creation
JS from the same authored graph and revision. This distinguishes static-content
growth from retained future branch creation. It is a payload comparison, not a
CPU speed measurement. The architecture record includes the shared validator and
conditional lifetime costs alongside the reduction in shipped static creation.

The HTML audit also includes a closed composed list that must ship zero JS, and
keyed/positional interactive lists with one versus sixty surrounding static
cards. Initial rows bind through the same factory used to create later rows.
These products currently cost more JS for a tiny list; static surrounding
content adds only four bytes rather than thousands. The architecture record
reports that cost and the increase in ordinary list bundles from sharing the
initial-range protocol. The optional initial-list validator is omitted from
ordinary JS-entry graphs.

The HTML suite also measures a controlled-input todo with an empty initial list,
surrounded by one or sixty static cards. It records the ordinary creation
product alongside initial HTML plus bindings. Text-like inputs preserve current
value and native reset semantics; later list rows retain their normal factories.
These are payload measurements, not CPU timings. The architecture record lists
the extra fixed binding cost and the smaller JS growth as static content grows.

The runtime build preserves module boundaries so unrelated feature initialization
does not survive alongside a used helper. The full distributed ESM graph has
more files and can be larger in aggregate while applications ship less. Both
figures are reported; the application figures drive bundle decisions.
See [Browser JavaScript architecture](../../docs/browser-bundle-architecture.md)
for the baseline, the Marko example analysis and the ordered implementation plan.

The HTML audit includes `future-markup-1-cards` and `future-markup-24-cards`.
These place static content inside a component that is initially rendered and
later removed/recreated, so they measure retained creation code rather than
only static surrounding content. Compare the same fixtures before and after a
compiler change with:

```bash
bun run bench:size:html --before-ref=6943cb7 --fixture=future-markup-1-cards --fixture=future-markup-24-cards
bun run bench:size:html --fixture=future-markup-1-cards --fixture=future-markup-24-cards
```

The baseline archives compiler/Vite and holds the current runtime constant.
Production SSR browser tests separately verify initial node identity and later
component state, prop updates and recreation. Read-only fetch/Group source
audits also reject retained resource-write implementation code; public bundled
constructor tests verify that explicitly exposed resource writes stay available.

## Historical architecture milestone checkpoint

Source audits use archived runtime sources unchanged and require the compiler
hooks used by the selected fixtures. Incompatible baselines fail instead of
receiving API aliases. The paired production audit builds each compiler revision
without patching it, against the current runtime; that boundary must also be
API-compatible. To cross a removed API, build each entire revision with its own
compiler and runtime.

The 2026-10-06 architecture milestone checkpoint is recorded in
[Browser JavaScript architecture](../../docs/browser-bundle-architecture.md).
Reproduce its three distinct products after building runtime and compiler:

```bash
bun run bench:size:ssr --before-ref=9f844f2
bun run bench:size:audit --verify --before-ref=674001c --fixture=owner-counter --fixture=input-list --fixture=owner-list --fixture=mixed-lists
bun run bench:size:audit --hydrate-program --verify --before-ref=9f844f2 --fixture=owner-counter --fixture=composition --fixture=input-list --fixture=owner-list --fixture=request-routed-group --fixture=request-markup
```

SSR archives compiler/Vite while holding current runtime packages constant.
Source audits archive runtime/data/router and use the current compiler; the
hydration comparison uses the baseline's general entry and current selected
bootstrap. Reports include HEAD, baseline and dirty state. These payload checks
do not measure CPU performance. The general entry's separate cost is available
with `--hydrate` instead of `--hydrate-program`.

## Retained caller-slot creation

For retained caller-slot creation, use the production delivery audit:

```bash
bun run bench:size:ssr --before-ref=6c48d1c --fixture=composition-recreated-slot-1 --fixture=composition-recreated-slot-24 --fixture=request-recreated-slot-1 --fixture=request-recreated-slot-24
bunx vitest run --config packages/vite/vitest.config.ts tests/initial-ssr.test.ts -t "retained caller slot markup"
```

These stable authored fixtures check small and large future-creation costs.
The production browser group validates adoption and later interaction; the generic
source audit's browser verifier does not cover these structural fixture shapes.
Measurements and limitations are recorded in
[Browser JavaScript architecture](../../docs/browser-bundle-architecture.md).

## Canonical key interning estimate

After building an application, run:

```bash
bun run bench/package-size/interning-estimate.ts <assets-directory>
```

The script estimates how much replacing canonical state-key text with short IDs
could save. It substitutes matching text in the final JavaScript chunks and
recompresses them.
It does not produce runnable code or include the dictionary and runtime support
that a real implementation would need.

On 2026-09-30, the todo bundle had 10 distinct keys and 26 occurrences. The
hypothetical substitution saved 521 B raw and 37 B gzip. Fieldnotes had 8 keys
and 61 occurrences across 10 chunks; it saved 1,096 B raw and 74 B gzip.
These small gzip savings do not currently justify adding an integer-key
protocol. The runtime also uses dotted-path prefix matching, independently
installed module fragments, and string keys at API boundaries; an actual
implementation must preserve those behaviors and measure its full cost.
