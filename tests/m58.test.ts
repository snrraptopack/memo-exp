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
function C() { return <ul>{items.map(item => <Row sfx={suffix} item={item} />)}</ul>; }
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
    expect(code).toContain('function Row(item, sfx, __memoRowId)');
    expect(code).not.toContain('MD.registerProps');
    const rowFactory = code.slice(code.indexOf('function Row'), code.indexOf('export function C'));
    expect(rowFactory).not.toContain('MD.register({');
    expect(code).toContain('entities: []');
    expect(code).toContain('"selected": ["App", "App/*"]');
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
    commitWrites(['suffix']);
    expect(rows()[0]!.textContent).toBe('clicked!');
    expect(rows()[1]!.textContent).toBe('two!');
  });

  it('keeps rows with local state on the existing entity and props-box path', () => {
    const code = compile(STATEFUL_SOURCE, { runtimePath: '../out-runtime' });
    expect(code).toContain('MD.registerProps(id, __p)');
    expect(code).toContain('Row(rowId, id, [item])');
  });

  it('recomputes lightweight props in declaration order during reconcile', () => {
    const code = compile(PROP_ORDER_SOURCE, { runtimePath: '../out-runtime' });
    expect(code).toContain('entry.updateProps(suffix, item)');
  });

  it('tracks member writes through TypeScript non-null assertions', () => {
    const code = compile(NON_NULL_WRITE_SOURCE, { runtimePath: '../out-runtime' });
    expect(code).toContain('MD.markDirty(id)');
  });

  it('preserves a typed object-prop row contract in lightweight emission', () => {
    const code = compile(OBJECT_PROP_ROW_SOURCE, { runtimePath: '../out-runtime' });
    expect(code).toMatch(/Row\(\{\s*item\s*\}, rowId\)/);
    expect(code).toMatch(/entry\.updateProps\(\{\s*item\s*\}\)/);
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
});
