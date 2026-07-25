/**
 * @file run.ts
 * Drives the 3-way real-browser benchmark in headless Chromium.
 * Loads browser.html, runs window.__runAll(), prints the table.
 */
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface BenchRow {
  name: string;
  tsx: number;
  inline: number;
  vanilla: number;
  ratioTsx: number;
  ratioInline: number;
}

const executablePath =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/usr/bin/chromium');

const browser = await puppeteer.launch({
  executablePath,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  headless: true,
});

try {
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.goto(`file://${__dirname}/browser.html`, { waitUntil: 'load' });

  const rows = await page.evaluate(() => {
    const fn = (window as unknown as Record<string, () => BenchRow[]>).__runAll;
    return fn();
  });

  console.log('\n3-WAY REAL CHROMIUM BENCHMARK (median of 7)\n');
  console.log(
    'scenario'.padEnd(28),
    'tsx-comp'.padStart(12),
    'tsx-inline'.padStart(12),
    'vanilla'.padStart(10),
    'inline/vanilla'.padStart(16),
  );
  console.log('-'.repeat(95));
  for (const r of rows) {
    const ratioInline =
      r.ratioInline === null || !Number.isFinite(r.ratioInline) ? '>100x' : `${r.ratioInline.toFixed(2)}x`;
    console.log(
      r.name.padEnd(28),
      `${r.tsx.toFixed(2)}ms`.padStart(12),
      `${r.inline.toFixed(2)}ms`.padStart(12),
      `${r.vanilla.toFixed(2)}ms`.padStart(10),
      ratioInline.padStart(16),
    );
  }
} finally {
  await browser.close();
}
