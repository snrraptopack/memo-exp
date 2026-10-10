import { expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileDesktop } from '@memoized-dom/compiler/desktop';
import {
  createDesktopApplication,
  type SceneHandle,
  type SceneInstance,
  type SceneTemplate,
  type SceneTransaction,
} from '../src';

const runtimePath = pathToFileURL(resolve(import.meta.dirname, '../src/index.ts')).href;

async function load(source: string) {
  const { code } = compileDesktop(source, { moduleId: 'inline.tsx', runtimePath });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as Promise<{
    App(): SceneInstance;
  }>;
}

function recording() {
  const templates: SceneTemplate[] = [];
  const transactions: SceneTransaction[] = [];
  const values = new Map<number, Map<number, string>>();
  let rejectNext = false;
  const app = createDesktopApplication({
    async install(template) {
      templates.push(template);
    },
    async commit(transaction) {
      transactions.push(transaction);
      if (rejectNext) {
        rejectNext = false;
        throw new Error('inline publication rejected');
      }
      for (const operation of transaction.operations) {
        if (operation.kind === 'dispose') values.delete(operation.handle.id);
        if (operation.kind === 'mount') values.set(operation.handle.id, new Map());
        if (operation.kind === 'mount' || operation.kind === 'update') {
          const accepted = values.get(operation.handle.id)!;
          for (const write of operation.values) accepted.set(write.slot, write.value);
        }
      }
      return { sequence: transaction.sequence };
    },
  });
  return {
    app, templates, transactions,
    reject() { rejectNext = true; },
    text(handle: SceneHandle) { return [...values.get(handle.id)!.values()]; },
  };
}

function mounts(transaction: SceneTransaction) {
  return transaction.operations.filter(operation => operation.kind === 'mount');
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => { throw new Error('Expected publication rejection'); },
    error => error as Error,
  );
}

it('shares conditional closure writes while retaining its branch and independent child state', async () => {
  const { App } = await load(`
    function Child({ value }) {
      let clicks = 0;
      return <button onClick={() => clicks++}>{value}: {clicks}</button>;
    }
    export function App() {
      let count = 0;
      let shown = true;
      return <main>
        <button onClick={() => count++}>Outside</button>
        <button onClick={() => shown = !shown}>Toggle</button>
        <p>{count}</p>
        {shown && <section>
          <button onClick={() => count++}>Inside</button>
          <input type="text" value={count} />
          <p>{count}</p>
          <Child value={count} />
        </section>}
      </main>;
    }
  `);
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  const [, branch, child] = mounts(f.transactions[0]!);
  await f.app.dispatch(child!.handle, 0);
  await f.app.dispatch(branch!.handle, 0);
  expect(f.text(root.handle)).toEqual(['1']);
  expect(f.text(branch!.handle)).toEqual(['1', '1']);
  expect(f.text(child!.handle)).toEqual(['1', '1']);
  expect(f.transactions.at(-1)!.operations.every(operation => operation.kind === 'update')).toBe(true);
  await root.dispatch(0);
  expect(f.text(branch!.handle)).toEqual(['2', '2']);
  expect(f.text(child!.handle)).toEqual(['2', '1']);
  await root.dispatch(1);
  expect(f.transactions.at(-1)!.operations.filter(operation => operation.kind === 'dispose')).toHaveLength(1);
  expect((await rejection(f.app.dispatch(branch!.handle, 0))).message).toContain('retired owner');
  await root.dispatch(1);
  const fresh = mounts(f.transactions.at(-1)!);
  expect(fresh[0]!.handle).not.toEqual(branch!.handle);
  expect(f.text(fresh[1]!.handle)).toEqual(['2', '0']);
  await f.app.dispose();
});

it('installs inactive nested templates without reading inactive expressions or child props', async () => {
  const { App } = await load(`
    function Child({ value }) { return <p>{value}</p>; }
    export function App() {
      let shown = false;
      let nested = true;
      function checked() {
        if (!shown) throw new Error('inactive read');
        return 'visible';
      }
      return <main>
        <button onClick={() => shown = !shown}>Toggle</button>
        {shown && <section>
          {nested ? <><p>{checked()}</p><Child value={checked()} /></> : <p>Other</p>}
        </section>}
      </main>;
    }
  `);
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  expect(f.templates).toHaveLength(5);
  expect(mounts(f.transactions[0]!)).toHaveLength(1);
  await root.dispatch(0);
  const visible = mounts(f.transactions.at(-1)!);
  expect(visible).toHaveLength(3);
  expect(f.text(visible[1]!.handle)).toEqual(['visible']);
  expect(f.text(visible[2]!.handle)).toEqual(['visible']);
  await root.dispatch(0);
  expect(f.transactions.at(-1)!.operations).toMatchObject([{ kind: 'dispose' }]);
  await f.app.dispose();
});

it('retries rejected inline replacements with the same candidate and current closure values', async () => {
  const { App } = await load(`
    export function App() {
      let shown = true;
      let count = 0;
      return <main>
        <button onClick={() => shown = !shown}>Toggle</button>
        {shown ? <section><button onClick={() => count++}>Count</button><p>{count}</p></section>
          : <section><p>{count}</p></section>}
      </main>;
    }
  `);
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  const accepted = mounts(f.transactions[0]!)[1]!.handle;
  f.reject();
  expect((await rejection(root.dispatch(0))).message).toBe('inline publication rejected');
  const rejected = f.transactions.at(-1)!;
  const candidate = mounts(rejected)[0]!.handle;
  await root.flush();
  expect(f.transactions.at(-1)).toEqual(rejected);
  expect(f.text(candidate)).toEqual(['0']);
  expect((await rejection(f.app.dispatch(accepted, 0))).message).toContain('retired owner');
  await f.app.dispose();
});

it('retains keyed inline rows and nested input state, updating object and index captures', async () => {
  const { App } = await load(`
    function Note() {
      let note = '';
      return <input type="text" value={note} onInput={event => note = event.currentTarget.value} />;
    }
    export function App() {
      let items = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
      let selected = '';
      return <main>
        <button onClick={() => items = items.toReversed()}>Reverse</button>
        <button onClick={() => items = items.map(item => ({ ...item, title: item.title + '!' }))}>Rename</button>
        <p>{selected}</p>
        <ul>{items.map((item, index) => <li key={item.id}>
          <p>{item.title}: {index}</p>
          <button onClick={() => selected = item.title}>Select</button>
          <Note />
        </li>)}</ul>
      </main>;
    }
  `);
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  const [, rowA, noteA, rowB, noteB] = mounts(f.transactions[0]!);
  await f.app.dispatch(noteA!.handle, 0, { currentTarget: { value: 'keep me' } });
  await root.dispatch(0);
  const reversed = f.transactions.at(-1)!;
  expect(reversed.operations.some(operation => operation.kind === 'mount' || operation.kind === 'dispose')).toBe(false);
  expect(reversed.operations.at(-1)).toMatchObject({ kind: 'order', children: [rowB!.handle, rowA!.handle] });
  expect(f.text(rowA!.handle)).toEqual(['A', '1']);
  expect(f.text(noteA!.handle)).toEqual(['keep me']);
  expect(f.text(noteB!.handle)).toEqual(['']);
  await root.dispatch(1);
  await f.app.dispatch(rowA!.handle, 0);
  expect(f.text(root.handle)).toEqual(['A!']);
  expect(f.text(rowA!.handle)).toEqual(['A!', '1']);
  expect(f.text(noteA!.handle)).toEqual(['keep me']);
  await f.app.dispose();
});

it('supports shared destructuring and derivation normalization in inline rows', async () => {
  const { App } = await load(`
    export function App() {
      let items = [{ id: 1, title: 'First' }];
      return <main>
        <button onClick={() => items = [{ id: 1, title: 'Updated' }]}>Replace</button>
        {items.map(({ id, title }, index) => {
          const label = title + '!';
          return <section key={id}><p>{label}: {index}</p></section>;
        })}
      </main>;
    }
  `);
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  const row = mounts(f.transactions[0]!)[1]!.handle;
  expect(f.text(row)).toEqual(['First!', '0']);
  await root.dispatch(0);
  expect(f.text(row)).toEqual(['Updated!', '0']);
  expect(f.transactions.at(-1)!.operations.every(operation => operation.kind === 'update')).toBe(true);
  await f.app.dispose();
});

it('validates inline keys before allocation and preserves candidates through publication rejection', async () => {
  const { App } = await load(`
    export function App() {
      let items = ['a'];
      return <main>
        <button onClick={() => items = ['b', 'b']}>Duplicate</button>
        <button onClick={() => items = ['a', 'b']}>Add</button>
        <button onClick={() => items = []}>Clear</button>
        {items.map(item => <section key={item}><p>{item}</p></section>)}
      </main>;
    }
  `);
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  expect((await rejection(root.dispatch(0))).message).toContain('Duplicate desktop row key');
  expect(f.transactions).toHaveLength(1);
  f.reject();
  await rejection(root.dispatch(1));
  const failed = f.transactions.at(-1)!;
  await root.flush();
  expect(f.transactions.at(-1)).toEqual(failed);
  await root.dispatch(2);
  expect(f.transactions.at(-1)!.operations.map(operation => operation.kind)).toEqual(['dispose', 'dispose', 'order']);
  await f.app.dispose();
});

it('bubbles inline events across structural owners once and shares the declaring state owner', async () => {
  const { App } = await load(`
    export function App() {
      let shown = true;
      let count = 0;
      return <main onClick={() => count += 10}>
        <p>{count}</p>
        {shown && <section><button onClick={() => count++}>Click</button><p>{count}</p></section>}
      </main>;
    }
  `);
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  const branch = mounts(f.transactions[0]!)[1]!;
  const template = f.templates.find(template => template.id === branch.template)!;
  await f.app.dispatchEvent({ type: 'event', handle: branch.handle, node: template.events[0]!.node, payload: { type: 'click' } });
  expect(f.text(root.handle)).toEqual(['11']);
  expect(f.text(branch.handle)).toEqual(['11']);
  expect(f.transactions).toHaveLength(2);
  await f.app.dispose();
});

it('keeps nested row captures isolated and propagates in-place object writes to the parent', async () => {
  const { App } = await load(`
    export function App() {
      let groups = [
        { id: 'a', children: [{ id: 'first', title: 'First' }] },
        { id: 'b', children: [{ id: 'second', title: 'Second' }] },
      ];
      return <main>
        <button onClick={() => groups = groups.toReversed()}>Reverse</button>
        <p>{groups[0].children[0].title}</p>
        {groups.map(group => <section key={group.id}>
          {group.children.map(item => <div key={item.id}>
            <p>{item.title}</p>
            <button onClick={() => item.title += '!'}>Rename</button>
          </div>)}
        </section>)}
      </main>;
    }
  `);
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  const [, groupA, first, groupB, second] = mounts(f.transactions[0]!);
  await f.app.dispatch(first!.handle, 0);
  expect(f.text(root.handle)).toEqual(['First!']);
  expect(f.text(first!.handle)).toEqual(['First!']);
  expect(f.text(second!.handle)).toEqual(['Second']);
  await root.dispatch(0);
  expect(f.transactions.at(-1)!.operations.at(-1)).toMatchObject({
    kind: 'order', children: [groupB!.handle, groupA!.handle],
  });
  await f.app.dispatch(first!.handle, 0);
  expect(f.text(first!.handle)).toEqual(['First!!']);
  expect(f.text(root.handle)).toEqual(['Second']);
  await f.app.dispose();
});

it('restores accepted row captures on rejection before a retained handler can run', async () => {
  const { App } = await load(`
    export function App() {
      let selected = '';
      let items = [{ id: 'a', title: 'Accepted' }];
      return <main>
        <button onClick={() => items = [{ id: 'a', title: 'Pending' }]}>Replace</button>
        <p>{selected}</p>
        {items.map(item => <section key={item.id}>
          <button onClick={() => selected = item.title}>Select</button>
          <p>{item.title}</p>
        </section>)}
      </main>;
    }
  `);
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  const row = mounts(f.transactions[0]!)[1]!.handle;
  f.reject();
  await rejection(root.dispatch(0));
  expect(f.text(row)).toEqual(['Accepted']);
  await f.app.dispatch(row, 0);
  // The retained callback saw the accepted binding; publication then received
  // the pending object without changing the retained structural identity.
  expect(f.text(root.handle)).toEqual(['Accepted']);
  expect(f.text(row)).toEqual(['Pending']);
  expect(f.transactions.at(-1)!.operations.every(operation => operation.kind === 'update')).toBe(true);
  await f.app.dispose();
});

it.each([false, true])('preserves inline closure writes during in-flight replacement (rejected=%s)', async refuse => {
  const { App } = await load(`
    export function App() {
      let shown = true;
      let count = 0;
      return <main>
        <button onClick={() => shown = !shown}>Toggle</button>
        <p>{count}</p>
        {shown ? <section><button onClick={() => count++}>Count</button></section>
          : <section><p>{count}</p></section>}
      </main>;
    }
  `);
  const transactions: SceneTransaction[] = [];
  let resume!: () => void;
  let entered!: () => void;
  let pause = false;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const preparing = new Promise<void>(resolve => { entered = resolve; });
  const app = createDesktopApplication({
    async install() {},
    async commit(transaction) {
      transactions.push(transaction);
      if (pause) {
        pause = false;
        entered();
        await gate;
        if (refuse) throw new Error('in-flight rejection');
      }
      return { sequence: transaction.sequence };
    },
  });
  const root = app.mount(App);
  await root.ready;
  const previous = mounts(transactions[0]!)[1]!.handle;
  pause = true;
  const replacement = root.dispatch(0);
  const result = replacement.then(() => undefined, error => error as Error);
  await preparing;
  // The old native subtree is still accepted. Its handler must write the
  // surrounding state and leave that write pending behind the publication.
  const later = app.dispatch(previous, 0);
  await Promise.resolve();
  resume();
  expect(await result).toEqual(refuse ? new Error('in-flight rejection') : undefined);
  await later;
  const candidate = mounts(transactions[1]!)[0]!.handle;
  const final = transactions.at(-1)!;
  for (const handle of [root.handle, candidate]) {
    expect(final.operations.some(operation =>
      (operation.kind === 'mount' || operation.kind === 'update') &&
      operation.handle.id === handle.id && operation.values.some(write => write.value === '1'),
    )).toBe(true);
  }
  expect((await rejection(app.dispatch(previous, 0))).message).toContain('retired owner');
  await app.dispose();
});
