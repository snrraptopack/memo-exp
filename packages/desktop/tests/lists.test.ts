import { expect, it } from 'bun:test';
import { compileDesktop } from '@memoized-dom/compiler/desktop';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createDesktopApplication, defineSceneComponent, mountScene, sceneEvent, type SceneInstance, type SceneTransaction, type SceneTemplate } from '../src';

const runtimePath = pathToFileURL(resolve(import.meta.dirname, '../src/index.ts')).href;
const rejected = (promise: Promise<unknown>) => promise.then(() => { throw new Error('Expected rejection'); }, error => error as Error);
async function load(source: string) {
  const { code } = compileDesktop(source, { moduleId: 'lists.tsx', runtimePath });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as Promise<{ App(): SceneInstance }>;
}
function recording() {
  const templates: SceneTemplate[] = []; const transactions: SceneTransaction[] = []; let reject = false;
  const app = createDesktopApplication({ async install(template) { templates.push(template); }, async commit(transaction) {
    transactions.push(transaction); if (reject) { reject = false; throw new Error('list rejected'); } return { sequence: transaction.sequence };
  } });
  return { app, templates, transactions, reject() { reject = true; } };
}
const source = `
  function Row({name, position}) {let clicks=0;return <li><p>{name}: {position}</p><button onClick={()=>clicks++}>Clicks: {clicks}</button></li>;}
  export function App(){let items=['a','b','c'];return <main>
    <button onClick={()=>items=items.toReversed()}>Reverse</button>
    <button onClick={()=>items=['d',...items.slice(1)]}>Replace</button>
    <button onClick={()=>items=[]}>Clear</button>
    <button onClick={()=>items=['a','b','c']}>Reset</button>
    <ul>{items.map((name,position)=><Row key={name} name={name} position={position}/>)}</ul>
  </main>;}
`;
const mounts = (t: SceneTransaction) => t.operations.filter(operation => operation.kind === 'mount');

it('reorders keyed rows atomically while retaining handles, local state and updated index props', async () => {
  const { App } = await load(source); const f = recording(); const root = f.app.mount(App); await root.ready;
  const initial = mounts(f.transactions[0]!); const [a, b, c] = initial.slice(1).map(operation => operation.handle);
  expect(initial).toHaveLength(4); expect(f.templates).toHaveLength(2);
  await f.app.dispatch(b!, 0); await root.dispatch(0);
  const changed = f.transactions.at(-1)!;
  expect(changed.operations.filter(operation => operation.kind === 'mount' || operation.kind === 'dispose')).toEqual([]);
  expect(changed.operations.at(-1)).toMatchObject({ kind: 'order', handle: root.handle, children: [c, b, a] });
  expect(changed.operations.filter(operation => operation.kind === 'update')).toHaveLength(2);
  await f.app.dispatch(b!, 0);
  expect(f.transactions.at(-1)!.operations).toEqual([{ kind: 'update', handle: b!, values: [{ slot: 2, value: '2' }] }]);
  await f.app.dispose();
});

it('inserts/removes rows without rebuilding retained rows and handles empty/refilled lists', async () => {
  const { App } = await load(source); const f = recording(); const root = f.app.mount(App); await root.ready;
  const first = mounts(f.transactions[0]!).slice(1); await root.dispatch(1);
  const replaced = f.transactions.at(-1)!;
  expect(replaced.operations.map(operation => operation.kind)).toEqual(['dispose', 'mount', 'order']);
  expect(replaced.operations[0]!.handle).toEqual(first[0]!.handle);
  expect(replaced.operations.at(-1)).toMatchObject({ children: [replaced.operations[1]!.handle, first[1]!.handle, first[2]!.handle] });
  await root.dispatch(2); expect(f.transactions.at(-1)!.operations.map(operation => operation.kind)).toEqual(['dispose', 'dispose', 'dispose', 'order']);
  expect(f.transactions.at(-1)!.operations.at(-1)).toMatchObject({ children: [] });
  await root.dispatch(3); expect(mounts(f.transactions.at(-1)!)).toHaveLength(3);
  expect(mounts(f.transactions.at(-1)!)[0]!.handle).not.toEqual(first[0]!.handle);
  await f.app.dispose();
});

it('retries a rejected replacement with the same sequence and candidate identities', async () => {
  const { App } = await load(source); const f = recording(); const root = f.app.mount(App); await root.ready;
  f.reject(); expect((await rejected(root.dispatch(1))).message).toBe('list rejected');
  const failed = f.transactions.at(-1)!; await root.flush(); expect(f.transactions.at(-1)).toEqual(failed);
  await f.app.dispose();
});

it('cancels rejected row candidates when returning to accepted keys, retaining old row state', async () => {
  const { App } = await load(source); const f = recording(); const root = f.app.mount(App); await root.ready;
  const a = mounts(f.transactions[0]!)[1]!.handle; await f.app.dispatch(a, 0);
  f.reject(); await rejected(root.dispatch(1)); const candidate = mounts(f.transactions.at(-1)!)[0]!.handle;
  const before = f.transactions.length; await root.dispatch(3); expect(f.transactions).toHaveLength(before);
  await f.app.dispatch(a, 0); expect(f.transactions.at(-1)!.operations[0]).toMatchObject({ handle: a, values: [{ slot: 2, value: '2' }] });
  expect((await rejected(f.app.dispatch(candidate, 0))).message).toContain('retired owner');
  await f.app.dispose();
});

it('validates all keys before constructing candidates or publishing partial work', async () => {
  const { App } = await load(`function Row({name}){return <p>{name}</p>;}export function App(){let items=['a'];return <main><button onClick={()=>items=['b','b']}>Bad</button><button onClick={()=>items=['a']}>Reset</button>{items.map(name=><Row key={name} name={name}/>)}</main>;}`);
  const f = recording(); const root = f.app.mount(App); await root.ready;
  expect((await rejected(root.dispatch(0))).message).toContain('Duplicate desktop row key'); expect(f.transactions).toHaveLength(1);
  await root.dispatch(1); expect(f.transactions).toHaveLength(1); await f.app.dispose();
});

it('preserves primitive key types and rejects non-finite/object/null keys explicitly', async () => {
  for (const key of ['NaN', 'Infinity', '{}', 'null']) {
    const { App } = await load(`function Row(){return <p>row</p>;}export function App(){let items=['a'];return <main>{items.map(name=><Row key={${key}}/>)}</main>;}`);
    const f = recording(); expect(() => f.app.mount(App)).toThrow('row keys'); await f.app.dispose();
  }
  const { App } = await load(`function Row({name}){return <p>{name}</p>;}export function App(){let items=[1,'1'];return <main>{items.map(name=><Row key={name} name={name}/>)}</main>;}`);
  const f = recording(); const root = f.app.mount(App); await root.ready; expect(mounts(f.transactions[0]!)).toHaveLength(3); await f.app.dispose();
});

it('uses shared destructuring/callback derivation and optional-source normalization', async () => {
  const { App } = await load(`function Row({label}){return <p>{label}</p>;}export function App(){let items=[{id:'a',name:'A'}];return <main><button onClick={()=>items=undefined}>Clear</button>{items?.map(({id,name})=>{const label=name+'!';return <Row key={id} label={label}/>;})}</main>;}`);
  const f = recording(); const root = f.app.mount(App); await root.ready;
  expect(mounts(f.transactions[0]!)[1]).toMatchObject({ values: [{ slot: 0, value: 'A!' }] });
  await root.dispatch(0); expect(f.transactions.at(-1)!.operations.at(-1)).toMatchObject({ kind: 'order', children: [] }); await f.app.dispose();
});

it('keeps stable rows out of native publication when neither props nor order change', async () => {
  const { App } = await load(`function Row({name}){return <p>{name}</p>;}export function App(){let count=0;let items=['a','b'];return <main><button onClick={()=>count++}>{count}</button>{items.map(name=><Row key={name} name={name}/>)}</main>;}`);
  const f = recording(); const root = f.app.mount(App); await root.ready; await root.dispatch(0);
  expect(f.transactions.at(-1)!.operations).toEqual([{ kind: 'update', handle: root.handle, values: [{ slot: 0, value: '1' }] }]); await f.app.dispose();
});

it('recovers after row setup fails without retiring accepted siblings', async () => {
  const { App } = await load(`function Row({name}){if(name==='bad')throw new Error('bad setup');let clicks=0;return <button onClick={()=>clicks++}>{name}: {clicks}</button>;}export function App(){let items=['a'];return <main><button onClick={()=>items=['b','bad']}>Bad</button><button onClick={()=>items=['a']}>Reset</button>{items.map(name=><Row key={name} name={name}/>)}</main>;}`);
  const f = recording(); const root = f.app.mount(App); await root.ready; const a = mounts(f.transactions[0]!)[1]!.handle;
  expect((await rejected(root.dispatch(0))).message).toBe('bad setup'); expect(f.transactions).toHaveLength(1);
  await root.dispatch(1); await f.app.dispatch(a, 0); expect(f.transactions.at(-1)!.operations[0]).toMatchObject({ handle: a, values: [{ slot: 1, value: '1' }] }); await f.app.dispose();
});

it('cascades parent disposal and retires every row event handle', async () => {
  const { App } = await load(source); const f = recording(); const root = f.app.mount(App); await root.ready;
  const rows = mounts(f.transactions[0]!).slice(1); await root.dispose();
  expect(f.transactions.at(-1)!.operations).toEqual([{ kind: 'dispose', handle: root.handle }]);
  for (const row of rows) expect((await rejected(f.app.dispatch(row.handle, 0))).message).toContain('retired owner'); await f.app.dispose();
});

it('preserves later list changes during accepted and rejected in-flight insertion', async () => {
  for (const reject of [false, true]) {
    const { App } = await load(`function Row({name}){return <p>{name}</p>;}export function App(){let items=['a','b'];return <main><button onClick={()=>items=['c',...items]}>Insert</button><button onClick={()=>items=items.toReversed()}>Reverse</button>{items.map(name=><Row key={name} name={name}/>)}</main>;}`);
    const transactions: SceneTransaction[] = []; let blocked = false;
    let arrived!: () => void; const arrival = new Promise<void>(resolve => { arrived = resolve; });
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const app = createDesktopApplication({ async install() {}, async commit(transaction) {
      transactions.push(transaction); if (transaction.sequence === 2 && !blocked) { blocked = true; arrived(); await gate; if (reject) throw new Error('rejected insertion'); }
      return { sequence: transaction.sequence };
    } });
    const root = app.mount(App); await root.ready; const initial = mounts(transactions[0]!);
    const insertion = root.dispatch(0).then(() => undefined, error => error); await arrival;
    const candidate = mounts(transactions[1]!)[0]!.handle; const reversal = root.dispatch(1); release(); await Promise.all([insertion, reversal]);
    const last = transactions.at(-1)!; expect(last.sequence).toBe(reject ? 2 : 3);
    expect(last.operations.at(-1)).toMatchObject({ kind: 'order', children: [initial[2]!.handle, initial[1]!.handle, candidate] });
    expect(mounts(last)).toHaveLength(reject ? 1 : 0); await app.dispose();
  }
});

it('cleans accepted and staged rows when a parent is disposed during publication', async () => {
  for (const reject of [false, true]) {
    const { App } = await load(source); const transactions: SceneTransaction[] = []; let blocked = false;
    let arrived!: () => void; const arrival = new Promise<void>(resolve => { arrived = resolve; });
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const app = createDesktopApplication({ async install() {}, async commit(transaction) {
      transactions.push(transaction); if (transaction.sequence === 2 && !blocked) { blocked = true; arrived(); await gate; if (reject) throw new Error('rejected insertion'); }
      return { sequence: transaction.sequence };
    } });
    const root = app.mount(App); await root.ready;
    const replacement = root.dispatch(1).then(() => undefined, error => error); await arrival;
    const candidate = mounts(transactions[1]!)[0]!.handle; const disposal = root.dispose(); release(); await Promise.all([replacement, disposal]);
    expect(transactions.at(-1)!.operations).toEqual([{ kind: 'dispose', handle: root.handle }]);
    expect((await rejected(app.dispatch(candidate, 0))).message).toContain('retired owner'); await app.dispose();
  }
});

for (const jsx of ['<Row name={name}/>', '<p>{name}</p>']) it('diagnoses incomplete desktop row contracts: '+jsx, () => {
  expect(() => compileDesktop(`function Row({name}){return <p>{name}</p>;}export function App(){let items=['a'];return <main>{items.map(name=>${jsx})}</main>;}`)).toThrow('desktop list rows');
});

it('emits exact list dependencies for primitive rows and includes parent prop reads', () => {
  const exact = compileDesktop(`function Row({name,value}){return <p>{name}: {value}</p>;}export function App(){let items=['a'];let count=0;return <main><button onClick={()=>count++}>Count</button>{items.map(name=><Row key={name} name={name} value={count}/>)}</main>;}`).code;
  expect(exact).toMatch(/lists:[\s\S]*?sources:\s*\["count",\s*"items"\]/);
  const opaque = compileDesktop(`function Row({name}){return <p>{name}</p>;}export function App(){let items=[{id:'a'}];return <main>{items.map(item=><Row key={item.id} name={item.id}/>)}</main>;}`).code;
  expect(opaque).toMatch(/lists:[\s\S]*?sources:\s*null/);
});

it('rejects side-effect callback preludes and asynchronous map callbacks explicitly', () => {
  expect(() => compileDesktop(`function Row({name}){return <p>{name}</p>;}export function App(){let items=['a'];return <main>{items.map(name=>{console.log(name);return <Row key={name} name={name}/>;})}</main>;}`)).toThrow('pure const derivations');
  expect(() => compileDesktop(`function Row({name}){return <p>{name}</p>;}export function App(){let items=['a'];return <main>{items.map(async name=><Row key={name} name={name}/>)}</main>;}`)).toThrow('asynchronous callbacks');
});

it('restores accepted row props before host acceptance and after a rejection', async () => {
  let value = 0; let observed = () => -1; let captured!: SceneInstance; let reject = true;
  let arrived!: () => void; const arrival = new Promise<void>(resolve => { arrived = resolve; });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const child: SceneTemplate = { id: 'raw-row', nodes: [{ kind: 'text', parent: null, text: '' }], slots: [{ node: 0, type: 'text' }], events: [] };
  const Row = (props: Readonly<Record<string, unknown>>) => {
    let current = props.value; observed = () => current as number;
    captured = mountScene(child, [{ slot: 0, sources: null, read: () => current }], [], { receiveProps: next => { current = next.value; } }); return captured;
  };
  defineSceneComponent(Row, child, () => []);
  const parent: SceneTemplate = { id: 'raw-list', nodes: [{ kind: 'element', tag: 'main', parent: null, text: '' }, { kind: 'element', tag: 'button', parent: 0, text: '' }, { kind: 'region', parent: 0, multiple: true }], slots: [], events: [{ node: 1, type: 'click' }] };
  const app = createDesktopApplication({ async install() {}, async commit(transaction) {
    if (transaction.sequence === 2 && reject) { arrived(); await gate; reject = false; throw new Error('reject props'); } return { sequence: transaction.sequence };
  } });
  const root = app.mount(() => mountScene(parent, [], [sceneEvent(() => value++, ['value'])], { lists: [{ node: 2, sources: ['value'], component: Row, read: () => [{ key: 'row', props: { value } }] }] }));
  await root.ready; const changed = rejected(root.dispatch(0)); await arrival; expect(observed()).toBe(0); release(); await changed; expect(observed()).toBe(0);
  await root.flush(); expect(observed()).toBe(1);
  await captured.dispose(); expect(captured.mounted).toBe(false);
  await root.dispatch(0); expect(observed()).toBe(2); await app.dispose();
});

it('replaces rows inside a rejected unmounted candidate without disposing unpublished handles', async () => {
  const { App } = await load(`function Row({name}){return <p>{name}</p>;}function Rows({flip}){let items=['a','b'];return <section>{items.map(name=><Row key={flip?name+'!':name} name={name}/>)}</section>;}export function App(){let shown=false;let flip=false;return <main><button onClick={()=>shown=true}>Show</button><button onClick={()=>flip=true}>Flip</button>{shown&&<Rows flip={flip}/>}</main>;}`);
  const f = recording(); const root = f.app.mount(App); await root.ready; f.reject(); await rejected(root.dispatch(0));
  const failed = mounts(f.transactions.at(-1)!); await root.dispatch(1); const accepted = f.transactions.at(-1)!;
  expect(accepted.sequence).toBe(2); expect(accepted.operations.map(operation => operation.kind)).toEqual(['mount', 'mount', 'mount', 'order']);
  expect(mounts(accepted)[0]!.handle).toEqual(failed[0]!.handle);
  expect(mounts(accepted).slice(1).every(row => failed.slice(1).every(old => old.handle.id !== row.handle.id))).toBe(true);
  await f.app.dispose();
});
