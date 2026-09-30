# DOM List Benchmark

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
preserved rows. Generated rows must have unique ids and nonempty labels; new
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
