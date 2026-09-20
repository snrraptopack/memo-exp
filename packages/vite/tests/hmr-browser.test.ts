import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import memoizedDom from '../src';

const repository = resolve(import.meta.dirname, '../../..');
const runtime = resolve(repository, 'packages/runtime/src/index.ts');
const runtimeHot = resolve(repository, 'packages/runtime/src/hot.ts');

function chromeExecutable(): string | null {
  const candidates = [
    process.env.MMD_CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find(
    (candidate): candidate is string =>
      candidate !== undefined && existsSync(candidate),
  ) ?? null;
}

let browser: Browser | undefined;
let server: ViteDevServer | undefined;
let fixture: string | undefined;

afterEach(async () => {
  await browser?.close();
  browser = undefined;
  await server?.close();
  server = undefined;
  if (fixture !== undefined) {
    await rm(fixture, { recursive: true, force: true });
    fixture = undefined;
  }
}, 30_000);

describe('browser HMR', () => {
  it('propagates helper edits and replaces component text without reloading or duplicating DOM', async (context) => {
    const executablePath = chromeExecutable();
    if (executablePath === null) {
      context.skip('Chrome is unavailable; set MMD_CHROME_PATH to run this test');
      return;
    }

    fixture = await mkdtemp(join(tmpdir(), 'memoized-dom-hmr-'));
    const source = resolve(fixture, 'src');
    await mkdir(source, { recursive: true });
    await writeFile(resolve(fixture, 'index.html'), `
      <div id="root"></div>
      <script type="module" src="/src/main.ts"></script>
    `);
    await writeFile(resolve(source, 'main.ts'), `
      import { mount } from '@memoized-dom/runtime';
      import { App } from './App';
      const loads = Number(sessionStorage.getItem('loads') ?? '0') + 1;
      sessionStorage.setItem('loads', String(loads));
      mount('root', App);
    `);
    const appFile = resolve(source, 'App.tsx');
    await writeFile(appFile, `
      import { label } from './label';
      export function App() {
        return <main><span>{label}</span><strong>first</strong></main>;
      }
    `);
    const labelFile = resolve(source, 'label.ts');
    await writeFile(labelFile, `export const label = 'before';\n`);

    server = await createServer({
      root: fixture,
      configFile: false,
      logLevel: 'silent',
      resolve: {
        alias: [
          { find: '@memoized-dom/runtime/hot', replacement: runtimeHot },
          { find: '@memoized-dom/runtime', replacement: runtime },
        ],
      },
      plugins: [memoizedDom({ entries: 'src/main.ts' })],
      server: { host: '127.0.0.1', port: 0 },
    });
    await server.listen();
    const hot = server.environments.client.hot;
    const sendHot = hot.send.bind(hot);
    const send = vi.spyOn(hot, 'send').mockImplementation((payload, client) =>
      sendHot(payload, client)
    );
    const address = server.httpServer?.address();
    if (address === null || address === undefined || typeof address === 'string') {
      throw new Error('Vite did not expose a TCP address');
    }

    browser = await puppeteer.launch({ headless: true, executablePath });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForFunction(() => document.body.textContent?.includes('before'));

    await writeFile(labelFile, `export const label = 'after';\n`);
    await page.waitForFunction(() => document.body.textContent?.includes('after'));
    const hotPayloads = send.mock.calls.map(([payload]) => payload);
    expect(hotPayloads.some((payload) => payload.type === 'full-reload'))
      .toBe(false);
    expect(await page.evaluate(() => ({
      loads: sessionStorage.getItem('loads'),
      mains: document.querySelectorAll('main').length,
      text: document.querySelector('main')?.textContent,
    }))).toEqual({ loads: '1', mains: 1, text: 'afterfirst' });

    await writeFile(appFile, `
      import { label } from './label';
      export function App() {
        return <main><span>{label}</span><strong>second</strong></main>;
      }
    `);
    await page.waitForFunction(() => document.body.textContent?.includes('second'));
    expect(await page.evaluate(() => ({
      loads: sessionStorage.getItem('loads'),
      mains: document.querySelectorAll('main').length,
      text: document.querySelector('main')?.textContent,
    }))).toEqual({ loads: '1', mains: 1, text: 'aftersecond' });
  }, 45_000);
});
