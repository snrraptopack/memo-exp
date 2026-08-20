export const ROUTER_BENCH_OPTIONS = Object.freeze({
  time: 750,
  iterations: 100,
  warmupTime: 150,
  warmupIterations: 10,
});

let benchmarkSink: unknown;

/** Keep benchmark results observable without adding assertion work to timed loops. */
export function consume(value: unknown): void {
  benchmarkSink = value;
}

/** Validate fixtures once, before Vitest starts timing them. */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`router benchmark fixture mismatch: ${message}`);
}

// Preserve an observable module binding for engines that inline `consume()`.
export function readBenchmarkSink(): unknown {
  return benchmarkSink;
}
