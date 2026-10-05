/** Measure shipped HTML and JS separately through the production Vite pipeline. */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import memoizedDom from '@memoized-dom/vite';
import { sizeFixtures } from './fixtures';
import { compilerBaseline } from './compiler-baseline';

const repository = resolve(import.meta.dirname, '../..');
const args=process.argv.slice(2);
if(args.some(arg=>!arg.startsWith('--before-ref=') && !arg.startsWith('--fixture='))) throw new Error('Use --before-ref=<commit> or --fixture=<name>');
const reference=args.find(arg=>arg.startsWith('--before-ref='))?.slice(13);
const baseline=reference===undefined?undefined:execFileSync('git',['rev-parse','--verify','--end-of-options',`${reference}^{commit}`],{cwd:repository,encoding:'utf8'}).trim();
if(baseline!==undefined && !/^[a-f0-9]{40,64}$/.test(baseline)) throw new Error('Invalid compiler baseline');
const output = resolve(import.meta.dirname, baseline?`dist/html-before-${baseline.slice(0,8)}`:'dist/html');
let compilerPlugin=memoizedDom;
if(baseline) {
  compilerPlugin=await compilerBaseline(repository,baseline,resolve(output,'compiler-baseline'));
}
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim() !== '';
const fixtures:Record<string,Record<string,string>> = { ...sizeFixtures,
  'static-name': { './App.tsx': `export function App(){let name='Ada';const greeting='Hello '+name;return <h1>{greeting}</h1>;}` },
  'static-list': { './App.tsx': `function Row({label}){return <li>{label}</li>;}export function App(){
    const items=[${Array.from({length:40},(_,index)=>`{id:${index},label:'Row ${index}'}`).join(',')}];
    return <ul>{items.map(item=><Row key={item.id} label={item.label}/>)}</ul>;}` },
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
  ...Object.fromEntries([1,60].map(count=>[`bindings-${count}-cards`, {
    './App.tsx': `export function App(){let n=0;return <main>
      ${Array.from({length:count},(_,index)=>`<section><h2>Static card ${index}</h2><p>Ready.</p></section>`).join('')}
      <button onClick={()=>n++}>Add</button><p>{n}</p></main>;}`,
  }])),
  ...Object.fromEntries([1,60].map(count=>[`conditions-${count}-cards`, {
    './App.tsx': `export function App(){let open=true;let n=1;return <main>
      ${Array.from({length:count},(_,index)=>`<section><h2>Static card ${index}</h2><p>Ready.</p></section>`).join('')}
      <button class="toggle" onClick={()=>{open=!open;}}>Toggle</button>
      {open?<section><button class="add" onClick={()=>n++}>{n}</button></section>:<p>Closed</p>}</main>;}`,
  }])),
  ...Object.fromEntries(['keyed','positional'].flatMap(identity=>[1,60].map(count=>[`list-${identity}-${count}-cards`, {
    './App.tsx': `export function App(){let items=[{id:1,label:'one'},{id:2,label:'two'}];return <main>
      ${Array.from({length:count},(_,index)=>`<section><h2>Static card ${index}</h2><p>Ready.</p></section>`).join('')}
      <button onClick={()=>{items=[...items,{id:3,label:'three'}];}}>Append</button><ul>
      {items.map((item,index)=><li key={${identity==='keyed'?'item.id':'index'}}><b>Row: </b><span>{index}:{item.label}</span></li>)}</ul></main>;}`,
  }]))),
  ...Object.fromEntries([1,60].map(count=>[`empty-todo-${count}-cards`, {
    './App.tsx': `export function App(){let items=[];let temp='seed';return <main>
      ${Array.from({length:count},(_,index)=>`<section><h2>Static card ${index}</h2><p>Ready.</p></section>`).join('')}
      <input value={temp} onInput={e=>{temp=e.target.value;}}/><ul>{items.map((item,index)=><li key={index}>{index}-{item}</li>)}</ul>
      <button onClick={()=>{if(!temp.trim())return;items=[...items,temp];temp='';}}>Add todo</button></main>;}`,
  }])),
};
for(const count of [1,60]) fixtures[`future-composition-${count}-cards`]={
  './App.tsx':`function Label({value}){let clicks=0;return <section title={value}><strong>{value}</strong>
    <button onClick={()=>clicks++}>{clicks}</button></section>;}
    export function App(){let open=true;let n=1;return <main>
    ${Array.from({length:count},(_,index)=>`<article><h2>Static card ${index}</h2><p>Ready.</p></article>`).join('')}
    <button class="toggle" onClick={()=>open=!open}>Toggle</button><button onClick={()=>n++}>Increment</button>
    <Label value={n}/>{open&&<Label value={n+10}/>}</main>;}`,
};
const rows: Array<{ fixture: string; html: number; htmlGzip: number;
  javascript: number; javascriptGzipSum: number; javascriptAssets: number;
  browserCreationJavascript?: number; browserCreationJavascriptGzipSum?: number }> = [];
await mkdir(output, { recursive: true });
const selected=new Set(args.filter(arg=>arg.startsWith('--fixture=')).map(arg=>arg.slice(10)));
for(const name of selected) if(!Object.hasOwn(fixtures,name)) throw new Error(`Unknown fixture ${name}`);
for (const [name, sources] of Object.entries(fixtures)) {
  if(selected.size && !selected.has(name)) continue;
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
      plugins: [compilerPlugin({ clientEntry: 'main.ts' })], build: { write: false },
    });
    const files = (Array.isArray(result) ? result : [result]).flatMap(result => result.output);
    const html = files.find(file => file.type === 'asset' && file.fileName === 'index.html');
    if (!html || html.type !== 'asset') throw new Error(`Missing HTML for ${name}`);
    const js = files.filter(file => file.type === 'chunk');
    const row: (typeof rows)[number] = { fixture: name, html: Buffer.byteLength(html.source), htmlGzip: gzipSync(html.source).byteLength,
      javascript: js.reduce((size, file) => size + Buffer.byteLength(file.code), 0),
      javascriptGzipSum: js.reduce((size, file) => size + gzipSync(file.code).byteLength, 0), javascriptAssets: js.length };
    if (name.startsWith('mixed-') || name.startsWith('bindings-') || name.startsWith('conditions-') || name.startsWith('list-') || name.startsWith('empty-todo-') || name.startsWith('future-composition-') || name==='input-list' || name.endsWith('-counter')) {
      // Same authored graph through the ordinary JS-entry DOM creation target.
      const creation = await build({root,configFile:false,logLevel:'silent',
        resolve:{alias:{'@memoized-dom/runtime':resolve(repository,'packages/runtime/dist/index.js')}},
        plugins:[compilerPlugin({clientEntry:'main.ts'})],
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
await writeFile(resolve(output, 'results.json'), JSON.stringify({ revision, dirty, baseline, rows }, null, 2));
await writeFile(resolve(output, 'results.md'), [
  '# Production HTML and JavaScript audit', '', `HEAD: ${revision}; working tree changes: ${dirty}.`, '',
  `Compiler/Vite baseline: ${baseline??'current packages'}. The runtime and authored fixtures use the current checkout.`, '',
  'Published compiler, Vite plugin and browser runtime. Stable authored fixtures, production HTML entry, default Vite minification. HTML is compressed separately. JS includes every emitted chunk; gzip sums compress each served chunk once. No SSR or network data payload is included in these fixtures.', '',
  '| Fixture | HTML B | HTML gzip B | JS B | JS gzip sum B | JS assets | Ordinary DOM creation JS B / gzip sum B |',
  '|---|---:|---:|---:|---:|---:|---:|',
  ...rows.map(row => `| ${row.fixture} | ${row.html} | ${row.htmlGzip} | ${row.javascript} | ${row.javascriptGzipSum} | ${row.javascriptAssets} | ${row.browserCreationJavascript === undefined ? '—' : `${row.browserCreationJavascript} / ${row.browserCreationJavascriptGzipSum}`} |`), '',
].join('\n'));
