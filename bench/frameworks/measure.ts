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

  function expectedView(
    count: number,
    scenario: BenchScenario,
    iterations: number,
  ): { order: string; remaining: number; state: string } {
    const todos = Array.from({ length: count }, (_, index) => ({
      completed: index % 3 === 0,
      id: index + 1,
      title: `Todo ${index + 1}`,
    }));
    for (let sequence = 0; sequence < iterations; sequence++) {
      if (todos.length === 0) break;
      const index = (sequence * 17 + 3) % todos.length;
      const todo = todos[index]!;
      if (scenario === 'rename') {
        todo.title = `Todo ${todo.id} / ${sequence + 1}`;
      } else if (scenario === 'toggle') {
        todo.completed = !todo.completed;
      } else if (scenario === 'move' && todos.length > 1) {
        const length = todos.length;
        const [moved] = todos.splice(index, 1);
        todos.splice((index + 1) % length, 0, moved!);
      }
    }
    return {
      order: todos.map((todo) => todo.id).join(','),
      remaining: todos.filter((todo) => !todo.completed).length,
      state: todos
        .map((todo) => `${todo.id}:${todo.completed ? 1 : 0}:${todo.title}`)
        .join('|'),
    };
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
          const expected = expectedView(count, scenario, iterations);
          if (
            validation.rows !== count ||
            validation.firstTitle.length === 0 ||
            validation.order !== expected.order ||
            validation.remaining !== expected.remaining ||
            validation.state !== expected.state
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
