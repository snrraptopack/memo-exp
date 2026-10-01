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
  direct lexical assignments or proven synchronous local forwarding chains.
  Missing props, mutable bindings, argument/property mutations, opaque calls
  and deferred work retain the conservative path.
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
| 1 | Conservative partial update cost across state placements | The `adeb2c4` VM report takes 1.1–1.6 ms at 10k rows, versus vanilla's 0.3 ms. Row update closures dominate an earlier local sampled profile. Closed component-owned records, including fresh local literal factories, support bounded-loop key journals and arithmetic row reads. Opaque-produced collections in the main benchmark still replay broadly; extending the producer/alias proof or reducing conservative replay cost remains open. |
| 1 | Broader callback proofs | Direct lexical assignments and stable synchronous local forwarding chains are optimized. Opaque calls, argument mutation, mutable targets and deferred work still need stronger proofs; exceptions keep normal-completion semantics. |
| 1 | Structural retained-row work | The `adeb2c4` VM measures 10k swaps at 0.8–1.3 ms across placements; Octane displacement workloads take 0.275–0.430 ms. Ordered removal and persistent retained Maps are included in that run, but its different CPU prevents isolated historical comparisons. Required key/row evaluation and broad replay remain. |
| 2 | Further module selection proofs | Closed module bindings now target old/new keys over module/component data. Exported or imported state, cross-module row contracts, computed sources and general/hidden reads still need stronger proofs before narrowing their routing. |
| 2 | Structural reconciliation and safe list mutations | Closed plain-record content writes can collect row keys; opaque-produced collections retain full replay. Append/truncate/reorder specialization and arbitrary alias handling remain open. |
| 2 | Creation/replacement/teardown | The `adeb2c4` VM measures DOM 10k creation at 11.4–14.0 ms versus vanilla's 8.1 ms, replacement at 14.7–16.3 ms versus 9.3 ms, and clear at 2.2–2.5 ms versus 0.6 ms. Registered leaf teardown now avoids traversal buffers and empty error arrays. Main DOM/Octane row entries already omit registration, so their closure, event and DOM-range costs remain open. |
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

## Evaluated list keys and cyclic placement

The runtime stores each evaluated key alongside its existing row entry, entity
ID and position. Ordered buffers now hold those records rather than separate
entry/ID arrays. Same-shape validation still evaluates authored current keys,
then compares against cached keys using Map's SameValueZero identity. It avoids
one Map lookup per row on this path. Failed append/removal probes pass their
evaluated keys to the general reconciler, and suffix removal uses the removed
records' cached keys.

Four regressions failed before the change: a removed suffix accessor could
throw during removal; failed append and removal probes could read a current
key twice; duplicate-key rejection could also repeat those reads. The new
tests cover these failures, NaN/zero/object/symbol identity, and key reads that
append or truncate the source during shape validation. Each fixture owns its
data and reads no example files.

Placement also recognizes a complete cyclic shift of evaluated old positions
inside the active reorder window. It verifies every position, then keeps the
longer increasing run in linear time. Equal-length runs preserve the general
LIS tie choice. Additions, gaps and other orders use the existing patience-sort
path. Key evaluation and retained-row updates still run in their existing
order; the proof relies on the resulting sequence, with no method-name rules.

Two paired local Chromium runs compared `687a86b` with the cached-record/key
change before adding cyclic placement. The production bundles used identical
compiler output and synchronous scheduling. Each placement had five warmups
and 25 fresh 10k-list samples per version, alternating order. Each sample
checked all text, classes, count and retained identity outside timing.

| Data / selection | Rows | Run 1 update before → after (ms) | Run 2 update before → after (ms) |
|---|---|---|---|
| Module / module | Component | 6.0 → 5.4 | 5.3 → 5.6 |
| Module / module | Inline | 5.4 → 5.1 | 5.3 → 4.6 |
| Component / component | Component | 6.1 → 6.2 | 6.4 → 6.0 |
| Component / component | Inline | 5.7 → 4.9 | 6.0 → 5.6 |
| Module / component | Component | 5.9 → 5.2 | 6.5 → 5.9 |
| Module / component | Inline | 5.5 → 4.9 | 7.0 → 7.0 |
| Component / module | Component | 6.3 → 5.8 | 7.7 → 6.4 |
| Component / module | Inline | 5.4 → 4.6 | 5.4 → 5.3 |

Creation was mixed, with increases in most placements in the first run and
both directions after a laptop restart. The new cached key adds one reference
per row record; removal of the parallel ID buffers also affects memory. No
retained-heap improvement is established. Broad content replay and general Map
transfer remain, including for immutable replacement objects.

A separate production-bundled runtime comparison used guarded single-node rows
at 10k, validating text, order and retained identity after every operation.
The full-patch comparison used five warmups and 25 fresh-list samples. The
isolated cyclic-path comparison kept both versions on the new cached records,
used ten warmups and 100 repeated samples, and alternated measurement order.
Repeated removals started at 10k and reduced the list by one per sample.

| Operation | `687a86b` → full patch, fresh lists (ms) | Cached records → cyclic path, repeated lists (ms) |
|---|---|---|
| Forward one-row rotation | 6.9 → 9.1 | 6.5 → 5.7 |
| Backward one-row rotation | 7.1 → 6.8 | 7.2 → 6.2 |
| Half-list rotation | 30.5 → 25.1 | 16.6 → 15.5 |
| Sparse swap | 8.9 → 10.6 | 6.2 → 5.9 |
| Reverse | 39.7 → 40.5 | 30.6 → 32.5 |
| Remove first | 2.9 → 3.0 | 2.4 → 2.4 |

These are noisy local measurements with different sampling protocols. The
isolated cycle results support keeping the linear proof; the full patch still
needs the VM matrix to establish creation and structural performance. The
correctness fixes address demonstrated failures. The broader performance
backlog remains open.

The runtime build, lint and 65 focused tests passed, including all 720 six-row
permutations against an independent minimum-move oracle, multi-node cyclic
windows, key/update ordering, hydration and setter/proxy fallbacks. The nine
DOM variants passed all 21 scenarios and mixed selection/structure sequences
with retained identity checks. Memoized-dom also passed the pinned Octane
canonical and reorder smoke gates. Smoke timings are only execution checks;
the other nine Octane framework targets were unchanged and were not rerun.

## General-path row lookup, key creation and failed-frame cleanup

The general forward pass now compares the current evaluated key with the
cached record at that position. If it matches using SameValueZero and deletion
from the old Map succeeds, the record is unconsumed and unique so far. That
case skips `next.has()` and `old.get()`. New, displaced and already-consumed
keys retain the normal Map checks. The old record is still removed before its
row update, and the next Map is still built in the same order. Required key
reads, props updates and broad retained-row replay remain.

This benefits immutable same-key replacements and the unchanged positions
around sparse reorders. It adds no per-row field or cache. An initial version
called a key-comparison helper per row and was slower locally; that version was
discarded in favor of an inline comparison and the existing deletion check.

Tracked row creation also computes its serialized key once and shares it
between the entity ID and hydration marker. Client-created rows without entity
IDs skip serialization because they emit no row marker. Server and hydration
paths retain encoded keys, escaping and synthetic-ID behavior.

A local paired Chromium comparison compiled the existing memoized-dom Octane
fixture through the compiler and bundled identical output against `7e1d310`
and the new runtime. Both versions used source runtime entries, production
minification and synchronous scheduling. Five warmups preceded 25 fresh-list
samples per version, with alternating order. Every sample selected a row,
updated immutable records, swapped, reversed and cleared. Checks outside timing
covered count, text, classes, order and retained node identity.

| Rows | Creation before → after (ms) | Immutable update before → after (ms) | Swap before → after (ms) | Reverse before → after (ms) | Clear before → after (ms) |
|---|---|---|---|---|---|
| 1k | 15.9 → 15.8 | 0.7 → 0.6 | 0.7 → 0.7 | 6.2 → 6.5 | 2.9 → 3.0 |
| 10k | 150.8 → 147.6 | 7.7 → 7.3 | 5.3 → 4.6 | 58.4 → 57.0 | 22.9 → 21.6 |

These local differences are modest and noisy. The 1k measurements approach
timer precision. The VM can check these changes together with the preceding
cached-key/cyclic-placement pass; a full rerun is not needed for each candidate.
General Map transfers and unproven broad row replay still need further work.

Failure testing also reproduced three teardown bugs: a duplicate-key exception
could leave a consumed row mounted, a later key exception could leave retained
and newly created records alive, and a failed append factory could leave a
completed detached row registered. Disposal now cleans completed records from
both Maps and the ordered scratch buffer. Removal-probe references are checked
against the Maps to avoid double disposal. Successful frames leave these scratch
containers empty, so this adds no scan of successful retained rows. The tests
verify DOM removal, registry cleanup and exactly-once disposal, including a
second disposal call. This covers completed row records; it does not make
reconciliation transactional or recover allocations made inside a factory that
throws before returning its entry.

The runtime build, lint and 73 focused tests passed. All nine DOM variants
passed 21 scenarios plus retained-identity and mixed selection/structure gates.
The paired Octane-fixture checks above covered creation, immutable update,
selection, swap, reverse and clear. The complete upstream Octane harness was
not rerun for this pass.

## Single-node row ownership and isolated DOM moves

Inline row factories now return their root Node directly, using the existing
`ListEntry.nodes` union. Lightweight single-root component rows already did
this. This removes one array allocation per inline row. The runtime inserts a
single pending Node directly instead of allocating a fragment and appending
the Node into it first. Arrays retain their iteration and fragment handling;
multi-entry runs still batch into a fragment. Server and hydration entries
retain their marker-plus-node extents. All generated benchmark changes came
from the compiler.

A browser cost probe against `a88e100` verified retained identity and order at
10k rows. A one-row rotation allocated one fragment and staged one Node before
the patch, versus zero of each afterward. A sparse swap removed two of each.
Reverse retained one fragment and 9,999 staging appends in both versions.

A paired production runtime comparison used ten warmups and 100 repeated
samples with alternating order. Text, order and retained identity were checked
after every operation, outside timing. Repeated removals started at 10k and
reduced the list by one per sample.

| Operation | `a88e100` → patch median (ms) |
|---|---|
| Forward one-row rotation | 5.5 → 5.4 |
| Backward one-row rotation | 4.4 → 4.8 |
| Half-list rotation | 16.7 → 16.2 |
| Sparse swap | 5.9 → 5.4 |
| Reverse | 25.2 → 25.2 |
| Remove first | 2.3 → 2.5 |

The compiled eight-variant comparison used five warmups and 25 fresh 10k-list
samples per version, alternating order and validating text, classes and
identity after each update. Inline creation medians were module 94.9 → 100.2,
owned 92.1 → 92.3, module data/component selection 83.5 → 86.4, and component
data/module selection 95.0 → 92.3 ms. Component controls and update timings
also varied. These local runs establish removed allocations and DOM calls,
but do not establish a repeatable overall throughput or heap improvement.
The VM should evaluate the accumulated changes together. Broad replay and
general Map transfer remain priorities.

An experiment skipping proven direct inline binding assignments was discarded
after two paired runs remained mixed or slower. No compiler flag or runtime
shortcut from that experiment remains.

The compiler/runtime builds, lint and 109 focused regressions passed. Coverage
includes all 720 six-row permutations against a minimum-move oracle,
multi-node extents, custom array iteration, retained input values/listeners,
hydration, key/read order, selection and disposal. An older mutation-journal
test's targeted expectation also failed on `a88e100`: its producer and indexed
loop require conservative replay under the existing proof. It now checks that
fallback; separate literal-record regressions continue to check targeted
refresh. Lint reports three pre-existing `any` warnings in that test.
All nine DOM variants passed 21 scenarios plus identity and mixed-sequence
checks. The pinned memoized-dom Octane canonical and reorder smoke gates
passed; their one-sample timings are execution checks. The other nine Octane
targets were unchanged and were not rerun.

## Published local callback forwarding

The published-callback proof now follows direct calls through stable `const`
functions declared in the same component factory. Every callee is resolved by
lexical binding, and every function must satisfy the existing synchronous
scalar-write proof. Arguments must be literals or lexically bound identifiers.
Property reads, opaque calls, spreads, optional calls, parameter mutations,
mutable bindings, async/generator functions and recursive cycles keep the
fallback. Results are memoized within each proof to avoid repeatedly walking
shared helper bodies. Every component caller still has to supply a proven value.

This allows `select = id => forward(id)` → `forward = id => apply(id)` →
`apply = id => { selected = id; }` to rely on the already instrumented helper's
publication. The calling row omits its extra update and conservative root
refresh. A self-contained linked-module regression reproduced two synchronous
publications before the change, versus one afterward. Synchronous and deferred
schedulers preserve selection, text and all retained row nodes.

A production-bundled paired Chromium fixture used 10k component-owned rows,
the forwarding chain above and synchronous scheduling. The baseline compiler
used `a693034`'s prop-origin source; both bundles used the same runtime. Five
warmups preceded 25 alternating old/new selection samples at positions 500 and
7,500. Count, every row's text/class and retained identity were checked outside
timing after each operation. The median was **2.3 ms → 0.2 ms**. This measures
the forwarding case only: the existing DOM matrix's direct callbacks were
already optimized and its generated output is unchanged.

The compiler build, lint and 76 focused tests passed, including negative proofs
for shadowed callees, opaque/argument-mutating helpers, mutable targets, cycles,
property/spread/global arguments and deferred work. All nine DOM variants
passed their 21 scenarios plus identity and mixed-sequence gates. The pinned
Octane harness was not rerun for this compiler-only pass; the prior pass's
canonical/reorder smoke checks remain recorded above. General opaque partial
updates and broader callback shapes remain open.

## VM checkpoint: `581b40f`

The user's full [report](../bench/octane/vm-review-581b40f.md) records a passing
fresh build, two complete DOM matrices with seven samples per cell, and the
canonical/reorder Octane suites across ten targets with eight samples per cell.
Text, classes, counts, keyed order, retained identity and mixed sequences passed.
These are imported VM results; the report's supporting JSON/archive files were
not supplied with this document.

The runs were sequential after a competing process exited. Both suites used
the same Chromium 153 executable. The VM host changed from AMD EPYC to Intel
Xeon, so the historical results cannot establish gains or regressions from the
intervening commits. Vanilla 10k creation also varied from 48.3 to 16.8 ms
between the two current DOM runs. Both full matrices are preserved, without
selecting the faster result or pooling their medians.

Selection remains around 0.1–0.2 ms at 10k in the DOM matrix. Canonical Octane
records memoized-dom at 7.1 ms for 1k creation, 11.2 ms replacement, 0.6 ms update
and 0.2 ms selection. Those are competitive within that suite; they do not
cancel the DOM partial-update, structural and teardown gaps listed above.
Canonical removal is 1.2 ms with 64.22% RME and a 4.5 ms p95, so its median
alone is insufficient to attribute a bottleneck. Repeated front removal in
the reorder suite is 0.315 ms, versus 0.105 ms for octane-tsrx. The next profile
should separate required row/key evaluation from bookkeeping on partial updates
and front/scattered removals before adding another specialization.

The existing matrix uses direct selection callbacks and does not exercise the
forwarding shape added at `581b40f`; that shape's improvement remains supported
by the focused paired fixture and regressions above. No compiler/runtime source
or dependency version was changed while recording this checkpoint. Bundle work
remains deferred, and the existing optimization priorities remain in place.

## Ordered removal bookkeeping

A local Chromium CPU profile of compiler-generated apps put 887/1,460 samples
in component-row update closures and 576/802 in inline-row update closures.
For repeated Octane front removals at 10k, reconciliation accounted for
283/573 samples. These sampled counts include idle, program and GC samples;
they identify investigation targets rather than precise elapsed-time shares.

Removal-subsequence validation now compares each authored key with the next
ordered record before using a Map lookup across a gap. Cleanup walks the old
ordered records, without iterating Map entries or filling a parallel position
buffer. Authored key evaluation, required retained-row updates and disposal
order remain intact. Reordered, duplicate or new keys retain the general path.
The contiguous suffix-removal Range path remains in use.

A direct-runtime 10k cost probe counted:

| Removal | Map lookups before / after | Map entries visited before / after |
| --- | --- | --- |
| First row | 9,999 / 1 | 10,000 / 0 |
| Every tenth row | 9,000 / 1,000 | 10,000 / 0 |
| Last 1,000 rows | 9,000 / 0 | 0 / 0 |

Entry visits are logical iterator work, not a measurement of heap allocations.
A separate paired production Chromium fixture compiled the Octane app with
the current compiler and compared runtime source at `858b9a4` with this change.
Five warmups preceded 15 fresh samples per side, alternating execution order.
Removal samples average 20 individually timed operations on a shrinking list;
update samples time one operation. Creation, selection and checks of every
row's text, class, order, count and retained node identity occur outside timing.

| Starting rows | Operation | Before / after median ms |
| --- | --- | --- |
| 1,000 | Front removal | 1.93 / 0.78 |
| 1,000 | Every-tenth removal | 1.28 / 0.83 |
| 1,000 | Middle removal through row event | 2.36 / 1.36 |
| 1,000 | Partial update control | 1.10 / 1.10 |
| 10,000 | Front removal | 7.91 / 5.17 |
| 10,000 | Every-tenth removal | 7.23 / 5.58 |
| 10,000 | Middle removal through row event | 11.50 / 10.52 |
| 10,000 | Partial update control | 9.60 / 9.70 |

These local results support this removal optimization; they are not comparable
to VM medians or evidence of a general partial-update improvement. Broad row
replay and structural work remain open priorities. Bundle work stays deferred.

Regression tests also reproduced and fixed two existing removal-proof failures:
a key read growing the source back to its original length could access a
missing suffix entry, while truncation could leave a staged phantom row mounted.
The proof now checks the final removal extent and trims staged survivors.
The runtime build, lint, 105 focused tests and all nine DOM variants passed,
including hydration, failed-frame disposal, permutation, identity and mixed
selection/reorder/removal checks.
The pinned Octane memoized-dom target also passed canonical and reorder smoke
checks; their single-sample timings are correctness checks, not performance
evidence. Other framework targets were unchanged and were not rerun locally.

## Append-prefix validation

Unproven appends still evaluate every retained authored key and replay the
required rows. Prefix validation now compares each key directly with its
cached ordered record, using SameValueZero, instead of looking it up in the
Map. A mismatch keeps the existing general reconciliation and evaluated-key
fallback. Compiler-proven append behavior is unchanged.

A 10k-prefix direct-runtime probe counted **10,000 → 0 Map lookups** when
appending 1,000 rows, with retained identity, order and text checks. Two paired
local production Chromium runs compared runtime source at `bfa2fb5` with this
change, using the compiler-generated DOM component-row apps. Each used five
warmups and 25 samples per side with alternating order; each sample appended
1,000 rows, checked the retained prefix's text/identity/order and selection,
then removed the appended tail outside timing to restore the starting list.
The complete DOM suite separately validates authored labels and mixed cases.

| State placement | Starting rows | Run 1 before / after ms | Run 2 before / after ms |
| --- | --- | --- | --- |
| Module data and selection | 1,000 | 7.6 / 7.6 | 7.4 / 7.8 |
| Module data and selection | 10,000 | 8.3 / 7.7 | 7.7 / 7.3 |
| Component data, module selection | 1,000 | 7.0 / 7.3 | 7.2 / 7.1 |
| Component data, module selection | 10,000 | 8.3 / 8.0 | 9.1 / 8.4 |

The 10k gains were modest and 1k results mixed. This removes redundant prefix
bookkeeping; it does not narrow required row evaluation or solve partial
updates. The runtime/compiler builds, lint and 50 focused tests passed. The
key-identity regression additionally checks appending after a mixed-key
reorder/removal, preserving NaN, zero, string, symbol and object identity.
All nine DOM variants passed their 21 scenarios plus retained identity and
mixed-sequence gates. Generated benchmark output is unchanged. The pinned
Octane harness was not rerun for this follow-up; its prior smoke results are
recorded above.

## Discarded: reusable private component-row props

A compiler prototype reused a generic props envelope only when lexical reads
stayed within explicitly supplied own fields, with no escape, direct mutation,
computed access or receiver call. It staged all next values before updating
fields. Twelve focused checks passed, including throwing value evaluation and
observing previous props while a later value was still being evaluated.

A paired Chromium run at 1k/10k used the two component-row placements above,
five warmups and 25 samples per side for update, swap and reverse, with text,
class, order and identity checks outside timing. At 10k, update medians were
6.2 → 6.4 ms and 5.5 → 5.6 ms; swaps were 4.9 → 4.2 ms and 4.5 → 5.3 ms;
reverse was 20.0 → 21.2 ms and 18.3 → 18.4 ms. The results were mixed and did
not improve partial updates. The prototype and its tests were removed; no
props-reuse flag or compiler shortcut remains.

## Bounded owner-list updates

The closed-record proof now admits canonical increasing loops over
component-owned fixed literal arrays: a `let` counter starts at a nonnegative
safe integer literal, the condition uses `<` with the collection length or a
bounded integer literal, and the counter advances through `++` or positive
integer-literal `+=`. Other counter writes, dynamic/invalid bounds, collection
escapes, cross-row reads, key mutations and opaque values retain full replay.
The same lexical proof is shared between collection analysis and handler
instrumentation; a local shadow cannot borrow an enclosing collection's proof.
Executed writes use the existing owner key journal. No runtime graph, new
intrinsic or method-name purity rule was added. Module dynamic-index writes
still use ordinary routing.

Two earlier proof restrictions were also corrected: quoted string field names
on plain literal records are accepted, and a field on the left of arithmetic
or a comparison is treated as a read rather than an assignment. Actual writes,
including wrapped destructuring and loop targets, still prevent a read-only
row-item proof. The first measurement probe exposed the arithmetic restriction:
both its outputs retained broad replay, so those timings do not measure this
optimization. It was corrected and regenerated before the comparison below.

A self-contained paired production Chromium fixture compiled identical 1k/10k
literal-record apps with compiler source at `8acb876` and this change, using
the same runtime. Five warmups preceded 25 alternating samples per side,
updating every tenth label in an existing list. Every row's text, empty class,
order, count and retained identity were checked after each sample outside
timing. The regenerated output was checked for executed-write key journals.

| Rows | Row form | Before / after median ms |
| --- | --- | --- |
| 1,000 | Inline | 0.5 / 0.4 |
| 1,000 | Component | 0.6 / 0.4 |
| 10,000 | Inline | 3.0 / 2.5 |
| 10,000 | Component | 2.9 / 2.5 |

These are local results for closed literals. They do not establish an improvement
in the main DOM/Octane suites, whose opaque producers still lack this proof.
Their regenerated DOM output remains unchanged. Broad opaque partial updates,
producer proofs, module dynamic targeting and structural work remain open.

A separate browser comparison reproduced an existing block-shadowing bug:
before the fix, a foreign proxy receiver was read twice and its setter left
a sibling output at `0`; afterward the receiver is read once and the output
becomes `1`. Owner rows remain unchanged. The handler now checks its actual
lexical scope before adding owner keys or making extra plain-field reads.

The compiler build, lint and 64 focused regressions passed. The tests cover
inline/component rows with synchronous/deferred schedulers, conditional skips,
mixed broad/targeted batches, arithmetic reads, unsafe loops, opaque receivers
and assignment patterns. The DOM suite passed all nine variants, including
identity and mixed-sequence gates. The pinned Octane harness was not rerun for
this compiler-only extension; no dependency versions or benchmark adapters
changed. Bundle work remains deferred.

## Fresh local literal factories

The closed-record proof now follows stable local synchronous factories that
only return a fresh array literal. It accepts function declarations and `const`
function/arrow expressions, simple unmodified parameters and primitive literal
arguments. Record fields can combine those parameters and literals through `+`,
templates or primitive unary operators. Later writes must independently preserve
the plain-data shape. Module fixed-position writes and owner bounded-loop writes
then use their existing targeting paths.

Imported/opaque calls, mutable factories, shared returned arrays, extra statements,
default/rest/destructured parameters, async/generator functions, getters, spreads,
nested values, captured field values and opaque later writes remain unproven.
The existing escape, immutable-key and cross-row-read checks still apply. No
method-name purity rule, runtime graph, dependency change or new intrinsic was
introduced. General array constructors and loop-built producers remain open;
the main DOM/Octane generators do not gain targeting from this extension.

A paired local production Chromium check compiled identical fresh-factory apps
against `2054005` and this change with the same runtime. Five warmups preceded
25 alternating samples per side, updating every tenth label. Every row's text,
class, count, order and retained node identity were checked outside timing after
each sample. The baseline output was broad and the new output journaled actual
executed keys.

| Rows | Row form | Before / after median ms |
| --- | --- | --- |
| 1,000 | Inline | 0.7 / 0.5 |
| 1,000 | Component | 0.7 / 0.5 |
| 10,000 | Inline | 3.3 / 2.8 |
| 10,000 | Component | 3.2 / 2.7 |

These are local measurements of this proof extension, not main-suite VM results.
The compiler build, lint and 112 focused tests passed. New self-contained fixtures
check inline/component rows, synchronous/deferred scheduling, independent owner
instances, two module-state list readers, retained identity and unsafe factory
fallbacks. Generated tests do not read examples. Main DOM outputs were regenerated
through the compiler; their identity and mixed-operation gates cover nine variants.
The pinned Octane harness is unchanged. Bundle work remains deferred.

## General reconciliation keeps retained keys

General frames now keep retained records in their live Map and mark consumed
records with a private frame identity. The marker replaces deleting and inserting
every retained key, detects duplicates before replay, and preserves SameValueZero
key identity. Ordered records still supply prior positions and lifecycle order;
authored keys and retained updates keep their forward interleaving. Fresh records
are staged separately until commit. Fresh mounting and complete replacement adopt
that staged Map without inserting the complete fresh batch a second time.

Consumed keys remain unavailable to in-frame `refreshKey()`, and `size()` exposes
the remaining old entries, matching the previous general-frame behavior. General
removal hooks can still refresh an earlier removed key until every hook completes.
Removed keys are deleted after those hooks. Successful disposal follows current
row order; interrupted general disposal deduplicates entries across buffers.
Hydration, ordinary row updates, index-sensitive structural updates, key validation
and setter/proxy fallback are unchanged.

This also fixes ownership after a retained prop update or render throws. The old
path deleted the record before its update and inserted it into the next Map only
after success, losing that row on failure. A three-row production-browser probe
against `793b9f3` disposed rows `[1,3]` and left one node; this change disposes
`[1,2,3]` and leaves none. Tests also check registered entity cleanup, repeated
disposal, throwing key/factory paths and placement failure after removals. This is
not transactional reconciliation or rollback of authored effects.

A direct 10k-row operation check, using identical before/after row factories,
measured Map operations as follows:

| Path | Before / after Map insertions | Before / after Map deletions |
| --- | --- | --- |
| Fresh mount | 10,000 / 10,000 | 0 / 0 |
| Immutable content update | 10,000 / 0 | 10,000 / 0 |
| Sparse swap | 10,000 / 0 | 10,000 / 0 |

Both content update and swap still evaluated all 10,000 authored keys and all
10,000 retained updates. This removes bookkeeping rather than assuming producer
purity or skipping opaque reads. The earlier compiler-only literal-factory work
does not explain these gains; this change applies to general runtime replay.

A paired local production Chromium comparison compiled the actual Octane adapter
through the compiler and bundled the same output with runtime `793b9f3` and this
change. No compiled code was manually edited. Three warmups preceded 15 alternating
samples per side; each sample rebuilt an equivalent list outside timing and selected
row 500 before the operation. The deterministic random stream was the same for both
bundles. Text, classes, count, order and retained node identity were checked outside
timing after every operation; middle insertion also checked its new rows.

| Rows | Operation | Before / after median ms |
| --- | --- | --- |
| 1,000 | Immutable update every tenth row | 0.7 / 0.6 |
| 1,000 | Swap | 0.5 / 0.5 |
| 1,000 | Rotate last row to front | 0.7 / 0.7 |
| 1,000 | Insert 100 rows at middle | 2.0 / 2.0 |
| 1,000 | Clear control | 2.8 / 2.6 |
| 10,000 | Immutable update every tenth row | 7.8 / 3.8 |
| 10,000 | Swap | 4.9 / 2.8 |
| 10,000 | Rotate last row to front | 8.8 / 6.2 |
| 10,000 | Insert 100 rows at middle | 6.7 / 4.7 |
| 10,000 | Clear control | 22.4 / 21.2 |

These are focused local click-to-completion timings, not the upstream harness's
full VM results. An earlier prototype comparison had mixed 1k middle-insert results,
and another run overlapped regression testing; neither supplies the final table.
The small 1k differences and clear control do not establish a reliable improvement.
The VM still needs to confirm scaling across all state placements and frameworks.

The runtime build, lint and 97 focused regressions passed. These include every
six-row permutation with an independent minimum-move oracle, mixed additions and
removals, SameValueZero, in-frame refresh/size observations, removal-hook effects,
retained identity, selective reasons, exception ownership and hydration.
The regenerated DOM suite passed all 21 scenarios across nine variants, including
identity and mixed-operation gates. The memoized-dom target passed the pinned
Octane canonical and reorder smoke checks. Its first reorder navigation timed out
before tests; a sequential retry passed both suites. Smoke timings are correctness
checks here, not evidence of relative framework performance. The upstream pin,
dependencies, authored adapters and stored VM timing reports remain unchanged.
Bundle work remains deferred.

## Registered leaf teardown and registry visibility

Entity removal now takes a direct path when the registered entity has no child
links. It skips the stack, teardown list and their iteration/reversal. Nested
owners retain the original traversal and descendant-first cleanup order, including
the authored child-link getter reads. Kernel error collection and owner-cleanup
hooks allocate error arrays only after an actual failure. All hooks still run,
with owner callbacks in reverse registration order; multiple errors retain their
ordered aggregate and a single error is thrown unchanged.

Registry-cache invalidation also moves before removal notifications and user
cleanup. Three regressions reproduced stale `registeredIds()` snapshots inside
leaf cleanup, subtree cleanup and per-removal notifications. Removed entities had
already left the Map, but the ID cache and generation still represented the prior
registry. The generation now advances before those callbacks, and every removal
invalidates the ID cache before notification, including when an earlier listener
repopulated it. Old returned snapshots are not rewritten. A production-browser
probe against `adeb2c4` saw `['LeafProbe']` during that leaf's cleanup; the new path
sees `[]`.

A direct 10k-leaf operation check measured **10,000 → 0** teardown-array pushes
and **10,000 → 0** teardown reversals, with no entities left registered. These
counters measure traversal bookkeeping, not allocated-byte totals. No hooks,
registered children, refs, effects or dirty-state cancellation are skipped.

A self-contained production Chromium fixture compiled component-owned lists with
registered component rows, each owning one `$cleanup` callback. Identical generated
output was bundled with runtime `adeb2c4` and the combined kernel/cleanup change.
Three warmups preceded 15 alternating samples per side. Node and registry counts,
disposal counts, text/classes, new-key order and replacement identity were checked
outside timing after every operation. The local comparison measured:

| Rows | Operation | Before / after median ms |
| --- | --- | --- |
| 1,000 | Clear registered cleanup rows | 5.5 / 4.4 |
| 1,000 | Replace registered cleanup rows | 17.5 / 16.8 |
| 1,000 | Fresh creation control | 9.2 / 8.7 |
| 10,000 | Clear registered cleanup rows | 32.6 / 24.0 |
| 10,000 | Replace registered cleanup rows | 162.8 / 151.8 |
| 10,000 | Fresh creation control | 96.2 / 115.9 |

The creation control does not exercise the changed teardown path. Its slower
10k result prompted an isolated repeat with five warmups and 25 alternating
samples: **14.1 / 13.5 ms at 1k** and **94.2 / 93.0 ms at 10k**. A kernel-only
prototype also measured clear at **6.3 / 5.1 ms at 1k** and **33.9 / 30.0 ms at
10k**, but replacement and creation were mixed. These local controls do not
establish a creation improvement or a consistent creation regression; replacement
is also variable. The measured claim is registered-row teardown, with allocation
work removed directly and successful cleanup counts verified. These fixtures are
not the main DOM/Octane timing matrix or VM results.

Most current main DOM/Octane rows already use entries with no registered entity.
This optimization targets registered component ownership and fixes registry
visibility generally; it does not establish a main-suite row-clear speedup.
Creation, replacement and lightweight-row teardown remain open.

The runtime build, lint and 75 focused checks passed, including the eight new
self-contained kernel tests, lifecycle ownership, replacement registration during
cleanup, pending/volatile cancellation, hook iterator semantics, refs, effects,
hydration recovery and application-runtime isolation. Regenerated DOM output passed
all 21 scenarios across nine variants, including retained identity and mixed
operations. The pinned Octane canonical and reorder smoke checks also passed;
their timings are correctness gates, not comparative measurements. Dependencies,
the pinned upstream benchmark and intrinsic syntax remain unchanged. Bundle work
is deferred.

## VM checkpoint: adeb2c4

The user's full VM report measured `adeb2c4f6ee1c998d6d40843302890c1a3bafad4`
on an AMD EPYC 9V74 host with Chromium 153. All 21 DOM scenarios across nine
variants, both full Octane suites and retained-node checks passed. This run predates
the registered-leaf teardown change above. The preceding `581b40f` run used an
Intel Xeon host, so historical ratios do not isolate commit improvements.

Across the four DOM state placements at 10k rows, selection measured 0.1 ms for
both row shapes. Component/inline creation ranged from 11.4 to 14.0 ms against
vanilla's 8.1 ms; replacement ranged from 14.7 to 16.3 ms against 9.3 ms.
Partial updates ranged from 1.1 to 1.6 ms against 0.3 ms, and clear ranged from
2.2 to 2.5 ms against 0.6 ms. Conservative row replay for opaque data producers,
creation/replacement and lightweight-row disposal therefore remain relevant.

In the pinned Octane canonical suite, memoized-dom measured 0.4 ms for partial
update and 0.1 ms for selection, while 10k creation measured 47.3 ms against
38.8 ms for Ripple and 39.7 ms for Solid. The reorder matrix measured reverse at
2.825 ms against 2.125/2.150 ms for those adapters. Displacement workloads remain
a concrete candidate: memoized-dom measured 0.275–0.430 ms for displacing 3–8
rows, compared with Ripple's 0.100–0.130 ms. These are results for the authored
workloads, with validation outside timing, not universal framework rankings.
Near-zero selection timings approach browser timer resolution.

The report also exposed a clean workspace build failure: the root script built
`utils` before its `data` dependency. The build order now follows runtime → data
→ utils before their consumers. After clearing all ten packages' generated
distributions with their guarded clean scripts, the full root build passed.
No dependency versions or upstream benchmark source changed. The optimization
backlog retains its priorities, and bundle-size investigation remains deferred.

## Discarded: lazy staging of matching list keys

The main DOM partial-update handlers cannot use the current closed plain-record
proof: their initially empty lists are replaced with imported producer output and
also undergo arbitrary replacement/structural operations. Narrowing row writes
there still requires a stronger producer/escape proof. A cheaper conservative
runtime experiment instead deferred staging evaluated keys until the first key
mismatch, copying the already matched prefix from private ordered records.
Every authored key and row update still ran, with the existing fallback ordering.

A separate instrumented probe showed 10,000 → 0 scratch-key writes for a 10k
partial update in all eight compiled DOM variants. That removed bookkeeping but
did not establish better operation time. Two paired runs were mixed; a version
with a simpler matching-key branch was also mixed and repeatedly a little slower
in some variants. The final local 10k update comparison against `2c17863` was:

| State / rows | Before / trial median ms |
| --- | --- |
| Module / component | 5.2 / 4.7 |
| Module / inline | 3.7 / 3.7 |
| Component / component | 3.9 / 3.6 |
| Component / inline | 3.3 / 3.6 |
| Module data, component selection / component | 3.7 / 3.8 |
| Module data, component selection / inline | 3.1 / 3.3 |
| Component data, module selection / component | 3.6 / 3.7 |
| Component data, module selection / inline | 3.2 / 3.4 |

Identical compiler-generated apps used separate before/after runtimes, synchronous
scheduling, five warmups and 25 alternating samples at 1k and 10k. Each list was
selected at row 500 and updated repeatedly; full text, class, order/count and
retained identity were checked after each sample outside timing. These focused
local measurements differ from the VM matrix's reset-per-sample workload.

The trial passed 101 focused tests and all nine DOM variants' 21-scenario,
identity and mixed-operation gates, but the runtime change was discarded. The
original staging loop remains unchanged. Three self-contained regression cases
are retained for late key changes, key-before-update ordering and throwing keys;
all 13 key-evaluation tests passed again against the unchanged runtime. Existing
tests also cover key-induced length changes and SameValueZero identities.
Dependency versions, the upstream benchmark pin and generated outputs are
unchanged. No VM rerun is needed to evaluate a discarded implementation.

An additional local Chromium sampling profile used the unchanged runtime and
fresh production-generated apps across all eight variants. Each 10k list had
row 500 selected, three untimed partial-update warmups and a batch of 40 partial
updates under the synchronous scheduler. Profiling stopped before full text,
class, count/order and identity validation. Raw profiles remain local diagnostic
artifacts. The bundle preserved function names without minification; profiler
overhead and the repeated-update workload make it unsuitable for timing claims.

The row update closures were the largest named JavaScript leaf functions in
all eight profiles. Reconciliation also took samples, while prop forwarding and
dispatch took smaller named leaf counts. Program/idle and GC samples prevent a
precise attribution of total operation time from these profiles. This supports
investigating conservative row emission and producer/alias proofs next, rather
than assuming scratch-key writes dominate. It does not prove any emitted read,
getter or unknown call can be skipped.

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
