# Vite Adapter

This benchmark starts a real Vite 8 middleware server over the package test
fixture. It reports:

- server startup, including the initial connected-graph compilation;
- the first request for the entry transform;
- Vite's own repeated `transformRequest()` cache;
- a full Vite transform pipeline after invalidating only the entry module,
  while the adapter retains its linked compiler output.

The final measurement is useful adapter overhead evidence, but it includes
Vite parsing and transform hooks and is not a raw `Map.get()` benchmark.

Run:

```bash
bun run --cwd packages/vite bench
```

## Latest Measurement

Windows x64, Bun 1.3.14, Vite 8.1.5, 2026-07-26:

| Scenario | Time |
|---|---:|
| Vite startup + linked graph | 1,302.88 ms |
| First entry transform | 230.74 ms |
| Vite request cache | 32.64 us/op |
| Invalidated Vite pipeline with cached adapter output | 43.63 ms/op |

These are warm-filesystem single-process measurements. Startup and first
transform are not yet stable throughput baselines; the invalidated pipeline is
the more relevant upper bound for serving already-linked output during
development.
