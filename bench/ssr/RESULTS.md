# HTTP SSR and retained leaf writer — local experiment

Branch baseline: `be56dfa` (`feat/ssr-layer-improvements`), with the uncommitted
benchmark/prototype changes described here. Run date: 2026-10-02. These are
local measurements; raw JSON records runtime versions and host hardware.

## Phase 6: HTTP path

The full matrix passed **4,050 measured request gates** across three rounds
and 13 scenarios, plus warmups. Reader cancellation, request disconnect,
soft timeout, hard deadline, and routed redirects had their expected outcomes.
Concurrent routed requests retained their own locals. Request-owned signals
were aborted after cancellation/deadline/timeout disposal.

The delayed feed's stream TTFB medians across rounds were 1.86, 1.21, and
0.83ms; first application bytes arrived at 38.64, 35.33, and 61.79ms. Buffered
TTFB medians were 41.07, 45.76, and 38.56ms. This confirms the early-head
contract; it does not establish faster ready-to-use content in every round.

Routed preparation with 30ms simulated service delay had TTFB medians of
94.33, 75.29, and 67.07ms under 20-way concurrency. CPU scheduling, timer
delay, and contention materially affect these numbers. The static table's
head and application bytes arrive together because synchronous mount work
runs before the event loop can return the response.

Memory figures are sampled heap/RSS growth, with the limitations in the
README. Slow consumers retain the atomic application body. No bounded-memory
network streaming claim follows from this benchmark.

Raw data: `dist/http-results.json`.

## Next bet: compiler leaf writer

Two independent paired-batch runs each used 12 alternating rounds and 20
renders per batch, after 30 warmups per variant. Exact plain and marked HTML
parity was required before timing.

| Fixture / marker policy | First run baseline → writer (ms) | Second run baseline → writer (ms) |
| --- | --- | --- |
| 1,000-row table, plain | 52.80 → 24.27 | 16.41 → 8.28 |
| 1,000-row table, marked | 22.65 → 12.74 | 11.52 → 5.11 |
| Four-card dashboard, plain | 1.64 → 2.01 | 0.34 → 0.62 |
| Four-card dashboard, marked | 0.34 → 0.30 | 0.43 → 0.30 |

The large absolute differences between runs show host/process noise. The
table improvement repeats; small-dashboard behavior is mixed, including a
plain-output regression. Sub-millisecond ratios warrant particular caution.

The table retained output graph shrinks from **8,015 to 2,015 nodes/extents**.
This removes 6,000 interior server nodes while retaining structural comments
and list identity. The dashboard shrinks from 37 to 21. These are retained
graph counts, not total allocation or peak-memory counts.

Unminified emitted module size rises from 4,249 to 5,610 bytes for the table
and 4,655 to 5,555 bytes for the dashboard. The opt-in module retains its DOM
fallback, so this code-size cost is real and must remain part of the decision.

The writer-enabled table HTTP run passed another **390 request gates** across
stream, buffer, and slow-consumer scenarios. Its stream TTFB medians were
11.55, 3.96, and 4.94ms; buffer medians were 9.38, 4.67, and 4.41ms. That run
was a separate process later than the baseline, so it is an integration and
correctness check, not a controlled HTTP speedup ratio.

Raw data: `dist/writer-results-run1.json`, `dist/writer-results.json`, and
`dist/http-writer-results.json`.

## Decision

Keep `ssrWriter` **opt-in**. It removes demonstrable work from repeated leaf
rows and is worth pursuing for large eligible lists. The current evidence
does not justify enabling it for every component or replacing the string
tier. Next checks should include imported row components, additional runtimes,
and paired HTTP runs under steady host load. Extend the proof only when a
specific unsupported operation has meaningful measured cost.
