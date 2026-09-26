/** Real-browser history/scroll regressions. No dev server or downloaded browser required. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';

const executablePath = [
  process.env.MMD_BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((path): path is string => path !== undefined && existsSync(path));
if (executablePath === undefined) {
  throw new Error('Set MMD_BROWSER_PATH to an installed Chrome/Chromium executable');
}

const source = `
import { createRouteRuntime } from './packages/router/src/runtime';
import { registerRoutedPreparation } from './packages/router/src/preparation';
import { createScrollCoordinator } from './packages/router/src/scroll';

let gate = 'ready';
let release;
let retry;
let errorCount = 0;
registerRoutedPreparation({ id: 'browser-first', server: false, prepare: async () => {
  if (gate === 'fail') throw new Error('offline');
  if (gate === 'wait') await new Promise(resolve => { release = resolve; });
  return 'ready';
} });
const runtime = createRouteRuntime({
  // Explicitly exercise the fallback History API even in Navigation API browsers.
  environment: {
    location, history,
    addEventListener: (type, listener) => window.addEventListener(type, listener),
    removeEventListener: (type, listener) => window.removeEventListener(type, listener),
  },
  routes: [
    { id: 'first', pattern: '/first', metadata: { preparations: ['browser-first'] } },
    { id: 'second', pattern: '/second' },
  ],
});
runtime.subscribe(route => {
  document.getElementById('page').textContent = route.pathname;
});
runtime.subscribeNavigation(event => {
  if (event.phase === 'error') { errorCount++; retry = event.retry; }
});
runtime.connect();
let coordinator;
window.routerScrollTest = {
  get route() { return runtime.route.pathname; },
  get errors() { return errorCount; },
  get canRelease() { return release !== undefined; },
  setGate(value) { gate = value; },
  release() { gate = 'ready'; release(); },
  async navigate(path) {
    const result = runtime.navigate(path);
    if (result.status === 'preparing') await result.finished;
  },
  async retry() {
    gate = 'ready';
    const result = retry();
    if (result.status === 'preparing') await result.finished;
  },
  standalone() {
    runtime.dispose();
    coordinator = createScrollCoordinator();
    coordinator.connect();
  },
  restore(hash, type = 'push') {
    coordinator.restore(new URL('/first' + hash, location.href), type, hash || 'first');
  },
  dispose() { coordinator?.dispose(); runtime.dispose(); },
};
`;
const output = await build({
  stdin: { contents: source, loader: 'ts', resolveDir: resolve(import.meta.dirname, '..') },
  bundle: true, write: false, format: 'esm', platform: 'browser',
});
const script = output.outputFiles[0]!.text;
const server = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  fetch(request) {
    if (new URL(request.url).pathname === '/test.js') {
      return new Response(script, { headers: { 'content-type': 'text/javascript' } });
    }
    return new Response(`<!doctype html><html><head><style>
      body { margin: 0; } #page { height: 4000px; }
      </style></head><body><main id="page"></main>
      <script type="module" src="/test.js"></script></body></html>`,
      { headers: { 'content-type': 'text/html' } });
  },
});

interface BrowserTest {
  readonly route: string;
  readonly errors: number;
  readonly canRelease: boolean;
  setGate(value: 'ready' | 'fail' | 'wait'): void;
  release(): void;
  navigate(path: string): Promise<void>;
  retry(): Promise<void>;
  standalone(): void;
  restore(hash: string, type?: 'push' | 'replace'): void;
  dispose(): void;
}
declare global { interface Window { routerScrollTest: BrowserTest } }

const browser = await puppeteer.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 700 });
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on('pageerror', error => { errors.push(String(error)); });
  const reset = async () => {
    await page.goto(`http://127.0.0.1:${server.port}/first`);
    await page.waitForFunction(() => window.routerScrollTest?.route === '/first');
  };
  const scroll = async (y: number) => {
    await page.evaluate(value => window.scrollTo(0, value), y);
    await page.waitForFunction(value => window.scrollY === value, {}, y);
  };

  await reset();
  await scroll(900);
  await page.evaluate(() => window.routerScrollTest.navigate('/second'));
  await page.waitForFunction(() => window.scrollY === 0);
  await scroll(350);
  const historyLength = await page.evaluate(() => history.length);
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => window.routerScrollTest.route === '/first' && window.scrollY === 900);
  await page.evaluate(() => history.forward());
  await page.waitForFunction(() => window.routerScrollTest.route === '/second' && window.scrollY === 350);
  assert.equal(await page.evaluate(() => history.length), historyLength);
  console.log('PASS native back/forward restores independent entry positions');

  await page.evaluate(() => { window.routerScrollTest.setGate('wait'); history.back(); });
  await page.waitForFunction(() => window.routerScrollTest.canRelease);
  assert.equal(await page.evaluate(() => window.routerScrollTest.route), '/second');
  await page.evaluate(() => window.routerScrollTest.release());
  await page.waitForFunction(() => window.routerScrollTest.route === '/first' && window.scrollY === 900);
  console.log('PASS pending native traversal retains old UI until preparation resolves');

  await page.evaluate(() => history.forward());
  await page.waitForFunction(() => window.routerScrollTest.route === '/second' && window.scrollY === 350);
  await page.evaluate(() => { window.routerScrollTest.setGate('fail'); history.back(); });
  await page.waitForFunction(() => window.routerScrollTest.errors === 1 && location.pathname === '/second');
  assert.equal(await page.evaluate(() => window.routerScrollTest.route), '/second');
  assert.equal(await page.evaluate(() => history.length), historyLength);
  await page.evaluate(() => window.routerScrollTest.retry());
  await page.waitForFunction(() => window.routerScrollTest.route === '/first' && window.scrollY === 900);
  assert.equal(await page.evaluate(() => history.length), historyLength);
  console.log('PASS failed native traversal recovers and retries without duplicate history');

  await reset();
  await page.evaluate(async () => {
    window.routerScrollTest.standalone();
    window.routerScrollTest.restore('#late-target');
    for (let i = 0; i < 4; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    document.body.innerHTML = '<div style="height:1800px"></div><h2 id="late-target">Late</h2><div style="height:1200px"></div>';
  });
  await page.waitForFunction(() => Math.abs(document.getElementById('late-target')!.getBoundingClientRect().top) < 2);
  console.log('PASS late resource DOM triggers hash restoration after multiple frames');

  await scroll(400);
  await page.evaluate(() => {
    window.routerScrollTest.restore('', 'push');
    window.routerScrollTest.restore('', 'replace');
  });
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });
  assert.equal(await page.evaluate(() => scrollY), 400);
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.routerScrollTest.dispose());
  console.log('PASS obsolete queued restoration cannot scroll a newer replacement');
} finally {
  await browser.close();
  server.stop(true);
}
