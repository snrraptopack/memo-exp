<!-- Documents the isolated current-framework state-update benchmark. -->
# Current Framework Updates

This suite measures update-completion latency in isolated production bundles.
It is not a pure DOM reconciler benchmark: the reactive track includes each
framework's state mechanism and scheduler.

The adapters use their normal authored formats (`.tsx`, `.vue`, `.svelte`, and
Angular templates). Each sample runs deterministic no-change, rename, toggle,
and keyed-move operations at 10, 100, and 1,000 rows.

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
| Vanilla DOM | 1134 | 1178 | 914 | 1018 | 2 | 8 | 14 | 10 |
| memoized-dom TSX | 42 | 36 | 40 | 92 | 38 | 116 | 102 | 104 |
| Solid 1.9.14 | 254 | 324 | 302 | 210 | 14 | 20 | 188 | 848 |
| Svelte 5.56.8 | 72 | 68 | 142 | 124 | 32 | 70 | 220 | 1218 |
| Vue 3.5.40 | 1040 | 1250 | 1046 | 1260 | 158 | 40 | 306 | 1006 |
| Preact 10.29.7 | 900 | 870 | 1012 | 936 | 278 | 390 | 318 | 358 |
| React 19.2.8 | 188 | 180 | 190 | 178 | 322 | 434 | 560 | 650 |

Angular builds through its production AOT/linker path but was excluded from
this recorded run. Imba is not included.

These are machine-local scenario numbers, not general framework rankings.
Direct Vanilla patches and framework render/update paths do different amounts
of work; compare tracks and scenarios with that limitation in mind.
