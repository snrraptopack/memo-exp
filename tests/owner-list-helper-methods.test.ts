import { stubGlobal, unstubAllGlobals } from '../test-support/helpers';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'bun:test';
import { compileModules } from '@memoized-dom/compiler';
import { _internals, resetAccessTable, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const directory = join(import.meta.dirname, 'fixtures/out/owner-list-helper-methods');
const records = "[{id:1,label:'one'},{id:2,label:'two'},{id:3,label:'three'}]";
const helpers = `export function reverse(rows){return rows.toReversed();}
  export function rotate(rows,count){const tail=rows.slice(count);return tail.concat(rows.slice(0,count));}
  export function drop(rows){return rows.slice(0,rows.length-1);}
  export function append(rows){return rows.concat([{id:4,label:'four'}]);}`;
const probe = `import * as runtime from '@memoized-dom/runtime/testing';export * from '@memoized-dom/runtime/testing';
  export function createListRegion(...args){const create=args[2];args[2]=(...values)=>{
    const entry=create(...values),update=entry.update;
    if(update)entry.update=(...values)=>{globalThis.__helperReplays++;return update(...values);};return entry;
  };return runtime.createListRegion(...args);}`;
async function load(sources: Record<string, string>, name: string) {
  const output = compileModules(sources, { runtimePath: './probe' });
  const target = join(directory, name); mkdirSync(target, { recursive: true });
  for (const [id, source] of Object.entries(output)) writeFileSync(join(target, id.replace(/\.tsx$/, '.ts')), source);
  writeFileSync(join(target, 'probe.ts'), probe);
  const specifier = `./fixtures/out/owner-list-helper-methods/${name}/App.ts`;
  return { App: (await import(specifier)).App, output: output['./App.tsx']! };
}
const replays = () => (globalThis as unknown as { __helperReplays: number }).__helperReplays;
const reset = () => { (globalThis as unknown as { __helperReplays: number }).__helperReplays = 0; };
beforeEach(() => { document.body.replaceChildren(); resetAccessTable(); stubGlobal('__helperReplays', 0); });
afterEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  resetAccessTable(); resetScheduler(); unstubAllGlobals();
});

it.each([false, true].flatMap(linked => [false, true].map(deferred => ({ linked, deferred }))))(
  'skips unchanged rows through native helper chains and preserves mixed selection (%j)', async ({ linked, deferred }) => {
    const sources = {
      './App.tsx': `${linked ? "import {reverse,rotate,drop,append} from './bridge';" : helpers.replaceAll('export ', '')}
        export function App(){let items=${records};let selected=0;const select=id=>{selected=id;};
          return <main><button id="reverse" onClick={()=>{items=reverse(items);}}>reverse</button>
            <button id="rotate" onClick={()=>{items=rotate(items,1);}}>rotate</button>
            <button id="drop" onClick={()=>{items=drop(items);}}>drop</button>
            <button id="append" onClick={()=>{items=append(items);}}>append</button>
            <button id="mixed" onClick={()=>{items=reverse(items);selected=4;}}>mixed</button>
            <ul>{items.map(row=><li key={row.id} class={selected===row.id?'danger':''}>
              <a onClick={()=>select(row.id)}>{row.label}</a></li>)}</ul></main>;}`,
      ...(linked ? { './rows.ts': helpers, './bridge.ts': `import {reverse as flip,rotate,drop,append} from './rows';
        export function reverse(rows){return flip(rows);}export {rotate,drop,append};` } : {}),
    };
    const { App, output } = await load(sources, `chain-${linked}-${deferred}`);
    expect(output).toContain('evaluateListOperation');
    const pending: Array<() => void> = [];
    setScheduler(run => { if (deferred) pending.push(run); else run(); });
    const flush = () => { for (let turns = 0; pending.length; turns++) {
      if (turns > 50) throw new Error('Did not settle'); pending.shift()!();
    } };
    document.body.append(App('Helpers', null)); flush();
    const rows = () => [...document.querySelectorAll('li')]; const original = rows();
    const click = (id: string) => { reset(); document.getElementById(id)!.click(); flush(); };
    original[1]!.querySelector('a')!.click(); flush();
    click('reverse'); expect(replays()).toBe(0); expect(rows()).toEqual(original.toReversed());
    expect(original[1]!.className).toBe('danger');
    click('rotate'); expect(replays()).toBe(0); expect(rows()).toEqual([original[1], original[0], original[2]]);
    click('drop'); expect(replays()).toBe(0); expect(rows()).toEqual([original[1], original[0]]);
    click('append'); expect(replays()).toBe(0); const fourth = rows()[2]!;
    expect(rows().slice(0, 2)).toEqual([original[1], original[0]]);
    click('mixed'); expect(replays()).toBe(3); expect(rows()).toEqual([fourth, original[0], original[1]]);
    expect(rows().map(row => row.className)).toEqual(['danger', '', '']);
  });

it('keeps escaped rows untrusted after a helper native override is restored', async () => {
  const { App, output } = await load({ './rows.ts': `export function copy(rows){return rows.slice();}
      export function reverse(rows){return rows.toReversed();}`,
    './App.tsx': `import {copy,reverse} from './rows';export function App(){let items=${records};
      return <main><button id="copy" onClick={()=>{items=copy(items);}}>copy</button>
        <button id="reverse" onClick={()=>{items=reverse(items);}}>reverse</button>
        <button id="fresh" onClick={()=>{items=${records};}}>fresh</button>
        <ul>{items.map(row=><li key={row.id}>{row.label}</li>)}</ul></main>;}` }, 'override');
  expect(output).toContain('evaluateListOperation');
  setScheduler(run => run()); document.body.append(App('Override', null));
  const original = [...document.querySelectorAll('li')];
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'slice')!;
  let saved: { label: string } | undefined;
  Object.defineProperty(Array.prototype, 'slice', { ...descriptor, value: function (...args: unknown[]) {
    if (this[0]?.label === 'one') { saved = this[0]; saved!.label = 'changed'; }
    return Reflect.apply(descriptor.value, this, args);
  } });
  try { reset(); document.getElementById('copy')!.click(); }
  finally { Object.defineProperty(Array.prototype, 'slice', descriptor); }
  expect(replays()).toBe(3); expect(original[0]!.textContent).toBe('changed');
  saved!.label = 'later'; reset(); document.getElementById('reverse')!.click();
  expect(replays()).toBe(3); expect(original[0]!.textContent).toBe('later');
  reset(); document.getElementById('fresh')!.click(); expect(replays()).toBe(3);
  expect(original.map(row => row.textContent)).toEqual(['one', 'two', 'three']);
  reset(); document.getElementById('reverse')!.click(); expect(replays()).toBe(0);
});

it('updates positional content while preserving nodes on a helper reorder', async () => {
  const { App } = await load({ './rows.ts': helpers,
    './App.tsx': `import {reverse} from './rows';export function App(){let items=${records};
      return <main><button onClick={()=>{items=reverse(items);}}>reverse</button>
        <ul>{items.map((row,index)=><li key={row.id}>{row.label}:{index}</li>)}</ul></main>;}` }, 'indices');
  setScheduler(run => run()); document.body.append(App('Indices', null));
  const original = [...document.querySelectorAll('li')]; reset(); document.querySelector('button')!.click();
  expect(replays()).toBe(2); expect([...document.querySelectorAll('li')]).toEqual(original.toReversed());
  expect(original.map(row => row.textContent)).toEqual(['one:2', 'two:1', 'three:0']);
});

it('guards native calls whose results are discarded inside linked helpers', async () => {
  const { App, output } = await load({ './rows.ts': `export function copy(rows){return rows.slice();}`,
    './bridge.ts': `import {copy} from './rows';
      export function reverse(rows){const ignored=copy(rows);return rows.toReversed();}`,
    './App.tsx': `import {reverse} from './bridge';export function App(){let items=${records};
      return <main><button onClick={()=>{items=reverse(items);}}>reverse</button>
        <ul>{items.map(row=><li key={row.id}>{row.label}</li>)}</ul></main>;}` }, 'discarded-native');
  expect(output).toContain('evaluateListOperation');
  setScheduler(run => run()); document.body.append(App('Discarded', null));
  const descriptor = Object.getOwnPropertyDescriptor(Array, Symbol.species)!;
  const allocations: Array<Array<{ label: string }>> = [];
  Object.defineProperty(Array, Symbol.species, { configurable: true, value: function () {
    const value: Array<{ label: string }> = []; allocations.push(value); return value;
  } });
  try { reset(); document.querySelector('button')!.click(); }
  finally { Object.defineProperty(Array, Symbol.species, descriptor); }
  expect(replays()).toBe(3);
  const saved = allocations.find(value => value[0]?.label === 'one'); expect(saved).toBeDefined();
  saved![0]!.label = 'escaped'; reset(); document.querySelector('button')!.click();
  expect(replays()).toBe(3); expect(document.querySelector('li')!.textContent).toBe('escaped');
});

it.each([
  `export function change(rows){return rows.inspect();}`,
  `export function change(rows){return rows.filter(row=>opaque(row));}`,
  `export function change(rows){rows[0].label='changed';return rows.toReversed();}`,
  `export function change(rows){globalThis.saved=rows;return rows.slice();}`,
  `export function change(rows){const shortened=rows.slice(1);return [shortened[0]];}`,
  `export function change(rows){const ignored=rows[999];return rows.slice();}`,
  `export function change(rows){return rows.slice(opaque());}`,
  `export function change(rows){return rows.slice({valueOf(){return 1;}});}`,
  `export function project(rows){return [rows[0]];}export function change(rows){return project(rows.slice(0,0));}`,
  `export function change(rows){return [{id:1,label:'one'}].slice(0,0);}
    export function project(rows){const ignored=rows[0];return rows;}`,
  `export function identity(rows){return rows;}
    export function change(rows){return identity([{id:1,label:'one'}].slice(0,0));}
    export function project(rows){const ignored=rows[0];return rows;}`,
])('retains replay for unproven helper behavior: %s', helper => {
  const output = compileModules({ './rows.ts': helper,
    './App.tsx': `import {change${helper.includes('export function project') ? ',project' : ''}} from './rows';
      export function App(){let items=${records};return <main>
        <button onClick={()=>{items=change(items);${helper.includes('const ignored=rows[0]') ? 'items=project(items);' : ''}}}>change</button>
        <ul>{items.map(row=><li key={row.id}>{row.label}</li>)}</ul></main>;}` })['./App.tsx']!;
  expect(output).not.toContain('evaluateListOperation');
});
