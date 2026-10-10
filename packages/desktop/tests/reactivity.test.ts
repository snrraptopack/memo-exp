import { expect, it } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getActiveApplicationRuntime } from '@memoized-dom/runtime/core';
import { createProcessHost } from '../src/bridge/process';
import { buildDesktopEntry } from '../src/dev/build';
import {
  createDesktopApplication,
  runDesktopEntry,
  type SceneHandle,
  type SceneTemplate,
  type SceneTransaction,
  type DesktopHost,
} from '../src';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

interface EntryExports {
  increment(): number;
  schedule(): void;
}

const sources = {
  'main.ts': `
    import {mount} from '@memoized-dom/runtime';
    import {App} from './App';
    import {increment, schedule} from './state';
    export {increment, schedule};
    mount('root', App);
  `,
  'state.ts': `
    export let count = 0;
    export const doubled = count * 2;
    export function increment() { count++; return count; }
    export function schedule() { setTimeout(() => { count++; }, 0); }
  `,
  'barrel.ts': `import {count as total, doubled, increment as advance} from './state'; export {total, doubled, advance};`,
  'helper.ts': `import {advance} from './barrel'; export function bump() { return advance(); }`,
  'First.tsx': `import {total} from './barrel'; export function First() { return <p>{total}</p>; }`,
  'Second.tsx': `import {doubled} from './barrel'; export function Second() { return <p>{doubled}</p>; }`,
  'Editor.tsx': `import {bump} from './helper'; export function Editor() { return <button onClick={bump}>Add</button>; }`,
  'App.tsx': `
    import {First} from './First';
    import {Second} from './Second';
    import {Editor} from './Editor';
    function Unrelated() { return <p>{globalThis.desktopUnrelatedProbe}</p>; }
    export function App() { return <main><Editor/><First/><Second/><Unrelated/></main>; }
  `,
};

/** Use the real file builder: plain .ts modules must participate in linking. */
async function fixture(overrides: Record<string, string> = {}, native?: DesktopHost) {
  const directory = await mkdtemp(resolve(tmpdir(), 'memo-desktop-reactivity-'));
  const transactions: SceneTransaction[] = [];
  const templates = new Map<string, SceneTemplate>();
  const mounted = new Map<string, SceneHandle[]>();
  const values = new Map<number, Map<number, string>>();
  let rejectNext = false;
  let gate: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | undefined;
  let committed = deferred();
  const app = createDesktopApplication({
    async install(template) {
      await native?.install(template);
      templates.set(template.id, template);
    },
    async commit(transaction) {
      const blocked = gate;
      gate = undefined;
      if (blocked) {
        blocked.entered.resolve();
        await blocked.release.promise;
      }
      if (rejectNext) {
        rejectNext = false;
        throw new Error('native rejection');
      }
      await native?.commit(transaction);
      transactions.push(transaction);
      for (const operation of transaction.operations) {
        if (operation.kind === 'mount') {
          const name = operation.template.slice(operation.template.lastIndexOf('#') + 1);
          const handles = mounted.get(name) ?? [];
          handles.push(operation.handle);
          mounted.set(name, handles);
          values.set(operation.handle.id, new Map(operation.values.map(value => [value.slot, value.value])));
        } else if (operation.kind === 'update') {
          for (const value of operation.values) values.get(operation.handle.id)!.set(value.slot, value.value);
        } else if (operation.kind === 'dispose') {
          values.delete(operation.handle.id);
        }
      }
      committed.resolve();
      committed = deferred();
      return { sequence: transaction.sequence };
    },
  });
  try {
    for (const [name, source] of Object.entries({ ...sources, ...overrides })) {
      await writeFile(resolve(directory, name), source);
    }
    const code = await buildDesktopEntry(resolve(directory, 'main.ts'), {
      runtimePath: pathToFileURL(resolve(import.meta.dirname, '../src/index.ts')).href,
    });
    let entry!: EntryExports;
    await runDesktopEntry(app, async () => {
      entry = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    });
    const handle = (name: string): SceneHandle => mounted.get(name)![0]!;
    return {
      app, entry, code, transactions, templates, mounted, handle,
      text(name: string, slot = 0) { return values.get(handle(name).id)!.get(slot); },
      textAt(handle: SceneHandle, slot: number) { return values.get(handle.id)!.get(slot); },
      nextCommit() { return committed.promise; },
      reject() { rejectNext = true; },
      block() {
        const blocked = { entered: deferred(), release: deferred() };
        gate = blocked;
        return blocked;
      },
      async close() {
        try { await app.dispose(); }
        finally { await rm(directory, { recursive: true, force: true }); }
      },
    };
  } catch (error) {
    await app.dispose();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

it('routes canonical writes through helper and state re-exports to sibling readers and module derivations', async () => {
  let unrelatedReads = 0;
  Object.defineProperty(globalThis, 'desktopUnrelatedProbe', {
    configurable: true,
    get() { unrelatedReads++; return 'untouched'; },
  });
  const f = await fixture();
  try {
    expect(f.code).toContain('/state.ts#count');
    expect(f.code).toContain('readers:');
    expect(f.text('First')).toBe('0');
    expect(f.text('Second')).toBe('0');
    expect(await f.app.dispatch(f.handle('Editor'), 0)).toBe(1);
    expect(f.text('First')).toBe('1');
    expect(f.text('Second')).toBe('2');
    expect(unrelatedReads).toBe(1);
    const operations = f.transactions.at(-1)!.operations;
    expect(operations.map(operation => operation.handle.id).sort()).toEqual([
      f.handle('First').id, f.handle('Second').id,
    ].sort());
  } finally {
    await f.close();
    Reflect.deleteProperty(globalThis, 'desktopUnrelatedProbe');
  }
});

it.each([
  `export async function increment() { count++; await Promise.resolve(); count++; }`,
  `export function increment() { setTimeout(async () => { await Promise.resolve(); count++; }, 0); }`,
  `export function* increment() { count++; yield count; count++; }`,
])('diagnoses module writes requiring asynchronous or generator continuations: %s', async helper => {
  await expect(fixture({
    'state.ts': `
      export let count = 0;
      export const doubled = count * 2;
      ${helper}
      export function schedule() {}
    `,
  })).rejects.toThrow('continuation instrumentation');
});

it('automatically publishes programmatic and timer writes in the originating application scope', async () => {
  const f = await fixture();
  try {
    const first = f.nextCommit();
    expect(f.app.run(() => f.entry.increment())).toBe(1);
    await first;
    expect(f.text('First')).toBe('1');
    expect(f.text('Second')).toBe('2');
    const timer = f.nextCommit();
    f.app.run(() => f.entry.schedule());
    await timer;
    await f.app.flush();
    expect(f.text('First')).toBe('2');
    expect(f.text('Second')).toBe('4');
  } finally { await f.close(); }
});

it('keeps cross-module destinations accepted until a rejected transaction is explicitly retried', async () => {
  const f = await fixture();
  try {
    f.reject();
    const error = await f.app.dispatch(f.handle('Editor'), 0).then(() => null, failure => failure);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('native rejection');
    expect(f.text('First')).toBe('0');
    expect(f.text('Second')).toBe('0');
    await f.app.flush();
    expect(f.text('First')).toBe('1');
    expect(f.text('Second')).toBe('2');
    expect(f.transactions.at(-1)!.sequence).toBe(2);
  } finally { await f.close(); }
});

it('keeps a later module write independent from an earlier in-flight rejection', async () => {
  const f = await fixture();
  try {
    const gate = f.block();
    f.reject();
    const first = f.app.dispatch(f.handle('Editor'), 0).then(() => null, error => error);
    await gate.entered.promise;
    const second = f.app.dispatch(f.handle('Editor'), 0);
    await Promise.resolve();
    gate.release.resolve();
    expect((await first).message).toBe('native rejection');
    expect(await second).toBe(2);
    expect(f.text('First')).toBe('2');
    expect(f.text('Second')).toBe('4');
  } finally { await f.close(); }
});

it('reports automatic publication rejection before allowing an explicit retry', async () => {
  const f = await fixture();
  try {
    const gate = f.block();
    f.reject();
    f.app.run(() => f.entry.increment());
    await gate.entered.promise;
    gate.release.resolve();
    // Let the automatic publication settle before attaching a flush waiter.
    await Bun.sleep(0);
    await expect(f.app.flush()).rejects.toThrow('native rejection');
    expect(f.text('First')).toBe('0');
    expect(f.text('Second')).toBe('0');
    await f.app.flush();
    expect(f.text('First')).toBe('1');
    expect(f.text('Second')).toBe('2');
    expect(f.transactions.at(-1)!.sequence).toBe(2);
  } finally { await f.close(); }
});

it('routes direct inline module writes while preserving a shadowed component-local binding', async () => {
  const f = await fixture({
    'Editor.tsx': `import {advance} from './barrel'; export function Editor(){let count=10; return <div><button onClick={()=>advance()}>Shared</button><button onClick={()=>count++}>Local</button><p>{count}</p></div>;}`,
  });
  try {
    await f.app.dispatch(f.handle('Editor'), 1);
    expect(f.text('Editor')).toBe('11');
    expect(f.text('First')).toBe('0');
    await f.app.dispatch(f.handle('Editor'), 0);
    expect(f.text('Editor')).toBe('11');
    expect(f.text('First')).toBe('1');
    expect(f.text('Second')).toBe('2');
  } finally { await f.close(); }
});

it('routes after authored finally blocks while preserving the helper return value', async () => {
  const f = await fixture({
    'state.ts': `export let count=0; export const doubled=count*2; export function increment(){try{count++;return count;}finally{count++;}} export function schedule(){}`,
  });
  try {
    expect(await f.app.dispatch(f.handle('Editor'), 0)).toBe(1);
    expect(f.text('First')).toBe('2');
    expect(f.text('Second')).toBe('4');
  } finally { await f.close(); }
});

it('uses linked helper reads and parameter-write effects for mutable module stores', async () => {
  const f = await fixture({
    'state.ts': `
      export const model={name:'Ada'};
      export let count=0;
      export const doubled=count*2;
      export function readName(){return model.name;}
      export function rename(target,name){target.name=name;}
      export function increment(){rename(model,'Grace');return ++count;}
      export function schedule(){}
    `,
    'First.tsx': `import {readName} from './state'; export function First(){return <p>{readName()}</p>;}`,
  });
  try {
    expect(f.text('First')).toBe('Ada');
    await f.app.dispatch(f.handle('Editor'), 0);
    expect(f.text('First')).toBe('Grace');
    expect(f.text('Second')).toBe('2');
  } finally { await f.close(); }
});

it('keeps native row identity and local input state while shared module readers change and retire', async () => {
  const f = await fixture({
    'state.ts': `
      export let count=0;
      export const doubled=count*2;
      export let rows=[{id:'a',title:'A'},{id:'b',title:'B'}];
      export function increment(){return ++count;}
      export function schedule(){}
      export function reverse(){rows=rows.toReversed();}
      export function remove(){rows=rows.slice(1);}
      export function add(){rows=[...rows,{id:'c',title:'C'}];}
    `,
    'Row.tsx': `
      import {count} from './state';
      export function Row({title}){let note='';return <article><p>{title}</p><p>{count}</p><input value={note} onChange={e=>note=e.target.value}/></article>;}
    `,
    'App.tsx': `
      import {rows,reverse,remove,add,increment} from './state';
      import {Row} from './Row';
      export function App(){return <main><button onClick={reverse}>Reverse</button><button onClick={remove}>Remove</button><button onClick={add}>Add</button><button onClick={increment}>Count</button><div>{rows.map(row=><Row key={row.id} title={row.title}/>)}</div></main>;}
    `,
  });
  try {
    const a = f.mounted.get('Row')![0]!;
    const b = f.mounted.get('Row')![1]!;
    await f.app.dispatch(a!, 0, { target: { value: 'A note' } });
    await f.app.dispatch(f.handle('App'), 0);
    const order = f.transactions.at(-1)!.operations.find(operation => operation.kind === 'order');
    expect(order).toMatchObject({ children: [b, a] });
    expect(f.textAt(a!, 2)).toBe('A note');
    await f.app.dispatch(f.handle('App'), 3);
    expect(f.transactions.at(-1)!.operations.map(operation => operation.handle)).toEqual([b, a]);
    expect(f.textAt(a!, 1)).toBe('1');
    expect(f.textAt(b!, 1)).toBe('1');
    await f.app.dispatch(f.handle('App'), 1);
    await f.app.dispatch(f.handle('App'), 2);
    const c = f.mounted.get('Row')![2]!;
    await f.app.dispatch(f.handle('App'), 3);
    expect(f.textAt(a!, 1)).toBe('2');
    expect(f.textAt(c, 1)).toBe('2');
    expect(f.textAt(a!, 2)).toBe('A note');
    await expect(f.app.dispatch(b!, 0)).rejects.toThrow('retired');
  } finally { await f.close(); }
});

it('activates module derivations only for the owning graph and isolates application registries', async () => {
  const first = await fixture();
  const second = await fixture();
  try {
    const computedIds = (app: typeof first.app) => app.run(() =>
      [...getActiveApplicationRuntime().state.registry.keys()].filter(id => id.includes('/$computed/')));
    expect(computedIds(first.app)).toHaveLength(1);
    expect(computedIds(second.app)).toHaveLength(1);
    expect(computedIds(first.app)[0]).not.toBe(computedIds(second.app)[0]);
    await first.app.dispatch(first.handle('Editor'), 0);
    expect(first.text('First')).toBe('1');
    expect(second.text('First')).toBe('0');
    await first.close();
    await second.app.dispatch(second.handle('Editor'), 0);
    expect(second.text('Second')).toBe('2');
  } finally {
    await first.close();
    await second.close();
  }
});

it('prepares derived readers during a conservative unknown write', async () => {
  Object.defineProperty(globalThis, 'desktopOpaqueMutation', {
    configurable: true,
    value: (store: { count: number }) => { store.count++; },
  });
  const f = await fixture({
    'state.ts': `export const model={count:0};export const count=model.count;export const doubled=count*2;export function increment(){globalThis.desktopOpaqueMutation(model);return model.count;}export function schedule(){}`,
  });
  try {
    expect(await f.app.dispatch(f.handle('Editor'), 0)).toBe(1);
    expect(f.text('First')).toBe('1');
    expect(f.text('Second')).toBe('2');
  } finally {
    await f.close();
    Reflect.deleteProperty(globalThis, 'desktopOpaqueMutation');
  }
});

it('publishes linked module updates into the real Rust retained scene', async () => {
  const host = createProcessHost({ executable: resolve(import.meta.dirname, '../rust/target/debug',
    process.platform === 'win32' ? 'memoized-dom-desktop-host.exe' : 'memoized-dom-desktop-host') });
  const f = await fixture({}, host);
  try {
    await f.app.dispatch(f.handle('Editor'), 0);
    const snapshot = await host.inspect();
    const first = snapshot.instances.find(instance => instance.handle.id === f.handle('First').id)!;
    const second = snapshot.instances.find(instance => instance.handle.id === f.handle('Second').id)!;
    expect(first.texts.join('')).toBe('1');
    expect(second.texts.join('')).toBe('2');
  } finally {
    await f.close();
    await host.close();
  }
});

it('runs the editable shared-state example through normal mount and the Rust host', async () => {
  const host = createProcessHost({ executable: resolve(import.meta.dirname, '../rust/target/debug',
    process.platform === 'win32' ? 'memoized-dom-desktop-host.exe' : 'memoized-dom-desktop-host') });
  const templates = new Map<string, SceneTemplate>();
  const app = createDesktopApplication({
    async install(template) {
      templates.set(template.id, template);
      await host.install(template);
    },
    commit: transaction => host.commit(transaction),
  });
  try {
    const code = await buildDesktopEntry(resolve(import.meta.dirname, '../examples/shared-state/main.ts'), {
      runtimePath: pathToFileURL(resolve(import.meta.dirname, '../src/index.ts')).href,
    });
    await runDesktopEntry(app, () => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`));
    const initial = await host.inspect();
    const controls = initial.instances.find(instance => instance.template.endsWith('#Controls'))!;
    const events = templates.get(controls.template)!.events;
    await app.dispatch(controls.handle, events.findIndex(event => event.type === 'click'));
    await app.dispatch(controls.handle, events.findIndex(event => event.type === 'change'), {
      currentTarget: { value: 'Shared native title' },
    });
    const snapshot = await host.inspect();
    const readouts = snapshot.instances.filter(instance => instance.template.endsWith('#Readout'));
    expect(readouts).toHaveLength(2);
    for (const readout of readouts) {
      const text = readout.text_groups.map(group => group.text);
      expect(text).toContain('Shared native title');
      expect(text).toContain('Count: 1');
      expect(text).toContain('Derived double: 2');
    }
  } finally {
    await app.dispose();
    await host.close();
  }
});
