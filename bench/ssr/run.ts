import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderToString, renderToStringAsync } from '@memoized-dom/server';
import { hydrate, registerRootFactory, resetScheduler, setScheduler } from '@memoized-dom/runtime';
import { parseHTML } from 'linkedom';
import { TABLE_SOURCE, DASHBOARD_SOURCE, compileScenario } from './scenarios';

const outDir = join(import.meta.dirname, 'dist');
mkdirSync(outDir, { recursive: true });

const tablePath = join(outDir, 'table.compiled.ts');
const dashboardPath = join(outDir, 'dashboard.compiled.ts');

writeFileSync(tablePath, compileScenario(TABLE_SOURCE));
writeFileSync(dashboardPath, compileScenario(DASHBOARD_SOURCE));

const tableMod = await import(pathToFileURL(tablePath).href);
const dashboardMod = await import(pathToFileURL(dashboardPath).href);

interface BenchmarkMetric {
  name: string;
  serverRenderMs: number;
  serverThroughputOpsPerSec: number;
  htmlBytes: number;
  markedBytes: number;
  markerOverheadRatio: string;
  clientHydrateMs: number;
}

function benchmarkSync(
  name: string,
  app: { App(id: string, parent: null): Node },
  iterations = 100,
): BenchmarkMetric {
  registerRootFactory(app.App, {
    id: 'App',
    create: () => app.App('App', null),
  });

  // 1. Measure Server Render Time (plain HTML)
  // Warmup
  for (let i = 0; i < 10; i++) renderToString(app.App, { markers: false });

  const startServer = performance.now();
  for (let i = 0; i < iterations; i++) {
    renderToString(app.App, { markers: false });
  }
  const endServer = performance.now();
  const serverRenderMs = (endServer - startServer) / iterations;
  const serverThroughputOpsPerSec = Math.round(1000 / serverRenderMs);

  // 2. Measure HTML Sizes
  const plainHtml = renderToString(app.App, { markers: false });
  const markedHtml = renderToString(app.App, { markers: true });
  const htmlBytes = Buffer.byteLength(plainHtml, 'utf8');
  const markedBytes = Buffer.byteLength(markedHtml, 'utf8');
  const markerOverheadRatio = `${(((markedBytes - htmlBytes) / htmlBytes) * 100).toFixed(1)}%`;
  // 3. Measure Client Hydration Time (under real DOM environment)
  const { document: clientDocument } = parseHTML('<!DOCTYPE html><html><body></body></html>');
  globalThis.document = clientDocument as unknown as Document;
  const host = clientDocument.createElement('div');
  clientDocument.body.appendChild(host);
  for (let i = 0; i < 5; i++) {
    host.innerHTML = markedHtml;
    const m = hydrate(host, app.App);
    m.unmount();
  }

  const startHydrate = performance.now();
  for (let i = 0; i < iterations; i++) {
    host.innerHTML = markedHtml;
    const m = hydrate(host, app.App);
    m.unmount();
  }
  const endHydrate = performance.now();
  const clientHydrateMs = (endHydrate - startHydrate) / iterations;
  host.parentNode?.removeChild(host);

  return {
    name,
    serverRenderMs: Number(serverRenderMs.toFixed(3)),
    serverThroughputOpsPerSec,
    htmlBytes,
    markedBytes,
    markerOverheadRatio,
    clientHydrateMs: Number(clientHydrateMs.toFixed(3)),
  };
}

console.log('========================================================================================');
console.log('                 MEMOIZED-DOM SSR & HYDRATION BENCHMARK (Phase 4 String-Writer)         ');
console.log('========================================================================================\n');

setScheduler((fn) => fn());

const tableResults = benchmarkSync('Table (1,000 Keyed Rows)', tableMod, 50);
const dashboardResults = benchmarkSync('Dashboard (Cards + Branch)', dashboardMod, 200);

resetScheduler();

const results = [tableResults, dashboardResults];

console.log(
  'Scenario'.padEnd(30),
  'Server (ms)'.padStart(12),
  'Throughput'.padStart(14),
  'HTML Size'.padStart(12),
  'Marked Size'.padStart(12),
  'Overhead'.padStart(10),
  'Hydrate (ms)'.padStart(14),
);
console.log('-'.repeat(110));

for (const r of results) {
  console.log(
    r.name.padEnd(30),
    `${r.serverRenderMs} ms`.padStart(12),
    `${r.serverThroughputOpsPerSec} ops/s`.padStart(14),
    `${r.htmlBytes} B`.padStart(12),
    `${r.markedBytes} B`.padStart(12),
    r.markerOverheadRatio.padStart(10),
    `${r.clientHydrateMs} ms`.padStart(14),
  );
}

console.log('\n========================================================================================');
console.log('Notes:');
console.log('- Server render uses Phase 4 fast StringDocument tier (server-string mode).');
console.log('- LinkeDOM (server-dom mode) is preserved as the correctness oracle for tests.');
console.log('========================================================================================\n');
