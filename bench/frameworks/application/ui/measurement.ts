import type {
  ApplicationBench,
  ApplicationScenario,
  ApplicationValidation,
} from '../contract';
import {
  applyApplicationScenario,
  expectedApplicationValidation,
  prepareApplicationState,
} from '../model';

interface MemoryPerformance extends Performance {
  memory?: {
    usedJSHeapSize: number;
  };
}

export interface LiveMeasurement {
  count: number;
  framework: string;
  heapDeltaBytes: number | null;
  mutationRecords: number;
  p25Ms: number;
  p75Ms: number;
  scenario: ApplicationScenario;
  timeMs: number;
}

export class PreviewHost {
  private currentFramework: string | null = null;
  private pending: Promise<ApplicationBench> | null = null;

  constructor(private readonly frame: HTMLIFrameElement) {}

  async load(framework: string, force = false): Promise<ApplicationBench> {
    const available = this.frame.contentWindow?.__applicationBench;
    if (!force && this.currentFramework === framework && available) {
      return available;
    }
    if (!force && this.currentFramework === framework && this.pending) {
      return this.pending;
    }

    this.currentFramework = framework;
    this.pending = new Promise<ApplicationBench>((resolve, reject) => {
      const loaded = (): void => {
        const bench = this.frame.contentWindow?.__applicationBench;
        if (bench === undefined) {
          reject(
            new Error(
              `${framework} loaded without window.__applicationBench`,
            ),
          );
          return;
        }
        resolve(bench);
      };
      this.frame.addEventListener('load', loaded, { once: true });
      this.frame.addEventListener(
        'error',
        () => reject(new Error(`Unable to load ${framework}.html`)),
        { once: true },
      );
      this.frame.src = `./${framework}.html?ui=${Date.now()}`;
    }).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  async preview(
    framework: string,
    scenario: ApplicationScenario,
    count: number,
  ): Promise<void> {
    const bench = await this.load(framework);
    await settle(bench.reset(count, scenario));
    await settle(bench.run(scenario));
    assertValid(bench.validate(), scenario, count);
  }

  async measure(
    framework: string,
    scenario: ApplicationScenario,
    count: number,
    samples: number,
  ): Promise<LiveMeasurement> {
    const bench = await this.load(framework);

    await settle(bench.reset(count, scenario));
    await settle(bench.run(scenario));

    const timings: number[] = [];
    const heapDeltas: number[] = [];
    const mutations: number[] = [];
    for (let sample = 0; sample < samples; sample++) {
      await settle(bench.reset(count, scenario));

      const target = this.frame.contentDocument?.querySelector('#app');
      const frameWindow = this.frame.contentWindow;
      if (target === null || target === undefined || frameWindow === null) {
        throw new Error('The application preview is not available');
      }

      let mutationRecords = 0;
      const observer = new MutationObserver((records) => {
        mutationRecords += records.length;
      });
      observer.observe(target, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });

      const memory = frameWindow.performance as MemoryPerformance;
      const heapBefore = memory.memory?.usedJSHeapSize;
      const started = frameWindow.performance.now();
      await settle(bench.run(scenario));
      const elapsed = frameWindow.performance.now() - started;
      const heapAfter = memory.memory?.usedJSHeapSize;
      mutationRecords += observer.takeRecords().length;
      observer.disconnect();

      assertValid(bench.validate(), scenario, count);
      timings.push(elapsed);
      mutations.push(mutationRecords);
      if (heapBefore !== undefined && heapAfter !== undefined) {
        heapDeltas.push(heapAfter - heapBefore);
      }
    }

    return {
      count,
      framework,
      heapDeltaBytes:
        heapDeltas.length === 0 ? null : median(heapDeltas),
      mutationRecords: median(mutations),
      p25Ms: percentile(timings, 0.25),
      p75Ms: percentile(timings, 0.75),
      scenario,
      timeMs: median(timings),
    };
  }
}

function assertValid(
  actual: ApplicationValidation,
  scenario: ApplicationScenario,
  count: number,
): void {
  const expected = expectedApplicationValidation(
    applyApplicationScenario(
      prepareApplicationState(count, scenario),
      scenario,
      count,
    ),
  );
  const fields = Object.keys(expected) as Array<keyof ApplicationValidation>;
  const mismatch = fields.find((field) => actual[field] !== expected[field]);
  if (mismatch !== undefined) {
    throw new Error(
      `Validation failed at ${mismatch}: expected ` +
        `${JSON.stringify(expected[mismatch])}, received ` +
        `${JSON.stringify(actual[mismatch])}`,
    );
  }
}

async function settle(pending: void | Promise<void>): Promise<void> {
  if (pending && typeof pending.then === 'function') await pending;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * ratio)]!;
}
