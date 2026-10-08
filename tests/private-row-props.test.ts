import { afterEach, beforeAll, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@memoized-dom/compiler';
import { compileModules } from '../packages/compiler/src/linker';
import { _internals, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';
import { setProps } from '@memoized-dom/runtime';

const probe = globalThis as typeof globalThis & {
  privateRows?: Array<{ id: number; label: string }>;
  privateEnvelopes?: Array<{ item: unknown }>;
  privateRead?: () => string;
  privateReads?: string[];
  privateItem?: (item: unknown) => unknown;
};
const row = `function Row(props) {
  return <li onClick={() => { props.item.label += '!'; }}>{props.item.id + ':' + props.item.label}</li>;
}`;
function source(declaration = row, attributes = 'item={item}', callbackBlock = false) {
  const jsx = `<Row key={item.id} ${attributes}/>`;
  return `${declaration} export function App({items}) {
    return <ul>{items.map(item => ${callbackBlock ? `{return ${jsx};}` : jsx})}</ul>;
  }`;
}

beforeAll(() => {
  const directory = join(import.meta.dirname, 'fixtures/out/private-row-props');
  mkdirSync(directory, { recursive: true });
  const cases = {
    private: source(),
    block: source(row, undefined, true),
    linked: source(),
    escaped: source(`function Row(props) {
      return <li onClick={() => globalThis.privateEnvelopes.push(props)}>{props.item.label}</li>;
    }`),
    receiver: source(`function Row(props) {
      return <li onClick={() => props.item()}>{props.item.id}</li>;
    }`),
    tagReceiver: source(`function Row(props) {
      return <li onClick={() => props.item\`tag\`}>{props.item.id}</li>;
    }`),
    staged: source(`function Row(props) {
      return <li onClick={() => { globalThis.privateRead = () => props.item.label; }}>{props.item.label}</li>;
    }`, 'item={globalThis.privateItem(item)}'),
    shadow: source(`function Row(props) {
      const label = props => props.item.label;
      return <li>{label({item:props.item})}</li>;
    }`),
  };
  for (const [name, input] of Object.entries(cases)) {
    const output = name === 'linked' ? compileModules({ './linked.tsx': input })['./linked.tsx']! : compile(input);
    writeFileSync(join(directory, name + '.ts'), output);
  }
});
afterEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  resetScheduler(); document.body.replaceChildren();
  delete probe.privateRows; delete probe.privateEnvelopes; delete probe.privateRead;
  delete probe.privateReads; delete probe.privateItem;
});
async function create(name: string, items: unknown[]) {
  const specifier = `./fixtures/out/private-row-props/${name}.ts`;
  const { App } = await import(specifier);
  document.body.append(App('App', null, [{ items }]));
  return document.querySelector('ul')!;
}

it.each(['private','block','linked'])('%s: retained replacements and events use the current item', async kind => {
  setScheduler(run => run());
  const first = {id:1,label:'one'}, second = {id:2,label:'two'};
  const host = await create(kind, [first, second]); const nodes = [...host.children];
  const next = [{id:2,label:'two!'}, {id:1,label:'one!'}];
  setProps('App', [{items:next}]);
  expect([...host.children]).toEqual([nodes[1],nodes[0]]);
  expect([...host.children].map(node => node.textContent)).toEqual(['2:two!','1:one!']);
  (host.children[0] as HTMLElement).click();
  expect(next[0]!.label).toBe('two!!'); expect(second.label).toBe('two');
  expect(host.children[0]!.textContent).toBe('2:two!!');
});

it('replays record getters and preserves an opaque setter changing another retained row', async () => {
  setScheduler(run => run()); const reads: string[] = [];
  const second = {id:2,label:'two'}; let label = 'one';
  const first = { get id() { reads.push('id'); return 1; },
    get label() { reads.push('label'); return label; },
    set label(value: string) { label=value; second.label='setter changed sibling'; },
  };
  const host = await create('private', [first,second]); const nodes = [...host.children]; reads.length = 0;
  _internals().registry.get('App')!.render();
  expect(reads).toEqual(['id','id','label']);
  (host.children[0] as HTMLElement).click();
  expect([...host.children]).toEqual(nodes);
  expect([...host.children].map(node => node.textContent)).toEqual(['1:one!','2:setter changed sibling']);
});

it('keeps escaped props envelopes distinct across replacement', async () => {
  setScheduler(run => run()); probe.privateEnvelopes = [];
  const first = {id:1,label:'one'}, next = {id:1,label:'next'};
  const host = await create('escaped', [first]); const node = host.firstElementChild as HTMLElement;
  node.click(); setProps('App', [{items:[next]}]); node.click();
  expect(probe.privateEnvelopes).toHaveLength(2);
  expect(probe.privateEnvelopes[0]).not.toBe(probe.privateEnvelopes[1]);
  expect(probe.privateEnvelopes.map(value => value.item)).toEqual([first,next]);
  expect(host.firstElementChild).toBe(node);
});

it.each(['receiver','tagReceiver'])('%s: preserves a props receiver for function-property calls', async kind => {
  setScheduler(run => run()); probe.privateEnvelopes = [];
  function item(this: {item: unknown}) { probe.privateEnvelopes!.push(this); }
  Object.assign(item, {id:1});
  const host = await create(kind, [item]);
  (host.firstElementChild as HTMLElement).click();
  expect(probe.privateEnvelopes).toHaveLength(1);
  expect(probe.privateEnvelopes[0]!.item).toBe(item);
});

it('evaluates the next prop before changing row bindings, including a throwing value', async () => {
  const jobs: Array<() => void> = [];
  setScheduler(run => jobs.push(run)); const first = {id:1,label:'old'}, next = {id:1,label:'new'};
  let checking = false, throws = true;
  probe.privateItem = item => {
    if (checking) {
      expect(probe.privateRead!()).toBe('old');
      if (throws) throw new Error('next prop');
    }
    return item;
  };
  const host = await create('staged', [first]); const node = host.firstElementChild as HTMLElement;
  node.click(); checking = true; setProps('App', [{items:[next]}]);
  expect(() => _internals().registry.get('App')!.render()).toThrow('next prop');
  expect(probe.privateRead!()).toBe('old'); expect(node.textContent).toBe('old');
  throws = false; _internals().registry.get('App')!.render();
  expect(probe.privateRead!()).toBe('new'); expect(node.textContent).toBe('new');
  expect(host.firstElementChild).toBe(node);
  checking = false;
  while (jobs.length) jobs.shift()!();
});

it('preserves a nested parameter shadowing the outer props name', async () => {
  setScheduler(run => run()); const host = await create('shadow', [{id:1,label:'one'}]);
  setProps('App', [{items:[{id:1,label:'next'}]}]);
  expect(host.firstElementChild!.textContent).toBe('next');
});

it.each([
  ['exported', source(row.replace('function Row', 'export function Row'))],
  ['extra prop', source(row, 'item={item} extra={item.label}')],
  ['spread', source(row, '{...{item}}')],
  ['default', source(row.replace('Row(props)', 'Row(props = {})'))],
  ['computed', source(row.replaceAll('props.item', 'props["item"]'))],
  ['receiver', source(row.replace("props.item.label += '!'", 'props.item()'))],
  ['tag receiver', source(row.replace("props.item.label += '!'", 'props.item`tag`'))],
  ['mutation', source(row.replace("props.item.label += '!'", 'props.item = {id:3,label:"three"}'))],
  ['arguments', source(row.replace('return <li', 'globalThis.inspect(arguments); return <li'))],
  ['eval', source(row) + 'function inspect() { return eval("Row"); }'],
  ['escaped factory', source(row) + 'export const factory = Row;'],
  ['cleanup owner', source(row.replace('return <li', '$cleanup(() => {}); return <li'))],
  ['member tag', 'const registry = {Shell:"li"};' + source('function Row(props) { return <registry.Shell>{props.item.label}</registry.Shell>; }')],
])('retains the generic contract for %s', (_name, input) => {
  const output = compile(input);
  expect(output).not.toMatch(/function Row\(_rowProp/);
});

it('preserves the existing diagnostic for mixed static and listed calls', () => {
  const input = source(row).replace('return <ul>', 'return <main><Row item={items[0]}/><ul>').replace('</ul>;', '</ul></main>;');
  expect(() => compile(input)).toThrow(/R7 L1/);
});

it('retains the generic contract during hot compilation', () => {
  expect(compile(source(), {hot:true})).not.toMatch(/function Row\(_rowProp/);
});
