import { build } from 'esbuild';
import { compileModules, compileModulesDetailed } from '@memoized-dom/compiler';
import { expect, it } from 'vitest';

async function bundle(source: string) {
  const result = await build({ stdin: { contents: compileModules({'./App.tsx':source})['./App.tsx']!, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, metafile: true, minify: true, format: 'esm', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' }, outfile: 'browser.js',
    plugins: [{name:'opaque-clock-fixture',setup(builder) {
      builder.onResolve({filter:/^@size\/clock$/},() => ({path:'clock',namespace:'clock'}));
      builder.onLoad({filter:/.*/,namespace:'clock'},() => ({contents:'export function createClock(){return {value:0};}',loader:'js'}));
    }}],
  });
  const inputs = Object.entries(Object.values(result.metafile!.outputs)[0]!.inputs)
    .filter(([, input]) => input.bytesInOutput > 0).map(([path]) => path.replaceAll('\\', '/'));
  return { inputs, code: result.outputFiles[0]!.text };
}
it('keeps an owner counter free of unused list native guards, routing and props', async () => {
  const { inputs, code } = await bundle(`export function App(){let count=0;return <button onClick={()=>count++}>{count}</button>;}`);
  expect(inputs.some(path => path.endsWith('/dist/kernel.js'))).toBe(true);
  for (const feature of ['list', 'list-update', 'access', 'props', 'hydration', 'effect', 'async-storage', 'application-scope', 'volatile', 'reasoned-invalidation']) {
    expect(inputs.some(path => path.endsWith(`/dist/${feature}.js`))).toBe(false);
  }
  expect(code).not.toContain('[native code]');
  expect(code).not.toContain('node:async_hooks');
});
it('retains polling only for an opaque source', async () => {
  const { inputs } = await bundle(`import {createClock} from '@size/clock';
    export function App(){const clock=createClock();return <p>{clock.value}</p>;}`);
  expect(inputs.some(path => path.endsWith('/dist/volatile.js'))).toBe(true);
  expect(inputs.some(path => path.endsWith('/dist/reasoned-invalidation.js'))).toBe(true);
});

it('retains exact cause merging for a component with independent state slots', async () => {
  const { inputs } = await bundle(`export function App(){let a=0;let b=0;
    return <main><button onClick={()=>a++}>{a}</button><button onClick={()=>b++}>{b}</button></main>;}`);
  expect(inputs.some(path => path.endsWith('/dist/reasoned-invalidation.js'))).toBe(true);
});

it.each(['bindings', 'mixed', 'conditional', 'list', 'input'] as const)('omits SSR mounting from the %s HTML product', async kind => {
  const sources = {
    './main.ts': `import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`,
    './App.tsx': kind === 'bindings'
      ? `export function App(){let n=0;return <button onClick={()=>n++}>{n}</button>;}`
      : kind === 'conditional' ? `export function App(){let show=true;return <main><button onClick={()=>{show=!show;}}>Toggle</button>{show?<p>Open</p>:null}</main>;}`
      : kind === 'list' ? `export function App(){let items=['one'];return <main><button onClick={()=>{items=[...items,'two'];}}>Add</button>{items.map((item,index)=><li key={index}>{item}</li>)}</main>;}`
      : kind === 'input' ? `export function App(){let value='seed';return <input value={value} onInput={e=>{value=e.target.value;}}/>;}`
      : `import {Counter} from './Counter';export function App(){return <main><h1>Static</h1><Counter/></main>;}`,
    './Counter.tsx': `export function Counter(){let n=0;${kind === 'mixed' ? 'const setup=()=>{};$effect(setup);' : ''}return <button onClick={()=>n++}>{n}</button>;}`,
  };
  for (const initial of [true, false]) {
    const result = compileModulesDetailed(sources, { initialContent: initial });
    expect(result.initialRender.kind).toBe(kind === 'conditional' || kind === 'list' || kind==='input' ? 'bindings' : kind);
    const modules = result.output;
    const bundled = await build({
      stdin: { contents: modules['./main.ts']!, resolveDir: process.cwd(), loader: 'ts' },
      bundle: true, write: false, metafile: true, minify: true, format: 'esm', platform: 'browser',
      outfile: 'initial-browser.js',
      plugins: [{ name: 'compiled-initial-fixture', setup(builder) {
        builder.onResolve({ filter: /^\.\/(App|Counter)$/ }, args => ({ path: args.path + '.tsx', namespace: 'compiled' }));
        builder.onLoad({ filter: /.*/, namespace: 'compiled' }, args => ({
          contents: modules[args.path]!, loader: 'ts', resolveDir: process.cwd(),
        }));
      } }],
    });
    const inputs = Object.entries(Object.values(bundled.metafile!.outputs)[0]!.inputs)
      .filter(([, input]) => input.bytesInOutput > 0).map(([path]) => path.replaceAll('\\', '/'));
    expect(inputs.some(path => path.endsWith('/dist/mount-core.js'))).toBe(true);
    expect(inputs.some(path => path.endsWith('/dist/initial-list.js'))).toBe(initial && kind==='list');
    expect(inputs.some(path => path.endsWith('/dist/initial-input.js'))).toBe(initial && kind==='input');
    for (const feature of ['mount', 'hydration-error', 'hydration-marker']) {
      expect(inputs.some(path => path.endsWith(`/dist/${feature}.js`))).toBe(!initial);
    }
  }
});
it('retains access routing when module state requires it', async () => {
  const { inputs } = await bundle(`let count=0;export function App(){return <button onClick={()=>count++}>{count}</button>;}`);
  expect(inputs.some(path => path.endsWith('/dist/access.js'))).toBe(true);
  expect(inputs.some(path => path.endsWith('/dist/list.js'))).toBe(false);
});
it('retains prop delivery for composed components', async () => {
  const { inputs } = await bundle(`function Label({value}){return <strong>{value}</strong>;}
    export function App(){let count=0;return <main><button onClick={()=>count++}>Add</button><Label value={count}/></main>;}`);
  expect(inputs.some(path => path.endsWith('/dist/props.js'))).toBe(true);
  expect(inputs.some(path => path.endsWith('/dist/list-update.js'))).toBe(false);
});
it('retains native-operation guards for a proven list copy', async () => {
  const { inputs, code } = await bundle(`export function App(){let rows=[{id:1,label:'one'},{id:2,label:'two'}];
    return <main><button onClick={()=>{rows=rows.toReversed();}}>Reverse</button>
      <ul>{rows.map(row=><li key={row.id}>{row.label}</li>)}</ul></main>;}`);
  expect(inputs.some(path => path.endsWith('/dist/list.js'))).toBe(true);
  expect(inputs.some(path => path.endsWith('/dist/list-update.js'))).toBe(true);
  expect(code).toContain('[native code]');
  expect(inputs.some(path => path.endsWith('/dist/hydration.js'))).toBe(false);
});

it('ships positional reconciliation only for explicit index keys on DOM-only rows', async () => {
  const { inputs } = await bundle(`export function App(){let items=['one','two'];
    return <main><button onClick={()=>{items=[...items,'two'];}}>Append</button>
      <ul>{items.map((item,index)=><li key={index}>{index}-{item}</li>)}</ul></main>;}`);
  expect(inputs.some(path => path.endsWith('/dist/list-positional.js'))).toBe(true);
  expect(inputs.some(path => path.endsWith('/dist/list-dom.js'))).toBe(true);
  expect(inputs.some(path => path.endsWith('/dist/list.js'))).toBe(false);
  expect(inputs.some(path => path.endsWith('/dist/list-keys.js'))).toBe(false);
  expect(inputs.some(path => path.endsWith('/dist/hydration-error.js'))).toBe(false);
});
