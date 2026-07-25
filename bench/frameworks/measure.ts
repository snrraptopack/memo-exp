/**
 * @file measure.ts
 * Runs repeatable update-completion samples inside an isolated adapter page.
 */
import type { BenchMode, BenchScenario } from './contract';

export interface MeasureConfig {
  counts: number[];
  iterations: Record<number, number>;
  modes: BenchMode[];
  samples: number;
  scenarios: BenchScenario[];
  warmup: number;
}

export interface BrowserMeasurement {
  count: number;
  mode: BenchMode;
  mutationsPerOp: number;
  nsPerOp: number;
  scenario: BenchScenario;
}

export async function measureInPage(
  config: MeasureConfig,
): Promise<BrowserMeasurement[]> {
  const bench = window.__frameworkBench;
  const results: BrowserMeasurement[] = [];

  function median(values: number[]): number {
    const sorted = values.slice().sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)]!;
  }

  for (const mode of config.modes) {
    for (const count of config.counts) {
      for (const scenario of config.scenarios) {
        let pending = bench.reset(count, mode);
        if (pending && typeof pending.then === 'function') await pending;
        for (let index = 0; index < config.warmup; index++) {
          pending = bench.run(scenario);
          if (pending && typeof pending.then === 'function') await pending;
        }

        const timings: number[] = [];
        const mutationCounts: number[] = [];
        const iterations = config.iterations[count]!;
        for (let sample = 0; sample < config.samples; sample++) {
          pending = bench.reset(count, mode);
          if (pending && typeof pending.then === 'function') await pending;
          (globalThis as typeof globalThis & { gc?: () => void }).gc?.();

          let mutations = 0;
          const observer = new MutationObserver((records) => {
            mutations += records.length;
          });
          observer.observe(document.querySelector('#app')!, {
            attributes: true,
            characterData: true,
            childList: true,
            subtree: true,
          });

          const started = performance.now();
          for (let iteration = 0; iteration < iterations; iteration++) {
            pending = bench.run(scenario);
            if (pending && typeof pending.then === 'function') await pending;
          }
          const elapsed = performance.now() - started;
          mutations += observer.takeRecords().length;
          observer.disconnect();

          const validation = bench.validate();
          if (
            validation.rows !== count ||
            validation.firstTitle.length === 0 ||
            validation.remaining < 0 ||
            validation.remaining > count
          ) {
            throw new Error(
              `${bench.id} failed ${mode}/${scenario}/${count}: ${JSON.stringify(validation)}`,
            );
          }
          timings.push((elapsed * 1_000_000) / iterations);
          mutationCounts.push(mutations / iterations);
        }

        results.push({
          count,
          mode,
          scenario,
          nsPerOp: median(timings),
          mutationsPerOp: median(mutationCounts),
        });
      }
    }
  }
  return results;
}
