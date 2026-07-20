/**
 * @file run-browser.ts
 * M4.5 — Drives the real-browser benchmark in headless Chromium.
 * Loads bench/browser.html, runs window.__runAll(), prints the table.
 */
 import puppeteer from 'puppeteer-core';
 import { fileURLToPath } from 'node:url';
 import { dirname } from 'node:path';

 const __dirname = dirname(fileURLToPath(import.meta.url));

interface BenchRow {
  name: string;
  ours: number;
  vanilla: number;
  ratio: number;
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

  console.log('\nmemo-dom vs vanilla — REAL CHROMIUM, median of 7\n');
  console.log(
    'scenario'.padEnd(28),
    'memo-dom'.padStart(10),
    'vanilla'.padStart(10),
    'ratio'.padStart(8),
  );
  console.log('-'.repeat(58));
  for (const r of rows) {
    const ratio =
      r.ratio === null || !Number.isFinite(r.ratio) ? '>100x' : `${r.ratio.toFixed(2)}x`;
    console.log(
      r.name.padEnd(28),
      `${r.ours.toFixed(2)}ms`.padStart(10),
      `${r.vanilla.toFixed(2)}ms`.padStart(10),
       ratio.padStart(8),
    );
  }
} finally {
  await browser.close();
}
