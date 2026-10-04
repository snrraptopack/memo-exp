/** Compare compiler-generated DOM fixtures with isolated Git source snapshots. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import type { BenchRow } from './state-placement-browser';
import { helperComparisonSources } from './helper-comparison-fixture';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('bun run bench:dom:compare --before-ref=COMMIT [--isolate=both|compiler|runtime] [--samples=7] [--operations=swap,remove,... | --full] [--helpers]');
  process.exit(0);
}
if (args.some(arg => !/^(--before-ref=.+|--isolate=(both|compiler|runtime)|--samples=\d+|--operations=[a-z0-9,]+|--full|--helpers)$/.test(arg))) {
  throw new Error('Unknown comparison option; use --help');
}
const value = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const ref = value('before-ref');
if (!ref) throw new Error('An explicit --before-ref=COMMIT is required');
const samples = Number(value('samples') ?? 7);
if (!Number.isSafeInteger(samples) || samples < 1) throw new Error('samples must be positive');
const isolate = value('isolate') ?? 'both';
const helpers = args.includes('--helpers');
if (helpers && args.includes('--full')) throw new Error('Helper comparison is a focused suite; omit --full');
if (args.includes('--full') && value('operations')) throw new Error('Choose --full or --operations');
const root = resolve(import.meta.dirname, '../..');
async function git(...arguments_: string[]): Promise<string> {
  const child = Bun.spawn(['git', ...arguments_], { cwd: root, stdout: 'pipe', stderr: 'inherit' });
  const output = await new Response(child.stdout).text();
  if (await child.exited !== 0) throw new Error(`Git ${arguments_[0]} failed`);
  return output.trim();
}
const beforeCommit = await git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`);
if (!/^[a-f0-9]{40,64}$/.test(beforeCommit)) throw new Error('Invalid baseline commit');
const head = await git('rev-parse', 'HEAD');
const status = await git('status', '--porcelain');
const directory = resolve(import.meta.dirname, 'dist/compare', `${beforeCommit.slice(0, 8)}-${isolate}${helpers ? '-helpers' : ''}`);
const snapshot = resolve(directory, 'baseline');
mkdirSync(snapshot, { recursive: true });
const archive = resolve(snapshot, 'source.tar');
await git('archive', `--output=${archive}`, beforeCommit, 'packages/compiler', 'packages/runtime');
const extract = Bun.spawn(['tar', '-xf', archive, '-C', snapshot], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
if (await extract.exited !== 0) throw new Error('Cannot extract baseline');
const compilers = {
  before: await import(pathToFileURL(resolve(isolate === 'runtime' ? root : snapshot, 'packages/compiler/src/index.ts')).href),
  after: await import(pathToFileURL(resolve(root, 'packages/compiler/src/index.ts')).href),
};
const variants = [
  ['App', 'BenchApp', 'compiled-tsx-app', 'createCompiledTsxApp'],
  ['AppInline', 'BenchAppInline', 'compiled-inline-app', 'createCompiledInlineApp'],
  ['AppOwned', 'BenchAppOwned', 'compiled-owned-app', 'createCompiledOwnedApp'],
  ['AppInlineOwned', 'BenchAppInlineOwned', 'compiled-inline-owned-app', 'createCompiledInlineOwnedApp'],
  ['AppModuleDataComponent', 'BenchModuleDataComponent', 'compiled-module-data-component', 'createModuleDataComponent'],
  ['AppModuleDataInline', 'BenchModuleDataInline', 'compiled-module-data-inline', 'createModuleDataInline'],
  ['AppModuleSelectionComponent', 'BenchModuleSelectionComponent', 'compiled-module-selection-component', 'createModuleSelectionComponent'],
  ['AppModuleSelectionInline', 'BenchModuleSelectionInline', 'compiled-module-selection-inline', 'createModuleSelectionInline'],
] as const;
const data = readFileSync(resolve(import.meta.dirname, 'data.ts'), 'utf8');
const entry = resolve(import.meta.dirname, helpers ? 'helper-comparison-browser.ts' : 'state-placement-browser.ts');
const hashes: Record<string, string> = {};
for (const variant of ['before', 'after'] as const) {
  const output = resolve(directory, variant);
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, 'data.ts'), data);
  if (helpers) {
    const compiled = compilers[variant].compileModules(helperComparisonSources());
    for (const [id, source] of Object.entries(compiled)) {
      writeFileSync(resolve(output, id === './App.tsx' ? 'compiled-helper-app.ts' : id), source as string);
    }
  } else for (const [file, component, module, factory] of variants) {
    const id = `./bench/dom/${file}.tsx`;
    const compiled = compilers[variant].compileModules({
      [id]: readFileSync(resolve(import.meta.dirname, `${file}.tsx`), 'utf8'),
      './bench/dom/data.ts': data,
      './bench/dom/entry.ts': `import {mount} from '@memoized-dom/runtime';import {${component}} from './${file}';mount('root',${component});`,
    })[id];
    // The adapter is authored harness code; the component is always compiler output.
    writeFileSync(resolve(output, `${module}.ts`), `${compiled}
export function ${factory}(){
  const root=${component}('${component}',null),toolbar=root.querySelector('.toolbar'),ul=root.querySelector('ul');
  return {root,click(name){const button=[...toolbar.children].find(child=>child.textContent===name);
    if(!button)throw new Error('Missing button '+name);button.click();},
    selectRow(index){ul.children[index].click();},rowCount(){return ul.children.length;}};
}`);
  }
  const runtimeRoot = variant === 'before' && isolate !== 'compiler' ? snapshot : root;
  const bundle = resolve(output, 'browser.js');
  await build({ entryPoints: [entry], outfile: bundle,
    bundle: true, format: 'iife', minify: true, define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'isolated-dom-inputs', setup(builder) {
      builder.onResolve({ filter: /^\.\/compiled-/ }, ({ path, importer }) =>
        importer === entry ? { path: resolve(output, `${path}.ts`) } : undefined);
      builder.onResolve({ filter: /^@memoized-dom\/runtime(?:\/client)?$/ }, () =>
        ({ path: resolve(runtimeRoot, 'packages/runtime/src/index.ts') }));
    } }],
  });
  hashes[variant] = createHash('sha256').update(readFileSync(bundle)).digest('hex');
  writeFileSync(resolve(output, 'index.html'), '<!doctype html><body><script src="./browser.js"></script>');
}
// Focused timing still runs every existing correctness and mixed-sequence gate.
const focused = helpers ? ['reverse 10k', 'rotate 10k', 'drop 10k'] : [
  'create 10k', 'replace 10k', 'update 10k', 'swap 10k', 'remove 10k', 'clear 10k',
  'append1k 10k', 'prepend1k 10k', 'pop1k 10k', 'reverse 10k', 'remove100 10k',
];
const requested = value('operations')?.split(',');
if (requested?.some(operation => !focused.some(name => name === `${operation} 10k`))) {
  throw new Error(`Unknown operation; use ${focused.map(name => name.split(' ')[0]).join(',')}`);
}
const names = args.includes('--full') ? undefined : requested?.map(operation => `${operation} 10k`) ?? focused;
const browser = await puppeteer.launch({ headless: true, protocolTimeout: 600000,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/chromium'),
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const runs: Array<{ variant: string; rows: BenchRow[] }> = [];
let browserVersion: string;
try {
  browserVersion = await browser.version();
  for (const variant of ['before', 'after', 'after', 'before']) {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.text().startsWith('measure ')) console.log(`${variant}: ${message.text()}`); });
    await page.evaluateOnNewDocument(() => {
      let seed = 173091;
      Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    });
    try {
      await page.goto(pathToFileURL(resolve(directory, variant, 'index.html')).href);
      const rows = await page.evaluate(options => (window as unknown as {
        __runAll(input: typeof options): BenchRow[];
      }).__runAll(options), { names, samples, collectSamples: true });
      if (errors.length) throw new Error(errors.join('\n'));
      runs.push({ variant, rows });
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
const lines = ['# Local DOM comparison', '', `Baseline: ${beforeCommit}. Current HEAD: ${head}.`, '',
  `Current working tree includes changes: ${status !== ''}. Bundle hashes and checkout status are recorded in results.json.`, '',
  `Isolation: ${isolate}. Browser: ${browserVersion}. ${samples} samples per cell; ABBA order.`, '',
  helpers ? 'Focused closed-producer helper fixture: reverse, rotate and drop, plus mixed selection/reverse. This does not establish gains for opaque producers or the general DOM/Octane suite.'
    : 'All 21 scenarios and mixed sequences validated before timing.', '',
  'Every timed sample validates text, classes, order and retained identity outside timing. Authored inputs and deterministic seeds match. Timing includes JavaScript and DOM writes, excludes paint.', '',
  `Identical browser artifacts: ${hashes.before === hashes.after}. Local noise remains; this is not a VM ranking.`, ''];
for (const [before, after] of [[0, 1], [3, 2]] as const) {
  lines.push(`## ${before === 0 ? 'Before first' : 'After first'}`, '',
    '| Operation | State / rows | Before ms | After ms |', '|---|---|---:|---:|');
  for (const row of runs[before]!.rows) for (const [id, time] of Object.entries(row.timings)) {
    const next = runs[after]!.rows.find(other => other.name === row.name)!.timings[id]!;
    lines.push(`| ${row.name} | ${id} | ${time.toFixed(3)} | ${next.toFixed(3)} |`);
  }
}
writeFileSync(resolve(directory, 'results.json'), JSON.stringify({ beforeCommit, head, status, isolate,
  browserVersion, samples, names, helpers, hashes, measuredAt: new Date().toISOString(), runs }, null, 2) + '\n');
writeFileSync(resolve(directory, 'results.md'), lines.join('\n') + '\n');
console.log(`Report: ${resolve(directory, 'results.md')}`);
