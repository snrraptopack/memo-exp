import { expect, it } from 'bun:test';
import { compileDesktop } from '@memoized-dom/compiler/desktop';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  createDesktopApplication,
  mountScene,
  type SceneInstance,
  type SceneTemplate,
  type SceneTransaction,
} from '../src';

const runtimePath = pathToFileURL(resolve(import.meta.dirname, '../src/index.ts')).href;
const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('Expected rejection');
    },
    (error) => error as Error,
  );
async function load(source: string) {
  const { code } = compileDesktop(source, { moduleId: 'nested.tsx', runtimePath });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as Promise<{
    App(): SceneInstance;
  }>;
}
function recording() {
  const templates: SceneTemplate[] = [];
  const transactions: SceneTransaction[] = [];
  let reject = false;
  const app = createDesktopApplication({
    async install(template) {
      templates.push(template);
    },
    async commit(transaction) {
      transactions.push(transaction);
      if (reject) {
        reject = false;
        throw new Error('rejected tree');
      }
      return { sequence: transaction.sequence };
    },
  });
  return {
    app,
    templates,
    transactions,
    reject() {
      reject = true;
    },
  };
}

it('publishes declaring-owner changes through forwarded synchronous callback props', async () => {
  const { App } = await load(`
    function Leaf({onAdd}) {let clicks=0;return <button onClick={()=>{clicks++;onAdd(2);}}>Clicks: {clicks}</button>;}
    function Middle({onAdd}) {return <section><Leaf onAdd={onAdd}/></section>;}
    export function App(){let count=0;const add=(amount)=>count+=amount;return <main><p>{count}</p><Middle onAdd={add}/></main>;}
  `);
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  const leaf = f.transactions[0]!.operations.at(-1)!.handle;
  await f.app.dispatch(leaf, 0);
  expect(f.transactions.at(-1)!.operations).toEqual([
    { kind: 'update', handle: root.handle, values: [{ slot: 0, value: '2' }] },
    { kind: 'update', handle: leaf, values: [{ slot: 0, value: '1' }] },
  ]);
  await f.app.dispose();
});

it('keeps callback writes dirty after an authored throw and a rejected parent publication', async () => {
  const { App } = await load(
    `function Child({onAdd}){return <button onClick={()=>onAdd()}>Add</button>;}export function App(){let count=0;return <main><p>{count}</p><Child onAdd={()=>{count++;throw new Error('callback failed');}}/></main>;}`,
  );
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  const child = f.transactions[0]!.operations[1]!.handle;
  f.reject();
  const error = await rejection(f.app.dispatch(child, 0));
  expect(error).toBeInstanceOf(AggregateError);
  await root.flush();
  expect(f.transactions.at(-1)!.operations).toEqual([
    { kind: 'update', handle: root.handle, values: [{ slot: 0, value: '1' }] },
  ]);
  await f.app.dispose();
});

it('rejects generator and render-prop callback contracts during compilation', () => {
  expect(() =>
    compileDesktop(
      `function Child({action}){return <button onClick={()=>action()}>Run</button>;}export function App(){return <Child action={function*(){}}/>;}`,
    ),
  ).toThrow('callback props cannot be generators');
  expect(() =>
    compileDesktop(
      `function Child({action}){return <button onClick={()=>action()}>Run</button>;}export function App(){return <Child action={()=><p>render prop</p>}/>;}`,
    ),
  ).toThrow('render-prop callbacks');
});

it('publishes a forwarded async callback in its declaring owner across await', async () => {
  let resume!: () => void;
  const pause = new Promise<void>((resolve) => {
    resume = resolve;
  });
  Object.assign(globalThis, { desktopCallbackPause: pause });
  const { App } = await load(`
    function Child({action}) {
      return <button onClick={() => action()}>Run</button>;
    }

    export function App() {
      let count = 0;

      return <main>
        <p>{count}</p>
        <Child action={async () => {
          count++;
          await globalThis.desktopCallbackPause;
          count++;
        }}/>
      </main>;
    }
  `);
  const f = recording();
  try {
    const root = f.app.mount(App);
    await root.ready;
    const child = f.transactions[0]!.operations[1]!.handle;
    const completion = f.app.dispatch(child, 0);
    await f.app.flush();
    expect(f.transactions.flatMap((transaction) => transaction.operations)).toContainEqual({
      kind: 'update',
      handle: root.handle,
      values: [{ slot: 0, value: '1' }],
    });

    resume();
    await completion;
    expect(f.transactions.at(-1)!.operations).toEqual([
      { kind: 'update', handle: root.handle, values: [{ slot: 0, value: '2' }] },
    ]);
  } finally {
    resume();
    await f.app.dispose();
    Reflect.deleteProperty(globalThis, 'desktopCallbackPause');
  }
});

it('attaches compiled children, refreshes destructured props, and keeps local state and owner handles', async () => {
  const { App } = await load(`
    function Child({count, label='Child'}) {
      let clicks=0;
      return <section><p>{label}: {count}</p><button onClick={()=>clicks++}>Child clicks: {clicks}</button></section>;
    }
    export function App(){ let count=0; return <main><button onClick={()=>count++}>{count}</button><Child count={count}/><Child count={99} label="Fixed"/></main>; }
  `);
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  const mounted = f.transactions[0]!.operations;
  expect(mounted.map((operation) => operation.kind)).toEqual(['mount', 'mount', 'mount']);
  expect(mounted[1]).toMatchObject({
    attach_to: { handle: root.handle, node: 3 },
    values: [
      { slot: 0, value: 'Child' },
      { slot: 1, value: '0' },
      { slot: 2, value: '0' },
    ],
  });
  const child = mounted[1]!.handle;
  await f.app.dispatch(child, 0);
  expect(f.transactions.at(-1)!.operations).toEqual([
    { kind: 'update', handle: child, values: [{ slot: 2, value: '1' }] },
  ]);
  await root.dispatch(0);
  expect(f.transactions.at(-1)!.operations).toEqual([
    { kind: 'update', handle: root.handle, values: [{ slot: 0, value: '1' }] },
    { kind: 'update', handle: child, values: [{ slot: 1, value: '1' }] },
  ]);
  expect(
    f.transactions
      .flatMap((transaction) => transaction.operations)
      .filter((operation) => operation.kind === 'mount'),
  ).toHaveLength(3);
  await root.dispose();
  expect(f.transactions.at(-1)!.operations).toEqual([{ kind: 'dispose', handle: root.handle }]);
  expect((await rejection(f.app.dispatch(child, 0))).message).toContain('retired owner');
  await f.app.dispose();
});

it('refreshes three levels of generic and positional props in one publication', async () => {
  const { App } = await load(`
    function Leaf(value=7){ return <p>{value}</p>; }
    function Middle(props){ return <div><Leaf value={props.count}/></div>; }
    export function App(){ let count=0; return <main><button onClick={()=>count++}>{count}</button><Middle count={count}/></main>; }
  `);
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  const leaf = f.transactions[0]!.operations[2]!.handle;
  await root.dispatch(0);
  expect(f.transactions[1]!.operations).toEqual([
    { kind: 'update', handle: root.handle, values: [{ slot: 0, value: '1' }] },
    { kind: 'update', handle: leaf, values: [{ slot: 0, value: '1' }] },
  ]);
  await f.app.dispose();
});

it('does not advance parent or child caches when their publication is rejected', async () => {
  const { App } = await load(
    `function Child({value}){return <p>{value}</p>;} export function App(){let count=0;return <main><button onClick={()=>count++}>{count}</button><Child value={count}/></main>;}`,
  );
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  f.reject();
  expect((await rejection(root.dispatch(0))).message).toBe('rejected tree');
  await root.flush();
  expect(f.transactions[2]).toEqual(f.transactions[1]);
  await f.app.dispose();
});

it('rejects a failed child read before publishing any parent values, then retries the whole tree', async () => {
  const { App } = await load(
    `function Child({value}){function checked(){if(value===1)throw new Error('child read');return value;}return <p>{checked()}</p>;} export function App(){let count=0;return <main><button onClick={()=>count++}>{count}</button><Child value={count}/></main>;}`,
  );
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  expect((await rejection(root.dispatch(0))).message).toBe('child read');
  expect(f.transactions).toHaveLength(1);
  await root.dispatch(0);
  expect(f.transactions[1]!.operations).toHaveLength(2);
  expect(
    f.transactions[1]!.operations.every(
      (operation) => 'values' in operation && operation.values[0]!.value === '2',
    ),
  ).toBe(true);
  await f.app.dispose();
});

it('rejects recursive construction without publishing a partial tree', async () => {
  const { App } = await load(`export function App(){return <main><App/></main>;}`);
  const f = recording();
  expect(() => f.app.mount(App)).toThrow('Recursive desktop component attachment');
  await f.app.dispose();
  expect(f.transactions).toHaveLength(0);
});

it('cleans up all allocated descendants when child construction fails', async () => {
  const f = recording();
  const leaf: SceneTemplate = {
    id: 'leaf',
    nodes: [{ kind: 'text', parent: null, text: 'leaf' }],
    slots: [],
    events: [],
  };
  const parent: SceneTemplate = {
    id: 'parent',
    nodes: [{ kind: 'region', parent: null }],
    slots: [],
    events: [],
  };
  let allocated: SceneInstance | undefined;
  expect(() =>
    f.app.mount(() =>
      mountScene(parent, [], [], {
        children: [
          {
            node: 0,
            sources: [],
            read: () => ({}),
            component() {
              allocated = mountScene(leaf, [], []);
              throw new Error('child setup');
            },
          },
        ],
      }),
    ),
  ).toThrow('child setup');
  await f.app.dispose();
  expect(f.transactions).toHaveLength(0);
  expect(allocated!.mounted).toBe(false);
});

it('retries rejected tree disposal while blocking events in its descendants', async () => {
  const { App } = await load(
    `function Child(){let clicks=0;return <button onClick={()=>clicks++}>{clicks}</button>;}export function App(){return <main><Child/></main>;}`,
  );
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  const child = f.transactions[0]!.operations[1]!.handle;
  f.reject();
  expect((await rejection(root.dispose())).message).toBe('rejected tree');
  expect(root.mounted).toBe(true);
  expect((await rejection(f.app.dispatch(child, 0))).message).toContain('disposed owner');
  await root.dispose();
  expect(f.transactions[2]).toEqual(f.transactions[1]);
  expect(root.mounted).toBe(false);
  expect((await rejection(f.app.dispatch(child, 0))).message).toContain('retired owner');
  await f.app.dispose();
});

it('preserves parent prop and child state changes during an in-flight tree publication', async () => {
  for (const rejected of [false, true]) {
    const { App } = await load(
      `function Child({value}){let clicks=0;return <section><p>{value}</p><button onClick={()=>clicks++}>{clicks}</button></section>;}export function App(){let count=0;return <main><button onClick={()=>count++}>{count}</button><Child value={count}/></main>;}`,
    );
    const transactions: SceneTransaction[] = [];
    let arrived!: () => void;
    const arrival = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let block = true;
    const app = createDesktopApplication({
      async install() {},
      async commit(transaction) {
        transactions.push(transaction);
        if (transaction.sequence === 2 && block) {
          block = false;
          arrived();
          await gate;
          if (rejected) throw new Error('tree rejected');
        }
        return { sequence: transaction.sequence };
      },
    });
    const root = app.mount(App);
    await root.ready;
    const child = transactions[0]!.operations[1]!.handle;
    const first = root.dispatch(0).then(
      () => undefined,
      (error) => error as Error,
    );
    await arrival;
    const childChange = app.dispatch(child, 0);
    const parentChange = root.dispatch(0);
    release();
    await Promise.all([first, childChange, parentChange]);
    expect(transactions.at(-1)!.sequence).toBe(rejected ? 2 : 3);
    expect(transactions.at(-1)!.operations).toEqual([
      { kind: 'update', handle: root.handle, values: [{ slot: 0, value: '2' }] },
      {
        kind: 'update',
        handle: child,
        values: [
          { slot: 0, value: '2' },
          { slot: 1, value: '1' },
        ],
      },
    ]);
    await app.dispose();
  }
});

it('links default and renamed component exports through shared core prop discovery', () => {
  const modules: Record<string, string> = {
    './child.tsx': `function Child({value}){return <p>{value}</p>;} export {Child as Renamed}; export default Child;`,
    './barrel.ts': `import DefaultChild from './child.tsx'; export {DefaultChild as Through};`,
  };
  const readModule = (specifier: string) =>
    modules[specifier] === undefined
      ? undefined
      : { moduleId: specifier, source: modules[specifier]! };
  for (const statement of [
    `import Local from './child.tsx'`,
    `import {Renamed as Local} from './child.tsx'`,
    `import {Through as Local} from './barrel.ts'`,
  ]) {
    expect(
      compileDesktop(
        `${statement}; export function App(){return <main><Local value={1}/></main>;}`,
        { readModule },
      ).code,
    ).toContain('component: Local');
    expect(() =>
      compileDesktop(`${statement}; export function App(){return <Local typo={1}/>;}`, {
        readModule,
      }),
    ).toThrow('does not declare prop typo');
  }
});

it('does not treat arbitrary value imports as compiled components', () => {
  expect(() =>
    compileDesktop(`import {Value} from './value.ts'; export function App(){return <Value/>;}`, {
      readModule: () => ({ moduleId: 'value.ts', source: 'export const Value=1;' }),
    }),
  ).toThrow('unresolved desktop component <Value>');
});

it('reports cyclic component re-exports without recursing indefinitely', () => {
  expect(() =>
    compileDesktop(`import {Child} from './a.ts'; export function App(){return <Child/>;}`, {
      readModule: (specifier) => ({
        moduleId: specifier,
        source:
          specifier === './a.ts'
            ? `import {Child} from './b.ts';export {Child};`
            : `import {Child} from './a.ts';export {Child};`,
      }),
    }),
  ).toThrow('cyclic component re-export');
});

it.each([
  [
    `function Child({value}){return <p>{value}</p>;} export function App(){return <Child unknown={1}/>;}`,
    'does not declare prop',
  ],
  [
    `function Child({value}){return <p>{value}</p>;} export function App(){return <Child value={{a:1}}/>;}`,
    'primitive expressions',
  ],
  [
    `function Child({value=f()}){return <p>{value}</p>;} export function App(){return <Child/>;}`,
    'constant primitive',
  ],
  [
    `function Child({value:{nested}}){return <p>{nested}</p>;} export function App(){return <Child/>;}`,
    'nested and rest',
  ],
  [
    `function Child(){return <p>child</p>;} export function App(){return <Child>contents</Child>;}`,
    'render-prop regions',
  ],
])('rejects unfinished prop contracts explicitly', (source, message) => {
  expect(() => compileDesktop(source, { moduleId: 'bad-props.tsx' })).toThrow(message);
});
