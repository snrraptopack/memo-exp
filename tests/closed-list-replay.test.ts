import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { compileModules } from '@memoized-dom/compiler';
import {
  _internals, createListRegion, resetAccessTable, resetScheduler, setScheduler, unregister,
} from '@memoized-dom/runtime/testing';

const directory = join(import.meta.dirname, 'fixtures/out/closed-list-replay');
const clock = { value: 0 };
const frames: FrameRequestCallback[] = [];
const fixedReplay = /\.reconcile\(items, [^\n]*, false, true\)/;
function source(local: boolean, component: boolean) {
  const data = `let items=[{id:1,label:'one'},{id:2,label:'two'}];`;
  const row = component ? '<Row key={item.id} item={item} suffix={suffix}/>'
    : '<li key={item.id}>{item.label}:{clock.value}:{suffix}</li>';
  const list = `<ul>{items.map(item=>${row})}</ul>`;
  return `import {clock} from './external';
    function Row({item,suffix}){return <li>{item.label}:{clock.value}:{suffix}</li>;}
    ${local ? '' : data}
    export function App(){${local ? data : ''}let suffix=0;
      return <main><output>{clock.value}</output><button onClick={()=>{
        items[0].label += '!';suffix++;
      }}>change</button>${list}${local ? '' : list}</main>;}`;
}
beforeEach(() => {
  document.body.replaceChildren(); resetAccessTable(); clock.value = 0; frames.length = 0;
  vi.stubGlobal('__closedListClock', clock);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback); return frames.length;
  });
});
afterEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  while (frames.length) frames.shift()!(performance.now());
  resetAccessTable(); resetScheduler(); vi.unstubAllGlobals();
});

for (const local of [false, true]) for (const component of [false, true]) {
  it.each([false, true])(`retains live closed rows (local=${local}, component=${component}, deferred=%s)`, async deferred => {
    const name = `${local}-${component}-${deferred}`;
    const output = compileModules({ './app.tsx': source(local, component) })['./app.tsx']!;
    expect(output).toMatch(fixedReplay);
    const target = join(directory, name); mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'external.ts'), 'export const clock=globalThis.__closedListClock;');
    writeFileSync(join(target, 'app.ts'), output);
    const pending: Array<() => void> = [];
    setScheduler(run => { if (deferred) pending.push(run); else run(); });
    const flush = () => { while (pending.length) pending.shift()!(); };
    const specifier = `./fixtures/out/closed-list-replay/${name}/app.ts`;
    const { App } = await import(specifier);
    // Module readers use the compiled App identity; two owned list regions
    // exercise fanout. Independent local owners have no module reader table.
    document.body.append(...(local ? [App('First', null), App('Second', null)] : [App('App', null)]));
    const roots = [...document.querySelectorAll('main')];
    const rows = roots.map(root => [...root.querySelectorAll('li')]);
    const check = (changed: boolean, value: number) => roots.forEach((root, instance) => {
      const labels = ['one' + (changed && (!local || instance === 0) ? '!' : ''), 'two'];
      const suffix = changed && instance === 0 ? 1 : 0;
      [...root.querySelectorAll('li')].forEach((row, index) => {
        expect(row).toBe(rows[instance]![index]);
        expect(row.textContent).toBe(`${labels[index % 2]}:${value}:${suffix}`);
      });
      expect(root.querySelector('output')!.textContent).toBe(String(value));
    });
    const pull = () => {
      const frame = frames.shift(); expect(frame).toBeTypeOf('function'); frame!(performance.now());
    };
    check(false, 0); clock.value = 3; pull(); flush(); check(false, 3);
    clock.value = 4; pull(); roots[0]!.querySelector<HTMLButtonElement>('button')!.click();
    flush(); check(true, 4); clock.value = 0; pull(); flush(); check(true, 0);
  });
}

const plain = `import {clock} from './external';export function App(){
  let items=[{id:1,label:'one'},{id:2,label:'two'}];EXTRA
  return <main>{clock.value}<ul>{items.map(item=><li key={item.id}>{item.label}</li>)}</ul></main>;}`;
it.each([
  plain.replace("id:1,label:'one'", "get id(){return clock.value},label:'one'"),
  plain.replace("id:1,label:'one'", "id:1,get label(){return clock.value}"),
  plain.replace('EXTRA', 'const alias=items;'),
  plain.replace('EXTRA', 'clock.use(items);'),
  plain.replace('EXTRA', 'items[0].id++;'),
  plain.replace('EXTRA', "items[0]={id:1,label:'replacement'};"),
  plain.replace('EXTRA', 'items.reverse();'),
  plain.replace('EXTRA', "items=[{id:3,label:'new'}];"),
  plain.replace('item.id}', 'clock.key(item.id)}'),
  plain.replace('items.map(item=>', 'items.map((item,index)=>'),
  plain.replace('items.map(item=><li', 'items.map(item=>{clock.inspect(item.id);return <li')
    .replace('</li>)', '</li>;})'),
  plain.replace('EXTRA', "eval('items.reverse()');"),
])('retains key/position validation without the closed-list proof: %#', text => {
  const output = compileModules({ './app.tsx': text.replace('EXTRA', '') })['./app.tsx']!;
  expect(output).not.toMatch(fixedReplay);
});

it('skips only proven position/key reads while retaining forward content updates', () => {
  const host = document.createElement('ul');
  const items = [{ id: 1, label: 'one' }, { id: 2, label: 'two' }];
  const calls: string[] = [];
  const region = createListRegion(host, 'fixed-content', initial => {
    let item = initial;
    const node = document.createElement('li'); node.textContent = item.label;
    return { nodes: node, entities: [],
      updateProps(next) { item = next as typeof initial; },
      update() { calls.push(`u${item.id}`); node.textContent = item.label; },
    };
  }, item => { calls.push(`k${item.id}`); return item.id; }, false);
  region.reconcile(items, false, false, true);
  expect(calls).toEqual(['k1', 'k2']); const rows = [...host.children]; calls.length = 0;
  items[0]!.label = 'changed'; region.reconcile(items, false, false, true);
  expect(calls).toEqual(['u1', 'u2']); expect([...host.children]).toEqual(rows);
  expect(rows[0]!.textContent).toBe('changed');
  calls.length = 0; region.reconcile(items);
  expect(calls).toEqual(['k1', 'k2', 'u1', 'u2']);
  calls.length = 0; region.reconcile(items.slice(0, 1), false, false, true);
  expect(calls).toEqual(['k1', 'u1']); expect([...host.children]).toEqual([rows[0]]);
  region.dispose();
});

it('keeps validation during recovery from an interrupted general frame', () => {
  const host = document.createElement('ul'); let throwing = false;
  const reads: number[] = [];
  const region = createListRegion(host, 'fixed-recovery', initial => {
    const node = document.createElement('li'); node.textContent = String(initial.id);
    return { nodes: node, entities: [], update() { if (throwing) throw new Error('update'); } };
  }, (item: { id: number }) => { reads.push(item.id); return item.id; }, false);
  region.reconcile([{ id: 1 }, { id: 2 }]); const rows = [...host.children];
  const next = [{ id: 1 }, { id: 2 }]; throwing = true;
  expect(() => region.reconcile(next)).toThrow('update');
  throwing = false; reads.length = 0; region.reconcile(next, false, false, true);
  expect(reads).toEqual([1, 2]); expect([...host.children]).toEqual(rows);
  region.dispose();
});
