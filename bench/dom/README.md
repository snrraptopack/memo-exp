# DOM List Benchmark

## Local comparisons

`bun run bench:dom:compare --before-ref=COMMIT` compiles the same authored DOM
fixtures with an isolated Git snapshot and the current source, then measures
them in before/after/after/before order. All nine variants retain the existing
21-scenario and mixed-sequence correctness gates; every timed sample checks
text, classes, order and retained node identity outside timing. Seven samples
per cell are the default. Production bundles use deterministic input seeds.

```sh
bun run bench:dom:compare --before-ref=e0cd1d5
bun run bench:dom:compare --before-ref=e0cd1d5 --isolate=runtime --operations=swap,remove,reverse --samples=15
bun run bench:dom:compare --before-ref=e0cd1d5 --isolate=compiler --full
```

`--isolate=runtime` uses the current compiler with each runtime;
`--isolate=compiler` uses each compiler with the current runtime. The default
`both` uses the matching compiler and runtime from each revision. Runtime-only
comparison requires compatible generated/runtime APIs. The default timing
selection covers the eleven 10k scenarios; `--full` also times the 1k scenarios.
The current side includes uncommitted source changes, recorded in the metadata.

The runner writes isolated generated files, browser hashes, raw sample arrays
and a comparison report under `dist/compare/`. It does not replace tracked
generated apps or the main timing results. Builds finish before measurement;
each page closes before the next comparison run. Unchanged vanilla remains a
noise control. Local comparisons establish workload evidence, not a VM ranking.

The user's latest VM report for `581b40f` covers two full executions of this
matrix and all ten pinned Octane targets: [VM report](../octane/vm-review-581b40f.md).
All reported gates passed. Across both DOM executions, 10k partial updates
measured 1.3–2.4 ms versus vanilla's 0.3–0.5 ms. The host changed from AMD to
Intel, so comparisons with the [earlier report](../octane/vm-review-1fd4911.md)
do not isolate compiler/runtime changes. Both current matrices are retained.

Run `bun run bench` from the repository root. The build compiles every TSX
variant through the compiler/linker, bundles them with vanilla, and runs the
operations in headless Chromium. Each number is the median of seven samples.
One combined report is saved to [state-placement-results.md](state-placement-results.md),
with raw numbers in `state-placement-latest.json`. Headings distinguish Module
state, Component state, and the two mixed placements.

The additional fixtures, build, browser harness, runner and report writer live
in separate `App*Owned`/`AppModule*` and `state-placement-*` files. The original
three-way benchmark files remain intact; run `bun run bench:dom:module` to run
that harness alone. `bun run bench` runs all placements together in one report.

## Mutable and immutable updates

`bun run bench` also includes a separate comparison of mutable and immutable
partial updates, swaps, appends and removals at 1k and 10k rows. Its 16 compiled
variants cross both update styles with all four state placements and both row
representations. They are generated from authored TSX in `update-style-source.ts`
through the compiler/linker by `update-style-build.ts`. The new browser, runner
and report live in separate `update-style-*` files.

The comparison appears under **Mutable and immutable updates** in the same
`state-placement-results.md`, with its raw results nested in `updateStyles` in
`state-placement-latest.json`. The original nine-variant matrix remains in that
report. To run only the new comparison, use `bun run bench:dom:updates`; its
standalone reports are `dist/update-style/results.md` and `results.json`.

Mutable partial updates change existing labels; immutable partial updates map
a new array and copy only the changed records. Mutable swaps assign two existing
positions; immutable swaps map a new array with the same retained records.
Append uses push/concat and removal uses splice/filter. These authored paths
perform different allocation and iteration work, which is included in timing.
Neither style is assumed to be faster.

Each sample starts from a fresh mounted list, resets a seeded random generator
for matching labels, and selects row 500 before timing. There is one untimed
warmup per operation/variant and seven measured samples, with rotating variant
order. Every sample validates text, order, classes, counts and retained DOM
identity outside timing. Untimed mixed update/swap/remove/append sequences also
check selection after removing the selected key. Lists are cleared and their
owners unregistered after each sample. Timing covers synchronous execution and
DOM writes, without waiting for paint.

After building, `bun run bench/dom/update-style-run.ts --validate-only` checks
the new matrix alone. `bun run bench/dom/state-placement-run.ts --validate-only`
now checks both matrices without overwriting timing reports. A local
`--samples=1` run is a smoke check, not a performance conclusion.

## State placement matrix

| Result prefix | List data | Selection state |
|---|---|---|
| `module` | Module | Module |
| `owner` | List-owning component | List-owning component |
| `module-data` | Module | List-owning component |
| `module-selection` | List-owning component | Module |

Each placement has component-row and inline-row variants: eight compiled
implementations plus vanilla. Owner selection reaches component rows through
a boolean prop and an owner callback; module selection is read/written directly
by the row. These are actual authored state paths, including their prop and
callback costs. Row components do not each own an independent selection state:
that would change the single-selected-row workload.

The suite covers creation, replacement, every-tenth-row updates, first selection,
selection transitions, swapping, removal and clearing at 1k and 10k rows, plus
append/prepend/truncation/reversal/scattered removal at 10k.

Every operation has an untimed correctness pass, and every timed sample is
validated afterward. Checks cover text, classes, keyed order, row counts and
preserved rows, including retained DOM node identity. Untimed 1k/10k sequences
also select, reverse, remove the selected key, append and select again.
Generated rows must have unique ids and nonempty labels; new
creation/replacement must use new ids. Selection moves from row 500 to 501,
checking both classes. Validation and setup are outside the timed interval.
Adapters rotate measurement order, and each measured fixture is cleared after
validation so other variants do not retain large lists during its measurement.

The scheduler is synchronous; timings cover JavaScript and DOM writes, not a
completed browser paint. Vanilla uses direct node references and hand-written
operations. Near-zero timings cannot support precise ratios. The older tables
below used the earlier three-implementation harness and remain historical;
compare placements within the new matrix rather than treating the new run as
an isolated compiler performance change.

After building, `bun run bench/dom/state-placement-run.ts --validate-only`
checks all scenarios and sequences without overwriting timing results. The
committed timing artifact predates the identity/sequence gates. A subsequent
full run records timings with the stronger validation. The user's two VM runs
of `661d247` are recorded separately in
[state-placement-vm-review.md](state-placement-vm-review.md).

## Validated selection runs (2026-09-30)

| Run | Rows | Component rows | Inline rows | Vanilla |
|---|---:|---:|---:|---:|
| 1 | 1k | 1.9 ms | 2.6 ms | 0.1 ms |
| 1 | 10k | 19.8 ms | 39.7 ms | 1.0 ms |
| 2 | 1k | 2.0 ms | 2.7 ms | 0.1 ms |
| 2 | 10k | 19.9 ms | 28.4 ms | 0.5 ms |

The previous 0.5 ms component-row selection result was invalid: the selected
class did not change. The access table routed that write to nonexistent
`Row[*]` entities for lightweight component rows. The compiler now routes it
to the owning list, so the DOM updates; both runs above include that work.
Selection still revisits rows across the list. The 10k results show why
`Row[*]` fanout and owner reconciliation remain a performance priority.

## Cached row text comparison (2026-09-30)

List-row text now compares a normalized string slot before writing `Text.data`.
This removes a DOM text read from every unchanged row replay. Expressions and
string conversion still run, including getters and mutable `toString()` values.
Ordinary component text retains the compact `setTextData` helper.

A focused generated-code comparison used the component-row output from
`a885345` and the new compiler output with a shared current runtime in one
Chromium process. Each round mounted a fresh 10k list, warmed up six selection
transitions, then measured twenty transitions between rows 500 and 501. The
table contains per-round medians; measurement order alternated and the final
classes were validated after every round.

| Run / round | Previous output | Cached row text |
|---|---:|---:|
| 1 / 1 | 18.4 ms | 14.8 ms |
| 1 / 2 | 22.7 ms | 10.2 ms |
| 1 / 3 | 19.0 ms | 14.1 ms |
| 2 / 1 | 24.5 ms | 15.3 ms |
| 2 / 2 | 30.6 ms | 13.7 ms |
| 2 / 3 | 21.5 ms | 15.7 ms |

This improves required broad scans and adds one cached string per dynamic row
text expression. Selection still scans the list. Exact keyed invalidation and
safe list-method specializations need separate proofs; these measurements do
not establish constant-time selection or a general framework ranking.

## Routed-reader batching and combined run (2026-09-30)

Routing now enqueues each complete resolved reader set before scheduling its
commit. Previously the synchronous scheduler committed separately for every
reader, so a wildcard selection incurred one commit per matched row. Deferred
schedulers already coalesced those marks. The new behavior also allows parent
reconciliation to cancel pending row renders after resync.

The DOM suite uses a synchronous scheduler. The framework reconciliation suite
uses synchronous scheduling in forced mode and microtasks in reactive mode;
its workloads and list sizes also differ. Scheduling contributes to the gap,
but does not explain all of it.

The combined row text cache, string class normalization, and batching run passed
the fresh-list selection checks and produced these medians of seven samples:

| Operation | Component rows | Inline rows | Vanilla |
|---|---:|---:|---:|
| Create 1k | 25.1 ms | 36.6 ms | 13.0 ms |
| Update every tenth row in 1k | 2.4 ms | 2.4 ms | 0.3 ms |
| Select in 1k | 1.8 ms | 1.8 ms | 0.2 ms |
| Select in 10k | 12.6 ms | 38.6 ms | 0.8 ms |
| Create 10k | 194.3 ms | 232.0 ms | 113.1 ms |
| Append 1k to 10k | 30.6 ms | 43.1 ms | 8.7 ms |
| Clear 10k | 24.6 ms | 81.7 ms | 4.7 ms |

This is a combined run, not an isolated measurement of batching. Broad row
fanout, owner reconciliation, registration, and teardown still have costs.
See `docs/performance-work.md` for the remaining review and Marko candidates.

These timings vary with browser and machine load. Cases near the timer's
resolution should not support fine-grained percentage claims. Future
optimizations should first preserve the DOM validation and then compare
multiple runs with DOM mutation and heap/GC measurements.

## Focused helper comparison

`bun run bench:dom:compare --before-ref=COMMIT --isolate=compiler --helpers --samples=15`
compares compiler-generated closed owner lists with linked `slice`, `concat` and
`toReversed` helpers using the same runtime. It measures reverse, one-row rotation
and suffix removal at 10k rows in ABBA order. Every sample checks text, classes,
key order and retained DOM identity outside timing; a mixed selection/reverse
gate follows each page. Reset may recreate removed keys, while retained nodes
must survive. Raw samples and both compiler bundles stay under ignored
`dist/compare/`. `--operations=rotate,drop` can restrict this focused comparison.

This isolates helper-summary precision for a closed literal producer. The
general DOM and Octane fixtures use broader producers and need their own proofs
and measurements; these results do not establish gains for those suites.
