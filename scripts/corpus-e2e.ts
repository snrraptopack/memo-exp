/**
 * Client committed-path e2e across the example corpus.
 *
 * Boots the real Vite dev server (memoized-dom plugin active) and drives
 * every example in a headless Chrome, asserting per example:
 *   1. the app mounts into its root (no blank page),
 *   2. zero console errors / page errors during load and settle,
 *   3. the committed data path lands (per-example expectation, where the
 *      example has one — e.g. workspace shows the session user after the
 *      mock latency, proving async data committed into the UI).
 *
 * Run: `bun run test:corpus` (needs Chrome; see PUPPETEER_EXECUTABLE_PATH).
 * Kept outside the vitest root suite: it requires a live server + browser.
 */
import { createServer, type ViteDevServer } from 'vite';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import memoizedDom from '@memoized-dom/vite';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const examplesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');

/**
 * Examples that are not standalone client applications. The SSR showcase
 * requires its own fullstack server to provide hydration markers; serving its
 * index through this client-only harness would correctly fail hydration.
 */
const SKIP = new Set([
  'dist',
  'node_modules',
  'external-library',
  'ssr-showcase',
]);

interface CaseExpectation {
  /** Text that must appear once async data has committed. */
  contains?: string;
  /** Extra settle time (ms) after load for async commits. */
  settleMs?: number;
}

/**
 * Per-example committed-path expectations. Generic cases (mount + no
 * console errors) need no entry; add one when an example has a known
 * async-commit outcome worth pinning.
 */
const EXPECTATIONS: Record<string, CaseExpectation> = {
  // Session source commits after mock latency; badge shows the user's
  // initial, notifications rows render with an unread pill.
  workspace: { contains: 'ada@workspace.dev', settleMs: 2500 },
};

const executablePath =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/usr/bin/google-chrome');

const examples = readdirSync(examplesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !SKIP.has(e.name))
  .map((e) => e.name)
  .sort();

const failures: string[] = [];

/** Collect actionable browser errors from first paint through settle. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    // Chromium emits this generic message for every failed resource,
    // including harmless favicons. The response listener below records
    // actionable application resources with their URL and status.
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource:')) {
      errors.push(`console: ${msg.text()}`);
    }
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const type = response.request().resourceType();
    if (type === 'document' || type === 'script' || type === 'fetch' || type === 'xhr') {
      errors.push(`HTTP ${response.status()} ${response.url()}`);
    }
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}
/** Settle delay via withResolvers (linear control flow, no executor). */
function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function checkExample(
  browser: Browser,
  server: ViteDevServer,
  name: string,
): Promise<void> {
  const expectation = EXPECTATIONS[name] ?? {};
  const page = await browser.newPage();
  const errors = watchErrors(page);
  try {
    const response = await page.goto(
      `${server.resolvedUrls!.local[0]}${name}/`,
      { waitUntil: 'networkidle2', timeout: 30_000 },
    );
    if (!response || response.status() !== 200) {
      failures.push(`${name}: HTTP ${response?.status() ?? 'no response'}`);
      return;
    }

    if (expectation.settleMs !== undefined) {
      await delay(expectation.settleMs);
    }

    // 1. App mounted: the mount root has rendered children.
    const mounted = await page.evaluate(() => {
      const root = document.querySelector('#root, [data-mmd-root], body > div');
      return root !== null && root.children.length > 0;
    });
    if (!mounted) {
      failures.push(`${name}: app did not mount into root`);
    }

    // 2. Committed data path landed.
    if (expectation.contains !== undefined) {
      const body = await page.evaluate(() => document.body.textContent ?? '');
      if (!body.includes(expectation.contains)) {
        failures.push(
          `${name}: committed content missing ${JSON.stringify(expectation.contains)}`,
        );
      }
    }

    // 3. Zero runtime errors.
    if (errors.length > 0) {
      failures.push(`${name}:\n  ${errors.slice(0, 3).join('\n  ')}`);
    }
  } catch (error) {
    failures.push(`${name}: ${(error as Error).message}`);
  } finally {
    await page.close();
  }
}

const server = await createServer({
  root: examplesDir,
  logLevel: 'error',
  plugins: [memoizedDom({ entries: 'entry.ts' })],
  server: { port: 0 },
});
await server.listen();

const browser = await puppeteer.launch({
  executablePath,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  headless: true,
});

try {
  for (const name of examples) {
    await checkExample(browser, server, name);
    const failed = failures.some((f) => f.startsWith(`${name}:`));
    process.stdout.write(`${failed ? '×' : '✓'} ${name}\n`);
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length > 0) {
  process.stdout.write(`\n${failures.length} failure(s):\n${failures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`\ncorpus e2e: ${examples.length} examples green\n`);
