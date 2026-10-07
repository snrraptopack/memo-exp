/** In-process HTTP SSR benchmark; compilation and per-request gates are untimed. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModules } from '@memoized-dom/compiler';
import { resetScheduler, setScheduler } from '@memoized-dom/runtime';
import { serve, type RenderPolicy, type RenderReport, type ServerComponent } from '../../packages/server/src/index';
import { TABLE_SOURCE, DASHBOARD_SOURCE } from './scenarios';

const FEED_SOURCE = `
import { $fetch, Group } from '@memoized-dom/data';
function Pending() { return <p class="pending">Loading feed</p>; }
function Item(entry) {
  return <li class={entry.hot ? 'hot' : 'cold'}><a href={entry.href}>{entry.title}</a> <span>{entry.score}</span></li>;
}
export function Feed() {
  const feed = $fetch('/api/feed');
  return <main><h1>Feed</h1><Group pending={Pending}>
    <ul>{feed.items.map(entry => <Item entry={entry} key={entry.id} />)}</ul>
  </Group></main>;
}`;
const ROUTED_SOURCE = `
import { $routed, redirectRoute } from '@memoized-dom/router';
export function Report() {
  const page = $routed(async ({ params, locals, services, signal }) => {
    if (locals.token === 'redirect') return redirectRoute('/login');
    await services.prepare(signal);
    return { title: 'Report ' + params.id, token: locals.token };
  });
  return <main route="/reports/:id"><h1>{page.title}</h1><p>{page.token}</p></main>;
}`;
const outDir = join(import.meta.dirname, 'dist');
const ssrWriter = process.argv.includes('--writer');
const paired = process.argv.includes('--paired');
assert(!(paired && ssrWriter), 'use --paired or --writer');
mkdirSync(outDir, { recursive: true });
async function load(name: string, source: string, writer: boolean) {
  const id = `./http-${name}.tsx`;
  const component = name === 'feed' ? 'Feed' : name === 'routed' ? 'Report' : 'App';
  const output = compileModules({
    [id]: source,
    './main.ts': `import { mount } from '@memoized-dom/runtime'; import { ${component} } from '${id}'; mount('root', ${component});`,
  }, { routedEnvironment: 'server', ssrWriter: writer });
  if (writer && (name === 'table' || name === 'dashboard')) assert(output[id]!.includes('.htmlWriter'));
  const path = join(outDir, `${name}.${writer ? 'writer' : 'baseline'}.http.compiled.ts`);
  writeFileSync(path, output[id]!);
  return import(pathToFileURL(path).href);
}
const variants = [];
for (const writer of paired ? [false, true] : [ssrWriter]) {
  variants.push({ label: writer ? 'writer' : 'baseline',
    table: await load('table', TABLE_SOURCE, writer),
    dashboard: await load('dashboard', DASHBOARD_SOURCE, writer),
    feed: await load('feed', FEED_SOURCE, writer),
    routed: await load('routed', ROUTED_SOURCE, writer) });
}
const { table, dashboard, feed, routed } = variants[0]!;
const PREFIX = '<!doctype html><html><head><meta charset="utf-8"><title>bench</title><link rel="stylesheet" href="/app.css"><script type="module" src="/main.js"></script></head><body><div id="root">';
const SUFFIX = '</div></body></html>';
const TEMPLATE = PREFIX + '<!--ssr-outlet-->' + SUFFIX;
const FEED_ITEMS = Array.from({ length: 100 }, (_, id) => ({
  id, title: `Story ${id} & friends <${id % 7}>`, href: `/stories/${id}`,
  score: (id * 37) % 500, hot: id % 3 === 0,
}));

interface Scenario {
  name: string;
  component: ServerComponent;
  kind: 'table' | 'dashboard' | 'feed' | 'routed';
  policy: RenderPolicy;
  latency?: number;
  preparation?: number;
  concurrency: number;
  requests: number;
  cancel?: boolean;
  disconnect?: boolean;
  redirect?: boolean;
  slowConsumer?: number;
  expected: RenderReport['outcome'];
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); cleanup(); reject(signal!.reason); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function createApp(scenario: Scenario) {
  const reports = new Map<string, RenderReport>();
  const waiters = new Map<string, (report: RenderReport) => void>();
  const signals: AbortSignal[] = [];
  const app = serve<{ token: string }, unknown, { prepare(signal: AbortSignal): Promise<void> }>({
    createLocals: request => ({ token: request.headers.get('x-request-token')! }),
    createServices: () => ({ prepare: async signal => {
      signals.push(signal);
      await delay(scenario.preparation ?? 0, signal);
    } }),
    onRender: report => {
      const id = report.url.searchParams.get('sample')!;
      assert(!reports.has(id), `duplicate render report: ${id}`);
      reports.set(id, report);
      waiters.get(id)?.(report);
      waiters.delete(id);
    },
    onError: () => new Response('render failed', { status: 500 }),
  });
  app.get('/api/feed', async context => {
    signals.push(context.request.signal);
    await delay(scenario.latency ?? 0, context.request.signal);
    return { items: FEED_ITEMS };
  });
  app.ssr(scenario.component, scenario.policy);
  (app as unknown as { installDocumentTemplate(template: string): void }).installDocumentTemplate(TEMPLATE);
  return {
    app, reports, signals,
    report(id: string): Promise<RenderReport> {
      const known = reports.get(id);
      if (known) return Promise.resolve(known);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(id);
          reject(new Error(`render did not report completion: ${id}`));
        }, 5000);
        waiters.set(id, report => { clearTimeout(timer); resolve(report); });
      });
    },
  };
}

interface Sample {
  id: string;
  ttfb: number | null;
  firstApplicationByte: number | null;
  complete: number;
  bytes: number;
  chunks: number;
  status: number;
  outcome: RenderReport['outcome'];
  renderMs: number;
  settleMs?: number;
  outputHash?: string;
}

async function request(harness: ReturnType<typeof createApp>, scenario: Scenario, id: string): Promise<Sample> {
  const abort = new AbortController();
  const url = `https://bench.test${scenario.kind === 'routed' ? '/reports/42' : '/'}?sample=${id}`;
  const started = performance.now();
  const response = await harness.app.fetch(new Request(url, {
    signal: abort.signal, headers: { 'x-request-token': scenario.redirect ? 'redirect' : id },
  }));
  const reader = response.body?.getReader();
  let ttfb: number | null = null;
  let firstApplicationByte: number | null = null;
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    if (reader) for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const now = performance.now() - started;
      ttfb ??= now;
      bytes += value.byteLength;
      if (bytes > Buffer.byteLength(PREFIX) && !scenario.policy.deadline && !scenario.disconnect) firstApplicationByte ??= now;
      chunks.push(value);
      if (scenario.cancel) { await reader.cancel(); break; }
      if (scenario.disconnect) abort.abort(new DOMException('client disconnected', 'AbortError'));
      if (scenario.slowConsumer) await delay(scenario.slowConsumer);
    }
  } finally { reader?.releaseLock(); }
  const complete = performance.now() - started;
  const report = await harness.report(id);
  assert.equal(report.outcome, scenario.expected, `${scenario.name}: ${id}`);
  const html = Buffer.concat(chunks).toString('utf8');
  if (scenario.redirect) {
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'https://bench.test/login');
  } else {
    assert.equal(response.status, 200);
    if (scenario.cancel) assert.equal(html, PREFIX);
    else if (scenario.disconnect || scenario.expected === 'deadline') assert.equal(html, PREFIX + SUFFIX);
    else {
      assert(html.startsWith(PREFIX) && html.endsWith(SUFFIX));
      assert(html.includes('<!--mmd:r:') && html.includes('application/mmd+json'));
      if (scenario.kind === 'table') assert.equal((html.match(/<td>/g) ?? []).length, 3000);
      if (scenario.kind === 'dashboard') {
        assert.equal((html.match(/class="card"/g) ?? []).length, 4);
        assert(html.includes('Admin: Ada Lovelace') && html.includes('120 MB/s'));
      }
      if (scenario.kind === 'feed') {
        if (scenario.expected === 'complete') {
          assert.equal((html.match(/<li\b/g) ?? []).length, 100);
          assert(html.includes('Story 99 &amp; friends &lt;1&gt;'));
          assert(!html.includes('class="pending"'));
        } else assert(html.includes('class="pending"'));
      }
      if (scenario.kind === 'routed') {
        assert(html.includes('<h1>Report 42</h1>'));
        assert(html.includes(`<p>${id}</p>`), 'request locals crossed render boundaries');
        assert(html.includes('"routed":'));
      }
    }
  }
  return { id, ttfb, firstApplicationByte, complete, bytes, chunks: chunks.length,
    status: response.status, outcome: report.outcome, renderMs: report.durationMs, settleMs: report.settleMs,
    ...(paired ? { outputHash: createHash('sha256').update(html).digest('hex') } : {}) };
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}
const metric = (samples: Sample[], key: 'ttfb' | 'firstApplicationByte' | 'complete') => {
  const values = samples.map(sample => sample[key]).filter((value): value is number => value !== null);
  return { p50: percentile(values, .5), p95: percentile(values, .95) };
};
const quick = process.argv.includes('--quick');
const filter = process.argv.find(arg => arg.startsWith('--filter='))?.slice(9);
const repeats = Number(process.argv.find(arg => arg.startsWith('--repeats='))?.slice(10) ?? 3);
assert(Number.isInteger(repeats) && repeats > 0, '--repeats must be a positive integer');

async function run(scenario: Scenario, round: number) {
  const harness = createApp(scenario);
  for (let index = 0; index < 5; index++) await request(harness, { ...scenario, slowConsumer: 0 }, `warm-${index}`);
  harness.reports.clear();
  harness.signals.length = 0;
  (globalThis as { gc?: () => void }).gc?.();
  const samples: Sample[] = [];
  const base = process.memoryUsage();
  let heapPeak = base.heapUsed;
  let rssPeak = base.rss;
  const sampleMemory = () => {
    const memory = process.memoryUsage();
    heapPeak = Math.max(heapPeak, memory.heapUsed);
    rssPeak = Math.max(rssPeak, memory.rss);
  };
  const sampler = setInterval(sampleMemory, 5);
  const cpuStart = process.cpuUsage();
  const started = performance.now();
  let issued = 0;
  try {
    await Promise.all(Array.from({ length: scenario.concurrency }, async () => {
      while (issued < scenario.requests) {
        const id = `${round}-${issued++}`;
        samples.push(await request(harness, scenario, id));
        sampleMemory();
      }
    }));
  } finally { clearInterval(sampler); }
  const wallMs = performance.now() - started;
  const cpu = process.cpuUsage(cpuStart);
  sampleMemory();
  assert.equal(harness.reports.size, scenario.requests);
  if (scenario.cancel || scenario.disconnect || scenario.expected === 'deadline' || scenario.expected === 'timeout') {
    assert(harness.signals.length > 0 && harness.signals.every(signal => signal.aborted), 'request-owned work survived disposal');
  }
  const outcomes: Record<string, number> = {};
  for (const sample of samples) outcomes[sample.outcome] = (outcomes[sample.outcome] ?? 0) + 1;
  return {
    scenario: scenario.name, round, concurrency: scenario.concurrency, requests: samples.length,
    wallMs, requestsPerSecond: samples.length * 1000 / wallMs,
    ttfbMs: metric(samples, 'ttfb'), applicationByteMs: metric(samples, 'firstApplicationByte'),
    completionMs: metric(samples, 'complete'), cpuMsPerRequest: (cpu.user + cpu.system) / 1000 / samples.length,
    sampledHeapGrowthBytes: heapPeak - base.heapUsed, sampledRssGrowthBytes: rssPeak - base.rss,
    meanResponseBytes: samples.reduce((sum, sample) => sum + sample.bytes, 0) / samples.length,
    outcomes, samples,
  };
}

const scenarios: Scenario[] = [
  { name: 'table stream', component: table.App, kind: 'table', policy: {}, concurrency: 1, requests: 40, expected: 'complete' },
  { name: 'table buffer', component: table.App, kind: 'table', policy: { delivery: 'buffer' }, concurrency: 1, requests: 40, expected: 'complete' },
  { name: 'dashboard stream', component: dashboard.App, kind: 'dashboard', policy: {}, concurrency: 1, requests: 200, expected: 'complete' },
  { name: 'dashboard buffer', component: dashboard.App, kind: 'dashboard', policy: { delivery: 'buffer' }, concurrency: 1, requests: 200, expected: 'complete' },
  { name: 'feed stream', component: feed.Feed, kind: 'feed', policy: {}, latency: 30, concurrency: 1, requests: 40, expected: 'complete' },
  { name: 'feed buffer', component: feed.Feed, kind: 'feed', policy: { delivery: 'buffer' }, latency: 30, concurrency: 1, requests: 40, expected: 'complete' },
  { name: 'feed shell', component: feed.Feed, kind: 'feed', policy: { mode: 'shell' }, latency: 30, concurrency: 1, requests: 40, expected: 'shell' },
  { name: 'feed concurrent', component: feed.Feed, kind: 'feed', policy: {}, latency: 30, concurrency: 50, requests: 500, expected: 'complete' },
  { name: 'feed timeout', component: feed.Feed, kind: 'feed', policy: { timeout: 50 }, latency: 200, concurrency: 20, requests: 100, expected: 'timeout' },
  { name: 'feed cancellation', component: feed.Feed, kind: 'feed', policy: {}, latency: 30, concurrency: 20, requests: 200, cancel: true, expected: 'aborted' },
  { name: 'feed disconnect', component: feed.Feed, kind: 'feed', policy: {}, latency: 30, concurrency: 20, requests: 100, disconnect: true, expected: 'aborted' },
  { name: 'feed deadline', component: feed.Feed, kind: 'feed', policy: { deadline: 20 }, latency: 200, concurrency: 10, requests: 50, expected: 'deadline' },
  { name: 'table slow consumer', component: table.App, kind: 'table', policy: {}, concurrency: 10, requests: 50, slowConsumer: 5, expected: 'complete' },
  { name: 'routed preparation', component: routed.Report, kind: 'routed', policy: {}, preparation: 30, concurrency: 20, requests: 100, expected: 'complete' },
  { name: 'routed redirect', component: routed.Report, kind: 'routed', policy: {}, redirect: true, concurrency: 10, requests: 50, expected: 'redirect' },
];
const selected = scenarios.filter(scenario => filter ? scenario.name.includes(filter)
  : !paired || scenario.kind === 'table' || scenario.kind === 'dashboard');
assert(selected.length, `no scenario matches ${filter}`);
const results: (Awaited<ReturnType<typeof run>> & { variant: string })[] = [];
setScheduler(run => run());
try {
  for (let round = 0; round < repeats; round++) {
    for (const scenario of round % 2 ? [...selected].reverse() : selected) {
      const pair = [];
      for (const variant of round % 2 ? [...variants].reverse() : variants) {
        const component = variant[scenario.kind][scenario.kind === 'feed' ? 'Feed' : scenario.kind === 'routed' ? 'Report' : 'App'];
        const configured = { ...scenario, component };
        const result = { ...await run(quick ? { ...configured, requests: Math.min(scenario.requests, 12), concurrency: Math.min(scenario.concurrency, 4) } : configured, round), variant: variant.label };
        results.push(result);
        pair.push(result);
        console.log(`${scenario.name} ${variant.label} round ${round + 1}: ${result.outcomes[scenario.expected]} gates passed`);
      }
      if (paired) {
        const hashes = (result: typeof pair[number]) => result.samples.map(sample =>
          [sample.id, sample.status, sample.outcome, sample.bytes, sample.outputHash]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
        assert.deepEqual(hashes(pair[0]!), hashes(pair[1]!), `${scenario.name}: paired response parity`);
      }
    }
  }
} finally { resetScheduler(); }
writeFileSync(join(outDir, paired ? 'http-paired-results.json' : ssrWriter ? 'http-writer-results.json' : 'http-results.json'), JSON.stringify({
  measuredAt: new Date().toISOString(), runtime: process.versions, platform: process.platform,
  arch: process.arch, cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemory: totalmem(),
  quick, repeats, ssrWriter, paired, forcedGc: typeof (globalThis as { gc?: unknown }).gc === 'function',
  methodology: 'In-process Request→Response→reader; excludes network and paint. Per-request clocks exclude validation; throughput/CPU include gates and memory sampling. 5ms sampled memory is a lower bound on peak live memory. Application body remains atomic.',
  results,
}, null, 2));
console.table(results.map(result => ({
  scenario: result.scenario, variant: result.variant, round: result.round + 1, 'req/s': result.requestsPerSecond.toFixed(0),
  'ttfb p50': result.ttfbMs.p50?.toFixed(2), 'app p50': result.applicationByteMs.p50?.toFixed(2),
  'done p95': result.completionMs.p95?.toFixed(2), 'cpu ms/req': result.cpuMsPerRequest.toFixed(2),
  'heap MB': (result.sampledHeapGrowthBytes / 1048576).toFixed(1), outcomes: JSON.stringify(result.outcomes),
})));
