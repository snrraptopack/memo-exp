import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import puppeteer, { type Page } from 'puppeteer-core';
import type { ApplicationScenario, ApplicationValidation } from './contract';
import {
  applyApplicationScenario,
  expectedApplicationValidation,
  prepareApplicationState,
} from './model';
import {
  armInteractionProbeInPage,
  measureSustainedInPage,
  readInteractionProbeInPage,
  summarizeInteraction,
  type InteractionMeasurement,
  type InteractionProbeSample,
  type PipelineMeasurement,
  type SmoothnessConfig,
  type SustainedMeasurement,
} from './smoothness';

interface FrameworkSmoothnessResult {
  bundle: { gzipBytes: number; rawBytes: number };
  id: string;
  interactions: InteractionMeasurement[];
  label: string;
  pipeline: PipelineMeasurement;
  sustained: SustainedMeasurement;
  version: string;
}

interface SmoothnessRun {
  browser: string;
  config: SmoothnessConfig;
  date: string;
  note: string;
  platform: string;
  results: FrameworkSmoothnessResult[];
}

const root = dirname(fileURLToPath(import.meta.url));
const defaultIds = [
  'vanilla',
  'memoized-dom',
  'solid',
  'svelte',
  'vue',
  'preact',
  'react',
];
const ids =
  process.env.BENCH_SMOOTHNESS_FRAMEWORKS?.split(',') ?? defaultIds;
const config: SmoothnessConfig = {
  count: Number(process.env.BENCH_SMOOTHNESS_COUNT ?? 1000),
  interactionSamples: Number(
    process.env.BENCH_SMOOTHNESS_SAMPLES ?? 12,
  ),
  sustainedFrames: Number(
    process.env.BENCH_SMOOTHNESS_FRAMES ?? 180,
  ),
  warmup: 2,
};
const executablePath =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/usr/bin/chromium');

const launchOptions = {
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--enable-precise-memory-info',
    '--js-flags=--expose-gc',
  ],
  executablePath,
  headless: true,
} as const;

const results: FrameworkSmoothnessResult[] = [];
let browserIdentity = '';
for (const id of ids) {
  const browser = await puppeteer.launch(launchOptions);
  try {
    browserIdentity ||= await browser.version();
    const page = await browser.newPage();
    page.on('pageerror', (error) =>
      console.error(`${id} PAGE ERROR:`, error),
    );
    await page.goto(
      pathToFileURL(resolve(root, `dist/${id}.html`)).href,
      { waitUntil: 'load' },
    );
    await page.waitForFunction(() => Boolean(window.__applicationBench), {
      timeout: 30_000,
    });
    const identity = await page.evaluate(() => ({
      id: window.__applicationBench.id,
      label: window.__applicationBench.label,
      version: window.__applicationBench.version,
    }));
    console.log(`Measuring smoothness for ${identity.label} ${identity.version}...`);

    const interactions: InteractionMeasurement[] = [];
    interactions.push(
      await measureInteractions(page, 'triage', '#triage-ticket', config),
      await measureInteractions(
        page,
        'bulk-update',
        '#bulk-update-tickets',
        config,
      ),
    );

    const metricsBefore = await page.metrics();
    const sustainedProbe = await page.evaluate(measureSustainedInPage, config);
    const { validation, ...sustained } = sustainedProbe;
    const metricsAfter = await page.metrics();
    assertValidation(
      identity.id,
      validation,
      repeatedExpectation(
        config.count,
        'bulk-update',
        config.warmup + config.sustainedFrames,
      ),
    );
    const source = readFileSync(resolve(root, `dist/${id}.js`));
    results.push({
      ...identity,
      bundle: {
        gzipBytes: gzipSync(source).byteLength,
        rawBytes: source.byteLength,
      },
      interactions,
      pipeline: {
        layoutMs:
          (metricsAfter.LayoutDuration - metricsBefore.LayoutDuration) * 1000,
        recalcStyleMs:
          (metricsAfter.RecalcStyleDuration -
            metricsBefore.RecalcStyleDuration) *
          1000,
        scriptMs:
          (metricsAfter.ScriptDuration - metricsBefore.ScriptDuration) * 1000,
        taskMs: (metricsAfter.TaskDuration - metricsBefore.TaskDuration) * 1000,
      },
      sustained,
    });
    await page.close();
  } finally {
    await browser.close();
  }
}

const output: SmoothnessRun = {
  browser: browserIdentity,
  config,
  date: new Date().toISOString(),
  note:
    'Machine-local production-browser frame pacing and trusted interaction measurements; compare runs on identical hardware and browser versions.',
  platform: `${process.platform} ${process.arch}`,
  results,
};
writeFileSync(
  resolve(root, 'smoothness-latest.json'),
  `${JSON.stringify(output, null, 2)}\n`,
);

console.log(
  `\n${config.count.toLocaleString()}-ticket production smoothness\n`,
);
console.log(
  'framework'.padEnd(24),
  'good frames'.padStart(12),
  'p95 frame'.padStart(12),
  'dropped'.padStart(9),
  'triage p95'.padStart(12),
  'bulk p95'.padStart(11),
  'long tasks'.padStart(11),
);
for (const result of results) {
  const triage = result.interactions.find(
    (measurement) => measurement.scenario === 'triage',
  )!;
  const bulk = result.interactions.find(
    (measurement) => measurement.scenario === 'bulk-update',
  )!;
  console.log(
    `${result.label}@${result.version}`.slice(0, 24).padEnd(24),
    `${result.sustained.goodFramePercent.toFixed(1)}%`.padStart(12),
    `${result.sustained.frameIntervalP95Ms.toFixed(2)}ms`.padStart(12),
    String(result.sustained.droppedFrames).padStart(9),
    `${triage.eventToFrameP95Ms.toFixed(2)}ms`.padStart(12),
    `${bulk.eventToFrameP95Ms.toFixed(2)}ms`.padStart(11),
    String(result.sustained.longTasks).padStart(11),
  );
}
console.log(
  '\nFull results written to bench/frameworks/application/smoothness-latest.json',
);

async function measureInteractions(
  page: Page,
  scenario: 'triage' | 'bulk-update',
  selector: string,
  settings: SmoothnessConfig,
): Promise<InteractionMeasurement> {
  const samples: InteractionProbeSample[] = [];
  for (let index = 0; index < settings.warmup + settings.interactionSamples; index++) {
    await page.evaluate(
      async (count, selectedScenario) => {
        const pending = window.__applicationBench.reset(
          count,
          selectedScenario,
        );
        if (pending && typeof pending.then === 'function') await pending;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      },
      settings.count,
      scenario,
    );
    await page.evaluate(armInteractionProbeInPage);
    await page.click(selector);
    const sample = await page.evaluate(readInteractionProbeInPage);
    const validation = await page.evaluate(() =>
      window.__applicationBench.validate(),
    );
    assertValidation(
      await page.evaluate(() => window.__applicationBench.id),
      validation,
      repeatedExpectation(settings.count, scenario, 1),
    );
    if (index >= settings.warmup) samples.push(sample);
  }
  return summarizeInteraction(scenario, samples);
}

function repeatedExpectation(
  count: number,
  scenario: ApplicationScenario,
  repetitions: number,
): ApplicationValidation {
  let state = prepareApplicationState(count, scenario);
  for (let index = 0; index < repetitions; index++) {
    state = applyApplicationScenario(state, scenario, count);
  }
  return expectedApplicationValidation(state);
}

function assertValidation(
  id: string,
  actual: ApplicationValidation,
  expected: ApplicationValidation,
): void {
  for (const field of Object.keys(expected) as Array<keyof ApplicationValidation>) {
    if (actual[field] !== expected[field]) {
      throw new Error(
        `${id} smoothness validation failed at ${field}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      );
    }
  }
}
