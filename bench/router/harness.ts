interface Options {
  time: number;
  iterations: number;
  warmupTime: number;
  warmupIterations: number;
}

const groups: string[] = [];
const cases: Array<{ name: string; run: () => void; options: Options }> = [];

export function describe(name: string, register: () => void): void {
  groups.push(name);
  try { register(); } finally { groups.pop(); }
}

export function bench(name: string, run: () => void, options: Options): void {
  cases.push({ name: [...groups, name].join(' / '), run, options });
}

function measure(run: () => void, time: number, minimum: number): { iterations: number; elapsed: number } {
  let iterations = 0;
  const start = performance.now();
  let elapsed = 0;
  // Sample the clock once per batch so clock reads don't dominate tiny operations.
  do {
    for (let index = 0; index < 64; index++) run();
    iterations += 64;
    elapsed = performance.now() - start;
  } while (elapsed < time || iterations < minimum);
  return { iterations, elapsed };
}

export function runBenchmarks(smoke = false): void {
  console.log(smoke ? 'Router benchmark smoke run (not performance results)' : 'Router benchmarks under Bun; batched wall-clock measurements');
  for (const entry of cases) {
    const { time, iterations, warmupTime, warmupIterations } = entry.options;
    measure(entry.run, smoke ? 1 : warmupTime, smoke ? 1 : warmupIterations);
    const result = measure(entry.run, smoke ? 5 : time, smoke ? 1 : iterations);
    console.log(`${entry.name}: ${(result.iterations / result.elapsed * 1_000).toFixed(0)} ops/s (${result.iterations} iterations)`);
  }
}
