import { expect, it } from 'bun:test';
import { compileDesktop } from '@memoized-dom/compiler/desktop';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { buildDesktopEntry } from '../src/dev/build';
import { createProcessHost } from '../src/bridge/process';
import {
  createDesktopApplication,
  type SceneComponent,
  defineSceneComponent,
  mountScene,
  sceneEvent,
  sceneRenderCallback,
  runDesktopEntry,
  type SceneInstance,
  type SceneTemplate,
  type SceneTransaction,
} from '../src';

const runtimePath = pathToFileURL(resolve(import.meta.dirname, '../src/index.ts')).href;

async function load(source: string) {
  const { code } = compileDesktop(source, { moduleId: 'content.tsx', runtimePath });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as Promise<{
    App(): SceneInstance;
  }>;
}

function recording() {
  const templates: SceneTemplate[] = [];
  const transactions: SceneTransaction[] = [];
  let refuse = false;
  const app = createDesktopApplication({
    async install(template) {
      templates.push(template);
    },
    async commit(transaction) {
      transactions.push(transaction);
      if (refuse) {
        refuse = false;
        throw new Error('content rejected');
      }
      return { sequence: transaction.sequence };
    },
  });
  return {
    app,
    templates,
    transactions,
    reject() {
      refuse = true;
    },
  };
}

const mounts = (transaction: SceneTransaction) =>
  transaction.operations.filter((operation) => operation.kind === 'mount');

it('forwards children through two owners while preserving their declaring state', async () => {
  const { App } = await load(`
    function Leaf({children}) {
      let clicks = 0;
      return <section><button onClick={() => clicks++}>{clicks}</button>{children}</section>;
    }
    function Wrapper({children}) { return <Leaf>{children}</Leaf>; }
    export function App() {
      let count = 0;
      return <main><button onClick={() => count++}>Parent</button>
        <Wrapper><button onClick={() => count++}>{count}</button></Wrapper>
      </main>;
    }
  `);
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  const initial = mounts(f.transactions[0]!);
  const leaf = initial.find((operation) => operation.template === 'content.tsx#Leaf')!.handle;
  const content = initial.at(-1)!.handle;
  await f.app.dispatch(leaf, 0);
  await f.app.dispatch(content, 0);
  expect(f.transactions.at(-1)!.operations).toContainEqual({
    kind: 'update',
    handle: content,
    values: [{ slot: 0, value: '1' }],
  });
  await root.dispatch(0);
  expect(f.transactions.at(-1)!.operations).toContainEqual({
    kind: 'update',
    handle: content,
    values: [{ slot: 0, value: '2' }],
  });
  await f.app.dispatch(leaf, 0);
  expect(f.transactions.at(-1)!.operations).toContainEqual({
    kind: 'update',
    handle: leaf,
    values: [{ slot: 0, value: '2' }],
  });
  await f.app.dispose();
});

it('retains callback row handles and independent state across reordering and caller writes', async () => {
  const { App } = await load(`
    function Row({label, position}) {
      let clicks = 0;
      return <li><p>{label}: {position}</p><button onClick={() => clicks++}>{clicks}</button></li>;
    }
    function Collection({items, renderItem}) {
      return <ul>{items.map((item, index) => renderItem(item, index))}</ul>;
    }
    function Wrapper({items, renderItem}) { return <Collection items={items} renderItem={renderItem}/>; }
    export function App() {
      let prefix = 'A';
      let items = [{id: 'a', name: 'One'}, {id: 'b', name: 'Two'}];
      return <main>
        <button onClick={() => items = items.toReversed()}>Reverse</button>
        <button onClick={() => prefix = 'B'}>Prefix</button>
        <button onClick={() => items[0].name = 'Edited'}>Edit</button>
        <Wrapper items={items} renderItem={(item, index) =>
          <Row key={item.id} label={prefix + item.name} position={index}/>
        }/>
      </main>;
    }
  `);
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  const rows = mounts(f.transactions[0]!).filter(
    (operation) => operation.template === 'content.tsx#Row',
  );
  await f.app.dispatch(rows[1]!.handle, 0);
  await root.dispatch(0);
  expect(mounts(f.transactions.at(-1)!)).toEqual([]);
  const order = f.transactions.at(-1)!.operations.find((operation) => operation.kind === 'order');
  expect(order).toMatchObject({
    children: [mounts(f.transactions[0]!).at(-2)!.handle, mounts(f.transactions[0]!)[3]!.handle],
  });
  await root.dispatch(1);
  expect(
    f.transactions
      .at(-1)!
      .operations.some(
        (operation) =>
          operation.kind === 'update' && operation.values.some((value) => value.value === 'BTwo'),
      ),
  ).toBe(true);
  await root.dispatch(2);
  expect(
    f.transactions
      .at(-1)!
      .operations.some(
        (operation) =>
          operation.kind === 'update' &&
          operation.values.some((value) => value.value === 'BEdited'),
      ),
  ).toBe(true);
  await f.app.dispatch(rows[1]!.handle, 0);
  expect(f.transactions.at(-1)!.operations).toContainEqual({
    kind: 'update',
    handle: rows[1]!.handle,
    values: [{ slot: 2, value: '2' }],
  });
  await f.app.dispose();
});

it('retries rejected callback-key changes with the same candidate identities', async () => {
  const { App } = await load(`
    function Collection({items, renderItem}) {
      return <ul>{items.map(item => renderItem(item))}</ul>;
    }
    export function App() {
      let prefix = 'a';
      let items = [{id: 1}];
      return <main><button onClick={() => prefix = 'b'}>Change key</button>
        <Collection items={items} renderItem={({id}) => <li key={prefix + id}>{prefix}{id}</li>}/>
      </main>;
    }
  `);
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  f.reject();
  await expect(root.dispatch(0)).rejects.toThrow('content rejected');
  const rejected = f.transactions.at(-1)!;
  expect(rejected.operations.map((operation) => operation.kind)).toEqual([
    'dispose',
    'mount',
    'order',
  ]);
  await root.flush();
  expect(f.transactions.at(-1)).toEqual(rejected);
  await f.app.dispose();
});

it('keeps ordinary data props live after in-place edits', async () => {
  const { App } = await load(`
    function Child({data}) { return <p>{data.name}</p>; }
    export function App() {
      let data = {name: 'Before'};
      return <main><button onClick={() => data.name = 'After'}>Edit</button><Child data={data}/></main>;
    }
  `);
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  const child = mounts(f.transactions[0]!)[1]!.handle;
  await root.dispatch(0);
  expect(f.transactions.at(-1)!.operations).toEqual([
    { kind: 'update', handle: child, values: [{ slot: 0, value: 'After' }] },
  ]);
  await f.app.dispose();
});

it('rejects asynchronous and unkeyed render callbacks with concrete diagnostics', () => {
  for (const [callback, message] of [
    ['async item => <li key={item}>{item}</li>', 'synchronous inline'],
    ['item => <li>{item}</li>', 'explicit key'],
  ]) {
    expect(() =>
      compileDesktop(`
      function Collection({items, renderItem}) { return <ul>{items.map(item => renderItem(item))}</ul>; }
      export function App() { return <Collection items={['a']} renderItem={${callback}}/>; }
    `),
    ).toThrow(message!);
  }
});

it('places the same content twice without merging component-local state', async () => {
  const { App } = await load(`
    function Row() { let clicks = 0; return <button onClick={() => clicks++}>{clicks}</button>; }
    function Duplicate({children}) { return <section>{children}{children}</section>; }
    export function App() { return <Duplicate><Row/></Duplicate>; }
  `);
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  const rows = mounts(f.transactions[0]!).filter(
    (operation) => operation.template === 'content.tsx#Row',
  );
  expect(rows).toHaveLength(2);
  expect(rows[0]!.handle).not.toEqual(rows[1]!.handle);
  await f.app.dispatch(rows[0]!.handle, 0);
  expect(f.transactions.at(-1)!.operations).toEqual([
    { kind: 'update', handle: rows[0]!.handle, values: [{ slot: 0, value: '1' }] },
  ]);
  await f.app.dispatch(rows[1]!.handle, 0);
  expect(f.transactions.at(-1)!.operations).toEqual([
    { kind: 'update', handle: rows[1]!.handle, values: [{ slot: 0, value: '1' }] },
  ]);
  await f.app.dispose();
});

it('supports named conditional content and empty children', async () => {
  const { App } = await load(`
    function Panel({header, children}) { return <section>{header}{children}</section>; }
    export function App() {
      let shown = true;
      return <main><button onClick={() => shown = !shown}>Toggle</button>
        <Panel header={shown ? <h2>Heading</h2> : null}>{null}</Panel>
      </main>;
    }
  `);
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  const first = mounts(f.transactions[0]!).at(-1)!.handle;
  await root.dispatch(0);
  expect(f.transactions.at(-1)!.operations).toEqual([{ kind: 'dispose', handle: first }]);
  await root.dispatch(0);
  expect(mounts(f.transactions.at(-1)!)).toHaveLength(1);
  expect(mounts(f.transactions.at(-1)!)[0]!.handle).not.toEqual(first);
  await f.app.dispose();
});

it('routes inline callback-row events to their declaring owner', async () => {
  const { App } = await load(`
    function Collection({items, renderItem}) { return <section>{items.map(item => renderItem(item))}</section>; }
    export function App() {
      let count = 0;
      let items = ['a'];
      return <Collection items={items} renderItem={item =>
        <button key={item} onClick={() => count++}>{item}{count}</button>
      }/>;
    }
  `);
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  const row = mounts(f.transactions[0]!).at(-1)!.handle;
  await f.app.dispatch(row, 0);
  expect(f.transactions.at(-1)!.operations).toEqual([
    { kind: 'update', handle: row, values: [{ slot: 1, value: '1' }] },
  ]);
  await f.app.dispose();
});

it('validates callback keys before constructing new rows', async () => {
  const { App } = await load(`
    function Collection({items, renderItem}) { return <ul>{items.map(item => renderItem(item))}</ul>; }
    export function App() {
      let items = ['a'];
      return <main><button onClick={() => items = ['b', 'b']}>Duplicate</button>
        <button onClick={() => items = ['a']}>Reset</button>
        <Collection items={items} renderItem={item => <li key={item}>{item}</li>}/>
      </main>;
    }
  `);
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  await expect(root.dispatch(0)).rejects.toThrow('Duplicate desktop row key');
  expect(f.transactions).toHaveLength(1);
  await root.dispatch(1);
  expect(f.transactions).toHaveLength(1);
  await f.app.dispose();
});

it('captures named-row children at the row read and refreshes them without remounting', async () => {
  const { App } = await load(`
    function Row({children}) { return <li>{children}</li>; }
    export function App() {
      let items = [{id: 'a', name: 'Before'}];
      return <main><button onClick={() => items = [{id: 'a', name: 'After'}]}>Replace data</button>
        <ul>{items.map((item, index) => <Row key={item.id}><p>{item.name}{index}</p></Row>)}</ul>
      </main>;
    }
  `);
  const f = recording();
  const root = f.app.mount(App);
  await root.ready;
  const content = mounts(f.transactions[0]!).at(-1)!.handle;
  expect(mounts(f.transactions[0]!).at(-1)!.values).toEqual([
    { slot: 0, value: 'Before' },
    { slot: 1, value: '0' },
  ]);
  await root.dispatch(0);
  expect(f.transactions.at(-1)!.operations).toEqual([
    { kind: 'update', handle: content, values: [{ slot: 0, value: 'After' }] },
  ]);
  await f.app.dispose();
});

it('defers content refs and effects until acceptance and cancels rejected setup once', async () => {
  const observations: string[] = [];
  Object.assign(globalThis, {
    desktopContentRecord: (value: string) => {
      observations.push(value);
    },
    desktopContentRef: () => {
      observations.push('ref');
      return () => {
        observations.push('unref');
      };
    },
  });
  const f = recording();
  try {
    const { App } = await load(`
      function Candidate() {
        const receiveRef = globalThis.desktopContentRef;
        $cleanup(() => globalThis.desktopContentRecord('cleanup'));
        $effect(() => { globalThis.desktopContentRecord('effect'); });
        return <p ref={receiveRef}>Candidate</p>;
      }
      function Panel({children}) { return <section>{children}</section>; }
      export function App() {
        let shown = false;
        return <main><button onClick={() => shown = !shown}>Toggle</button>
          <Panel>{shown ? <Candidate/> : null}</Panel>
        </main>;
      }
    `);
    const root = f.app.mount(App);
    await root.ready;
    expect(observations).toEqual([]);
    f.reject();
    await expect(root.dispatch(0)).rejects.toThrow('content rejected');
    expect(observations).toEqual([]);
    await root.dispatch(0);
    expect(observations).toEqual(['cleanup']);
    await root.dispatch(0);
    await f.app.flush();
    expect(observations).toContain('ref');
    expect(observations).toContain('effect');
    await root.dispatch(0);
    expect(observations.filter((value) => value === 'cleanup')).toHaveLength(2);
    expect(observations.filter((value) => value === 'unref')).toHaveLength(1);
  } finally {
    await f.app.dispose();
    Reflect.deleteProperty(globalThis, 'desktopContentRecord');
    Reflect.deleteProperty(globalThis, 'desktopContentRef');
  }
});

it('keeps scalar props scalar through an imported untyped component', async () => {
  // Export discovery provisionally treats untyped interpolations as content.
  // The shared project contract must refine this using the actual scalar call.
  const { code } = compileDesktop(
    `
    import {Label} from './Label';
    export function App() { return <Label text="Scalar"/>; }
  `,
    {
      moduleId: '/scalar/App.tsx',
      runtimePath,
      readModule: () => ({
        moduleId: '/scalar/Label.tsx',
        source: 'export function Label({text}) { return <p>{text}</p>; }',
      }),
    },
  );
  expect(code).not.toContain('sceneContent');
});

it('preserves direct exported scalar props without inventing a native paragraph region', async () => {
  const { code } = compileDesktop('export function Label({value}) { return <p>{value}</p>; }', {
    moduleId: 'exported-label.tsx',
    runtimePath,
  });
  const { Label } = (await import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  )) as {
    Label: SceneComponent;
  };
  const f = recording();
  const owner = f.app.mount(() => Label({ value: 'Scalar' }));
  try {
    await owner.ready;
    expect(f.templates).toHaveLength(1);
    expect(f.templates[0]!.nodes.some((node) => node.kind === 'region')).toBe(false);
    expect(mounts(f.transactions[0]!)[0]!.values).toEqual([{ slot: 0, value: 'Scalar' }]);
  } finally {
    await f.app.dispose();
  }
});

it('replaces a callback factory at the same key only after acceptance', async () => {
  const observations: string[] = [];
  const rowTemplate = (name: string): SceneTemplate => ({
    id: name,
    nodes: [{ kind: 'element', tag: 'li', parent: null, text: '' }],
    slots: [],
    events: [],
  });
  const firstTemplate = rowTemplate('content-first');
  const secondTemplate = rowTemplate('content-second');
  const First = () =>
    mountScene(firstTemplate, [], [], {
      lexical: true,
      activate: () => {
        observations.push('first accepted');
      },
      cleanups: [
        () => {
          observations.push('first cleanup');
        },
      ],
    });
  const Second = () =>
    mountScene(secondTemplate, [], [], {
      lexical: true,
      activate: () => {
        observations.push('second accepted');
      },
      cleanups: [
        () => {
          observations.push('second cleanup');
        },
      ],
    });
  defineSceneComponent(First, firstTemplate, () => []);
  defineSceneComponent(Second, secondTemplate, () => []);
  const collectionTemplate: SceneTemplate = {
    id: 'content-collection',
    nodes: [{ kind: 'region', parent: null, multiple: true }],
    slots: [],
    events: [],
  };
  const Collection = (initial: Readonly<Record<string, unknown>>) => {
    let props = initial;
    return mountScene(collectionTemplate, [], [], {
      receiveProps: (next) => {
        props = next;
      },
      lists: [{ node: 0, sources: null, render: () => props.render, read: () => [[]] }],
    });
  };
  defineSceneComponent(Collection, collectionTemplate, () => []);
  const rootTemplate: SceneTemplate = {
    id: 'content-replacement',
    nodes: [
      { kind: 'element', tag: 'ul', parent: null, text: '' },
      { kind: 'region', parent: 0 },
    ],
    slots: [],
    events: [{ node: 0, type: 'click' }],
  };
  const f = recording();
  const root = f.app.mount(() => {
    let second = false;
    const firstContent = sceneRenderCallback(First, () => ({ key: 'same', props: {} }));
    const secondContent = sceneRenderCallback(Second, () => ({ key: 'same', props: {} }));
    return mountScene(
      rootTemplate,
      [],
      [
        sceneEvent(() => {
          second = !second;
        }, null),
      ],
      {
        components: [Collection, First, Second],
        children: [
          {
            node: 1,
            sources: null,
            component: Collection,
            read: () => ({ render: second ? secondContent : firstContent }),
          },
        ],
      },
    );
  });
  try {
    await root.ready;
    expect(observations).toEqual(['first accepted']);
    f.reject();
    await expect(root.dispatch(0)).rejects.toThrow('content rejected');
    const rejected = f.transactions.at(-1)!;
    expect(observations).toEqual(['first accepted']);
    await root.flush();
    expect(f.transactions.at(-1)).toEqual(rejected);
    expect(observations).toEqual(['first accepted', 'first cleanup', 'second accepted']);
    await root.dispose();
    expect(observations.at(-1)).toBe('second cleanup');
  } finally {
    await f.app.dispose();
  }
});

it('resolves composition contracts through actual module imports and a barrel', async () => {
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(resolve(temporaryRoot, 'memo-desktop-content-'));
  // Verify the test-owned directory before its recursive cleanup is registered.
  if (!resolve(directory).startsWith(resolve(temporaryRoot, 'memo-desktop-content-'))) {
    throw new Error('Unexpected content test directory');
  }
  try {
    await writeFile(
      resolve(directory, 'Panel.tsx'),
      `
      export function Panel({children}) { return <section>{children}</section>; }
      export function Collection({items, renderItem}) {
        return <ul>{items.map((item, index) => renderItem(item, index))}</ul>;
      }
    `,
    );
    await writeFile(
      resolve(directory, 'index.ts'),
      "import {Panel, Collection} from './Panel'; export {Panel, Collection};",
    );
    await writeFile(
      resolve(directory, 'App.tsx'),
      `
      import {Panel, Collection} from './index';
      export function App() {
        let count = 0;
        let items = [{id: 'a'}];
        return <Panel><button onClick={() => count++}>{count}</button>
          <Collection items={items} renderItem={({id}, index) => <li key={id}>{count}{index}</li>}/>
        </Panel>;
      }
    `,
    );
    await writeFile(
      resolve(directory, 'main.ts'),
      `
      import {mount} from '@memoized-dom/runtime';
      import {App} from './App';
      mount('root', App);
    `,
    );
    const code = await buildDesktopEntry(resolve(directory, 'main.ts'), { runtimePath });
    const f = recording();
    try {
      await runDesktopEntry(
        f.app,
        () => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`),
      );
      const button = mounts(f.transactions[0]!).find((operation) => {
        const template = f.templates.find((template) => template.id === operation.template)!;
        return template.events.length > 0;
      })!.handle;
      await f.app.dispatch(button, 0);
      const updates = f.transactions
        .at(-1)!
        .operations.filter((operation) => operation.kind === 'update');
      expect(updates).toHaveLength(2);
      expect(
        updates.every((operation) => operation.values.some((value) => value.value === '1')),
      ).toBe(true);
    } finally {
      await f.app.dispose();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('publishes forwarded content and callback rows into the actual Rust forest', async () => {
  const { code } = compileDesktop(
    `
    import './content.css';
    function Panel({children}) { return <section class="panel">{children}</section>; }
    function Collection({items, renderItem}) {
      return <ul class="rows">{items.map((item, index) => renderItem(item, index))}</ul>;
    }
    export function App() {
      let count = 0;
      let items = [{id: 'a', title: 'One'}, {id: 'b', title: 'Two'}];
      return <Panel>
        <button onClick={() => count++}>Count: {count}</button>
        <button onClick={() => items = items.toReversed()}>Reverse</button>
        <Collection items={items} renderItem={({id, title}, index) =>
          <li key={id} class="row"><p>{title}: {count}: {index}</p></li>
        }/>
      </Panel>;
    }
  `,
    {
      moduleId: 'native-content.tsx',
      runtimePath,
      readStylesheet: () =>
        '.panel > button { width: 180px; } .rows > .row { padding: 8px; } .row + .row { color: red; }',
    },
  );
  const module = (await import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  )) as {
    App(): SceneInstance;
  };
  const host = createProcessHost({
    executable: resolve(
      import.meta.dirname,
      '../rust/target/debug',
      process.platform === 'win32' ? 'memoized-dom-desktop-host.exe' : 'memoized-dom-desktop-host',
    ),
  });
  const app = createDesktopApplication(host);
  try {
    const root = app.mount(module.App);
    await root.ready;
    const initial = await host.inspect();
    const content = initial.instances.find((instance) =>
      instance.text_groups.some((group) => group.text.startsWith('Count:')),
    )!;
    const rows = initial.instances.filter((instance) =>
      instance.text_groups.some((group) => /One|Two/.test(group.text)),
    );
    expect(rows).toHaveLength(2);
    expect(
      rows.map(
        (instance) => instance.text_groups.find((group) => /One|Two/.test(group.text))!.text,
      ),
    ).toEqual(['One: 0: 0', 'Two: 0: 1']);
    expect(rows[0]!.styles![0]!.states[0]!['padding-top']).toBe('8px');
    expect(rows[1]!.styles![0]!.states[0]!['color']).toBe('red');
    await app.dispatch(content.handle, 0);
    await app.dispatch(content.handle, 1);
    const changed = await host.inspect();
    const retained = changed.instances.filter((instance) =>
      rows.some((row) => row.handle.id === instance.handle.id),
    );
    expect(retained.map((instance) => instance.handle)).toEqual(
      rows.map((instance) => instance.handle),
    );
    expect(
      retained.map(
        (instance) => instance.text_groups.find((group) => /One|Two/.test(group.text))!.text,
      ),
    ).toEqual(['One: 1: 1', 'Two: 1: 0']);
    expect(retained[0]!.styles![0]!.states[0]!['color']).toBe('red');
    await root.dispose();
    expect((await host.inspect()).instances).toEqual([]);
  } finally {
    await app.dispose();
    await host.close();
  }
});

it('composes compiled children, conditional text and keyed callbacks inside native paragraphs', async () => {
  const { code } = compileDesktop(
    `
    import './text.css';
    function Caption({children}) { return <span class="caption">{children}</span>; }
    function Forward({children}) { return <Caption>{children}</Caption>; }
    function InlineList({items, renderItem}) {
      return <span>{items.map((item, index) => renderItem(item, index))}</span>;
    }
    export function App() {
      let count = 0;
      let text = '';
      let shown = true;
      let items = [{id: 'a', title: 'One'}, {id: 'b', title: 'Two'}];
      return <section>
        <p id="count">Count: <Forward><strong>{count}</strong></Forward>!</p>
        <button id="increment" onClick={() => count++}>Add <Caption><em>{count}</em></Caption></button>
        <button id="toggle" onClick={() => shown = !shown}>Toggle</button>
        <p id="conditional">Shown: {shown ? <Caption><strong>yes</strong></Caption> : null}.</p>
        <input value={text} onInput={event => text = event.currentTarget.value}/>
        <p id="typed">Typed: <Caption><strong>{text}</strong></Caption>.</p>
        <button id="reverse" onClick={() => items = items.toReversed()}>Reverse</button>
        <p id="rows">Rows: <InlineList items={items} renderItem={({id, title}, index) =>
          <em key={id}>{title}:{index};</em>
        }/>.</p>
        <p id="static">Stable</p>
      </section>;
    }
    `,
    {
      moduleId: 'native-text-content.tsx',
      runtimePath,
      readStylesheet: () => '.caption { color: red; } p > .caption > strong { font-weight: 700; }',
    },
  );
  const module = (await import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  )) as { App(): SceneInstance };
  const host = createProcessHost({
    executable: resolve(
      import.meta.dirname,
      '../rust/target/debug',
      process.platform === 'win32' ? 'memoized-dom-desktop-host.exe' : 'memoized-dom-desktop-host',
    ),
  });
  const app = createDesktopApplication(host);
  try {
    const root = app.mount(module.App);
    await root.ready;
    const initial = await host.inspect();
    const parent = initial.instances.find((instance) =>
      instance.text_groups.some((group) => group.text === 'Count: 0!'),
    )!;
    const readParent = async () => (await host.inspect()).instances.find(
      (instance) => instance.handle.id === parent.handle.id,
    )!;
    const textGroups = (instance: typeof parent) => instance.text_groups.map((group) => group.text);
    expect(textGroups(parent)).toEqual([
      'Count: 0!', 'Add 0', 'Toggle', 'Shown: yes.', 'Typed: .', 'Reverse', 'Rows: One:0;Two:1;.', 'Stable',
    ]);
    const originalRows = initial.instances.filter((instance) =>
      instance.text_groups.some((group) => /^(One|Two):\d;$/.test(group.text)),
    );
    expect(originalRows).toHaveLength(2);
    await app.dispatch(parent.handle, 0);
    let changed = await readParent();
    expect(changed.text_groups[0]!.text).toBe('Count: 1!');
    expect(changed.text_groups[1]!.text).toBe('Add 1');
    expect(changed.text_groups[7]!.revision).toBe(parent.text_groups[7]!.revision);

    // Read each accepted edit, rather than checking only the final word.
    let expected = '';
    for (const letter of ['a', 'b', '🙂']) {
      expected += letter;
      await app.dispatch(parent.handle, 2, {
        target: { value: expected },
        currentTarget: { value: expected },
      });
      changed = await readParent();
      expect(changed.text_groups[4]!.text).toBe(`Typed: ${expected}.`);
    }
    await app.dispatch(parent.handle, 1);
    expect((await readParent()).text_groups[3]!.text).toBe('Shown: .');
    await app.dispatch(parent.handle, 3);
    expect((await readParent()).text_groups[6]!.text).toBe('Rows: Two:0;One:1;.');
    const reordered = await host.inspect();
    expect(reordered.instances.filter((instance) =>
      originalRows.some((row) => row.handle.id === instance.handle.id),
    ).map((instance) => instance.handle)).toEqual(originalRows.map((row) => row.handle));
    await root.dispose();
    expect((await host.inspect()).instances).toEqual([]);
  } finally {
    await app.dispose();
    await host.close();
  }
});
