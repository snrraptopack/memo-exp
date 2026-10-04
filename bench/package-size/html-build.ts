/** Measure shipped HTML and JS separately through the production Vite pipeline. */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import memoizedDom from '@memoized-dom/vite';
import { sizeFixtures } from './fixtures';

const repository = resolve(import.meta.dirname, '../..');
const output = resolve(import.meta.dirname, 'dist/html');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim() !== '';
const fixtures = { ...sizeFixtures,
  'static-name': { './App.tsx': `export function App(){let name='Ada';const greeting='Hello '+name;return <h1>{greeting}</h1>;}` },
  'static-composition': {
    './App.tsx': `import {Card} from './Card';export function App(){return <main><h1>Static shell</h1>
      ${Array.from({ length: 40 }, (_, index) => `<Card title="Card ${index}"/>`).join('')}</main>;}`,
    './Card.tsx': `export function Card({title}){return <section><h2>{title}</h2><p>Ready.</p></section>;}`,
  },
  ...Object.fromEntries([1, 60].map(count => [`mixed-${count}-cards`, {
    './App.tsx': `import {Card} from './Card';import {Counter} from './Counter';export function App(){return <main>
      ${Array.from({length:count}, (_, index) => `<Card title="Static card ${index}"/>`).join('')}<Counter/></main>;}`,
    './Card.tsx': `export function Card({title}){return <section><h2>{title}</h2><p>Ready.</p></section>;}`,
    './Counter.tsx': `export function Counter(){let n=0;return <button onClick={()=>n++}>{n}</button>;}`,
  }])),
};
const rows: Array<{ fixture: string; html: number; htmlGzip: number;
  javascript: number; javascriptGzipSum: number; javascriptAssets: number;
  browserCreationJavascript?: number; browserCreationJavascriptGzipSum?: number }> = [];
await mkdir(output, { recursive: true });
for (const [name, sources] of Object.entries(fixtures)) {
  const root = await mkdtemp(join(tmpdir(), 'memoized-dom-html-audit-'));
  try {
    const authored = { ...sources,
      './main.ts': `import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`,
      './index.html': '<!doctype html><html><head><title>Bundle audit</title></head><body><div id="root"></div><script type="module" src="./main.ts"></script></body></html>',
    };
    for (const [file, code] of Object.entries(authored)) {
      const path = resolve(root, file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, code);
    }
    const result = await build({ root, configFile: false, logLevel: 'silent',
      resolve: { alias: { '@memoized-dom/runtime': resolve(repository, 'packages/runtime/dist/index.js') } },
      plugins: [memoizedDom({ clientEntry: 'main.ts' })], build: { write: false },
    });
    const files = (Array.isArray(result) ? result : [result]).flatMap(result => result.output);
    const html = files.find(file => file.type === 'asset' && file.fileName === 'index.html');
    if (!html || html.type !== 'asset') throw new Error(`Missing HTML for ${name}`);
    const js = files.filter(file => file.type === 'chunk');
    const row: (typeof rows)[number] = { fixture: name, html: Buffer.byteLength(html.source), htmlGzip: gzipSync(html.source).byteLength,
      javascript: js.reduce((size, file) => size + Buffer.byteLength(file.code), 0),
      javascriptGzipSum: js.reduce((size, file) => size + gzipSync(file.code).byteLength, 0), javascriptAssets: js.length };
    if (name.startsWith('mixed-')) {
      // Same authored graph through the ordinary JS-entry DOM creation target.
      const creation = await build({root,configFile:false,logLevel:'silent',
        resolve:{alias:{'@memoized-dom/runtime':resolve(repository,'packages/runtime/dist/index.js')}},
        plugins:[memoizedDom({clientEntry:'main.ts'})],
        build:{write:false,rollupOptions:{input:resolve(root,'main.ts')}},
      });
      const creationJs=(Array.isArray(creation)?creation:[creation]).flatMap(result=>result.output).filter(file=>file.type==='chunk');
      row.browserCreationJavascript=creationJs.reduce((size,file)=>size+Buffer.byteLength(file.code),0);
      row.browserCreationJavascriptGzipSum=creationJs.reduce((size,file)=>size+gzipSync(file.code).byteLength,0);
    }
    if (name.startsWith('static') && js.length) throw new Error(`${name} shipped JavaScript`);
    rows.push(row);
    for (const file of files) {
      const path = resolve(output, name, file.fileName);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.type === 'chunk' ? file.code : file.source);
    }
    console.log(`${name.padEnd(20)} HTML ${row.html} B / ${row.htmlGzip} B gzip; JS ${row.javascript} B / ${row.javascriptGzipSum} B gzip sum (${js.length} assets)` +
      (row.browserCreationJavascript === undefined ? '' : `; ordinary DOM creation JS ${row.browserCreationJavascript} B / ${row.browserCreationJavascriptGzipSum} B gzip sum`));
  } finally { await rm(root, { recursive: true, force: true }); }
}
await writeFile(resolve(output, 'results.json'), JSON.stringify({ revision, dirty, rows }, null, 2));
await writeFile(resolve(output, 'results.md'), [
  '# Production HTML and JavaScript audit', '', `HEAD: ${revision}; working tree changes: ${dirty}.`, '',
  'Published compiler, Vite plugin and browser runtime. Stable authored fixtures, production HTML entry, default Vite minification. HTML is compressed separately. JS includes every emitted chunk; gzip sums compress each served chunk once. No SSR or network data payload is included in these fixtures.', '',
  '| Fixture | HTML B | HTML gzip B | JS B | JS gzip sum B | JS assets | Ordinary DOM creation JS B / gzip sum B |',
  '|---|---:|---:|---:|---:|---:|---:|',
  ...rows.map(row => `| ${row.fixture} | ${row.html} | ${row.htmlGzip} | ${row.javascript} | ${row.javascriptGzipSum} | ${row.javascriptAssets} | ${row.browserCreationJavascript === undefined ? '—' : `${row.browserCreationJavascript} / ${row.browserCreationJavascriptGzipSum}`} |`), '',
].join('\n'));
