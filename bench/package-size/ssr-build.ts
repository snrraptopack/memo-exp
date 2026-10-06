/** Paired production SSR delivery audit; fixtures never depend on examples. */
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build, type Rollup } from 'vite';
import memoizedDom from '@memoized-dom/vite';
import { sizeFixtures } from './fixtures';
import { compilerBaseline } from './compiler-baseline';

const repository = resolve(import.meta.dirname, '../..');
const output = resolve(import.meta.dirname, 'dist/ssr');
const args = process.argv.slice(2);
if (args.some(arg => !arg.startsWith('--before-ref=') && !arg.startsWith('--fixture='))) throw new Error('Use --before-ref=<commit> or --fixture=<name>');
const reference = args.find(arg => arg.startsWith('--before-ref='))?.slice(13) ?? 'cc5ce13';
const git = (...args: string[]) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
const baseline = git('rev-parse', '--verify', '--end-of-options', `${reference}^{commit}`);
if (!/^[a-f0-9]{40,64}$/.test(baseline)) throw new Error('Invalid compiler/Vite baseline');
await mkdir(output, { recursive: true });
const snapshot = resolve(output, `baseline-${baseline.slice(0, 8)}`);
const before = await compilerBaseline(repository, baseline, snapshot);

const fixtures = {
  'composition-static-children': sizeFixtures['composition-static-children']!,
  'composition-static-children-60': sizeFixtures['composition-static-children-60']!,
  'composition-live-children': sizeFixtures['composition-live-children']!,
  'composition-live-forwarded-children': sizeFixtures['composition-live-forwarded-children']!,
  'composition-conditional-children': sizeFixtures['composition-conditional-children']!,
  'composition-list-children': sizeFixtures['composition-list-children']!,
  'request-module-option-keys': sizeFixtures['request-module-option-keys']!,
  'request-inline-group': sizeFixtures['request-inline-group']!,
  'request-list-siblings': sizeFixtures['request-list-siblings']!,
  'request-list': sizeFixtures['request-list']!,
  'request-local-list': sizeFixtures['request-local-list']!,
  'request-conditional': sizeFixtures['request-conditional']!,
  'request-local-conditional': sizeFixtures['request-local-conditional']!,
  static: sizeFixtures.static!,
  counter: sizeFixtures['owner-counter']!,
  composition: sizeFixtures.composition!,
  todo: sizeFixtures['input-list']!,
  'counter-60-cards': { './App.tsx': `export function App(){let n=0;return <main>
    ${Array.from({ length: 60 }, (_, index) => `<section><h2>Card ${index}</h2><p>Ready.</p></section>`).join('')}
    <button onClick={()=>n++}>{n}</button></main>;}` },
  'request-data': { './App.tsx': `export function App(){const user=$fetch('/api/user');return <h1>{user?.name}</h1>;}` },
  'request-composition': {
    './App.tsx': `import {Card} from './Card';export function App(){const user=$fetch('/api/user');return <main><h1>Directory</h1><Card name={user?.name}/></main>;}`,
    './Card.tsx': `export function Card({name}){return <section><h2 title={name}>{'Hello '+name}</h2></section>;}`,
  },
  'request-interactive': { './App.tsx': `export function App(){const user=$fetch('/api/user');let n=0;return <main><h1>{user?.name}</h1><button onClick={()=>n++}>{n}</button></main>;}` },
  'request-routed-group': { './App.tsx': `import {Group} from '@memoized-dom/data';function Pending(){return <p>Loading</p>;}
    export function App(){const user=$fetch('/api/user');return <main route="/">
      <nav><a route-to="/">Home</a><a route-to="/about">About</a></nav>
      <section route="/"><Group pending={Pending}><h1>{user?.name}</h1></Group></section>
      <section route="/about"><h2>About directory</h2></section></main>;}` },
};
const aliases = (server = false) => Object.entries({
  '@memoized-dom/runtime/hydrate': 'packages/runtime/dist/hydrate.js',
  '@memoized-dom/runtime/hydrate-program': 'packages/runtime/dist/hydrate-program.js',
  '@memoized-dom/runtime/server': 'packages/runtime/dist/server.js',
  '@memoized-dom/runtime': `packages/runtime/dist/${server ? 'server' : 'index'}.js`,
  '@memoized-dom/data/internal': 'packages/data/dist/internal.js',
  '@memoized-dom/data': 'packages/data/dist/index.js',
  '@memoized-dom/router/internal': 'packages/router/dist/internal.js',
  '@memoized-dom/router': 'packages/router/dist/index.js',
  '@memoized-dom/server/router': 'packages/server/dist/http-router.js',
  '@memoized-dom/server': 'packages/server/dist/index.js',
}).map(([name, file]) => ({ find: new RegExp(`^${name}$`), replacement: resolve(repository, file) }));
const rows: Array<{ fixture: string; version: string; html: number; payload: number; javascript: number; gzip: number; chunks: number }> = [];
const selected = new Set(args.filter(arg => arg.startsWith('--fixture=')).map(arg => arg.slice(10)));
for (const name of selected) if (!Object.hasOwn(fixtures, name)) throw new Error(`Unknown fixture ${name}`);
for (const [fixture, sources] of Object.entries(fixtures)) {
  if (selected.size && !selected.has(fixture)) continue;
  const root = await mkdtemp(join(tmpdir(), 'memoized-dom-ssr-size-'));
  if (!root.startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected temporary fixture path');
  try {
    const user = fixture==='request-list'||fixture==='request-list-siblings' ? {name:'Ada',rows:[{id:1,label:'one'},{id:2,label:'two'}]} : {name:'Ada'};
    const files = { ...sources,
      './main.ts': `import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`,
      './server.ts': `import {serve} from '@memoized-dom/server';import {App} from './App';const app=serve();
        app.get('/api/user',()=>(${JSON.stringify(user)}));app.ssr(App,{delivery:'buffer'});export default app;`,
      './index.html': '<!doctype html><html><head><title>SSR audit</title></head><body><div id="root"><!--ssr-outlet--></div><script type="module" src="./main.ts"></script></body></html>',
    };
    for (const [file, source] of Object.entries(files)) {
      const target = resolve(root, file);
      await mkdir(dirname(target), { recursive: true }); await writeFile(target, source);
    }
    for (const [version, plugin] of [['before', before], ['after', memoizedDom]] as const) {
      const config = (server = false) => ({ root, configFile: false as const, logLevel: 'silent' as const,
        resolve: { alias: aliases(server) }, plugins: [plugin({ clientEntry: 'main.ts', serverEntry: 'server.ts' })] });
      const client = await build({ ...config(), build: { write: false } });
      const assets = (Array.isArray(client) ? client : [client]).flatMap(result => result.output);
      const template = assets.find(file => file.type === 'asset' && file.fileName === 'index.html');
      if (!template || template.type !== 'asset') throw new Error('Missing production page');
      const server = await build({ ...config(true), build: { write: false, ssr: 'server.ts' } });
      const emitted = (Array.isArray(server) ? server : [server]).flatMap(result => result.output);
      const directory = resolve(output, fixture, version);
      for (const file of emitted) {
        const path = resolve(directory, file.fileName);
        await mkdir(dirname(path), { recursive: true }); await writeFile(path, file.type === 'chunk' ? file.code : file.source);
      }
      const entry = emitted.find((file): file is Rollup.OutputChunk => file.type === 'chunk' && file.isEntry)!;
      const { default: app } = await import(pathToFileURL(resolve(directory, entry.fileName)).href);
      app.installDocumentTemplate(String(template.source));
      const response = await app.fetch(new Request('https://app.test/'));
      if (response.status !== 200) throw new Error(`SSR failed: ${await response.text()}`);
      const html = await response.text();
      if(fixture==='composition-static-children' && !html.replace(/<!--[^]*?-->/g,'').includes('<section><h2>Static card</h2><p>Ada</p></section>'))throw new Error('Static child content was lost');
      if(fixture==='composition-static-children-60' && (html.match(/<section>/g)?.length!==60 || !html.replace(/<!--[^]*?-->/g,'').includes('<aside><h2>Static card 59</h2><p>Ready.</p></aside>')))throw new Error('Repeated forwarded child content was lost');
      if(fixture==='request-inline-group' && !html.replace(/<!--[^]*?-->/g,'').includes('<h1>Directory:Ada</h1>'))throw new Error('Inline policy data did not settle');
      if (['request-module-option-keys', 'request-data', 'request-interactive', 'request-routed-group', 'request-conditional', 'request-local-conditional', 'request-list', 'request-local-list'].includes(fixture) && !html.replace(/<!--[^]*?-->/g, '').includes('<h1>Ada</h1>')) throw new Error('Request data did not settle');
      if (fixture==='request-list' && !html.replace(/<!--[^]*?-->/g,'').includes('<li title="one">0:one!</li><li title="two">1:two!</li>')) throw new Error('Fetched rows did not settle');
      if(fixture==='request-list-siblings' && !html.replace(/<!--[^]*?-->/g,'').includes('<h1>Ada</h1><li>0:one</li><li>1:two</li><button>0</button>0<footer>After</footer>'))throw new Error('Fetched sibling placement did not settle');
      if (fixture==='request-local-list' && !html.replace(/<!--[^]*?-->/g,'').includes('<li>one</li><li>two</li>')) throw new Error('Local rows lost their initial content');
      if (fixture === 'request-conditional' && !html.replace(/<!--[^]*?-->/g, '').includes('<section><h2>Ada:0</h2></section>')) throw new Error('Request conditional selected the wrong branch');
      if (fixture === 'request-local-conditional' && !html.includes('<p>Shown</p>')) throw new Error('Local conditional lost its initial branch');
      if (fixture === 'request-composition' && !html.replace(/<!--[^]*?-->/g, '').includes('Hello Ada')) throw new Error('Composed request data did not settle');
      // All emitted chunks, including shared/imported code and later capabilities.
      const chunks = assets.filter(file => file.type === 'chunk');
      const payload = html.match(/<script\b[^>]*type="application\/mmd\+json"[^>]*>[^]*?<\/script>/g) ?? [];
      const row = { fixture, version, html: Buffer.byteLength(html), payload: Buffer.byteLength(payload.join('')),
        javascript: chunks.reduce((size, file) => size + Buffer.byteLength(file.code), 0),
        gzip: chunks.reduce((size, file) => size + gzipSync(file.code).byteLength, 0), chunks: chunks.length };
      if (fixture === 'static' && version === 'after' && row.javascript !== 0) throw new Error('Static page emitted JavaScript');
      if(fixture.startsWith('composition-') && row.javascript===0)throw new Error('Composition lost its counter browser program');
      if (['request-data', 'request-composition'].includes(fixture) && version === 'after' && (row.javascript !== 0 || row.payload !== 0 || /<!--/.test(html))) throw new Error('Request-only page retained browser delivery');
      if (['request-module-option-keys', 'request-interactive', 'request-routed-group', 'request-conditional', 'request-local-conditional', 'request-list', 'request-local-list'].includes(fixture) && row.javascript === 0) throw new Error('Interactive behavior lost its browser program');
      rows.push(row);
      await writeFile(resolve(directory, 'response.html'), html);
      console.log(`${fixture} ${version}: HTML ${row.html} B; payload ${row.payload} B; JS ${row.javascript} B / ${row.gzip} B gzip (${row.chunks} chunks)`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const metadata = { baseline, head: git('rev-parse', 'HEAD'), dirty: !!git('status', '--porcelain'), rows };
await writeFile(resolve(output, 'results.json'), JSON.stringify(metadata, null, 2));
await writeFile(resolve(output, 'results.md'), [
  '# Production SSR delivery audit', '',
  `Compiler/Vite baseline: ${baseline}; current HEAD: ${metadata.head}; dirty: ${metadata.dirty}.`, '',
  'Both builds use the current runtime/data/server packages and stable authored fixtures; the baseline archives compiler and Vite source without changing the checkout. Identical HTML shells, actual served responses, production minification. HTML includes its payload; payload is also reported separately. JS counts every emitted chunk once, including shared and future code. Gzip compresses each chunk separately. Server JavaScript is excluded.', '',
  '| Fixture | Delivery | HTML B | Payload B | JS B | JS gzip sum B | Chunks |',
  '|---|---|---:|---:|---:|---:|---:|',
  ...rows.map(row => `| ${row.fixture} | ${row.version} | ${row.html} | ${row.payload} | ${row.javascript} | ${row.gzip} | ${row.chunks} |`), '',
].join('\n'));
