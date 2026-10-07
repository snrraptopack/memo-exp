/** Paired compiler leaf-writer experiment; output parity gates precede timing. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cpus } from 'node:os';
import { compileModules } from '@memoized-dom/compiler';
import { resetScheduler, setScheduler } from '@memoized-dom/runtime';
import { renderToString, type ServerComponent } from '../../packages/server/src/index';
import { RenderSession } from '../../packages/server/src/session';
import { StringDocument } from '../../packages/server/src/string-document';
import { TABLE_SOURCE, DASHBOARD_SOURCE } from './scenarios';

const directory = join(import.meta.dirname, 'dist');
mkdirSync(directory, { recursive: true });
const rounds = Number(process.argv.find(arg => arg.startsWith('--rounds='))?.slice(9) ?? 12);
const iterations = Number(process.argv.find(arg => arg.startsWith('--iterations='))?.slice(13) ?? 20);
const warmups = Number(process.argv.find(arg => arg.startsWith('--warmups='))?.slice(10) ?? 30);
const filter = process.argv.find(arg => arg.startsWith('--filter='))?.slice(9);
const stages = process.argv.includes('--stages');
const retained = Number(process.argv.find(arg => arg.startsWith('--retained='))?.slice(11) ?? 0);
assert(Number.isInteger(rounds) && rounds > 0 && Number.isInteger(iterations) && iterations > 0);
assert(Number.isInteger(warmups) && warmups >= 0 && Number.isInteger(retained) && retained >= 0);
const gcRuntime = globalThis as { gc?: () => void; Bun?: { gc(sync: boolean): void } };
const forceGc = gcRuntime.gc ?? (gcRuntime.Bun ? () => gcRuntime.Bun!.gc(true) : undefined);
assert(retained === 0 || forceGc, '--retained requires globalThis.gc or Bun.gc');
async function variant(name: string, source: string, ssrWriter: boolean) {
  const id = `./writer-bench-${name}.tsx`;
  const code = compileModules({
    [id]: source,
    './main.ts': `import { mount } from '@memoized-dom/runtime'; import { App } from '${id}'; mount('root', App);`,
  }, { ssrWriter })[id]!;
  const path = join(directory, `writer-bench-${name}-${ssrWriter}.ts`);
  writeFileSync(path, code);
  const module = await import(pathToFileURL(path).href);
  assert.equal(code.includes('.htmlWriter'), ssrWriter, `${name} must exercise the proposed path`);
  return { component: module.App as ServerComponent, codeBytes: Buffer.byteLength(code) };
}
function allocationCount(component: ServerComponent) {
  let elements = 0;
  let texts = 0;
  let retainedNodes = 0;
  class Counter extends StringDocument {
    override createElement(tag: string) { elements++; return super.createElement(tag); }
    override createTextNode(text: string) { texts++; return super.createTextNode(text); }
  }
  function count(node: Node): number {
    let total = 1;
    for (let child = node.firstChild; child !== null; child = child.nextSibling) total += count(child);
    return total;
  }
  RenderSession.execute(component, {}, { mode: 'server-string', document: new Counter() }, session => {
    retainedNodes = count(session.mount());
  });
  // Factory calls omit nodes cloned from cached row templates. Count the
  // retained output graph too; neither metric includes slot/closure objects.
  return { elements, texts, retainedNodes };
}
function stageProfile(component: ServerComponent, markers: boolean) {
  const started = performance.now();
  const session = new RenderSession(component, { markers }, { mode: 'server-string', document: new StringDocument() });
  const created = performance.now();
  let mounted = created;
  let serialized = created;
  try {
    session.run(() => {
      const root = session.mount();
      mounted = performance.now();
      session.wrap((root as unknown as { toString(markers: boolean): string }).toString(markers));
      serialized = performance.now();
    });
  } finally { session.dispose(); }
  return { session: created - started, mount: mounted - created, serialize: serialized - mounted,
    dispose: performance.now() - serialized };
}
function retainedHeap(component: ServerComponent, markers: boolean, count: number) {
  forceGc!();
  const before = process.memoryUsage().heapUsed;
  // Hold complete live sessions and their output roots, including row closures.
  // Measure before serialization to avoid counting response string retention.
  const held: { session: RenderSession; root: Node }[] = [];
  try {
    for (let index = 0; index < count; index++) {
      const session = new RenderSession(component, { markers }, { mode: 'server-string', document: new StringDocument() });
      held.push({ session, root: session.run(() => session.mount()) });
    }
    forceGc!();
    const live = process.memoryUsage().heapUsed;
    for (const entry of held) entry.session.dispose();
    held.length = 0;
    forceGc!();
    return { count, liveBytesPerSession: (live - before) / count,
      afterReleaseGrowthBytes: process.memoryUsage().heapUsed - before };
  } finally { for (const entry of held) entry.session.dispose(); }
}
const results: unknown[] = [];
setScheduler(run => run());
try {
  for (const [name, source] of [['table', TABLE_SOURCE], ['dashboard', DASHBOARD_SOURCE]] as const) {
    if (filter && !name.includes(filter)) continue;
    const baseline = await variant(name, source, false);
    const writer = await variant(name, source, true);
    for (const markers of [false, true]) {
      const expected = renderToString(baseline.component, { markers });
      assert.equal(renderToString(writer.component, { markers }), expected, `${name}: exact output parity`);
      for (let index = 0; index < warmups; index++) {
        renderToString(baseline.component, { markers });
        renderToString(writer.component, { markers });
      }
      const samples: { round: number; variant: string; msPerRender: number; cpuMsPerRender: number }[] = [];
      for (let round = 0; round < rounds; round++) {
        for (const [label, entry] of round % 2
          ? [['writer', writer], ['baseline', baseline]] as const
          : [['baseline', baseline], ['writer', writer]] as const) {
          const cpuStart = process.cpuUsage();
          const started = performance.now();
          for (let index = 0; index < iterations; index++) renderToString(entry.component, { markers });
          const elapsed = performance.now() - started;
          const cpu = process.cpuUsage(cpuStart);
          samples.push({ round, variant: label, msPerRender: elapsed / iterations,
            cpuMsPerRender: (cpu.user + cpu.system) / 1000 / iterations });
        }
      }
      const median = (label: string) => {
        const values = samples.filter(sample => sample.variant === label).map(sample => sample.msPerRender).sort((a, b) => a - b);
        return values.length % 2 ? values[values.length >> 1]! : (values[values.length / 2 - 1]! + values[values.length / 2]!) / 2;
      };
      const baselineMs = median('baseline');
      const writerMs = median('writer');
      // Independent diagnostic passes; their extra clocks and forced GC never
      // enter the ordinary render wall/CPU samples above.
      const stageSamples = [];
      if (stages) for (let round = 0; round < rounds; round++) {
        for (const [label, entry] of round % 2
          ? [['writer', writer], ['baseline', baseline]] as const
          : [['baseline', baseline], ['writer', writer]] as const) {
          const total = { session: 0, mount: 0, serialize: 0, dispose: 0 };
          for (let index = 0; index < iterations; index++) {
            const sample = stageProfile(entry.component, markers);
            for (const key of ['session', 'mount', 'serialize', 'dispose'] as const) total[key] += sample[key] / iterations;
          }
          stageSamples.push({ round, variant: label, msPerRender: total });
        }
      }
      const retainedSamples = [];
      if (retained) for (let round = 0; round < 3; round++) {
        for (const [label, entry] of round % 2
          ? [['writer', writer], ['baseline', baseline]] as const
          : [['baseline', baseline], ['writer', writer]] as const) {
          retainedSamples.push({ round, variant: label, ...retainedHeap(entry.component, markers, retained) });
        }
      }
      const result = { name, markers, htmlBytes: Buffer.byteLength(expected), rounds, iterations,
        baselineMs, writerMs, ratio: baselineMs / writerMs,
        baselineNodes: allocationCount(baseline.component), writerNodes: allocationCount(writer.component),
        codeBytes: { baseline: baseline.codeBytes, writer: writer.codeBytes }, samples, stageSamples, retainedSamples };
      results.push(result);
      console.log(JSON.stringify({ ...result, samples: undefined, stageSamples: undefined, retainedSamples: undefined }));
    }
  }
} finally { resetScheduler(); }
assert(results.length, `no fixture matches ${filter}`);
writeFileSync(join(directory, 'writer-results.json'), JSON.stringify({
  measuredAt: new Date().toISOString(), versions: process.versions, platform: process.platform,
  cpu: cpus()[0]?.model, logicalCpus: cpus().length,
  warmups, stages, retained, forcedGc: typeof forceGc === 'function',
  methodology: 'Paired alternating batches after configurable warmups. Exact HTML parity before timing. Compilation and allocation/diagnostic probes excluded. Retained graph includes structural comments but excludes closures; live-session heap probes include runtime/row closures and are GC-dependent, not allocation counts. Stage probes add clocks and are separate from render timing. Local timings are process-specific, not universal speedups.',
  results,
}, null, 2));
