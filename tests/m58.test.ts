/** M5.10 - Lightweight listed component rows. */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compile } from '../compiler/compile';
import { _internals, resetScheduler, setScheduler, unregister } from '../src/kernel';
import { installAccessTable, resetAccessTable, resolveWrites } from '../src/access';
import { commitWrites } from '../src/events';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

const LIGHT_SOURCE = `
let items = [{ id: 1, label: 'one' }, { id: 2, label: 'two' }];
let selected = 0;
let suffix = '';
export function setSuffix(next) { suffix = next; }
function Row(item, sfx) {
  return <li class={selected === item.id ? 'selected' : ''} onClick={() => {
    item.label = 'clicked';
    selected = item.id;
  }}>{item.label}{sfx}</li>;
}
export function C() {
  return <ul>{items.map(item => <Row key={item.id} item={item} sfx={suffix} />)}</ul>;
}`;

const STATEFUL_SOURCE = `
let items = [{ id: 1, label: 'one' }];
function Row(item) {
  let clicks = 0;
  return <li onClick={() => clicks++}>{item.label}{clicks}</li>;
}
export function C() { return <ul>{items.map(item => <Row key={item.id} item={item} />)}</ul>; }
`;

const PROP_ORDER_SOURCE = `
let items = [{ id: 1, label: 'one' }];
let suffix = '';
function Row(sfx, item) { return <li>{sfx}{item.label}</li>; }
function C() { return <ul>{items.map(i => <Row item={i} sfx={suffix} key={i.id} />)}</ul>; }
`;

const NON_NULL_WRITE_SOURCE = `
let items = [{ label: 'one' }];
function C() { return <button onClick={() => { items[0]!.label = 'two'; }}>go</button>; }
`;

const OBJECT_PROP_ROW_SOURCE = `
let items = [{ id: 1, label: 'one' }];
function Row(props: { item: { id: number; label: string } }) { return <li>{props.item.label}</li>; }
function C() { return <ul>{items.map(item => <Row key={item.id} item={item} />)}</ul>; }
`;

function importCompiled(): Promise<any> {
  return import('./fixtures/out/m510-light.compiled.ts');
}

describe('M5.10 - lightweight listed component rows', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'm510-light.compiled.ts'), compile(LIGHT_SOURCE, { runtimePath: '../out-runtime' }));
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((fn) => fn());
  });

  afterEach(() => resetScheduler());

  it('emits a stateless list-only component as a ListEntry factory', () => {
    const code = compile(LIGHT_SOURCE, { runtimePath: '../out-runtime' });
    expect(code).toMatch(/function Row\(item, sfx, _id\d*\)/);
    expect(code).not.toContain('.registerProps');
    const rowFactory = code.slice(code.indexOf('function Row'), code.indexOf('export function C'));
    expect(rowFactory).not.toContain('.register({');
    expect(code).toContain('entities: []');
    expect(code).toContain('"./component.tsx#selected": ["App", "App/*"]');
  });

  it('keeps lightweight rows out of the registry and refreshes them through the owner', async () => {
    const mod = await importCompiled();
    document.body.appendChild(mod.C('App', null));

    expect([..._internals().registry.keys()]).toEqual(['App']);
    const rows = () => document.querySelectorAll('li');
    expect(rows()[0]!.textContent).toBe('one');

    (rows()[0] as HTMLElement).click();
    expect(rows()[0]!.textContent).toBe('clicked');
    expect(rows()[0]!.className).toBe('selected');

    mod.setSuffix('!');
    commitWrites(['./component.tsx#suffix']);
    expect(rows()[0]!.textContent).toBe('clicked!');
    expect(rows()[1]!.textContent).toBe('two!');
  });

  it('keeps rows with local state on the existing entity and props-box path', () => {
    const code = compile(STATEFUL_SOURCE, { runtimePath: '../out-runtime' });
    expect(code).toMatch(/\.registerProps\(_id\d*, _props\d*\)/);
    expect(code).toMatch(/Row\(_rowId\d*, _id\d*, \[item\]\)/);
  });

  it('matches row props by name when JSX attribute order differs from declaration order', () => {
    const code = compile(PROP_ORDER_SOURCE, { runtimePath: '../out-runtime' });
    expect(code).toMatch(/Row\(suffix, i, _rowId\d*\)/);
    expect(code).toMatch(/_entry\d*\.updateProps\(suffix, i\)/);
  });

  it('tracks member writes through TypeScript non-null assertions', () => {
    const code = compile(NON_NULL_WRITE_SOURCE, { runtimePath: '../out-runtime' });
    expect(code).toMatch(/\.commitWrites\(_WRITES_\d*\)/);
  });

  it('preserves a typed object-prop row contract in lightweight emission', () => {
    const code = compile(OBJECT_PROP_ROW_SOURCE, { runtimePath: '../out-runtime' });
    expect(code).toMatch(/Row\(\{\s*item\s*\}, _rowId\d*\)/);
    expect(code).toMatch(/_entry\d*\.updateProps\(\{\s*item\s*\}\)/);
  });

  it('accepts deferred parametrized patterns without changing current resolution', () => {
    installAccessTable(
      {
        readers: { selected: ['App'] },
        params: { selected: [{ pattern: 'App/items/Row[{payload.id}]' }] },
      },
      'App',
    );
    expect(resolveWrites(['selected'], [])).toEqual(['App']);
  });

  it('resolves parametrized patterns from the payload, keeping exact readers', () => {
    installAccessTable(
      {
        readers: { selected: ['App/Badge', 'App/items/Row[*]'] },
        params: { selected: [{ pattern: 'App/items/Row[{payload.item.id}]' }] },
      },
      'App',
    );
    expect(resolveWrites(['selected'], [], { item: { id: 42 } })).toEqual([
      'App/items/Row[42]',
      'App/Badge',
    ]);
  });

  it('falls back to the readers superset when payload interpolation fails', () => {
    installAccessTable(
      {
        readers: { selected: ['App/Badge'] },
        params: { selected: [{ pattern: 'App/items/Row[{payload.item.id}]' }] },
      },
      'App',
    );
    // missing payload field → readers superset, never a partial/garbage set
    expect(resolveWrites(['selected'], [], { item: {} })).toEqual(['App/Badge']);
    expect(resolveWrites(['selected'], [], {})).toEqual(['App/Badge']);
  });

  it('treats prev.* patterns as unresolvable and falls back (L2 resolver state)', () => {
    installAccessTable(
      {
        readers: { selected: ['App/Badge'] },
        params: { selected: [{ pattern: 'App/items/Row[{prev.selected}]' }] },
      },
      'App',
    );
    expect(resolveWrites(['selected'], [], { selected: 3 })).toEqual(['App/Badge']);
  });

  it('detects typed object props behind a type alias', () => {
    const code = compile(
      `let items = [{ id: 1, label: 'one' }];\n` +
        `interface RowProps { item: { id: number; label: string } }\n` +
        `function Row(props: RowProps) { return <li>{props.item.label}</li>; }\n` +
        `function C() { return <ul>{items.map(item => <Row key={item.id} item={item} />)}</ul>; }`,
      { runtimePath: '../out-runtime' },
    );
    expect(code).toMatch(/Row\(\{\s*item\s*\}, _rowId\d*\)/);
  });

  it('rejects unknown props at call sites instead of misaligning silently', () => {
    expect(() =>
      compile(
        `let items = [{ id: 1 }];\nfunction Row(item) { return <li>{item.id}</li>; }\nfunction C() { return <ul>{items.map(i => <Row key={i.id} item={i} onClick={() => {}} />)}</ul>; }`,
      ),
    ).toThrowError(/unknown prop 'onClick' on <Row>/);
    expect(() =>
      compile(
        `function Child(a) { return <span>{a}</span>; }\nfunction C() { return <div><Child a={1} b={2} /></div>; }`,
      ),
    ).toThrowError(/unknown prop 'b' on <Child>/);
  });

  it('matches static child props by name, not attribute order', () => {
    const code = compile(
      `function Child(a, b) { return <span>{a}{b}</span>; }\nfunction C() { return <div><Child b={2} a={1} /></div>; }`,
      { runtimePath: '../out-runtime' },
    );
    expect(code).toMatch(/Child\(_id\d* \+ "\/Child", _id\d*, \[1, 2\]\)/);
  });
});
