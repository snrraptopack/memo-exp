# Router Benchmarks

Production-output benchmarks for `@memoized-dom/router`. The command builds the
router before Vitest imports its public package entry, so results cannot silently
come from an older ignored `dist` directory.

```bash
bun run bench:router
```

## Measurement model

Names state the cache and lifecycle mode being measured:

- **cached** repeats the exact identity or pathname and intentionally measures a
  documented last-result fast path;
- **warm varied** reuses compiled route structures but rotates inputs so a
  one-entry result cache cannot decide the row;
- **uncached** prevents the bounded normalization map from absorbing the input
  set during benchmark warm-up;
- **construction** includes creation of the named structure; and
- **cold runtime** constructs, initially resolves, and disposes a runtime per
  operation while module code and validated route patterns remain warm.

Each task warms for 150 ms and measures for at least 750 ms. Fixtures are
validated before timing. Timed return values are written to a module sink so the
engine cannot treat the calls as unobservable. Query, path, matcher, and runtime
suites live in separate benchmark modules to avoid sharing cursors and runtime
state across unrelated measurements. Vitest runs the files sequentially so they
do not compete for CPU time during a measurement.

## Suites

### Query

`query.bench.ts` separates same-reference encode and same-string decode hits from
rotating clean and escaped/repeated values. Input objects and strings are
preallocated, so caller fixture construction is not part of serialization time.

### Path

`path.bench.ts` measures cached normalization, uncached normalized and
trim/query/hash inputs, rotating nested joins, cached path construction, clean
parameter interpolation, escaped parameters, and terminal wildcards.

`normalizeRoutePath` does not collapse internal duplicate separators. The suite
therefore does not call its trim/query/hash case a `cleanPath` comparison.

### Matcher

`matcher.bench.ts` separates a last-result hit from rotating pattern and trie
lookups. Route-table rows cover 10, 100, 500, and 1,000 definitions, 500-route
misses, and 500-route trie construction. Construction runs with the global
pattern-validation cache warm; process startup and module loading are excluded.

### Runtime

`runtime.bench.ts` uses `environment: {}` explicitly. Its pure transaction rows
therefore do not include Happy DOM history by accident. It measures direct
location transactions, same-location no-ops, href and typed navigation, one and
five subscribers, accessed cancellation signals, navigation followed by the
first populated query lookup, an atomic three-match resolver, snapshots, and
cold isolated runtime creation.

## Interpretation

Cached rows prove the cost of caches that are expected to matter for repeated
application reads. They must not be presented as general matching or parsing
throughput. Warm-varied rows are the primary primitive regression signal.

Compare table sizes only within the `trie warm varied` rows. Do not compare a
batched operation count with a single operation or infer end-to-end application
speed from a primitive row. Treat changes smaller than the reported relative
margin of error as noise and confirm meaningful changes in multiple fresh
processes on the same machine.

## Deliberate exclusions

This suite does not currently measure:

- real Chromium History or Navigation API behavior;
- delegated anchor-event handling;
- compiler-generated `route` / `route-to` structural regions;
- DOM commit completion after route invalidation;
- route-scoped data cancellation, loading, or optimistic transitions;
- server request handling; or
- comparisons with another router whose navigation semantics perform different
  work.

Those should be added as separate integration or real-browser suites when the
corresponding Memoized DOM layers exist. A fair external comparison must run the
same fixture and validate equivalent output before timing; this suite is an
internal regression baseline, not a competitor leaderboard.
