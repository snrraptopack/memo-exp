import { afterEach, beforeAll, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@memoized-dom/compiler';
import { _internals, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const probe = globalThis as typeof globalThis & { calculationRenders?: number[]; calculationEnabled?: boolean; calculationHidden?: number };
const records = Array.from({length:24}, (_, id) => ({id, score:id+1, label:`r${id}`}));
function source(owner = true, component = false, expression = 'items[i].score * 2 + items[i].id', extra = '') {
  const data = `let items = ${JSON.stringify(records)};`;
  const access = owner ? 'i' : '0';
  const calculation = `items[${access}].score = ${expression.replaceAll('[i]', `[${access}]`)};
    items[${access}].label = items[${access}].label + ':' + items[${access}].score;`;
  const row = component ? '<Row key={item.id} item={item} suffix={suffix}/>'
    : '<li key={item.id}>{trace(item.id, item.label + "=" + item.score)}{suffix}</li>';
  const list = `<ul>{items.map(item => ${row})}</ul>`;
  const conditionalLabel = 'items[0].label = `${items[0].label}/${items[0].score}`;';
  return `function trace(id, value) { globalThis.calculationRenders.push(id); return value; }
    function Row({item, suffix}) { return <li>{trace(item.id, item.label + '=' + item.score)}{suffix}</li>; }
    ${owner ? '' : data}
    export function App() { ${owner ? data : ''} let suffix = ':'; ${extra}
      return <main><button id="calculate" onClick={() => {
        ${owner ? `for(let i=0;i<items.length;i+=10) { ${calculation} }` : calculation}
      }}>calculate</button><button id="conditional" onClick={() => {
        if(globalThis.calculationEnabled) {
          items[0].score = items[0].score > 10 ? items[0].score - 1 : items[0].score + 1;
          ${conditionalLabel}
        }
      }}>conditional</button><button id="broad" onClick={() => { suffix = '?'; }}>broad</button>
      ${list}${owner ? '' : list}</main>;
    }`;
}

beforeAll(() => {
  const directory = join(import.meta.dirname, 'fixtures/out/list-row-calculations');
  mkdirSync(directory, {recursive:true});
  for (const owner of [false, true]) for (const component of [false, true]) for (const deferred of [false, true]) {
    writeFileSync(join(directory, `${owner}-${component}-${deferred}.ts`), compile(source(owner, component)));
  }
  for (const deferred of [false, true]) writeFileSync(join(directory, `eval-${deferred}.ts`), compile(`
    function Aside() { return <output>{globalThis.calculationHidden}</output>; }
    export function App() {
      let items = [{id:0,score:1},{id:1,score:2}];
      eval('Object.defineProperty(items[0], "score", {get(){return 1},set(value){items[1].score=value;globalThis.calculationHidden=value;}})');
      return <main><Aside/><button onClick={() => { items[0].score = 9; }}>update</button>
        <ul>{items.map(item => <li key={item.id}>{item.score}</li>)}</ul></main>;
    }
  `));
});
afterEach(() => {
  _internals().registry.forEach((_, id) => unregister(id)); resetScheduler(); document.body.replaceChildren();
  delete probe.calculationRenders; delete probe.calculationEnabled;
  delete probe.calculationHidden;
});

for (const owner of [false, true]) for (const component of [false, true]) {
  it.each([false, true])(`same-row calculations owner=${owner}, component=${component}, deferred=%s`, async deferred => {
    const pending: Array<() => void> = [];
    setScheduler(run => { if (deferred) pending.push(run); else run(); });
    const flush = () => { while (pending.length) pending.shift()!(); };
    const renders: number[] = []; probe.calculationRenders = renders; probe.calculationEnabled = false;
    const specifier = `./fixtures/out/list-row-calculations/${owner}-${component}-${deferred}.ts`;
    const { App } = await import(specifier);
    document.body.append(...(owner ? [App('First', null), App('Second', null)] : [App('App', null)]));
    const lists = [...document.querySelectorAll('ul')], rows = lists.map(list => [...list.children]);
    const models = lists.map(() => records.map(record => ({...record})));
    const click = (id: string) => document.querySelector<HTMLButtonElement>('#'+id)!.click();
    const targets = owner ? [0,10,20] : [0];
    const calculate = () => models.forEach((model, instance) => {
      if (owner && instance !== 0) return;
      for (const id of targets) { const row = model[id]!; row.score = row.score * 2 + row.id; row.label += ':' + row.score; }
    });
    const check = (broad = false) => lists.forEach((list, instance) => models[instance]!.forEach((record, index) => {
      expect(list.children[index]).toBe(rows[instance]![index]);
      expect(list.children[index]!.textContent).toBe(`${record.label}=${record.score}` + (broad && (!owner || instance === 0) ? '?' : ':'));
    }));
    renders.length = 0; click('calculate'); flush(); calculate(); check();
    expect(renders).toEqual(owner ? targets : [0,0]);
    renders.length = 0; click('conditional'); flush(); expect(renders).toEqual([]); expect(pending).toEqual([]);
    probe.calculationEnabled = true; click('conditional'); flush();
    models.forEach((model, instance) => { if (owner && instance !== 0) return;
      model[0]!.score += model[0]!.score > 10 ? -1 : 1; model[0]!.label += '/' + model[0]!.score;
    });
    // Conditional module writes retain separate publication boundaries under
    // the immediate scheduler; deferred commits merge their matching reader.
    expect(renders).toEqual(owner ? [0] : deferred ? [0,0] : [0,0,0,0]); check();
    renders.length = 0; click('calculate'); click('broad'); flush(); calculate(); check(true);
    expect(new Set(renders)).toEqual(new Set(records.map(record => record.id)));
    renders.length = 0; click('calculate'); flush(); calculate(); check(true);
    expect(renders).toEqual(owner ? targets : [0,0]);
  });
}

it.each([
  'items[i].score + 1', 'items[i].score * 2', 'items[i].score / 2', 'items[i].score % 3',
  'items[i].score ** 2', 'items[i].score << 1', '(items[i].score & 3) | 1',
  'items[i].score > 10 ? items[i].score - 1 : items[i].score + 1',
  'items[i].score || items[i].id', 'items[i].score ?? items[i].id',
  'items[i]["score"] + items[i].id',
])('targets a proven same-row expression: %s', expression => {
  expect(compile(source(true, false, expression)).includes('ChangedKeys.add(items[i].id)')).toBe(true);
});

it.each([
  'items[1].score + 1', 'items[i+1].score + 1', 'other.score + 1',
  'opaque(items[i].score)', 'items[i].missing + 1', 'items[i].score.value',
  '(items[i].score = opaque())', 'items[i].score in other', 'items[i].score instanceof Other',
  'items[i].score + globalThis.hidden', 'items[i].score + 1n',
])('keeps broad replay for an unproven expression: %s', expression => {
  expect(compile(source(true, false, expression)).includes('ChangedKeys.add(items[i].id)')).toBe(false);
});

it.each([
  'const hidden = () => items[0].score;', 'observe(items);',
  'eval("Object.defineProperty(items[0], \'score\', {get(){return 0;},set(v){items[1].score=v;}})");',
])('rejects hidden reads, escapes and dynamic access: %s', extra => {
  expect(compile(source(true, false, 'items[i].score + 1', extra)).includes('ChangedKeys.add(items[i].id)')).toBe(false);
});

it('keeps the prior literal-write proof conservative in the presence of direct eval', () => {
  const input = source(true, false, 'items[i].score + 1', 'eval("items[0].score = 9");')
    .replaceAll('items[i].score + 1', '2').replaceAll("items[i].label + ':' + items[i].score", "'changed'")
    .replace('items[0].score > 10 ? items[0].score - 1 : items[0].score + 1', '3')
    .replace('`${items[0].label}/${items[0].score}`', "'conditional'");
  expect(compile(input).includes('ChangedKeys.add(items[i].id)')).toBe(false);
});

it.each([false, true])('keeps dynamically installed setter effects reactive (deferred=%s)', async deferred => {
  const pending: Array<() => void> = [];
  setScheduler(run => { if (deferred) pending.push(run); else run(); });
  probe.calculationHidden = 0;
  const specifier = `./fixtures/out/list-row-calculations/eval-${deferred}.ts`;
  const { App } = await import(specifier);
  document.body.append(App('App', null)); const nodes = [...document.querySelectorAll('li')];
  document.querySelector<HTMLButtonElement>('button')!.click();
  while (pending.length) pending.shift()!();
  expect([...document.querySelectorAll('li')]).toEqual(nodes);
  expect(nodes.map(node => node.textContent)).toEqual(['1', '9']);
  expect(document.querySelector('output')!.textContent).toBe('9');
});

it.each([
  '(id % 2 ? id * 3 : id / 2)', '(id > 10 && id + 1) || 0', '(id >>> 1) + (id ** 2)',
])('proves scalar factory fields computed from literal inputs: %s', value => {
  const input = source().replace(`let items = ${JSON.stringify(records)};`,
    `const make = id => [{id,score:${value},label:'row'}]; let items = make(0);`);
  expect(compile(input).includes('ChangedKeys.add(items[i].id)')).toBe(true);
});

it.each(['opaque(id)', 'id + 1n', 'id.value * 2'])('rejects unproven factory operands: %s', value => {
  const input = source().replace(`let items = ${JSON.stringify(records)};`,
    `const make = id => [{id,score:${value},label:'row'}]; let items = make(0);`);
  expect(compile(input).includes('ChangedKeys.add(items[i].id)')).toBe(false);
});
