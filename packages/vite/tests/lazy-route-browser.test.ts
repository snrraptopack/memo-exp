import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer-core';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import memoizedDom from '../src';
import { routedApp, routedDetail, routedOpaque, initializeRoutedLifecycles, checkRoutedLifecycles } from './fixtures/routed-lifecycles';

const repository = resolve(import.meta.dirname, '../../..');

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
let fixture: string | undefined;

afterEach(async () => {
  await browser?.close();
  browser = undefined;
  await vite?.close();
  vite = undefined;
  if (fixture) await rm(fixture, { recursive: true, force: true });
  fixture = undefined;
}, 30_000);

describe('route-only component chunks', () => {
  it('preserves Group, refs, effects and opaque updates through lazy navigation and direct hydration', async context => {
    const executablePath = chromeExecutable();
    if (executablePath === null) {
      context.skip('Chrome is unavailable; set MMD_CHROME_PATH to run this test');
      return;
    }
    fixture = await mkdtemp(join(tmpdir(), 'memoized-dom-lazy-lifecycles-'));
    await mkdir(join(fixture, 'src'));
    await writeFile(join(fixture, 'index.html'), '<!doctype html><html><body><div id="root"><!--ssr-outlet--></div><script type="module" src="/src/main.ts"></script></body></html>');
    await writeFile(join(fixture, 'src/main.ts'), "import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);");
    await writeFile(join(fixture, 'src/App.tsx'), routedApp);
    await writeFile(join(fixture, 'src/Detail.tsx'), routedDetail);
    await writeFile(join(fixture, 'src/opaque.mjs'), routedOpaque);
    await writeFile(join(fixture, 'server.ts'), "import {serve} from '@memoized-dom/server';import {App} from './src/App';const app=serve();app.get('/api/user',()=>({name:'Ada'}));app.ssr(App);export default app;");
    const entries = {
      '@memoized-dom/runtime/server': 'runtime/src/server.ts',
      '@memoized-dom/runtime/hot': 'runtime/src/hot.ts',
      '@memoized-dom/runtime/hydrate': 'runtime/src/hydrate.ts',
      '@memoized-dom/runtime': 'runtime/src/index.ts',
      '@memoized-dom/data/internal': 'data/src/internal.ts',
      '@memoized-dom/data': 'data/src/index.ts',
      '@memoized-dom/router/internal': 'router/src/internal.ts',
      '@memoized-dom/router': 'router/src/index.ts',
      '@memoized-dom/server/router': 'server/src/http-router.ts',
      '@memoized-dom/server': 'server/src/index.ts',
    };
    vite = await createServer({
      root: fixture, configFile: false, appType: 'custom', logLevel: 'silent',
      resolve: { alias: Object.entries(entries).map(([name, path]) => ({
        find: new RegExp(`^${name}$`), replacement: resolve(repository, 'packages', path),
      })) },
      plugins: [memoizedDom({ clientEntry: 'src/main.ts', serverEntry: 'server.ts' })],
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
    await initializeRoutedLifecycles(page);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url().includes('/src/Detail.tsx')) modules.push(request.url());
    });

    await page.goto(`${origin}/demo/`, { waitUntil: 'networkidle0' });
    expect(await page.$eval('h1', node => node.textContent)).toBe('Ada');
    expect(modules).toHaveLength(0);
    await page.click('.detail');
    await checkRoutedLifecycles(page);
    expect(modules.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);

    await page.goto(`${origin}/demo/detail`, { waitUntil: 'networkidle0' });
    await checkRoutedLifecycles(page);
    expect(errors).toEqual([]);
  }, 60_000);
});
