/** Drive the state-placement matrix in real Chromium. */
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type { BenchRow } from './state-placement-browser';
import { writeStatePlacementReport } from './state-placement-report';

const directory = dirname(fileURLToPath(import.meta.url));
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || (process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/chromium');
const browser = await puppeteer.launch({ executablePath,
  protocolTimeout: 600000,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'], headless: true,
});
try {
  const page = await browser.newPage();
  page.on('console', message => console.log(message.text()));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`file://${directory}/state-placement-browser.html`, { waitUntil: 'load' });
  const rows = await page.evaluate(() => (window as unknown as {
    __runAll(): BenchRow[];
  }).__runAll());
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(writeStatePlacementReport(directory, {
    measuredAt: new Date().toISOString(), samples: 7,
    scheduler: 'synchronous', validation: 'every operation outside timed interval', rows,
  }));
} finally { await browser.close(); }
