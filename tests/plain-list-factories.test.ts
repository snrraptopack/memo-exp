import { afterEach, beforeAll, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@memoized-dom/compiler';
import { _internals, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const probe = globalThis as typeof globalThis & { factoryRenders?: number[] };
const records = Array.from({ length: 24 }, (_, id) => `{id:${id},label:prefix + ':${id}'}`).join(',');
function source(kind = 'inline', factory = `const make = prefix => [${records}];`, init = "make('row')", owner = true) {
  const state = `let items = ${init};`;
  return `${factory}
    function trace(id, value) { globalThis.factoryRenders.push(id); return value; }
    function Row({item}) { return <li>{trace(item.id, item.label)}</li>; }
    ${owner ? '' : state}
    export function App() { ${owner ? state : ''}
      return <main><button onClick={() => {
        ${owner ? 'for (let i=0;i<items.length;i+=10) items[i].label += "!";' : 'items[0].label += "!";'}
      }}>update</button><ul>{items.map(item => ${kind === 'inline'
        ? '<li key={item.id}>{trace(item.id, item.label)}</li>' : '<Row key={item.id} item={item}/>'})}</ul></main>;
    }`;
}

beforeAll(() => {
  const directory = join(import.meta.dirname, 'fixtures/out/plain-factories');
  mkdirSync(directory, { recursive: true });
  for (const kind of ['inline', 'component']) {
    const output = compile(source(kind));
    expect(output).toContain('ChangedKeys.add(items[i].id)');
    writeFileSync(join(directory, `${kind}.ts`), output);
  }
  const output = compile(source('component', undefined, undefined, false)
    .replace('</ul>', '</ul><ul>{items.map(item => <Row key={item.id} item={item}/>)}</ul>'));
  expect(output).toContain('commitListItemWrites');
  writeFileSync(join(directory, 'module.ts'), output);
});
afterEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  resetScheduler(); document.body.replaceChildren(); delete probe.factoryRenders;
});

for (const kind of ['inline', 'component']) it.each([false, true])(`${kind}: factory lists refresh executed keys and stay instance-local (deferred=%s)`, async deferred => {
  const pending: Array<() => void> = [];
  setScheduler(run => { if (deferred) pending.push(run); else run(); });
  const renders: number[] = []; probe.factoryRenders = renders;
  const specifier = `./fixtures/out/plain-factories/${kind}.ts`;
  const { App } = await import(specifier);
  document.body.append(App('First', null), App('Second', null));
  const lists = [...document.querySelectorAll('ul')];
  const rows = lists.map(list => [...list.children]);
  renders.length = 0;
  document.querySelector<HTMLButtonElement>('button')!.click();
  while (pending.length) pending.shift()!();
  expect(renders).toEqual([0, 10, 20]);
  lists.forEach((list, instance) => rows[instance]!.forEach((row, id) => {
    expect(list.children[id]).toBe(row);
    expect(row.textContent).toBe(`row:${id}` + (instance === 0 && id % 10 === 0 ? '!' : ''));
  }));
});

it('module factory lists refresh the fixed row in every mounted list', async () => {
  setScheduler(run => run()); const renders: number[] = []; probe.factoryRenders = renders;
  const specifier = './fixtures/out/plain-factories/module.ts';
  const { App } = await import(specifier);
  document.body.append(App('App', null));
  const rows = [...document.querySelectorAll('li')];
  renders.length = 0; document.querySelector<HTMLButtonElement>('button')!.click();
  expect(renders).toEqual([0, 0]);
  rows.forEach((row, index) => {
    expect(document.querySelectorAll('li')[index]).toBe(row);
    expect(row.textContent).toBe(`row:${index % 24}` + (index % 24 === 0 ? '!' : ''));
  });
});

it.each([
  `function make(prefix) { return [${records}]; }`,
  `const make = function(prefix) { return [${records}]; };`,
  'const make = prefix => [{"id": +0, "label": `${prefix}:${-0}`}];',
  'const make = () => [{id: 0, label: "row" + ":0"}];',
])('proves fresh local literal factory: %s', factory => {
  const init = factory.includes('() =>') ? 'make()' : "make('row')";
  expect(compile(source('inline', factory, init))).toContain('ChangedKeys.add(items[i].id)');
});

it.each([
  ['const make = opaque;', "make('row')"],
  [`let make = prefix => [${records}];`, "make('row')"],
  [`const make = prefix => { observe(); return [${records}]; };`, "make('row')"],
  [`const make = async prefix => [${records}];`, "make('row')"],
  [`function* make(prefix) { return [${records}]; }`, "make('row')"],
  [`const make = (prefix='row') => [${records}];`, 'make()'],
  ['const make = (...args) => [{id:0,label:args[0]}];', "make('row')"],
  ['const make = ({prefix}) => [{id:0,label:prefix}];', "make({prefix:'row'})"],
  [`const make = prefix => [${records}];`, 'make(opaque())'],
  [`const make = prefix => [${records}];`, 'make(globalThis.prefix)'],
  ['const make = prefix => [{id:0,label:globalThis.prefix}];', "make('row')"],
  ['const make = prefix => [{id:0,get label(){return prefix;}}];', "make('row')"],
  ['const make = prefix => [{id:0,label:{value:prefix}}];', "make('row')"],
  ['const make = prefix => [{id:0,...opaque}];', "make('row')"],
  [`const original = prefix => [${records}]; const make = original;`, "make('row')"],
  [`const make = prefix => [${records}];`, "make.call(null, 'row')"],
])('keeps broad replay for an unproven factory: %s / %s', (factory, init) => {
  expect(compile(source('inline', factory, init))).not.toContain('ChangedKeys.add(items[i].id)');
});

it('rejects reassigned factories and opaque later field writes', () => {
  const input = source().replace('let items =', 'make = opaque; let items =');
  expect(compile(input)).not.toContain('ChangedKeys.add(items[i].id)');
  expect(compile(source().replace('items[i].label += "!"', 'items[i].label = opaque()')))
    .not.toContain('ChangedKeys.add(items[i].id)');
});

it('does not classify a factory returning shared reactive state as fresh data', () => {
  expect(() => compile(source('inline', "const shared = [{id:0,label:'row'}]; const make = () => shared;", 'make()')))
    .toThrow(/cannot write derived 'items'/);
});
