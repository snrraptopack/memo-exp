# Structured Application Workflows

This suite measures complete state-to-DOM workflows in a deterministic issue
tracker rendered as isolated production bundles. It complements, rather than
replaces, the sibling reconciliation benchmark.

The application includes:

- nested shell, metrics, navigation, list, detail, and report views;
- derived summaries, filtering, searching, sorting, and selection;
- keyed ticket rows and structural view changes;
- narrow and broad state updates over 100 and 1,000 tickets.

Each timed sample starts from a freshly prepared state and performs one
complete operation. Operations are not repeated in a tight loop:

| Scenario | Application work |
|---|---|
| `load` | Load and render the requested ticket dataset |
| `inspect` | Select a ticket and mount its detail panel |
| `triage` | Change status and priority and append activity |
| `search` | Apply a title search and update visible results |
| `organize` | Filter open tickets and sort them by priority |
| `navigate` | Replace the ticket workspace with an ownership report |
| `bulk-update` | Update status and activity for every tenth ticket |

After every sample, an independent model computes the expected metrics,
selection, ticket order/content, and report content. The runner rejects a
sample when the DOM differs. Results include completion latency, mutation
record count, JavaScript heap delta when Chromium exposes it, and production
JavaScript bundle size. Every adapter runs in a fresh Chromium process, and
the persisted timing includes median, 25th percentile, and 75th percentile.

The recorded bundle size is the complete production application payload, not
the size of a framework runtime. For memoized-dom it includes generated
application code, authored model/validation code, and the tree-shaken runtime
closure. The standalone full-surface runtime is measured separately by
`bun run bench:size`; gzip figures from the two suites are not additive.

Initial adapters are Vanilla DOM, memoized-dom, Solid, Svelte, Vue, Preact,
and React. Adapters use their normal reactive update path; there is no
synthetic forced-refresh mode.

Run:

```sh
cd bench/frameworks
bun install
bun run run:application
```

Select adapters with `BENCH_APPLICATION_FRAMEWORKS`, for example:

```sh
BENCH_APPLICATION_FRAMEWORKS=memoized-dom,vanilla bun run run:application
```

## Browser UI

From the repository root, build the production adapters and open the
interactive dashboard:

```sh
bun run bench:application:ui
```

The dashboard has a Run tab with one complete-run button for every framework
and scenario, plus a Results tab for filtering comparisons by source, ticket
count, metric, framework, and scenario. It shows the application currently
being measured and validates every resulting DOM. A completed live run can be
exported in the same JSON structure as `latest.json`. Interactive measurements
are exploratory; use the automated runner for isolated persisted results.

Timings are machine-local medians, not universal framework rankings. This
suite does not claim to reproduce every production concern such as network
latency, hydration, accessibility behavior, or user think time.

## First Baseline

Median milliseconds for 1,000 tickets on 2026-07-30 in Chrome 150; lower is
better:

| Adapter | Load | Inspect | Triage | Search | Organize | Navigate | Bulk update |
|---|---:|---:|---:|---:|---:|---:|---:|
| Vanilla DOM | 47.8 | 2.0 | 1.5 | 8.4 | 25.9 | 3.0 | 34.7 |
| memoized-dom | 59.5 | 2.8 | 2.7 | 10.0 | 10.2 | 4.2 | 3.8 |
| Solid | 53.8 | 6.5 | 5.4 | 11.5 | 18.4 | 8.1 | 11.3 |
| Svelte | 149.4 | 32.3 | 25.9 | 28.3 | 39.0 | 21.2 | 39.9 |
| Vue | 93.9 | 26.2 | 22.2 | 24.1 | 46.6 | 20.7 | 31.7 |
| Preact | 135.0 | 7.8 | 8.2 | 15.2 | 19.0 | 5.7 | 16.2 |
| React | 89.3 | 5.1 | 3.4 | 16.5 | 14.8 | 13.0 | 6.5 |

The complete measurements, timing ranges, mutation records, heap deltas, and
bundle sizes are stored in [`latest.json`](./latest.json).

The upstream js-framework-benchmark is deliberately not vendored here. If
memoized-dom is submitted there later, its canonical keyed implementation and
upstream runner belong in a separate checkout.
