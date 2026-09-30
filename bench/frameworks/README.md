<!-- Documents the isolated current-framework state-update benchmark. -->
# Reconciliation Updates

This suite measures update-completion latency in isolated production bundles.
It is not a pure DOM reconciler benchmark: the reactive track includes each
framework's state mechanism and scheduler.

This is intentionally a narrow reconciliation workload. See
[`application/`](./application/) for structured state-to-DOM workflows with
nested views, derived summaries, filtering, navigation, and detail content.

The adapters use their normal authored formats (`.tsx`, `.vue`, `.svelte`, and
Angular templates). Each sample runs deterministic no-change, rename, toggle,
and keyed-move operations at 10, 100, and 1,000 rows.
Before timing each mode/count/scenario, an untimed pass verifies every rendered
title, completed class, stable-ID order, row count, and derived remaining count
after **each operation**, including the initial view. Each adapter's completion
signal is awaited before inspection. Every timed sample also validates its final
DOM. Inspection is outside the timed interval.

- `forced`: mutate the model and explicitly request an update.
- `reactive`: update through the adapter's normal reactive path.
- Results are five-sample medians from one local Chromium process.
- `latest.json` contains timings, observed DOM mutation records, configuration,
  browser identity, and production bundle sizes.

Run:

```sh
cd bench/frameworks
bun install
bun run run
```

## Recorded 100-Row Baseline

Median microseconds per completed operation on 2026-07-25; lower is better.

| Adapter | Forced no-change | Forced rename | Forced toggle | Forced move | Reactive no-change | Reactive rename | Reactive toggle | Reactive move |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Vanilla DOM | 1264 | 1046 | 960 | 1082 | 2 | 6 | 8 | 12 |
| memoized-dom TSX | 38 | 32 | 28 | 84 | 34 | 46 | 56 | 120 |
| Solid 1.9.14 | 160 | 204 | 160 | 174 | 6 | 14 | 114 | 608 |
| Svelte 5.56.8 | 116 | 104 | 232 | 206 | 50 | 68 | 154 | 1066 |
| Vue 3.5.40 | 926 | 1116 | 1382 | 1490 | 236 | 66 | 566 | 1284 |
| Preact 10.29.7 | 1806 | 1798 | 1762 | 1882 | 464 | 552 | 678 | 640 |
| React 19.2.8 | 184 | 222 | 260 | 326 | 592 | 448 | 798 | 1026 |

Angular builds through its production AOT/linker path but was excluded from
this recorded run. Imba is not included.

The current `latest.json` records a 2026-09-30 run with all eight adapters,
including Angular, passing the per-operation correctness pass in both modes
at every list size. The table above retains the earlier baseline; use the JSON
for the current machine-local measurements.

These are machine-local scenario numbers, not general framework rankings.
Direct Vanilla patches and framework render/update paths do different amounts
of work; compare tracks and scenarios with that limitation in mind.

## Comparing the tracks

Reactive timings include each adapter's authored state mechanism, snapshot
updates, scheduling, and completion signal. Memoized DOM mutates its existing
snapshot; React creates an immutable snapshot and confirms the rendered commit
with a layout effect. Those are different update paths with the same checked
view. Matching DOM mutation counts describe visible writes and do not establish
equal computational work.

Forced updates differ more: React passes a revision through memoized rows, while
the vanilla adapter rebuilds its view. Treat this track as the behavior of these
specific forced adapters. It does not isolate rendering-engine cost.

The per-operation correctness pass catches an intermediate stale view that a
later operation could repair. Timed batches still inspect the endpoint, and
mutation counts cover the timed operations. Very small timings include scheduler
and promise costs and can approach browser timer precision. The larger-list DOM
suite remains a separate workload and an essential check on broad speed claims.
