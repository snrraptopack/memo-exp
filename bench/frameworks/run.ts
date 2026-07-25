/**
 * @file run.ts
 * Drives each isolated production adapter in real Chromium and records results.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { measureInPage, type MeasureConfig } from './measure';
import type { FrameworkResult, FrameworkRun } from './results';

const root = dirname(fileURLToPath(import.meta.url));
const defaultIds = [
  'vanilla',
  'memoized-dom',
  'solid',
  'svelte',
  'vue',
  'preact',
  'react',
  'angular',
];
const ids = process.env.BENCH_FRAMEWORKS?.split(',') ?? defaultIds;
const config: MeasureConfig = {
  counts: [10, 100, 1000],
  iterations: { 10: 100, 100: 50, 1000: 20 },
  modes: ['forced', 'reactive'],
  samples: 5,
  scenarios: ['no-change', 'rename', 'toggle', 'move'],
  warmup: 10,
};
const executablePath =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/usr/bin/chromium');

const browser = await puppeteer.launch({
  executablePath,
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--js-flags=--expose-gc',
  ],
  headless: true,
});

try {
  const frameworkResults: FrameworkResult[] = [];
  for (const id of ids) {
    const page = await browser.newPage();
    page.on('pageerror', (error) => console.error(`${id} PAGE ERROR:`, error));
    await page.goto(pathToFileURL(resolve(root, `dist/${id}.html`)).href, {
      waitUntil: 'load',
    });
    await page.waitForFunction(() => Boolean(window.__frameworkBench), {
      timeout: 30_000,
    });

    const identity = await page.evaluate(() => ({
      id: window.__frameworkBench.id,
      label: window.__frameworkBench.label,
      version: window.__frameworkBench.version,
    }));
    console.log(`Measuring ${identity.label} ${identity.version}...`);
    const measurements = await page.evaluate(measureInPage, config);
    const source = readFileSync(resolve(root, `dist/${id}.js`));
    frameworkResults.push({
      ...identity,
      bundle: {
        rawBytes: source.byteLength,
        gzipBytes: gzipSync(source).byteLength,
      },
      measurements,
    });
    await page.close();
  }

  const output: FrameworkRun = {
    browser: await browser.version(),
    config,
    date: new Date().toISOString(),
    note:
      'Machine-local update-completion latency; reactive results include each framework scheduler.',
    platform: `${process.platform} ${process.arch}`,
    results: frameworkResults,
  };
  writeFileSync(resolve(root, 'latest.json'), `${JSON.stringify(output, null, 2)}\n`);

  console.log('\n100-row median update completion (microseconds/op)\n');
  for (const mode of config.modes) {
    console.log(mode.toUpperCase());
    console.log(
      'framework'.padEnd(24),
      ...config.scenarios.map((scenario) => scenario.padStart(12)),
    );
    for (const result of frameworkResults) {
      const cells = config.scenarios.map((scenario) => {
        const row = result.measurements.find(
          (item) => item.mode === mode && item.count === 100 && item.scenario === scenario,
        )!;
        return (row.nsPerOp / 1000).toFixed(2).padStart(12);
      });
      console.log(`${result.label}@${result.version}`.slice(0, 24).padEnd(24), ...cells);
    }
    console.log();
  }
  console.log('Full results written to bench/frameworks/latest.json');
} finally {
  await browser.close();
}
