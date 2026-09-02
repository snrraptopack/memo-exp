import type { ApplicationValidation } from './contract';

export interface SmoothnessConfig {
  count: number;
  interactionSamples: number;
  sustainedFrames: number;
  warmup: number;
}

export interface InteractionProbeSample {
  eventTimingDurationMs: number | null;
  eventToFrameMs: number;
  longTaskDurationMs: number;
  longTasks: number;
  mutationRecords: number;
}

export interface InteractionMeasurement {
  eventTimingP95Ms: number | null;
  eventToFrameMedianMs: number;
  eventToFrameP75Ms: number;
  eventToFrameP95Ms: number;
  longTaskDurationMs: number;
  longTasks: number;
  mutationRecordsMedian: number;
  scenario: 'triage' | 'bulk-update';
}

export interface SustainedMeasurement {
  droppedFrames: number;
  frameBudgetMs: number;
  frameIntervalMedianMs: number;
  frameIntervalP95Ms: number;
  frameIntervalP99Ms: number;
  frames: number;
  goodFramePercent: number;
  heapDeltaBytes: number | null;
  longTaskDurationMs: number;
  longTasks: number;
  maxFrameIntervalMs: number;
  mutationRecords: number;
  updateWorkMedianMs: number;
  updateWorkP95Ms: number;
}

export interface SustainedProbeMeasurement extends SustainedMeasurement {
  validation: ApplicationValidation;
}

export interface PipelineMeasurement {
  layoutMs: number;
  recalcStyleMs: number;
  scriptMs: number;
  taskMs: number;
}

interface MemoryPerformance extends Performance {
  memory?: {
    usedJSHeapSize: number;
  };
}

interface EventTimingEntry extends PerformanceEntry {
  duration: number;
  interactionId?: number;
}

interface InteractionProbeState {
  promise: Promise<InteractionProbeSample>;
}

type ProbeWindow = Window & {
  __applicationSmoothnessProbe?: InteractionProbeState;
};

function percentile(values: readonly number[], ratio: number): number {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * ratio)]!;
}

export function summarizeInteraction(
  scenario: InteractionMeasurement['scenario'],
  samples: readonly InteractionProbeSample[],
): InteractionMeasurement {
  const eventTiming = samples.flatMap((sample) =>
    sample.eventTimingDurationMs === null
      ? []
      : [sample.eventTimingDurationMs],
  );
  const eventToFrame = samples.map((sample) => sample.eventToFrameMs);
  return {
    eventTimingP95Ms:
      eventTiming.length === 0 ? null : percentile(eventTiming, 0.95),
    eventToFrameMedianMs: percentile(eventToFrame, 0.5),
    eventToFrameP75Ms: percentile(eventToFrame, 0.75),
    eventToFrameP95Ms: percentile(eventToFrame, 0.95),
    longTaskDurationMs: samples.reduce(
      (total, sample) => total + sample.longTaskDurationMs,
      0,
    ),
    longTasks: samples.reduce((total, sample) => total + sample.longTasks, 0),
    mutationRecordsMedian: percentile(
      samples.map((sample) => sample.mutationRecords),
      0.5,
    ),
    scenario,
  };
}

/** Install a one-shot probe before Puppeteer dispatches a trusted click. */
export function armInteractionProbeInPage(): void {
  const host = window as ProbeWindow;
  let resolveSample: (sample: InteractionProbeSample) => void = () => {};
  const promise = new Promise<InteractionProbeSample>((resolve) => {
    resolveSample = resolve;
  });
  host.__applicationSmoothnessProbe = { promise };

  let mutationRecords = 0;
  const mutations = new MutationObserver((records) => {
    mutationRecords += records.length;
  });
  mutations.observe(document.querySelector('#app')!, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });

  const longTaskDurations: number[] = [];
  const longTasks = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      longTaskDurations.push(entry.duration);
    }
  });
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    longTasks.observe({ type: 'longtask', buffered: false });
  }

  const eventDurations: number[] = [];
  const events = new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as EventTimingEntry[]) {
      if (entry.name === 'click' && (entry.interactionId ?? 1) !== 0) {
        eventDurations.push(entry.duration);
      }
    }
  });
  if (PerformanceObserver.supportedEntryTypes.includes('event')) {
    events.observe({
      buffered: false,
      durationThreshold: 0,
      type: 'event',
    } as PerformanceObserverInit);
  }

  document.addEventListener(
    'click',
    () => {
      const started = performance.now();
      requestAnimationFrame(() => {
        setTimeout(() => {
          mutationRecords += mutations.takeRecords().length;
          mutations.disconnect();
          longTaskDurations.push(
            ...longTasks.takeRecords().map((entry) => entry.duration),
          );
          eventDurations.push(
            ...(events.takeRecords() as EventTimingEntry[])
              .filter((entry) => entry.name === 'click')
              .map((entry) => entry.duration),
          );
          longTasks.disconnect();
          events.disconnect();
          resolveSample({
            eventTimingDurationMs:
              eventDurations.length === 0
                ? null
                : Math.max(...eventDurations),
            eventToFrameMs: performance.now() - started,
            longTaskDurationMs: longTaskDurations.reduce(
              (total, duration) => total + duration,
              0,
            ),
            longTasks: longTaskDurations.length,
            mutationRecords,
          });
        }, 0);
      });
    },
    { capture: true, once: true },
  );
}

export async function readInteractionProbeInPage(): Promise<InteractionProbeSample> {
  const host = window as ProbeWindow;
  const state = host.__applicationSmoothnessProbe;
  if (state === undefined) {
    throw new Error('smoothness interaction probe was not armed');
  }
  try {
    return await state.promise;
  } finally {
    delete host.__applicationSmoothnessProbe;
  }
}

/** Run broad updates on consecutive animation frames inside one page. */
export async function measureSustainedInPage(
  config: SmoothnessConfig,
): Promise<SustainedProbeMeasurement> {
  const bench = window.__applicationBench;
  const settle = async (pending: void | Promise<void>): Promise<void> => {
    if (pending && typeof pending.then === 'function') await pending;
  };
  const nextFrame = (): Promise<number> =>
    new Promise((resolve) => requestAnimationFrame(resolve));
  const localPercentile = (
    values: readonly number[],
    ratio: number,
  ): number => {
    const sorted = values.slice().sort((left, right) => left - right);
    return sorted[Math.floor((sorted.length - 1) * ratio)]!;
  };

  await settle(bench.reset(config.count, 'bulk-update'));
  for (let index = 0; index < config.warmup; index++) {
    await settle(bench.run('bulk-update'));
  }

  const idleFrames: number[] = [];
  let idlePrevious = await nextFrame();
  for (let index = 0; index < 24; index++) {
    const timestamp = await nextFrame();
    idleFrames.push(timestamp - idlePrevious);
    idlePrevious = timestamp;
  }
  const frameBudgetMs = localPercentile(idleFrames, 0.5);

  (globalThis as typeof globalThis & { gc?: () => void }).gc?.();
  const memory = performance as MemoryPerformance;
  const heapBefore = memory.memory?.usedJSHeapSize;
  let mutationRecords = 0;
  const mutations = new MutationObserver((records) => {
    mutationRecords += records.length;
  });
  mutations.observe(document.querySelector('#app')!, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  const longTaskDurations: number[] = [];
  const longTasks = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      longTaskDurations.push(entry.duration);
    }
  });
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    longTasks.observe({ type: 'longtask', buffered: false });
  }

  const intervals: number[] = [];
  const updateWork: number[] = [];
  let previous = await nextFrame();
  for (let frame = 0; frame < config.sustainedFrames; frame++) {
    const started = performance.now();
    await settle(bench.run('bulk-update'));
    updateWork.push(performance.now() - started);
    const timestamp = await nextFrame();
    intervals.push(timestamp - previous);
    previous = timestamp;
  }

  mutationRecords += mutations.takeRecords().length;
  mutations.disconnect();
  longTaskDurations.push(
    ...longTasks.takeRecords().map((entry) => entry.duration),
  );
  longTasks.disconnect();
  (globalThis as typeof globalThis & { gc?: () => void }).gc?.();
  const heapAfter = memory.memory?.usedJSHeapSize;
  const goodFrames = intervals.filter(
    (duration) => duration <= frameBudgetMs * 1.5,
  ).length;
  const droppedFrames = intervals.reduce(
    (total, duration) =>
      total + Math.max(0, Math.round(duration / frameBudgetMs) - 1),
    0,
  );

  return {
    droppedFrames,
    frameBudgetMs,
    frameIntervalMedianMs: localPercentile(intervals, 0.5),
    frameIntervalP95Ms: localPercentile(intervals, 0.95),
    frameIntervalP99Ms: localPercentile(intervals, 0.99),
    frames: config.sustainedFrames,
    goodFramePercent: (goodFrames / intervals.length) * 100,
    heapDeltaBytes:
      heapBefore === undefined || heapAfter === undefined
        ? null
        : heapAfter - heapBefore,
    longTaskDurationMs: longTaskDurations.reduce(
      (total, duration) => total + duration,
      0,
    ),
    longTasks: longTaskDurations.length,
    maxFrameIntervalMs: Math.max(...intervals),
    mutationRecords,
    updateWorkMedianMs: localPercentile(updateWork, 0.5),
    updateWorkP95Ms: localPercentile(updateWork, 0.95),
    validation: bench.validate(),
  };
}
