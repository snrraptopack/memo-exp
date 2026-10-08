import { afterEach, beforeAll, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@memoized-dom/compiler';
import { _internals, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const probe = globalThis as typeof globalThis & {
  boundedRenders?: number[]; boundedEnabled?: boolean; boundedOpaque?: typeof items; boundedHidden?: number;
};
const items = Array.from({ length: 24 }, (_, id) => ({ id, label: String(id) }));
function source(kind: string, loop = 'for (let i = 0; i < items.length; i += 10) items[i].label += "!";', extra = '') {
  const row = kind === 'component' ? '<Row key={item.id} item={item} suffix={suffix}/>'
    : '<li key={item.id}>{trace(item.id, item.label)}{suffix}</li>';
  return `function trace(id, value) { globalThis.boundedRenders.push(id); return value; }
    function Row({ item, suffix }) { return <li>{trace(item.id, item.label)}{suffix}</li>; }
    export function App() {
      let items = ${JSON.stringify(items)}; let suffix = ':';
      ${extra}
      return <main><button id="update" onClick={() => { ${loop} }}>update</button>
        <button id="conditional" onClick={() => { for (let i=0; i<24; i++) if (globalThis.boundedEnabled && i % 10 === 0) items[i].label += '!'; }}>conditional</button>
        <button id="partial" onClick={() => { for (let i=3; i<24; i+=5) {
          if (i === 8) continue; if (i === 18) break; items[i].label += '?';
        } }}>partial</button>
        <button id="broad" onClick={() => { suffix = '?'; }}>broad</button><ul>{items.map(item => ${row})}</ul></main>;
    }`;
}
beforeAll(() => {
  const directory = join(import.meta.dirname, 'fixtures/out/bounded-list');
  mkdirSync(directory, { recursive: true });
  for (const kind of ['inline', 'component']) {
    const output = compile(source(kind));
    expect(output).toContain('ChangedKeys.add(items[i].id)');
    writeFileSync(join(directory, `${kind}.ts`), output);
  }
  writeFileSync(join(directory, 'shadow.ts'), compile(`
    function Aside() { return <output>{globalThis.boundedHidden}</output>; }
    export function App() {
      let items = [{id:1, label:'own'}];
      return <main><Aside/>
        <button onClick={() => { items[0].label = 'changed'; }}>own</button>
        <button id="shadow" onClick={() => {
          { const items = globalThis.boundedOpaque; items[0].label = 'foreign'; }
        }}>shadow</button><ul>{items.map(item => <li key={item.id}>{item.label}</li>)}</ul>
      </main>;
    }
  `));
});
afterEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  resetScheduler(); document.body.replaceChildren();
  delete probe.boundedRenders; delete probe.boundedEnabled;
  delete probe.boundedOpaque; delete probe.boundedHidden;
});

for (const kind of ['inline', 'component']) it.each([false, true])(`${kind}: updates executed loop targets and retains broad batches (deferred=%s)`, async deferred => {
  const pending: Array<() => void> = [];
  setScheduler(run => { if (deferred) pending.push(run); else run(); });
  const flush = () => { while (pending.length) pending.shift()!(); };
  const renders: number[] = []; probe.boundedRenders = renders; probe.boundedEnabled = false;
  const specifier = `./fixtures/out/bounded-list/${kind}.ts`;
  const { App } = await import(specifier);
  document.body.append(App('App', null));
  const rows = [...document.querySelectorAll('li')];
  const click = (id: string) => document.querySelector<HTMLButtonElement>('#'+id)!.click();
  const check = (changes: number, suffix = ':') => rows.forEach((row, index) => {
    expect(row.textContent).toBe(String(index) + (index % 10 === 0 ? '!'.repeat(changes) : '') + suffix);
    expect(document.querySelectorAll('li')[index]).toBe(row);
  });
  renders.length = 0; click('conditional'); flush();
  expect(renders).toEqual([]); expect(pending).toEqual([]); check(0);
  click('update'); flush(); expect(renders).toEqual([0, 10, 20]); check(1);
  renders.length = 0; probe.boundedEnabled = true; click('conditional'); flush();
  expect(renders).toEqual([0, 10, 20]); check(2);
  renders.length = 0; click('update'); click('broad'); flush();
  check(3, '?');
  expect(new Set(renders)).toEqual(new Set(items.map(item => item.id)));
  renders.length = 0; click('update'); flush(); expect(renders).toEqual([0, 10, 20]); check(4, '?');
  renders.length = 0; click('partial'); flush(); expect(renders).toEqual([3, 13]);
  rows.forEach((row, index) => expect(row.textContent).toBe(String(index) +
    (index % 10 === 0 ? '!!!!' : index === 3 || index === 13 ? '?' : '') + '?'));
});

it.each([
  'for (let i=0; i<items.length; i--) items[i].label = "!";',
  'for (let i=-1; i<items.length; i++) items[i].label = "!";',
  'for (let i=0; i<=items.length; i++) items[i].label = "!";',
  'for (let i=0; i<25; i++) items[i].label = "!";',
  'for (let i=start; i<items.length; i++) items[i].label = "!";',
  'for (let i=0; i<limit; i++) items[i].label = "!";',
  'for (let i=0; i<items.length; i+=step) items[i].label = "!";',
  'for (var i=0; i<items.length; i++) items[i].label = "!";',
  'for (let i=0; i<items.length; i++) { i += step; items[i].label = "!"; }',
  'for (let i=0; i<items.length; i++) { let i = other; items[i].label = "!"; }',
  'for (let i=0; i<items.length; i++) items[i].id = 0;',
  'for (let i=0; i<items.length; i++) items[i].label = opaque();',
])('retains full replay for an unproven loop: %s', loop => {
  expect(compile(source('inline', loop))).not.toContain('ChangedKeys.add(items[i].id)');
});

it('retains full replay for cross-row reads and escaped collections', () => {
  for (const extra of ['const hidden = () => items[0].label;', 'expose(items);']) {
    expect(compile(source('inline', undefined, extra))).not.toContain('ChangedKeys.add(items[i].id)');
  }
});

it.each(['inline', 'component'])('accepts arithmetic field reads in %s rows', kind => {
  const output = compile(source(kind).replaceAll('trace(item.id, item.label)', 'item.id + ": " + item.label'));
  expect(output).toContain('ChangedKeys.add(items[i].id)');
});

it.each([
  'item.label = value', 'item.label++', 'delete item.label',
  '({value: item.label} = value)', '[item.label] = value',
])('rejects row field mutation through %s', write => {
  const input = source('inline').replace('<li key={item.id}>', `<li key={item.id} onClick={() => { ${write}; }}>`);
  expect(compile(input)).not.toContain('ChangedKeys.add(items[i].id)');
});

it('does not apply an owner-list proof to a block-shadowed opaque receiver', async () => {
  setScheduler(run => run()); probe.boundedRenders = []; probe.boundedHidden = 0;
  let receiverReads = 0, readsAtWrite = 0;
  const foreign = { id: 99, get label() { return 'foreign'; }, set label(_value: string) {
    readsAtWrite = receiverReads; probe.boundedHidden!++;
  } };
  probe.boundedOpaque = new Proxy([foreign], { get(target, property, receiver) {
    if (property === '0') receiverReads++;
    return Reflect.get(target, property, receiver);
  } });
  const specifier = './fixtures/out/bounded-list/shadow.ts';
  const { App } = await import(specifier);
  document.body.append(App('App', null));
  const rows = [...document.querySelectorAll('li')];
  document.querySelector<HTMLButtonElement>('#shadow')!.click();
  expect(readsAtWrite).toBe(1); expect(receiverReads).toBe(1);
  expect(document.querySelector('output')!.textContent).toBe('1');
  expect([...document.querySelectorAll('li')]).toEqual(rows);
  expect(rows.map(row => row.textContent)).toEqual(['own']);
});
