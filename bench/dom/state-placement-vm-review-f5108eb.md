# User-reported VM review of `f5108eb`

Relevant findings from `virtual-run-results.md`, supplied by the user. This run
predates `f334fb3` (reorder-window trimming) and the lightweight-inline pass.
Existing local JSON and timing reports are unchanged.

Linux VM: AMD EPYC 9V74, nine visible logical CPUs, eight CPU equivalents of
quota, 8 GiB memory; Bun 1.4.2, Node 24.19.0, HeadlessChrome 153.0.8010.0.
Suites ran sequentially. Build and 33 focused regressions passed. DOM results
use synchronous scheduling, seven samples and untimed validation, excluding
paint. All nine variants passed 21 scenarios, retained-node identity and mixed
selection/reverse/remove-selected/append checks. Historical runs are not
controlled comparisons of individual commits.

## Relevant 10k-row results

Milliseconds, medians. C/I means component/inline rows.

| Operation | Both module C/I | Both component C/I | Module data, component selection C/I | Component data, module selection C/I | Vanilla |
|---|---|---|---|---|---|
| Update every tenth row | 2.5 / 5.0 | 0.9 / 0.9 | 2.8 / 4.8 | 0.8 / 1.0 | 0.4 |
| Select | 0.1 / 0.1 | 0.1 / 0.1 | 0.1 / 0.1 | 0.1 / 0.1 | 0.1 |
| Swap | 3.9 / 6.4 | 3.8 / 5.6 | 4.8 / 6.2 | 4.1 / 6.7 | 0.0 |
| Create | 13.3 / 27.1 | 15.5 / 24.8 | 12.3 / 28.5 | 12.2 / 36.8 | 8.1 |
| Replace | 15.7 / 30.8 | 22.8 / 33.6 | 14.9 / 37.9 | 15.6 / 39.8 | 9.6 |
| Clear | 2.5 / 4.6 | 2.5 / 4.6 | 2.5 / 4.5 | 2.5 / 4.5 | 0.6 |
| Append 1k | 3.6 / 5.5 | 4.2 / 4.9 | 3.8 / 4.9 | 3.9 / 5.8 | 1.0 |
| Reverse | 7.6 / 8.5 | 8.5 / 8.7 | 8.7 / 8.9 | 7.8 / 8.2 | 4.3 |

Selection targeting is reflected across state placements. Values near zero
approach timer precision. Module-data partial updates and inline creation,
replacement and clearing remain actionable gaps. Component-owned swaps are
closer to module-owned swaps than in the earlier report; this does not isolate
the contribution of any one change.

## Other suites: limits on conclusions

- Framework reactive rename at 1k rows: memoized DOM 80 microseconds, React
  1,030, Solid/Vue 10. Expected mutation counts passed. Scheduler and adapter
  work differ, so these numbers do not establish equal work or universal speed.
- Application at 1k: load 5.5 ms versus vanilla 5.4; search 2.1 versus 0.9;
  organize 2.2 versus 3.2; bulk action 0.8 versus 2.1. Investigate search only
  after the more distinct DOM list gaps.
- Smoothness at 1k: memoized DOM CPU median 0.7 ms, p95 1.1 ms, no dropped
  frames or long tasks. Similar frame pacing across implementations does not
  establish large-list throughput.
- Related/unrelated local-derived timings alone do not prove that unrelated
  derivations replay. Count evaluations before proposing a change there.
- Invalidation prototypes omit scheduler, routing and DOM work; their speedups
  cannot be presented as application speedups.

Bundle-size investigation is deferred at the user's request. The rest of the
general report is retained by the user; this summary selects performance work
relevant to the current compiler/runtime fixes.

## Subsequent correctness correction

The later journal-fallback pass reproduces stale sibling rows after a proxy
setter and an extra receiver read in the owner-local key journal. Opaque-produced
collections now keep broad fallback; only closed plain records support targeted
content writes. The VM inputs produced ordinary records and passed their gates,
but the older owner-local partial-update advantage does not measure this restored
fallback. Re-run the matrix on the corrected compiler before comparing ownership
performance. Conditional writes to proven module lists can still target one row;
cross-row helper captures and opaque methods retain general replay.
