import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import puppeteer from 'puppeteer-core';
import {
  measureApplicationInPage,
  type ApplicationExpectations,
  type ApplicationMeasureConfig,
} from './measure';
import {
  applyApplicationScenario,
  expectedApplicationValidation,
  prepareApplicationState,
} from './model';
import type {
  ApplicationFrameworkResult,
  ApplicationRun,
} from './results';

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
  process.env.BENCH_APPLICATION_FRAMEWORKS?.split(',') ?? defaultIds;
const config: ApplicationMeasureConfig = {
  counts: [100, 1000],
  samples: 7,
  scenarios: [
    'load',
    'inspect',
    'triage',
    'search',
    'organize',
    'navigate',
    'bulk-update',
  ],
  warmup: 2,
};
const expectations: ApplicationExpectations = {};
for (const count of config.counts) {
  for (const scenario of config.scenarios) {
    expectations[`${count}/${scenario}`] =
      expectedApplicationValidation(
        applyApplicationScenario(
          prepareApplicationState(count, scenario),
          scenario,
          count,
        ),
      );
  }
}
const executablePath =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/usr/bin/chromium');

const launchOptions = {
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--enable-precise-memory-info',
    '--js-flags=--expose-gc',
  ],
  executablePath,
  headless: true,
};

const frameworkResults: ApplicationFrameworkResult[] = [];
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
    console.log(`Measuring ${identity.label} ${identity.version}...`);
    const measurements = await page.evaluate(
      measureApplicationInPage,
      config,
      expectations,
    );
    const source = readFileSync(resolve(root, `dist/${id}.js`));
    frameworkResults.push({
      ...identity,
      bundle: {
        gzipBytes: gzipSync(source).byteLength,
        rawBytes: source.byteLength,
      },
      measurements,
    });
    await page.close();
  } finally {
    await browser.close();
  }
}

const output: ApplicationRun = {
  browser: browserIdentity,
  config,
  date: new Date().toISOString(),
  note:
    'Machine-local application workflow completion; each adapter uses normal reactive events in a fresh browser process.',
  platform: `${process.platform} ${process.arch}`,
  results: frameworkResults,
};
writeFileSync(
  resolve(root, 'latest.json'),
  `${JSON.stringify(output, null, 2)}\n`,
);

console.log('\n1,000-ticket median completion (milliseconds)\n');
console.log(
  'framework'.padEnd(24),
  ...config.scenarios.map((scenario) => scenario.padStart(13)),
);
for (const result of frameworkResults) {
  const cells = config.scenarios.map((scenario) => {
    const measurement = result.measurements.find(
      (item) => item.count === 1000 && item.scenario === scenario,
    )!;
    return (measurement.nsPerOperation / 1_000_000)
      .toFixed(3)
      .padStart(13);
  });
  console.log(
    `${result.label}@${result.version}`.slice(0, 24).padEnd(24),
    ...cells,
  );
}
console.log(
  '\nFull results written to bench/frameworks/application/latest.json',
);
