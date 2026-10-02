# SSR experiments

Run from the repository root after building the workspace packages:

```sh
bun run bench:ssr:http
bun run bench:ssr:http --quick --repeats=1
bun run bench:ssr:http --filter=feed --repeats=3
bun run bench:ssr:writer
bun run bench:ssr:http --writer --filter=table
bun run bench:ssr:http --paired --repeats=6
bun run bench:ssr:writer --filter=dashboard --warmups=200 --iterations=200 --stages --retained=100
```

`http.ts` extends the original HTTP harness. It measures the in-process
`serve().fetch(Request)` → `Response.body` reader path. There is no socket,
proxy, TLS, browser parsing, or paint in these numbers. Fixtures are linked
with `compileModules()` before timing. Scenarios execute sequentially; three
rounds alternate their order to reduce consistent warmup/order bias.

The matrix covers a 1,000-row table; delayed data with stream, buffer, shell,
concurrent, timeout, deadline, reader-cancellation, and request-disconnect
policies; a slow consumer; concurrent routed preparation with distinct
request locals; and routed redirects. Each response is gated by its status,
render report, expected HTML and markers/payload. Cancelled and timed-out
request work must have aborted signals. Reports are awaited explicitly;
there is no guessed sleep for asynchronous disposal.

TTFB means first **document** byte. First application byte is a separate
metric: a fast head does not mean the page content is ready. Cancellation,
redirects, and empty-outlet error recovery have no application-byte sample.
Completion latency stops after reading/cancelling the response and before
validation. Batch throughput and CPU include validation, report observation,
and memory sampling; compare like scenarios and treat them as harness costs.

Memory is sampled every 5ms and at request completion. Heap and RSS growth
are sampled high-water observations, not precise peak live allocation counts;
short synchronous allocations can occur between samples. Slow consumption
tests retention of the atomic rendered body. It does not establish bounded
memory proportional to a small network chunk: the application still produces
one complete HTML string and its payload before delivery.

Raw per-request samples, outcomes, runtime versions, host CPU, and summary
statistics are saved to `dist/http-results.json`. `--quick` lowers concurrency
and request count for correctness verification; use the full matrix for
performance comparisons. Repeat measurements on an otherwise idle host.
`--writer` enables the compiler experiment and saves a separate
`dist/http-writer-results.json`, preserving the baseline run.

`--paired` compiles baseline and writer fixtures with identical module IDs,
then runs both in the same process. Each scenario alternates variant order
between rounds. By default it selects table stream/buffer/slow-consumer and
dashboard stream/buffer; `--filter` can select another scenario. Every matched
request must have identical status, outcome, byte count, and SHA-256 of the
whole response including hydration payload. Hashing follows the per-request
completion clock but contributes to batch CPU/throughput. Results go to
`dist/http-paired-results.json`. Do not combine `--paired` and `--writer`.

`writer.ts` compares the experimental `ssrWriter` compiler option with the
existing string tier for table and dashboard fixtures. Both variants must
produce byte-identical marked and plain HTML before timing. After warmup,
paired batches alternate execution order. `dist/writer-results.json` retains
every batch, code-size cost, and deterministic element/text factory counts.
Structural comments and writer closures are excluded from those factory
counts; they are not total allocation counts. Cloned row-template nodes also
bypass document factories, so retained output-node counts are reported too.

`--filter`, `--warmups`, and `--iterations` support longer steady-state batches
for tiny fixtures. `--stages` runs a separate diagnostic pass for session
creation, mount, serialization, and disposal. Its extra clocks make stage
times diagnostic; they do not enter the ordinary paired render samples.
`--retained=N` additionally holds N live sessions and roots before
serialization, forces GC, and reports incremental heap per session, followed
by heap growth after release. Three paired probes alternate order. This
includes request runtimes and row closures; it excludes response strings and
is GC-dependent. It needs `Bun.gc` or `globalThis.gc`. Negative growth and
post-release drift can occur; these values are not allocation counts or a
leak test. Run performance measurements separately from builds and tests.

The compiler design and promotion criteria are documented in
[`docs/ssr-writer-experiment.md`](../../docs/ssr-writer-experiment.md).
