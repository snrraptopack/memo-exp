import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer-core';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import memoizedDom, { memoizedDomFullstack } from '../src';

const repository = resolve(import.meta.dirname, '../../..');
const runtime = resolve(repository, 'packages/runtime/src/index.ts');
const runtimeHot = resolve(repository, 'packages/runtime/src/hot.ts');
const runtimeHydrate = resolve(repository, 'packages/runtime/src/hydrate.ts');
const runtimeServer = resolve(repository, 'packages/runtime/src/server.ts');
const data = resolve(repository, 'packages/data/src/index.ts');
const dataInternal = resolve(repository, 'packages/data/src/internal.ts');
const router = resolve(repository, 'packages/router/src/index.ts');
const routerInternal = resolve(repository, 'packages/router/src/internal.ts');
const serverIndex = resolve(repository, 'packages/server/src/index.ts');
const serverRouter = resolve(repository, 'packages/server/src/http-router.ts');

function chromeExecutable(): string | null {
  const configured = process.env.MMD_CHROME_PATH;
  const candidates = [
    configured,
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

let vite: ViteDevServer | undefined;
let browser: Browser | undefined;
let fixture: string | undefined;

afterEach(async () => {
  await browser?.close();
  browser = undefined;
  await vite?.close();
  vite = undefined;
  if (fixture !== undefined) {
    await rm(fixture, { recursive: true, force: true });
    fixture = undefined;
  }
}, 30_000);

describe('fullstack browser integration', () => {
  it('hydrates facade sources, rebinds parameters, and settles event-created results', async (context) => {
    const executablePath = chromeExecutable();
    if (executablePath === null) {
      context.skip('Chrome is unavailable; set MMD_CHROME_PATH to run this test');
      return;
    }

    fixture = await mkdtemp(join(tmpdir(), 'memoized-dom-fullstack-browser-'));
    const functions = resolve(fixture, 'server/functions');
    await mkdir(functions, { recursive: true });
    await writeFile(resolve(fixture, 'index.html'), `
      <!doctype html>
      <html>
        <head><title>Fullstack fixture</title></head>
        <body>
          <div id="root"><!--ssr-outlet--></div>
          <script type="module" src="/main.ts"></script>
        </body>
      </html>
    `);
    await writeFile(resolve(fixture, 'styles.css'), `
      main { color: rgb(12, 34, 56); }
    `);
    await writeFile(resolve(functions, 'stories.ts'), `
      const stories = [
        { id: 1, title: 'First', votes: 3 },
        { id: 2, title: 'Second', votes: 5 },
      ];
      export async function getStories() {
        return stories;
      }
      export async function getStory(id: number) {
        return stories.find(story => story.id === id) ?? null;
      }
      export async function postVote(id: number) {
        const story = stories.find(candidate => candidate.id === id);
        if (story === undefined) throw new Error('Missing story');
        await new Promise(resolve => setTimeout(resolve, 100));
        if (id === 2) throw new Error('Vote rejected');
        story.votes++;
        return { id: story.id, votes: story.votes };
      }
    `);
    await writeFile(resolve(fixture, 'App.tsx'), `
      import { getStories, getStory, postVote } from '#server-functions';
      import { $track } from '@memoized-dom/data';
      import { route } from '@memoized-dom/router';
      export function App() {
        let selectedId = null as number | null;
        let lastVote = null as ReturnType<typeof postVote> | null;
        const stories = getStories();
        const tab = route.query.get('tab') ?? 'board';
        return <main route="/">
          <section data-page="home" route="/">
            <nav>
              <a data-tab="board" route-to={{ path: '/', query: { tab: 'board' } }}>Board</a>
              <a data-tab="activity" route-to={{ path: '/', query: { tab: 'activity' } }}>Activity</a>
            </nav>
            <section data-panel="board" if={tab === 'board'}>Board panel</section>
            <section data-panel="activity" if={tab === 'activity'}>Activity panel</section>
            <ul>{stories.map(story => <li key={story.id}>
              <span>{story.title}: {story.votes}</span>
              <button data-detail={story.id} onClick={() => { selectedId = story.id; }}>Details</button>
              <button data-vote={story.id} onClick={() => {
                lastVote = postVote(story.id);
                const tracked = $track(lastVote);
                story.votes++;
                tracked.onError(() => { story.votes--; });
              }}>Vote</button>
              <a data-open-project={story.id} route-to={{
                path: '/projects/:storyId',
                params: { storyId: story.id },
              }}>Open project</a>
            </li>)}</ul>
            {selectedId !== null && <Detail id={selectedId} />}
            {lastVote !== null && <output>
              {$track(lastVote).pending
                ? 'Voting'
                : $track(lastVote).error !== null
                  ? 'Vote failed'
                  : 'Voted #' + lastVote.id}
            </output>}
          </section>
          <section data-page="project" route="/projects/:storyId">
            <h1>Project {route.params.storyId}</h1>
            <a data-switch-project route-to={{
              path: '/projects/:storyId',
              params: { storyId: route.params.storyId === '1' ? 2 : 1 },
            }}>Switch project</a>
            <a data-back-home route-to="/">Back</a>
          </section>
        </main>;
      }
      function Detail({ id }: { id: number }) {
        const story = getStory(id);
        return <article>{story?.title ?? 'Missing'}</article>;
      }
    `);
    await writeFile(resolve(fixture, 'main.ts'), `
      import { hydrate } from '@memoized-dom/runtime/hydrate';
      import { createDataRuntime, setActiveDataRuntime } from '@memoized-dom/data';
      import { App } from './App';
      import './styles.css';
      setActiveDataRuntime(createDataRuntime());
      hydrate('root', App, {
        recover: true,
        onRecover(error) { throw error; },
      });
    `);
    await writeFile(resolve(fixture, 'server.ts'), `
      import { defineServer } from '@memoized-dom/server';
      import { App } from './App';
      export default defineServer({
        app: App,
        document: new URL('./index.html', import.meta.url),
        render: { mode: 'resolve', markers: true },
      });
    `);

    vite = await createServer({
      root: fixture,
      configFile: false,
      appType: 'custom',
      logLevel: 'silent',
      resolve: {
        alias: [
          { find: '@memoized-dom/runtime/hydrate', replacement: runtimeHydrate },
          { find: '@memoized-dom/runtime/server', replacement: runtimeServer },
          { find: '@memoized-dom/runtime/hot', replacement: runtimeHot },
          { find: '@memoized-dom/runtime', replacement: runtime },
          { find: '@memoized-dom/data/internal', replacement: dataInternal },
          { find: '@memoized-dom/data', replacement: data },
          { find: '@memoized-dom/router/internal', replacement: routerInternal },
          { find: '@memoized-dom/router', replacement: router },
          { find: '@memoized-dom/server/router', replacement: serverRouter },
          { find: '@memoized-dom/server', replacement: serverIndex },
        ],
      },
      plugins: [
        memoizedDom({ entries: 'main.ts' }),
        memoizedDomFullstack({ entry: 'server.ts' }),
      ],
      server: { host: '127.0.0.1', port: 0 },
    });
    await vite.listen();
    const address = vite.httpServer?.address();
    if (address === null || address === undefined || typeof address === 'string') {
      throw new Error('Expected a Vite TCP server address');
    }
    const origin = `http://127.0.0.1:${address.port}`;
    const documentResponse = await fetch(`${origin}/?tab=activity`);
    const html = await documentResponse.text();
    expect(documentResponse.status, html).toBe(200);
    expect(html).toContain('<li');
    expect(html).toContain('Activity panel');
    expect(html).not.toContain('Board panel');
    expect(html).toContain(
      '<link rel="stylesheet" href="/styles.css" data-memoized-dom-dev>',
    );
    expect(html.indexOf('data-memoized-dom-dev')).toBeLessThan(
      html.indexOf('</head>'),
    );

    browser = await puppeteer.launch({ headless: true, executablePath });
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    const documentRequests: string[] = [];
    const failedPostRequests: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('requestfailed', request => {
      if (request.url().includes('/postVote')) {
        failedPostRequests.push(request.failure()?.errorText ?? 'failed');
      }
    });
    page.on('request', request => {
      if (request.resourceType() === 'document') {
        documentRequests.push(request.url());
      }
    });
    await page.goto(`${origin}/?tab=activity`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(
      () => document.querySelectorAll('li').length === 2,
      { timeout: 10_000 },
    );
    expect(await page.$eval('main', element => getComputedStyle(element).color))
      .toBe('rgb(12, 34, 56)');
    expect(await page.$eval('[data-panel]', element => element.textContent))
      .toBe('Activity panel');
    documentRequests.length = 0;

    await page.click('[data-tab="board"]');
    await page.waitForFunction(
      () => document.querySelector('[data-panel]')?.textContent === 'Board panel',
    );
    await page.click('[data-tab="activity"]');
    await page.waitForFunction(
      () => document.querySelector('[data-panel]')?.textContent === 'Activity panel',
    );
    await page.click('[data-tab="board"]');
    await page.waitForFunction(
      () => document.querySelector('[data-panel]')?.textContent === 'Board panel',
    );

    await page.click('[data-detail="2"]');
    try {
      await page.waitForFunction(
        () => document.querySelector('article')?.textContent === 'Second',
        { timeout: 5_000 },
      );
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        url: location.href,
        body: document.body.innerHTML,
      }));
      throw new Error(
        `Details did not render after route updates: ${JSON.stringify({
          ...diagnostics,
          pageErrors,
          documentRequests,
        })}`,
        { cause: error },
      );
    }
    await page.click('[data-detail="1"]');
    await page.waitForFunction(() => document.querySelector('article')?.textContent === 'First');
    await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>('[data-vote="1"]');
      if (button === null) throw new Error('Missing vote button');
      for (let index = 0; index < 12; index++) button.click();
    });
    await page.waitForFunction(() => document.querySelector('output')?.textContent === 'Voted #1');
    await page.waitForFunction(
      () => document.querySelector('li span')?.textContent === 'First: 15',
    );
    await page.click('[data-vote="2"]');
    await page.waitForFunction(() => document.querySelector('output')?.textContent === 'Vote failed');
    await page.click('[data-detail="2"]');
    await page.waitForFunction(() => document.querySelector('article')?.textContent === 'Second');

    await page.click('[data-open-project="1"]');
    await page.waitForFunction(
      () => document.querySelector('[data-page="project"] h1')?.textContent === 'Project 1',
    );
    expect(await page.$$eval('[data-page]', elements => elements.length)).toBe(1);
    expect(await page.$$eval('[data-page="home"]', elements => elements.length)).toBe(0);
    await page.click('[data-switch-project]');
    await page.waitForFunction(
      () => document.querySelector('[data-page="project"] h1')?.textContent === 'Project 2',
    );
    expect(await page.$$eval('[data-page="project"]', elements => elements.length)).toBe(1);
    await page.click('[data-back-home]');
    await page.waitForFunction(
      () => document.querySelector('[data-page="home"]') !== null,
    );
    expect(await page.$$eval('[data-page]', elements => elements.length)).toBe(1);

    expect(documentRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedPostRequests).toEqual([]);
  }, 60_000);
});
