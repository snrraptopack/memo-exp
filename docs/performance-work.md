# Performance work

## Correctness gates

Benchmark timings require visible DOM changes. The DOM suite checks fresh 1k
and 10k selection transitions before timing. Alias routing and lightweight
component-row routing have regression coverage. Generated benchmark files must
come from the compiler.

Optimizations require compiler proof. Recognizing `map`, `push`, `splice`,
`reverse`, or another method name alone does not prove its behavior: methods can
be overridden, and getters or callbacks can read other state. Cases without
proof keep the conservative update path described in the compiler README.

## Completed changes

- List-row text uses normalized string slots to avoid unchanged DOM text reads.
  Operand reads and opaque string conversions still replay.
- Repeated-row text shaped as `left + "separator" + right` caches number/string
  operands from creation. Every replay still evaluates both operands once; when
  both remain primitive and unchanged, it skips rebuilding and comparing the
  joined string. Opaque operands retain native coercion order and exceptions,
  and invalidate the primitive cache after conversion, including reentrant
  updates. Other expression shapes retain the existing text path.
- String class values skip array allocation during normalization.
- Conditional class expressions whose every result branch is a string literal
  normalize those literals during compilation. Conditions still evaluate in
  their authored order on every replay, with the existing guarded DOM setter.
  Unknown branches, logical expressions, arrays and objects keep normalization.
- Each resolved reader set is enqueued before scheduling its commit. This
  avoids a separate commit per reader with a synchronous scheduler and lets
  parent reconciliation cancel pending duplicate row renders.
- Linked component callbacks can omit the caller's duplicate row/root refresh
  when every caller supplies a stable component-local callback consisting of
  direct lexical assignments. Missing props, mutable bindings, argument/property
  mutations, opaque calls and deferred work retain the conservative path.
- Adjacent execution sites with identical owner/root completion refreshes share
  one guarded commit. All write flags and setter/proxy fallbacks remain in place.
- An owner publication and its conservative root fallback now enqueue together
  through `markDirtySubtree(rootId, ownerId, ownerReasons)`, before scheduling.
  This removes the second owner/list replay with synchronous scheduling. Broad
  reasons dominate inside the root; an owner outside that root still receives
  its exact reasons, even if the fallback root is absent. Setter/proxy fallback
  and ordinary retained-row content evaluation remain intact.
- Component-owned selection can refresh the previous and next keys over module
  data as well as component data, for direct item-property keys and strict
  equality. Hidden getter/helper/derivation captures retain full replay. Every
  pending dirty cause must be covered by the selective plan; module data writes
  and mixed batches retain reconciliation or proven fixed-position refreshes.
- Reconciliation validates authored keys even when item references and positions
  are unchanged. Failed validation reuses the evaluated keys in its structural
  pass, preserving one evaluation per current item in that case. Identity keys
  retain the reference-only shortcut.
- Closed module selection bindings can route to one registered updater per
  keyed list instead of `Row[*]` readers. Each list instance caches its previous
  selection and refreshes the old/new keys, including the first selection from
  `null`. This covers inline rows, forwarded selection props and local component
  rows that compare selection with the same item-property key. It uses the
  existing static access table; no runtime subscriptions or dependency graph
  were added. Source writes keep their ordinary reconciliation/journal paths.
- Module reads in authored key expressions and key helpers are owner reads,
  so changing them reconciles the list rather than only updating row content.
- Structural placement trims unchanged key prefixes and suffixes before LIS
  and reverse placement. Unique retained keys bound the remaining old positions,
  including when additions/removals shift a suffix. A 10k swap at positions
  1/998 now analyzes 998 positions rather than 10k. Ordinary key evaluation,
  retained-row updates, cache transfer and duplicate detection still run.
- Simple inline host rows can now use lightweight list entries without a
  registered runtime entity or allocated row ID per item. Their update closure
  handles row-local and write-free event refreshes. The proof excludes independent
  module readers, hot builds, transparent owners, callback preludes, refs,
  spreads, child components, nested regions and calls in render expressions.
  General routing, key evaluation and setter/proxy fallbacks remain unchanged.
- Content journals now require a closed plain-record proof before adding a
  key read. Previously, rewriting an opaque member assignment could hide it
  from setter/proxy fallback analysis, read its receiver twice, and leave a
  setter-mutated sibling row stale. Unproven instance writes keep owner/root
  publication and full reconciliation. Closed literal arrays with bounded
  numeric indices, scalar writes, immutable key fields and no escapes retain
  targeted refresh. The proof uses lexical bindings, including owner-local
  bindings, rather than matching source names.
- Conditional writes to those proven module lists can now publish fixed
  indices only when the write executes. A skipped branch schedules nothing;
  an executed write refreshes one addressed row instead of replaying every row.
  Source reads outside the map (including cross-row helper captures), aliases,
  opaque methods, replacement producers and dynamic indices retain full replay.

A focused local Chromium check selected alternating rows in an existing 10k
component-owned component-row list: 25 samples after five warmups, synchronous
scheduling, class validation after each operation. The median was **5.3 ms before
and 0.2 ms after** these changes. This is a local comparison, not a replacement
for the user's VM matrix or an isolated swap measurement. Regenerated outputs
passed all 21 DOM scenarios across nine variants, including retained identity
and mixed selection/reorder/removal sequences.

Measurements and limits are recorded in `bench/dom/README.md`.

The mixed module-data/component-selection extension was checked locally in
Chromium with 10k existing rows, alternating selections, five warmups and 25
samples, synchronous scheduling and class checks after each operation. Two
before/after runs measured **5.2–5.4 ms → 0.2 ms** for inline rows and
**4.9–8.0 ms → 0.2 ms** for component rows. These are focused local measurements;
the VM matrix and earlier timing artifacts have not been replaced. All nine
variants passed the 21-scenario correctness gate again. Self-contained tests
also reproduce and fix stale getter-backed labels, loose-equality matches across
different key types, and keys derived from changing selection.

The subsequent module-selection pass used the same focused Chromium protocol
(five warmups, 25 samples, alternating rows 500/501 in 10k existing rows,
synchronous scheduling, class validation after every operation). A sequential
local comparison against `3bb8274` measured:

| Data placement | Rows | Before median | After median |
|---|---|---|---|
| Module | Component | 8.6 ms | 0.1 ms |
| Module | Inline | 12.8 ms | 0.1 ms |
| Component | Component | 5.5 ms | 0.2 ms |
| Component | Inline | 7.5 ms | 0.1 ms |

All four use module selection. These small post-change timings approach browser
timer precision, and local timing is variable; they are not the full VM matrix.
The existing timing report remains untouched. Exported state/row components,
general visual reads, hidden helper/getter captures, computed sources and
unproven keys retain broad routing. A row reused at another unproven list site
keeps the necessary ordinary owner reader. Tests cover multiple list instances,
mixed selection/structure batches, disposal and module-dependent key changes.

The owner/root publication pass was measured against `776f06f` in local
Chromium: 10k existing rows, synchronous scheduling, swaps of positions 1/998,
five warmups and 25 samples. After each operation, untimed checks validated
every row's text, class, order and exact DOM identity, including a selected row.
Before and after bundles were run sequentially without tests or builds running:

| Data placement | Selection placement | Rows | Before median | After median |
|---|---|---|---|---|
| Component | Component | Component | 32.5 ms | 9.1 ms |
| Component | Component | Inline | 32.6 ms | 20.3 ms |
| Component | Module | Component | 26.6 ms | 9.7 ms |
| Component | Module | Inline | 41.8 ms | 22.5 ms |

The unchanged module-data/component-row control varied from 21.1 to 13.7 ms,
so these timings cannot establish a reliable speedup ratio. Self-contained
regressions establish the narrower result: each retained row replays once per
swap with synchronous or deferred scheduling, while proxy-induced changes to
sibling output remain visible. All nine variants pass the 21-scenario identity
and mixed-sequence gates. The VM matrix and tracked timing reports are unchanged.

The subsequent reorder-window pass was checked against `f5108eb` in Chromium.
An isolated 10k-row list with no row update closure measured **3.8 ms → 3.2 ms**
for swaps at positions 1/998: ten warmups, 100 samples per version, alternating
before/after order in one page, with untimed full identity/text checks after
each sample. This measures runtime reconciliation and DOM moves, not app work.

The compiler-produced apps were then bundled against the before/after runtime
sources with identical package metadata and esbuild settings. Each variant used
a fresh page, two independent runtimes, synchronous scheduling, 10k rows and
a selected row. Before/after order alternated for ten warmups and 50 samples per
version. Every sample checked all rows' text, class, order and DOM identity:

| Data placement | Selection placement | Rows | Before median | After median |
|---|---|---|---|---|
| Module | Module | Component | 8.4 ms | 7.6 ms |
| Module | Module | Inline | 13.8 ms | 12.9 ms |
| Component | Component | Component | 10.7 ms | 9.0 ms |
| Component | Component | Inline | 15.3 ms | 15.0 ms |
| Module | Component | Component | 9.9 ms | 8.6 ms |
| Module | Component | Inline | 14.6 ms | 14.5 ms |
| Component | Module | Component | 8.3 ms | 6.9 ms |
| Component | Module | Inline | 14.3 ms | 13.6 ms |

These are local medians, not reliable universal speedup ratios; several inline
differences are small compared with machine variability. The existing matrix
reports remain unchanged. The full nine-variant correctness gate passed again.
Self-contained runtime tests check all 720 six-row permutations against an
independent minimum-move oracle, shifted suffixes with additions/removals,
replacement records, multi-node rows, index-sensitive structural updates,
key/update evaluation order, exact retained identity and key refresh after moves.

The lightweight-inline pass was measured against `f334fb3` in local Chromium:
10k rows, synchronous scheduling, five warmups and seven samples for creation,
replacement and clearing. Each variant used a fresh page; counts, classes and
unique keys were checked outside timing. Bundles used the same runtime, and
before/after ran sequentially without concurrent builds or tests.

| Data placement | Selection placement | Create before/after | Replace before/after | Clear before/after |
|---|---|---|---|---|
| Module | Module | 77.3 / 52.2 ms | 125.9 / 58.3 ms | 17.5 / 8.5 ms |
| Component | Component | 81.9 / 47.8 ms | 134.2 / 62.5 ms | 17.7 / 7.1 ms |
| Module | Component | 88.8 / 71.7 ms | 117.5 / 74.7 ms | 17.2 / 12.8 ms |
| Component | Module | 144.4 / 99.8 ms | 189.8 / 126.4 ms | 22.6 / 13.9 ms |

These inline timings are noisy: the unchanged both-module component-row control
varied from 81.5 to 56.0 ms for creation, while the unchanged both-component
control varied from 94.0 to 91.0 ms. Do not infer reliable speedup ratios. The
deterministic change is 10,000 fewer registered entities in each eligible inline
variant (1–2 total entities instead of 10,001–10,002). All nine DOM variants
passed the full correctness gate. Self-contained tests cover events, module and
component selection, key changes, retained identity, disposal and conservative
exclusions. Hydration adopts existing inline rows without creation or relocation
and retains their event updates after reordering. VM confirmation remains open.

## Optimistic forms and benchmark validation

The journal-fallback pass adds self-contained regressions for inline/component
rows with synchronous and deferred schedulers. They check one receiver read
before the authored write, setter changes to another row and a separate child
component, retained node identity, cross-row helper reads, safe targeted writes
and skipped conditional writes. The DOM benchmark's owner-local `buildData`
producer is opaque to this proof, so its partial writes now use the restored
fallback. Earlier VM partial-update timings remain a record of the older code;
re-measure them before comparing state-placement speed. This pass does not
establish faster opaque-produced partial updates. The next optimization requires
a sound producer/escape proof or a cheaper conservative replay path.

The simple example now demonstrates optimistic messages with a delayed action.
Its compiler/runtime regressions use self-contained source fixtures in tests;
tests do not load the example, which can change or be deleted independently.

Synchronous expression statements before a list callback's JSX return now replay
once per row, including error-list logging. Their reads participate in routing,
and they retain full reconciliation. Compiler-known frozen form controllers
publish their own submit notifications, avoiding an extra post-command refresh;
later in-place form-result changes still publish through the form notifier.

The framework suite now performs an untimed correctness pass that checks every
operation after its completion signal, plus the existing timed-batch endpoint
check. All eight adapters passed this pass at 10, 100, and 1,000 rows in forced
and reactive modes on 2026-09-30. Adapter fairness limits are documented in
`bench/frameworks/README.md`; this does not establish equal work or universal
speed claims.

## Investigated

- Canonical string key interning: estimates for Todo and Fieldnotes saved only
  37 B and 74 B gzip before accounting for an ID protocol. See
  `bench/package-size/README.md`. Numeric IDs and array lookup remain a candidate
  if a complete implementation produces a measured benefit and preserves path
  matching and independently installed access-table fragments.
- DOM and framework benchmark results exercise different workloads, list sizes,
  scheduler modes, and vanilla baselines. They do not establish one general
  framework ranking. Synchronous per-reader commits contributed to DOM fanout;
  broad selection still visits all matching rows.

## Remaining candidates from the review and Marko output

The separate DOM state-placement suite crosses module/component ownership of
data and selection with inline/component rows, retaining vanilla. All nine
implementations passed 21 operation scenarios and validation after every timed
sample. `bench/dom/state-placement-results.md` groups one report by ownership;
the original three-way harness remains available independently.

In this run, the 10k selection transition was 19.60 ms for module inline state,
0.20 ms for component-owned inline state, and 7.90 ms for component-owned
component rows. These are authored paths, not an isolated compiler comparison.
The original generated component-owned row callback included `markDirtySubtree`
after calling an already-instrumented owner callback. The narrow callback proof
above removes that extra work for the benchmark's selection callback. Broader
callbacks still require additional effect proofs.

## Open performance work and VM review

The pinned Octane comparison in `bench/octane` supplies additional measurements.
Its outcomes do not replace this backlog or change the existing priorities.

The earlier review is not fully addressed. The completed changes above reduce
some costs; the following work remains open. The VM measurements reported by
the user for commit `661d247` are preserved in
`bench/dom/state-placement-vm-review.md`, separately from locally measured JSON.
They passed all nine implementations twice, but the original gates did not
check retained DOM identity or mixed selection/structure sequences.

The newer user report for `f5108eb` is summarized in
`bench/dom/state-placement-vm-review-f5108eb.md`. It includes the stronger gates
and predates the reorder-window and lightweight-inline passes. Selection is now
about 0–0.1 ms across placements. The corrected `9811e0c` report is preserved in
`bench/dom/state-placement-vm-review-9811e0c.md`; it includes the restored
conservative content fallback and the reorder-window/lightweight-inline passes.
Inline creation is now 12.4–14.1 ms and clearing 2.4–2.5 ms at 10k rows, close to
component rows. Partial updates across all placements take 2.1–3.4 ms versus
vanilla's 0.3 ms. The older component-owned partial-update advantage does not
measure the restored fallback. These historical runs are not controlled
comparisons. Bundle-size work is deferred at the user's request.

The user's later `1fd4911` VM report is preserved in
`bench/octane/vm-review-1fd4911.md`. All DOM placements and ten Octane targets
passed, including the retained-node gates. DOM partial updates at 10k rows
measured 1.4–2.4 ms versus vanilla's 0.5 ms; selection stayed around 0.1 ms.
Creation was mixed (13.3–16.7 ms), so this does not establish a creation win or
isolate the earlier text-cache change. Swaps still took 1.8–2.4 ms and clearing
2.3–2.7 ms. The common Octane browser was Chromium 153 through an isolated
cache fallback after browser downloads failed; the expected Playwright browser
was Chromium 149. These remain run-specific measurements and do not change
the optimization priorities.

| Priority | Open issue | Evidence / required next step |
|---|---|---|
| 1 | Conservative partial update cost across state placements | The latest VM report takes 1.4–2.4 ms at 10k rows versus vanilla's 0.5 ms. Row update closures dominate a local sampled profile. Primitive text joins now skip unchanged string construction; required operand reads and broad replay remain. Narrower routing still requires proof covering setters, getters, aliases and hidden reads. |
| 1 | Broader callback proofs | The benchmark's direct lexical assignment callback is optimized. Opaque calls, argument mutation, mutable targets and deferred work still need stronger proofs; exceptions keep normal-completion semantics. |
| 1 | Structural retained-row work | Latest VM 10k swaps take 1.8–2.4 ms across placements. LIS and placement exclude unchanged ends; key validation, map transfers and required retained-row replay still need investigation. Setter/proxy fallbacks remain. |
| 2 | Further module selection proofs | Closed module bindings now target old/new keys over module/component data. Exported or imported state, cross-module row contracts, computed sources and general/hidden reads still need stronger proofs before narrowing their routing. |
| 2 | Structural reconciliation and safe list mutations | Closed plain-record content writes can collect row keys; opaque-produced collections retain full replay. Append/truncate/reorder specialization and arbitrary alias handling remain open. |
| 2 | Creation/replacement/teardown | The corrected VM confirms that eligible inline rows now approach component-row creation/clearing. Both still trail vanilla. Inspect event disposal, closure creation and retained heap before broader specialization. |
| 3 | Duplicated dynamic initialization/update emission | Check creation order, getter calls, transparent-source reads and hydration before sharing emitted expressions. |
| Deferred | Browser runtime size and routing | Deferred at the user's request. Browser/server separation, local-only routing, numeric/direct reader dispatch and string-key interning remain candidates. |
| 3 | Component template cloning and static registration | Row templates exist; broader component cloning and skipping static entity registration still require proof and measurement. |
| 3 | Slot granularity and opaque pulls | Extend reason gates and restrict volatile evaluation to dependent slots; do not hide required unknown-call refreshes. |
| 4 | SSR client omission and Marko emission ideas | Investigate hydration ownership/markers, per-binding/shared-input updates and region setup; these remain design candidates. |

The DOM matrix now also checks retained node identity after every validated
operation. Untimed 1k/10k sequences select a key, reverse it into the removal
position, remove the selected row, append, and select again. These strengthen
the correctness gate; they do not constitute a performance fix. Use
`state-placement-run.ts --validate-only` after building to check them without
replacing timing results. The existing timing artifact remains the earlier run.

## Primitive row text joins: local comparison

At `9811e0c`, a local Chromium CPU profile of 60 repeated 10k-row updates
sampled most JavaScript time inside row update closures (710/1240 component
samples and 886/1462 inline samples). This identifies the closure as a focus;
it does not attribute all of that time to concatenation.

Before/after bundles used the same runtime and a synchronous scheduler. Three
paired runs alternated operation order, with five warmups and 25 fresh-list
samples per version. Creation and the first every-tenth-row update were timed
separately. Row count, all text/classes and retained node identity were checked
after each update outside timing.

| Row shape | Before update medians (ms) | After update medians (ms) |
|---|---|---|
| Component | 8.3, 7.2, 7.2 | 5.6, 4.3, 4.5 |
| Inline | 6.3, 6.4, 12.2 | 4.0, 3.9, 6.6 |

These local timings are noisy and are not replacements for the VM matrix.
Creation medians varied substantially without a consistent direction. The
optimization adds three cached values per eligible text join; it still visits
all rows on an unproven content update. Verify the next commit on the VM before
drawing wider conclusions about creation, memory or structural operations.

## Literal class branches: local comparison

The compiler now trims class literals inside conditional result branches during
compilation. It leaves the condition expressions intact and keeps the guarded
HTML/SVG setter. If any result branch is unknown, the whole expression retains
runtime normalization, including mutable array/object values. This removes one
normalization per retained row on an unchanged class replay without adding cache
fields. It does not narrow list routing or skip any row's required reads.

Two paired Chromium runs compared compiler-generated output from `1fd4911`
with this class-only change, using the same runtime and production bundling.
Each variant mounted independent before/after apps in one page. Five warmups
preceded 25 fresh 10k-list samples per version, alternating measurement order.
Each sample selected row 500, timed the first every-tenth-row update, then
checked every row's text, class, count and retained DOM identity outside timing.
Builds and tests were not running alongside these two measurements.

| Data / selection | Rows | Run 1 before → after (ms) | Run 2 before → after (ms) |
|---|---|---|---|
| Module / module | Component | 4.9 → 4.9 | 5.9 → 5.8 |
| Module / module | Inline | 4.0 → 4.2 | 5.1 → 4.8 |
| Component / component | Component | 4.7 → 4.4 | 6.4 → 6.0 |
| Component / component | Inline | 4.7 → 4.5 | 5.3 → 5.0 |
| Module / component | Component | 4.9 → 4.7 | 6.6 → 6.6 |
| Module / component | Inline | 4.3 → 4.2 | 5.5 → 5.4 |
| Component / module | Component | 5.3 → 5.2 | 6.3 → 6.5 |
| Component / module | Inline | 4.6 → 4.1 | 5.2 → 5.2 |

This is a small reduction in replay work, not a substantial or consistent
timing win across every placement. Creation was mixed. These local measurements
do not replace the VM matrix. A separate experiment reordered primitive text
cache checks; its timings were mixed, so that change was discarded.

The compiler build and 64 focused tests passed, including HTML/SVG condition
reads, unknown mutable class branches, setter/proxy fallback and hydration.
Regenerated output passed all 21 scenarios across nine DOM variants, with
retained identity and mixed selection/structure sequences. Tests compile their
own source fixtures and do not read examples.

## Earlier candidates retained for tracking

- Prove when module-state selection can refresh only the previous and next keyed
  rows. Preserve getter and key-expression semantics before narrowing fanout.
- Specialize proven list mutations, retaining conservative reconciliation for
  unknown behavior.
- Emit dynamic initialization and update expressions once where creation order
  and hydration adoption allow it.
- Reduce retained browser runtime machinery and investigate components with
  entirely local writes as a smaller routing entry point.
- Extend template cloning from rows to suitable component shapes.
- Check whether static components can skip registration.
- Gate more expensive slots with precise dirty reasons and restrict opaque pull
  work to dependent slots.
- Compare direct reader references or numeric routing with existing access-table
  expansion caches; measure register/unregister and dispatch costs together.
- Explore client omission of static/server-derived components only after
  confirming hydration markers and ownership permit it.
- Compare Marko's per-binding updates, shared multi-input update groups, keyed
  loop parameters, conditional-region setup, and dynamic-tag handling with the
  compiler's current emission. The pasted Marko examples included malformed or
  incomplete cases, so they are design references rather than executable
  performance baselines.

These candidates are not completed work. Each needs a correctness test and a
measurement before it becomes a default optimization.
