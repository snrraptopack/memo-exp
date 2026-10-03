/** Compare isolated compiler snapshots with one runtime and independently checked DOM. */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { compileModules } from '@memoized-dom/compiler';
import type { BenchRow } from './state-placement-browser';
import { ownerReorderSource } from './local-owner-source';

if (process.argv.includes('--help')) {
  console.log('Usage: bun run bench:dom:compare [--before-ref=<commit> | --before-compiler=<source or bundle>] [--mutable-content] (default: HEAD)');
  process.exit(0);
}
const root = resolve(import.meta.dirname, '../..');
const mutableContent = process.argv.includes('--mutable-content');
const directory = resolve(import.meta.dirname, 'dist/local-owner-compare', mutableContent ? 'mutable-content' : '.');
mkdirSync(directory, { recursive: true });
let beforePath = process.argv.find(value => value.startsWith('--before-compiler='))?.slice('--before-compiler='.length);
const beforeRef = process.argv.find(value => value.startsWith('--before-ref='))?.slice('--before-ref='.length);
if (beforePath !== undefined && beforeRef !== undefined) throw new Error('Choose one baseline: --before-ref or --before-compiler');
let beforeCommit: string | null = null;
if (beforePath === undefined) {
  const revision = Bun.spawn(['git', 'rev-parse', '--verify', '--end-of-options', `${beforeRef ?? 'HEAD'}^{commit}`],
    { cwd: root, stdout: 'pipe', stderr: 'inherit' });
  const resolved = (await new Response(revision.stdout).text()).trim();
  if (await revision.exited !== 0 || !/^[a-f0-9]{40,64}$/.test(resolved)) throw new Error('Cannot resolve baseline commit');
  beforeCommit = resolved;
  const snapshot = resolve(directory, `baseline-${resolved}`);
  mkdirSync(snapshot, { recursive: true });
  const archive = resolve(snapshot, 'compiler.tar');
  for (const command of [
    ['git', 'archive', `--output=${archive}`, resolved, 'packages/compiler'],
    ['tar', '-xf', archive, '-C', snapshot],
  ]) {
    const child = Bun.spawn(command, { cwd: root, stdout: 'inherit', stderr: 'inherit' });
    if (await child.exited !== 0) throw new Error('Cannot prepare isolated baseline compiler');
  }
  beforePath = resolve(snapshot, 'packages/compiler/src/index.ts');
}
const baselinePath = resolve(beforePath);
const before = await import(pathToFileURL(baselinePath).href) as typeof import('@memoized-dom/compiler');
console.log(`Baseline compiler: ${beforeCommit ?? baselinePath}`);
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const run = async (script: string, compiler?: string) => {
  const child = Bun.spawn([process.execPath, 'run', script, ...(compiler ? [`--compiler=${resolve(compiler)}`] : [])],
    { cwd: root, stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited !== 0) throw new Error(`${script} failed`);
};
const imports: string[] = [], adapters: string[] = [];
for (const count of [1000, 10000]) {
  const source = ownerReorderSource(count, mutableContent);
  for (const [variant, compiler] of [['before', before.compileModules], ['after', compileModules]] as const) {
    console.log(`Compile focused ${variant}: ${count} rows`);
    const name = `${variant}${count}`;
    writeFileSync(resolve(directory, `${name}.ts`), compiler({ './local.tsx': source })['./local.tsx']!);
    imports.push(`import {App as ${name}} from './${name}';`);
    adapters.push(`{variant:'${variant}',count:${count},App:${name}}`);
  }
}
// This is authored benchmark driver code. Both app modules above come from their compiler.
writeFileSync(resolve(directory, 'browser.ts'), `${imports.join('\n')}
  import {setScheduler} from '@memoized-dom/runtime/client';setScheduler(run=>run());
  const adapters=[${adapters.join(',')}].map(adapter=>{
    const root=adapter.App('Local'+adapter.variant+adapter.count,null);document.body.append(root);
    return {...adapter,root,order:Array.from({length:adapter.count},(_,id)=>id),labels:Array.from({length:adapter.count},(_,id)=>'row '+id),nodes:[...root.querySelectorAll('li')]};
  });
  const median=values=>[...values].sort((a,b)=>a-b)[values.length>>1];
  window.__focused=()=>{
    const rows=[];
    for(const count of [1000,10000])for(const operation of ['reverse','rotate'])for(const first of ['before','after']){
      const values={before:[],after:[]};
      for(let sample=-5;sample<15;sample++)for(const variant of [first,first==='before'?'after':'before']){
        const app=adapters.find(adapter=>adapter.count===count&&adapter.variant===variant);
        const button=[...app.root.querySelectorAll('button')].find(button=>button.textContent===operation);
        if(${mutableContent}&&sample%5===0){
          app.root.querySelectorAll('button')[2].click();app.labels[app.order[0]]+='!';
          [...app.root.querySelectorAll('li')].forEach((node,index)=>{const id=app.order[index];
            if(node!==app.nodes[id]||node.textContent!==id+': '+app.labels[id])throw new Error('stale rename '+variant+' row '+index);
          });
        }
        const start=performance.now();button.click();const elapsed=performance.now()-start;
        if(sample>=0)values[variant].push(elapsed);
        app.order=operation==='reverse'?[...app.order].reverse():[...app.order.slice(1),app.order[0]];
        const actual=[...app.root.querySelectorAll('li')];
        if(actual.length!==count)throw new Error('wrong row count');
        actual.forEach((node,index)=>{const id=app.order[index];
          if(node!==app.nodes[id]||node.textContent!==id+': '+app.labels[id])throw new Error('stale or recreated '+variant+' '+operation+' row '+index);
        });
      }
      rows.push({count,operation,first,before:median(values.before),after:median(values.after),samples:values});
    }
    return rows;
  };`);
await build({ entryPoints: [resolve(directory, 'browser.ts')], outfile: resolve(directory, 'focused.js'),
  bundle: true, format: 'iife', platform: 'browser', minify: true });
writeFileSync(resolve(directory, 'focused.html'), '<!doctype html><meta charset="utf-8"><body><script src="./focused.js"></script></body>');

// Regenerate through each compiler, snapshot the browser artifact, then restore current output.
const builders = ['bench/dom/build.ts', 'bench/dom/state-placement-build.ts', 'bench/dom/update-style-build.ts'];
try {
  for (const script of builders) await run(script, baselinePath);
  await build({ entryPoints: [resolve(import.meta.dirname, 'state-placement-browser.ts')],
    outfile: resolve(directory, 'dom-before.js'), bundle: true, format: 'iife', platform: 'browser' });
} finally {
  for (const script of builders) await run(script);
}
await build({ entryPoints: [resolve(import.meta.dirname, 'state-placement-browser.ts')],
  outfile: resolve(directory, 'dom-after.js'), bundle: true, format: 'iife', platform: 'browser' });
copyFileSync(resolve(directory, 'dom-after.js'), resolve(import.meta.dirname, 'dist/state-placement-browser-bundle.js'));
for (const variant of ['before', 'after']) writeFileSync(resolve(directory, `dom-${variant}.html`),
  `<!doctype html><meta charset="utf-8"><body><script src="./dom-${variant}.js"></script></body>`);

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || (process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/chromium');
const browser = await puppeteer.launch({ executablePath, protocolTimeout: 600000,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'], headless: true });
const dom: Array<{ variant: string; rows: BenchRow[] }> = [];
let focused: Array<{ count: number; operation: string; first: string; before: number; after: number }> = [];
try {
  const page = await browser.newPage(); const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(pathToFileURL(resolve(directory, 'focused.html')).href);
  if (errors.length) throw new Error(errors.join('\n'));
  focused = await page.evaluate(() => (window as unknown as { __focused(): typeof focused }).__focused());
  if (errors.length) throw new Error(errors.join('\n')); await page.close();
  console.log('Focused comparison passed every sample; starting full DOM matrix in ABBA order.');
  for (const variant of ['before', 'after', 'after', 'before']) {
    console.log(`Measure DOM: ${variant}`);
    const page = await browser.newPage(); const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.text().startsWith('measure ')) console.log(`${variant}: ${message.text()}`); });
    await page.evaluateOnNewDocument(() => {
      let seed = 173091; Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    });
    await page.goto(pathToFileURL(resolve(directory, `dom-${variant}.html`)).href);
    if (errors.length) throw new Error(errors.join('\n'));
    const rows = await page.evaluate(() => (window as unknown as { __runAll(): BenchRow[] }).__runAll());
    if (errors.length) throw new Error(errors.join('\n'));
    dom.push({ variant, rows }); await page.close();
  }
} finally { await browser.close(); }
const hashes = { before: hash(resolve(directory, 'dom-before.js')), after: hash(resolve(directory, 'dom-after.js')) };
const lines = ['# Local compiler before/after comparison', '',
  `Baseline compiler: ${beforeCommit ?? baselinePath}. Same current runtime for both builds.`, '',
  `Focused source: ${mutableContent ? 'mixed structural/content writes; untimed renames checked every five samples' : 'wholly structural writes'}.`, '',
  'Focused cases: five warmups and 15 samples per execution order. Text/count/node identity checked after every sample outside timing.', '',
  '| Rows | Operation | First | Before ms | After ms | Change |', '|---:|---|---|---:|---:|---:|'];
for (const row of focused) lines.push(`| ${row.count} | ${row.operation} | ${row.first} | ${row.before.toFixed(3)} | ${row.after.toFixed(3)} | ${row.before === 0 ? 'n/a' : ((row.after / row.before - 1) * 100).toFixed(1) + '%'} |`);
lines.push('', `DOM browser artifacts identical: **${hashes.before === hashes.after}**.`, '',
  'Full DOM matrix: nine variants, 21 scenarios, seven samples, deterministic inputs, ABBA execution order. Every operation validates text/classes/order and retained nodes outside timing. Identical-artifact timing differences measure local noise, not this optimization.', '');
for (const [beforeIndex, afterIndex] of [[0, 1], [3, 2]]) {
  lines.push(`## DOM: ${beforeIndex === 0 ? 'before first' : 'after first'}`, '',
    '| Operation | State/row variant | Before ms | After ms |', '|---|---|---:|---:|');
  for (const row of dom[beforeIndex]!.rows) for (const [variant, time] of Object.entries(row.timings)) {
    const after = dom[afterIndex]!.rows.find(next => next.name === row.name)!.timings[variant]!;
    lines.push(`| ${row.name} | ${variant} | ${time.toFixed(2)} | ${after.toFixed(2)} |`);
  }
  lines.push('');
}
writeFileSync(resolve(directory, 'results.json'), JSON.stringify({ measuredAt: new Date().toISOString(), beforePath: baselinePath, beforeCommit, mutableContent, hashes, focused, dom }, null, 2));
writeFileSync(resolve(directory, 'results.md'), lines.join('\n'));
console.log(lines.slice(0, 17).join('\n')); console.log(`Report: ${resolve(directory, 'results.md')}`);
