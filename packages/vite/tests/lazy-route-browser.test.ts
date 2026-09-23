import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer-core';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';

const repository = resolve(import.meta.dirname, '../../..');
const configFile = resolve(repository, 'examples/fieldnotes/vite.config.ts');

function chromeExecutable(): string | null {
  return [
    process.env.MMD_CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((candidate): candidate is string =>
    candidate !== undefined && existsSync(candidate)) ?? null;
}

let vite: ViteDevServer | undefined;
let browser: Browser | undefined;

afterEach(async () => {
  await browser?.close();
  browser = undefined;
  await vite?.close();
  vite = undefined;
}, 30_000);

describe('route-only component chunks', () => {
  it('loads the detail module on navigation and hydrates a direct detail visit', async context => {
    const executablePath = chromeExecutable();
    if (executablePath === null) {
      context.skip('Chrome is unavailable; set MMD_CHROME_PATH to run this test');
      return;
    }
    vite = await createServer({
      configFile,
      server: { host: '127.0.0.1', port: 0 },
    });
    await vite.listen();
    const address = vite.httpServer?.address();
    if (address === undefined || address === null || typeof address === 'string') {
      throw new Error('Expected a Vite TCP server address');
    }
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await puppeteer.launch({ headless: true, executablePath });
    const page = await browser.newPage();
    const errors: string[] = [];
    const modules: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url().includes('/src/ExpeditionDetail.tsx')) modules.push(request.url());
    });

    await page.goto(`${origin}/expeditions`, { waitUntil: 'networkidle0' });
    expect(modules).toHaveLength(0);
    await page.click('a[href="/expeditions/canopy"]');
    await page.waitForSelector('input[placeholder]');
    expect(await page.$$('input[placeholder]')).toHaveLength(1);
    expect(modules.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);

    await page.goto(`${origin}/expeditions/canopy`, { waitUntil: 'networkidle0' });
    expect(await page.$$('input[placeholder]')).toHaveLength(1);
    expect(errors).toEqual([]);
  }, 60_000);
});
