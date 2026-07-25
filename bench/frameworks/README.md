<!-- Documents the isolated current-framework state-update benchmark. -->
# Current Framework Updates

This suite measures update-completion latency in isolated production bundles.
It is not a pure DOM reconciler benchmark: the reactive track includes each
framework's state mechanism and scheduler.

The adapters use their normal authored formats (`.tsx`, `.vue`, `.svelte`, and
Angular templates). Each sample runs deterministic no-change, rename, toggle,
and keyed-move operations at 10, 100, and 1,000 rows.
After every sample, an independent model verifies every rendered title,
completed class, stable-ID order, row count, and derived remaining count.

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

## Latest 100-Row Results

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

These are machine-local scenario numbers, not general framework rankings.
Direct Vanilla patches and framework render/update paths do different amounts
of work; compare tracks and scenarios with that limitation in mind.
