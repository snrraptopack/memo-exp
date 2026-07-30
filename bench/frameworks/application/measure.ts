import type {
  ApplicationScenario,
  ApplicationValidation,
} from './contract';

export interface ApplicationMeasureConfig {
  counts: number[];
  samples: number;
  scenarios: ApplicationScenario[];
  warmup: number;
}

export interface ApplicationMeasurement {
  count: number;
  heapDeltaBytes: number | null;
  mutationRecords: number;
  nsPerOperation: number;
  p25NsPerOperation: number;
  p75NsPerOperation: number;
  scenario: ApplicationScenario;
}

export type ApplicationExpectations = Record<
  string,
  ApplicationValidation
>;

interface MemoryPerformance extends Performance {
  memory?: {
    usedJSHeapSize: number;
  };
}

export async function measureApplicationInPage(
  config: ApplicationMeasureConfig,
  expectations: ApplicationExpectations,
): Promise<ApplicationMeasurement[]> {
  const bench = window.__applicationBench;
  const measurements: ApplicationMeasurement[] = [];
  const settle = async (
    pending: void | Promise<void>,
  ): Promise<void> => {
    if (pending && typeof pending.then === 'function') await pending;
  };
  const median = (values: number[]): number => {
    const sorted = values.slice().sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)]!;
  };
  const percentile = (values: number[], ratio: number): number => {
    const sorted = values.slice().sort((left, right) => left - right);
    return sorted[Math.floor((sorted.length - 1) * ratio)]!;
  };

  for (const count of config.counts) {
    for (const scenario of config.scenarios) {
      for (let index = 0; index < config.warmup; index++) {
        await settle(bench.reset(count, scenario));
        await settle(bench.run(scenario));
      }

      const timings: number[] = [];
      const mutations: number[] = [];
      const heapDeltas: number[] = [];
      for (let sample = 0; sample < config.samples; sample++) {
        await settle(bench.reset(count, scenario));
        (
          globalThis as typeof globalThis & { gc?: () => void }
        ).gc?.();

        let mutationRecords = 0;
        const observer = new MutationObserver((records) => {
          mutationRecords += records.length;
        });
        observer.observe(document.querySelector('#app')!, {
          attributes: true,
          characterData: true,
          childList: true,
          subtree: true,
        });

        const memory = performance as MemoryPerformance;
        const heapBefore = memory.memory?.usedJSHeapSize;
        const started = performance.now();
        await settle(bench.run(scenario));
        const elapsed = performance.now() - started;
        const heapAfter = memory.memory?.usedJSHeapSize;
        mutationRecords += observer.takeRecords().length;
        observer.disconnect();

        const expected = expectations[`${count}/${scenario}`]!;
        const actual = bench.validate();
        const fields = Object.keys(expected) as Array<
          keyof ApplicationValidation
        >;
        const mismatch = fields.find(
          (field) => actual[field] !== expected[field],
        );
        if (mismatch !== undefined) {
          throw new Error(
            `${bench.id} failed ${scenario}/${count} at ${mismatch}: ` +
              `expected ${JSON.stringify(expected)}, ` +
              `received ${JSON.stringify(actual)}`,
          );
        }

        timings.push(elapsed * 1_000_000);
        mutations.push(mutationRecords);
        if (heapBefore !== undefined && heapAfter !== undefined) {
          heapDeltas.push(heapAfter - heapBefore);
        }
      }

      measurements.push({
        count,
        heapDeltaBytes:
          heapDeltas.length === 0 ? null : median(heapDeltas),
        mutationRecords: median(mutations),
        nsPerOperation: median(timings),
        p25NsPerOperation: percentile(timings, 0.25),
        p75NsPerOperation: percentile(timings, 0.75),
        scenario,
      });
    }
  }
  return measurements;
}
