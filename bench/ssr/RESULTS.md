# HTTP SSR and retained leaf writer — local experiment

## Integration into main — 2026-10-04

The SSR branch was integrated onto `242ac21`, preserving the newer initial
HTML composition bindings and root factory metadata. All renderer entries use
the same request-owned `RenderSession`; LinkeDOM is confined to the `/dom`
oracle entry. The retained leaf writer remains opt-in, consumes the existing
lowered creation/update plan, and excludes initial HTML binding factories.
Document composition releases its body reader on completion, failure and
cancellation. Older branch fixtures now use `$effect` and `$cleanup`.

Local `bun run bench:ssr`, before versus after integration:

| Scenario | Before SSR ms | After SSR ms | Before hydrate ms | After hydrate ms |
| --- | ---: | ---: | ---: | ---: |
| 1,000 keyed rows | 56.035 | 6.391 | 38.971 | 38.047 |
| Dashboard | 0.353 | 0.434 | 0.867 | 1.008 |

HTML sizes were unchanged: table 62,845 bytes (89,797 marked), dashboard
376 bytes (587 marked). These are single local benchmark runs on a noisy
laptop, not VM results or a general speed guarantee.

Verification: full package build, 79 server tests, 110 root tests covering
SSR isolation, settlement, hydration, composition and data. The quick HTTP
matrix passed 180 request gates across 15 scenarios, including cancellation,
disconnects, deadlines, redirects and concurrent preparation. A two-round
writer comparison checked exact HTML parity with and without markers for
both fixtures; it reduced retained table nodes from 8,015 to 2,015. It adds
emitted code, so it is still an experiment rather than the default backend.

## Original branch measurements

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

Historical raw data: `dist/http-results-pre-main.json`.

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

First paired run raw data: `dist/writer-results-run1.json`. Historical HTTP
writer data: `dist/http-writer-results-pre-main.json`. Current
`dist/writer-results.json` contains the latest post-merge profile below.

## Decision

Keep `ssrWriter` **opt-in**. It removes demonstrable work from repeated leaf
rows and is worth pursuing for large eligible lists. The current evidence
does not justify enabling it for every component or replacing the string
tier. Next checks should include imported row components, additional runtimes,
and paired HTTP runs under steady host load. Extend the proof only when a
specific unsupported operation has meaningful measured cost.

## After syncing current main

Merged `origin/main` at `842bf78` into this branch (`4bad02f`), then committed
the opt-in prototype and harness at `0c5d7dc`. The following measurements
include the subsequent immutable literal-class folding improvement.
Builds/tests finished before the performance runs; other host load was not
controlled. Bun 1.4.0, Windows x64; the committed
[`results/2026-10-02-summary.json`](results/2026-10-02-summary.json) records
hardware/runtime metadata, every HTTP round pair, diagnostic medians, and
live-session heap probes.

### Paired HTTP evidence

Six rounds alternated baseline/writer order within each scenario, in one
process, using identical module identities. All **6,360 measured requests**
passed status/outcome/byte-count/full-response SHA-256 parity, including the
hydration payload. Each cell below is the median across the six round
summaries. Completion uses round p50s; CPU uses round CPU per request and
includes validation, response hashing, and memory sampling.

| Scenario | Completion baseline → writer (ms) | CPU baseline → writer (ms/request) |
| --- | --- | --- |
| Table stream | 5.76 → 3.57 | 13.08 → 7.61 |
| Table buffer | 6.56 → 4.27 | 13.10 → 7.23 |
| Table slow consumer | 114.24 → 84.66 | 14.22 → 8.74 |
| Dashboard stream | 0.459 → 0.546 | 0.783 → 0.898 |
| Dashboard buffer | 0.578 → 0.667 | 0.823 → 1.090 |

Table buffer completion improved in all six paired rounds; table stream and
slow-consumer completion improved in five. The stream's last pair and one
slow-consumer pair regressed, so a blanket latency guarantee is unjustified.
The small dashboard regresses in the HTTP aggregates despite isolated render
results below. This is material evidence against default activation, not a
reason to discard the HTTP path or report only favorable microbenchmarks.
Sampled HTTP heap/RSS growth does not show a stable reduction; it is not a
live retained-memory measure. Raw data: `dist/http-paired-results.json`.

### Dashboard investigation and bounded improvement

Generated code showed a constant `class="card"` normalized during every row
creation and escaped during serialization. The compiler now folds only a
proven single literal class write with no updater write. Whitespace trimming,
empty-class omission, escaping, and output order have parity tests. Dynamic
classes retain their existing snapshots. This removes 96 emitted bytes;
dashboard modules are now 4,743 baseline / 5,547 writer bytes (+804).

Two separate post-fold runs used 200 warmups, 12 alternating paired rounds,
and 200 renders per batch:

| Marker policy | Run 1 baseline → writer (ms) | Run 2 baseline → writer (ms) |
| --- | --- | --- |
| Plain | 0.231 → 0.228 | 0.537 → 0.351 |
| Marked | 0.148 → 0.144 | 0.329 → 0.316 |

These do not prove that class folding fixes the HTTP regression: the
pre-fold diagnostic pass overlapped tests, so it is excluded from timing
comparisons. Separate stage probes show the dashboard has very little
serialization work (roughly 8–21µs in these runs); request-session creation
and disposal contribute substantially. Total timings and mount stages vary
between runs. Optimize the measured cost rather than choosing a runtime row
threshold from these fixtures.

Raw data: `dist/writer-dashboard-after-fold-run1.json` and
`dist/writer-dashboard-after-fold-run2.json`.

### Live-session memory and larger fixture profile

A separate table run used 100 warmups, 12 rounds, and 40 renders per batch.
Plain render medians were **7.98 → 3.90ms**; marked **10.94 → 5.70ms**.
Independent plain-output stage medians were mount **4.22 → 2.05ms**,
serialize **1.97 → 0.95ms**, and dispose **0.86 → 0.48ms**. The writer removes
work at several stages, not only at final string concatenation.

Three alternating forced-GC probes held 12 live table sessions and roots,
before serialization. Incremental heap medians per session were about
**1,693,080 → 1,035,753 bytes** (plain), with essentially the same marked
result: roughly **39% less retained heap** for this fixture/runtime. These
include request runtimes and row closures, exclude response strings, and do
not establish HTTP peak/RSS or a leak guarantee. Dashboard probes held 100
sessions: baseline medians were about 19.8KB/session, writer 16.2–18.1KB.

Retained graph counts remain **8,015 → 2,015** for the table and **37 → 21**
for the dashboard. Table emitted code is 4,294 / 5,655 bytes (+1,361).

### Correctness and next decision

The imported-row gate now covers request-owned state in both the list owner
and row module, concurrent mounting before mutations, same-key replacement,
insertion/reordering, and exact HTML/payload parity. The server suite passed
71 tests after the main merge; the expanded writer suite subsequently passed
16 tests. Another 109 selected root SSR/runtime tests passed. Both HTTP
variants passed 180-request smoke matrices spanning 15 scenarios. Compiler,
runtime, and server builds and changed-file lint passed. Workspace typecheck
still reports the existing `EventTarget.reset` error in
`examples/simple/App.tsx:45`.

Keep the writer opt-in. The next architecture experiment should compare
separately emitted server factories against the current dual-path factories,
preserving these oracle/parity gates and measuring small-app HTTP cost. The
present evidence supports large repeated leaf lists and lower retained
session heap; it does not support replacing the default string tier.
