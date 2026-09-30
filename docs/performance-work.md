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
  Expression evaluation and string conversion still replay.
- String class values skip array allocation during normalization.
- Each resolved reader set is enqueued before scheduling its commit. This
  avoids a separate commit per reader with a synchronous scheduler and lets
  parent reconciliation cancel pending duplicate row renders.
- Linked component callbacks can omit the caller's duplicate row/root refresh
  when every caller supplies a stable component-local callback consisting of
  direct lexical assignments. Missing props, mutable bindings, argument/property
  mutations, opaque calls and deferred work retain the conservative path.
- Adjacent execution sites with identical owner/root completion refreshes share
  one guarded commit. All write flags and setter/proxy fallbacks remain in place.
- Component-owned selection can refresh the previous and next keys over module
  data as well as component data, for direct item-property keys and strict
  equality. Hidden getter/helper/derivation captures retain full replay. Every
  pending dirty cause must be covered by the selective plan; module data writes
  and mixed batches retain reconciliation or proven fixed-position refreshes.
- Reconciliation validates authored keys even when item references and positions
  are unchanged. Failed validation reuses the evaluated keys in its structural
  pass, preserving one evaluation per current item in that case. Identity keys
  retain the reference-only shortcut.

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

## Optimistic forms and benchmark validation

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

The earlier review is not fully addressed. The completed changes above reduce
some costs; the following work remains open. The VM measurements reported by
the user for commit `661d247` are preserved in
`bench/dom/state-placement-vm-review.md`, separately from locally measured JSON.
They passed all nine implementations twice, but the original gates did not
check retained DOM identity or mixed selection/structure sequences.

| Priority | Open issue | Evidence / required next step |
|---|---|---|
| 1 | Broader callback proofs | The benchmark's direct lexical assignment callback is optimized. Opaque calls, argument mutation, mutable targets and deferred work still need stronger proofs; exceptions keep normal-completion semantics. |
| 1 | Slower swaps with component-owned data | Duplicate identical owner/root completion commits are merged and order/identity gates pass. Setter/proxy fallbacks remain; re-measure the full matrix on the VM before judging the remaining gap. |
| 2 | Module-owned selection fanout | Component-owned selection over module data now has a guarded keyed plan. Module-owned selection remains broad for module and component data; preserve key/getter/hidden-read semantics when extending routing. |
| 2 | Structural reconciliation and safe list mutations | Partial content writes can already collect row keys for owner-local data; this does not complete append/truncate/reorder specialization or arbitrary alias handling. |
| 2 | Inline row teardown | VM clearing remains slower for inline rows, especially both-module state. Measure registration, unregister, event disposal and retained heap separately. |
| 3 | Duplicated dynamic initialization/update emission | Check creation order, getter calls, transparent-source reads and hydration before sharing emitted expressions. |
| 3 | Browser runtime size and routing | Browser/server separation, local-only routing, numeric/direct reader dispatch and string-key interning remain candidates. Existing interning estimates were small. |
| 3 | Component template cloning and static registration | Row templates exist; broader component cloning and skipping static entity registration still require proof and measurement. |
| 3 | Slot granularity and opaque pulls | Extend reason gates and restrict volatile evaluation to dependent slots; do not hide required unknown-call refreshes. |
| 4 | SSR client omission and Marko emission ideas | Investigate hydration ownership/markers, per-binding/shared-input updates and region setup; these remain design candidates. |

The DOM matrix now also checks retained node identity after every validated
operation. Untimed 1k/10k sequences select a key, reverse it into the removal
position, remove the selected row, append, and select again. These strengthen
the correctness gate; they do not constitute a performance fix. Use
`state-placement-run.ts --validate-only` after building to check them without
replacing timing results. The existing timing artifact remains the earlier run.

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
