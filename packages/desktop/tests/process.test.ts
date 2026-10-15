import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { executionCommand, type RuntimeSelection } from '../src/dev/execution';
import { bundleExecutionEntry } from '../src/dev/bundle';
import { PublicationClient } from '../src/host/client';
import { connectNativeHost } from '../src/host/node-process';
import { sourceTemplate } from './fixtures/native-template';
import { compileDesktop, compileDesktopProject } from '@memoized-dom/compiler/desktop';

const nativeHost = process.env.MEMOIZED_DESKTOP_HOST ?? fileURLToPath(new URL(
  '../rust/target/debug/memoized-dom-desktop' + (process.platform === 'win32' ? '.exe' : ''),
  import.meta.url,
));
let directory: string;

beforeAll(async () => {
  try { await access(nativeHost); } catch {
    throw new Error('Build the native host with cargo +1.96.0 build first, or set MEMOIZED_DESKTOP_HOST');
  }
  directory = await mkdtemp(join(tmpdir(), 'memoized-dom-engine-contract-'));
  // The application module is ordinary authored TSX. This private launcher
  // checks the emitted ABI; normal mount/window integration remains next.
  const core = fileURLToPath(new URL('../../runtime/dist/core.js', import.meta.url)).replaceAll('\\', '/');
  const compiled = compileDesktop(`
    let count=0;
    export function increment(){count++;}
    function Summary({count}){return <p>Count: {count}</p>}
    export function App(){return <main className="counter" style="display:flex;gap:12px;">
      <button onClick={increment}>Increment</button><Summary count={count} />
    </main>}
  `, { moduleId: './process-counter.tsx', runtimePath: core });
  await Bun.write(join(directory, 'compiled-app.mjs'), compiled.code);
  const conditional = compileDesktop(`
    let shown = true;
    export function toggle(){ shown = !shown; }
    function Label(){ return <strong>Visible</strong>; }
    export function App(){
      if (shown) return <main><Label /></main>;
      return <aside>Hidden</aside>;
    }
  `, { moduleId: './process-conditional.tsx', runtimePath: core });
  await Bun.write(join(directory, 'conditional-app.mjs'), conditional.code);
  const slots = compileDesktopProject({
    './main.ts': `
      import { mount } from '@memoized-dom/runtime';
      import { App } from './slots-app';
      mount('app', App);
    `,
    './slots-app.tsx': `
      import { Frame } from './Frame';
      let count = 0;
      export function increment() { count++; }
      export function App() {
        const header = count === 0 ? <h2>Start</h2> : <h2>Count: {count}</h2>;
        const children = [<button onClick={increment}>Count: {count}</button>];
        return <Frame {...{ header, children }} />;
      }
    `,
    './Frame.tsx': `
      export function Frame({ header, children }) {
        return <section><header>{header}</header><article>{children}</article></section>;
      }
    `,
  }, { runtimePath: '@memoized-dom/runtime' });

  for (const id of ['./slots-app.tsx', './Frame.tsx']) {
    await Bun.write(join(directory, id.replace(/\.tsx$/, '.mjs')), slots.modules.get(id)!.code);
  }

  const rows = compileDesktopProject({
    './main.ts': `
      import { mount } from '@memoized-dom/runtime';
      import { App } from './rows-app';
      mount('app', App);
    `,
    './row-state.ts': `
      export let count = 0;
      export let reversed = false;
      export let shown = true;
      export function increment() { count++; }
      export function reverse() { reversed = !reversed; }
      export function toggle() { shown = !shown; }
    `,
    './rows-app.tsx': `
      import { count, reversed, shown, reverse, toggle } from './row-state';
      import { Rows } from './Rows';
      export function App() {
        return <main>
          <button onClick={reverse}>Reverse</button>
          <button onClick={toggle}>Toggle second</button>
          <p>{count}</p>
          <Rows items={shown ? (reversed ? [2, 1] : [1, 2]) : [1]} />
        </main>;
      }
    `,
    './Rows.tsx': `
      import { count, increment } from './row-state';
      function Detail({item}) { return <strong>Item {item}</strong>; }
      export function Rows({items}) {
        return <ul>{items.map((item, index) => <li key={item}>
          <button onClick={increment}>{item}:{index}:{count}</button><Detail item={item} />
        </li>)}</ul>;
      }
    `,
  }, { runtimePath: '@memoized-dom/runtime' });

  for (const id of ['./row-state.ts', './rows-app.tsx', './Rows.tsx']) {
    await Bun.write(join(directory, id.replace(/\.tsx?$/, '.mjs')), rows.modules.get(id)!.code);
  }

  const callbacks = compileDesktopProject({
    './main.ts': `
      import { mount } from '@memoized-dom/runtime';
      import { App } from './rows-app';
      mount('app', App);
    `,
    './row-state.ts': `
      export let count = 0;
      export let reversed = false;
      export let shown = true;
      export function increment() { count++; }
      export function reverse() { reversed = !reversed; }
      export function toggle() { shown = !shown; }
    `,
    './rows-app.tsx': `
      import { count, reversed, shown, reverse, toggle, increment } from './row-state';
      import { Rows } from './Rows';
      function Detail({item}) { return <strong>Item {item}</strong>; }
      export function App() {
        return <main>
          <button onClick={reverse}>Reverse</button>
          <button onClick={toggle}>Toggle second</button>
          <p>{count}</p>
          <Rows items={shown ? (reversed ? [2, 1] : [1, 2]) : [1]}
            draw={(item, index) => <li key={item}>
              <button onClick={increment}>{item}:{index}:{count}</button><Detail item={item} />
            </li>}
          />
        </main>;
      }
    `,
    './Rows.tsx': `
      function List(props) {
        return <ul>{props.items.map((item, index) => props.renderItem(item, index))}</ul>;
      }
      export function Rows({items, draw}) {
        return <List {...{items, renderItem: draw}} />;
      }
    `,
  }, { runtimePath: '@memoized-dom/runtime' });
  const callbackDirectory = join(directory, 'callbacks');
  await mkdir(callbackDirectory);

  for (const id of ['./row-state.ts', './rows-app.tsx', './Rows.tsx']) {
    await Bun.write(join(callbackDirectory, id.replace(/\.tsx?$/, '.mjs')), callbacks.modules.get(id)!.code);
  }

  const application = fileURLToPath(new URL('../src/runtime/application.ts', import.meta.url)).replaceAll('\\', '/');
  const client = fileURLToPath(new URL('../src/host/client.ts', import.meta.url)).replaceAll('\\', '/');
  const mount = fileURLToPath(new URL('../src/runtime/mount.ts', import.meta.url)).replaceAll('\\', '/');
  await Bun.write(join(directory, 'rows-entry.ts'), `
    import assert from 'node:assert/strict';
    import { App } from './rows-app.mjs';
    import { reverse, toggle } from './row-state.mjs';
    import { commit, setScheduler } from ${JSON.stringify(core)};
    import { NativeApplication } from ${JSON.stringify(application)};
    import { createMountAdapter } from ${JSON.stringify(mount)};
    import { PublicationClient } from ${JSON.stringify(client)};
    import { connectNativeHost } from '@memoized-dom/desktop/internal-host';

    async function run() {
      const errors = [];
      const app = new NativeApplication(new PublicationClient(connectNativeHost({
        executable: process.argv[2], args: ['--headless'],
      })), { scheduleFrame: null, visible: () => true, reportError: error => errors.push(error) });
      app.run(() => setScheduler(() => {}));
      const adapter = createMountAdapter(app, 'app', error => errors.push(error));

      try {
        const mounted = adapter.mount('app', App);
        await adapter.settled();
        const view = adapter.view();
        const first = { owner: { id: 'App/Rows/items/Row[n:1]', generation: 2 }, source: 1 };
        const second = { owner: { id: 'App/Rows/items/Row[n:2]', generation: 3 }, source: 1 };
        // Synthetic callback/conditional ranges add a wire-only content owner.
        const semanticId = source => source.owner.id.replace('/$content', '');

        view.dispatch(first, 'onClick', new Event('click'));
        app.run(commit);
        await view.publication();
        assert.equal(app.run(() => view.evaluate()).some(step => step.kind === 'text' && step.value === 1), true);
        app.run(() => { reverse(); commit(); });
        await view.publication();
        app.run(commit);
        await view.publication();
        assert.equal(view.matchesSource(first), true);
        assert.equal(view.matchesSource(second), true);
        assert.equal(app.runtime.state.registry.has(semanticId(first) + '/Detail'), true);

        app.run(() => { toggle(); commit(); });
        await view.publication();
        app.run(commit);
        await view.publication();
        assert.equal(view.matchesSource(second), false);
        assert.equal(app.runtime.state.registry.has(semanticId(second) + '/Detail'), false);

        view.dispatch(first, 'onClick', new Event('click'));
        app.run(commit);
        await view.publication();
        assert.equal(app.run(() => view.evaluate()).some(step => step.kind === 'text' && step.value === 2), true);
        mounted.unmount();
        await adapter.settled();
        assert.equal(app.runtime.state.registry.size, 0);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ rows: true, events: true, retired: true }));
      } finally {
        app.close();
      }
    }

    run().catch(error => { console.error(error); process.exitCode = 1; });
  `);
  // The same process contract exercises direct and caller-owned row factories.
  const rowEntry = await readFile(join(directory, 'rows-entry.ts'), 'utf8');
  await Bun.write(join(directory, 'callbacks-entry.ts'), rowEntry
    .replace("'./rows-app.mjs'", "'./callbacks/rows-app.mjs'")
    .replace("'./row-state.mjs'", "'./callbacks/row-state.mjs'")
    .replaceAll('App/Rows/items/Row[', 'App/Rows/List/items/$content/rows/Row['));
  await Bun.write(join(directory, 'compiled-entry.ts'), `
    import assert from 'node:assert/strict';
    import {App} from './compiled-app.mjs';
    import {commit,setScheduler} from ${JSON.stringify(core)};
    import {NativeApplication} from ${JSON.stringify(application)};
    import {PublicationClient} from ${JSON.stringify(client)};
    import {connectNativeHost} from '@memoized-dom/desktop/internal-host';
    async function run(){
      const errors=[];
      const app=new NativeApplication(new PublicationClient(connectNativeHost({
        executable:process.argv[2],args:['--headless'],
      })), {scheduleFrame:null,visible:()=>true,reportError:error=>errors.push(error)});
      app.run(()=>setScheduler(()=>{}));
      const owner={id:'App',generation:1};
      let view;
      try {
        const candidate=app.prepare(()=>{
          view=App({application:app,owner,parent:null,reportError:error=>errors.push(error)});
          return view;
        },{accepted(){view.acceptInitial()},activated(){view.activateUpdates()}});
        const first=await candidate.publish(view.initialPublication);
        view.dispatch(1,'onClick',new Event('click'));
        app.run(commit);
        const second=await view.publication();
        assert.equal(second.sequence,2);
        const third=await candidate.retire({operations:[{op:'retire',owner}]});
        assert.throws(()=>view.dispatch(1,'onClick',new Event('click')),/not active/);
        assert.deepEqual(errors,[]);
        assert.equal(app.runtime.state.registry.size,0);
        console.log(JSON.stringify({accepted:[first.sequence,second.sequence,third.sequence],compiled:true}));
      }finally{app.close()}
    }
    run().catch(error=>{console.error(error);process.exitCode=1});
  `);
  await Bun.write(join(directory, 'conditional-entry.ts'), `
    import assert from 'node:assert/strict';
    import { App, toggle } from './conditional-app.mjs';
    import { commit, setScheduler } from ${JSON.stringify(core)};
    import { NativeApplication } from ${JSON.stringify(application)};
    import { PublicationClient } from ${JSON.stringify(client)};
    import { connectNativeHost } from '@memoized-dom/desktop/internal-host';

    async function run() {
      const errors = [];
      const app = new NativeApplication(new PublicationClient(connectNativeHost({
        executable: process.argv[2], args: ['--headless'],
      })), { scheduleFrame: null, visible: () => true, reportError: error => errors.push(error) });
      app.run(() => setScheduler(() => {}));
      const owner = { id: 'App', generation: 1 };
      let view;

      try {
        const candidate = app.prepare(() => {
          view = App({ application: app, owner, parent: null, reportError: error => errors.push(error) });
          return view;
        }, { accepted() { view.acceptInitial(); }, activated() { view.activateUpdates(); } });
        const first = await candidate.publish(view.initialPublication);

        app.run(() => { toggle(); commit(); });
        const second = await view.publication();
        assert.equal(app.runtime.state.registry.has('App/Label'), false);

        app.run(() => { toggle(); commit(); });
        const third = await view.publication();
        assert.equal(app.runtime.state.registry.has('App/Label'), true);

        const fourth = await candidate.retire(view.retirementPublication());
        assert.deepEqual(errors, []);
        assert.equal(app.runtime.state.registry.size, 0);
        console.log(JSON.stringify({
          accepted: [first.sequence, second.sequence, third.sequence, fourth.sequence],
          conditional: true,
        }));
      } finally {
        app.close();
      }
    }

    run().catch(error => { console.error(error); process.exitCode = 1; });
  `);

  await Bun.write(join(directory, 'slots-entry.ts'), `
    import assert from 'node:assert/strict';
    import { App } from './slots-app.mjs';
    import { commit, setScheduler } from ${JSON.stringify(core)};
    import { NativeApplication } from ${JSON.stringify(application)};
    import { PublicationClient } from ${JSON.stringify(client)};
    import { connectNativeHost } from '@memoized-dom/desktop/internal-host';

    async function run() {
      const errors = [];
      const app = new NativeApplication(new PublicationClient(connectNativeHost({
        executable: process.argv[2], args: ['--headless'],
      })), { scheduleFrame: null, visible: () => true, reportError: error => errors.push(error) });
      app.run(() => setScheduler(() => {}));
      let view;

      try {
        const candidate = app.prepare(() => {
          view = App({
            application: app, owner: { id: 'App', generation: 1 }, parent: null,
            reportError: error => errors.push(error),
          });
          return view;
        }, { accepted() { view.acceptInitial(); }, activated() { view.activateUpdates(); } });
        const first = await candidate.publish(view.initialPublication);
        view.dispatch({
          owner: { id: 'App/Frame/slot[1]/$content', generation: 1 }, source: 0,
        }, 'onClick', new Event('click'));
        app.run(commit);
        const updated = await view.publication();
        const retired = await candidate.retire(view.retirementPublication());
        assert.deepEqual(errors, []);
        assert.equal(app.runtime.state.registry.size, 0);
        console.log(JSON.stringify({
          accepted: [first.sequence, updated.sequence, retired.sequence], slots: true,
        }));
      } finally {
        app.close();
      }
    }

    run().catch(error => { console.error(error); process.exitCode = 1; });
  `);

  // This entry is the ordinary authoring boundary. Only the launcher knows
  // about the host connection, acceptance observation or generated frames.
  await Bun.write(join(directory, 'mounted-app.ts'), `
    import { mount } from '@memoized-dom/runtime';
    import { App } from './compiled-app.mjs';
    export const application = mount('app', App);
  `);
  const mounting = fileURLToPath(new URL('../src/runtime/mount.ts', import.meta.url)).replaceAll('\\', '/');
  const runtimeEntry = fileURLToPath(new URL('../src/runtime/entry.ts', import.meta.url)).replaceAll('\\', '/');
  await Bun.write(join(directory, 'mounted-entry.ts'), `
    import assert from 'node:assert/strict';
    import { commit, setScheduler } from ${JSON.stringify(core)};
    import { NativeApplication } from ${JSON.stringify(application)};
    import { PublicationClient } from ${JSON.stringify(client)};
    import { createMountAdapter } from ${JSON.stringify(mounting)};
    import { installNativeMount } from ${JSON.stringify(runtimeEntry)};
    import { connectNativeHost } from '@memoized-dom/desktop/internal-host';

    async function run() {
      const errors = [];
      const reportError = error => errors.push(error);
      const app = new NativeApplication(new PublicationClient(connectNativeHost({
        executable: process.argv[2], args: ['--headless']
      })), { scheduleFrame: null, visible: () => true, reportError });
      app.run(() => setScheduler(() => {}));
      const adapter = createMountAdapter(app, 'app', reportError);
      const uninstall = installNativeMount(adapter);

      try {
        const { application: mounted } = await import('./mounted-app.ts');
        const first = await adapter.settled();
        assert.equal(mounted.host.isConnected, true);
        adapter.view().dispatch(1, 'onClick', new Event('click'));
        app.run(commit);
        const second = await adapter.view().publication();
        mounted.unmount();
        const third = await adapter.settled();
        assert.equal(mounted.mounted, false);
        const { App } = await import('./compiled-app.mjs');
        const again = adapter.mount('app', App);
        const fourth = await adapter.settled();
        again.unmount();
        const fifth = await adapter.settled();
        assert.equal(app.runtime.state.registry.size, 0);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({
          accepted: [first.sequence, second.sequence, third.sequence, fourth.sequence, fifth.sequence],
          mounted: true
        }));
      } finally {
        uninstall();
        app.close();
      }
    }

    run().catch(error => { console.error(error); process.exitCode = 1; });
  `);
});

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

const customBackend = {
  name: 'custom-node-adapter',
  command: ['node'] as const,
  moduleFormat: 'cjs' as const,
  bundleTarget: 'node' as const,
  hostAdapter: fileURLToPath(new URL('./fixtures/custom-adapter.ts', import.meta.url)),
};

for (const runtime of ['bun', 'node', customBackend] satisfies RuntimeSelection[]) {
  const name = typeof runtime === 'string' ? runtime : runtime.name;
  for (const fixture of ['application', 'lifecycle', 'list', 'rows', 'callbacks', 'compiled', 'conditional', 'slots', 'mounted']) {
    test(name + ' runs ' + fixture + ' against the real native host', async () => {
      const probe = join(directory, name + '-' + fixture + '.probe');
      const { entry } = await bundleExecutionEntry({
        entry: ['compiled', 'conditional', 'slots', 'mounted', 'rows', 'callbacks'].includes(fixture)
          ? join(directory, fixture + '-entry.ts')
          : fileURLToPath(new URL('./fixtures/' + fixture + '.ts', import.meta.url)),
        outfile: join(directory, name + '-' + fixture + (typeof runtime === 'string' ? '.mjs' : '.cjs')),
        runtime,
      });
      const [command, ...args] = executionCommand(entry, runtime, [nativeHost]);
      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(command, args, {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, MEMOIZED_CUSTOM_ADAPTER_PROBE: probe },
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => { child.kill(); reject(new Error('Engine contract timed out')); }, 15_000);
        child.stdout.on('data', chunk => { stdout += String(chunk); });
        child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4096); });
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
      });
      expect(result.stderr).toBe('');
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(fixture === 'mounted'
        ? { accepted: [1, 2, 3, 4, 5], mounted: true }
        : fixture === 'list'
        ? { accepted: [1, 2, 3, 4, 5], refused: 'documentRefused', list: true }
        : fixture === 'rows' || fixture === 'callbacks'
        ? { rows: true, events: true, retired: true }
        : fixture === 'slots'
        ? { accepted: [1, 3, 4], slots: true }
        : fixture === 'conditional'
        ? { accepted: [1, 2, 3, 4], conditional: true }
        : fixture === 'compiled'
        ? { accepted: [1, 2, 3], compiled: true }
        : fixture === 'application'
        ? { accepted: [1, 2], refused: 'unknownTemplate' }
        : {
            accepted: [1, 2, 3], effects: [0, 1], refDisposals: 1,
            effectDisposals: 2, ownedDisposals: 1, refused: 'documentRefused',
          });
      if (typeof runtime !== 'string') {
        expect(await readFile(probe, 'utf8')).toBe('custom adapter selected');
      }
    }, 20_000);
  }
}

test('missing native executable rejects pending work without hanging', async () => {
  const client = new PublicationClient(connectNativeHost({ executable: join(directory, 'does-not-exist') }));
  const active = client.publish({ operations: [] }).then(() => undefined, error => error);
  const queued = client.publish({ operations: [] }).then(() => undefined, error => error);
  expect(await active).toMatchObject({ code: 'acceptanceUnknown' });
  expect(await queued).toMatchObject({ code: 'acceptanceUnknown' });
  expect(client.isClosed).toBe(true);
});

test('packaged compiler templates address real native text, regions and retired generations', async () => {
  const parent = sourceTemplate(`
    export function App({children}){let count=0;
      return <main><p>Count: {count}</p><section>{children}<small>End</small></section></main>
    }
  `, 'compiled-parent', ['children']).plan;
  const row = sourceTemplate('export function App(){return <span>Row</span>}', 'compiled-row').plan;
  const text = parent.steps.find(step => step.kind === 'text')!;
  const region = parent.steps.find(step => step.kind === 'region')!;
  const parentOwner = { id: 'Parent', generation: 1 };
  const rowOwner = { id: 'Row', generation: 1 };
  const client = new PublicationClient(connectNativeHost({ executable: nativeHost, args: ['--headless'] }));

  try {
    const mounted = await client.publish({
      templates: [parent.template, row.template],
      operations: [
        { op: 'mount', owner: parentOwner, template: parent.template.key, target: { kind: 'body' } },
        { op: 'text', target: { owner: parentOwner, source: text.source }, value: 'Count: 0' },
        {
          op: 'mount', owner: rowOwner, template: row.template.key,
          target: { kind: 'region', source: { owner: parentOwner, source: region.source } },
        },
      ],
    });
    expect(mounted.sequence).toBe(1);

    const updated = await client.publish({ operations: [
      { op: 'text', target: { owner: parentOwner, source: text.source }, value: 'Count: 1' },
      { op: 'text', target: { owner: rowOwner, source: 1 }, value: 'Updated row' },
    ] });
    expect(updated.sequence).toBe(2);

    const retired = await client.publish({ operations: [{ op: 'retire', owner: parentOwner }] });
    expect(retired.sequence).toBe(3);
    const stale = await client.publish({ operations: [{
      op: 'text', target: { owner: rowOwner, source: 1 }, value: 'Stale',
    }] }).then(() => undefined, error => error);
    expect(stale).toMatchObject({ code: 'documentRefused', reply: { expectedSequence: 4 } });

    // Template records are reusable; source handles remain generation-specific.
    const remounted = await client.publish({ operations: [{
      op: 'mount', owner: { id: 'Parent', generation: 2 }, template: parent.template.key,
      target: { kind: 'body' },
    }] });
    expect(remounted.sequence).toBe(4);
    expect(client.isClosed).toBe(false);
  } finally {
    client.close();
  }
});

test('native exit fails all active and queued jobs without replay', async () => {
  // The same real executable refuses startup without --headless, closing its
  // stream before any publication can be accepted.
  const client = new PublicationClient(connectNativeHost({ executable: nativeHost }));
  const active = client.publish({ operations: [] }).then(() => undefined, error => error);
  const queued = client.publish({ operations: [] }).then(() => undefined, error => error);
  expect(await active).toMatchObject({ code: 'acceptanceUnknown' });
  expect(await queued).toMatchObject({ code: 'acceptanceUnknown' });
  expect(client.isClosed).toBe(true);
});

test('the process adapter bounds direct writes without corrupting the native stream', async () => {
  const transport = connectNativeHost({ executable: nativeHost, args: ['--headless'] });
  const received: unknown[] = [];
  let expectedReplies = 0;
  let receive!: () => void;
  let fail!: (error: Error) => void;
  const accepted = new Promise<void>((resolve, reject) => {
    receive = resolve;
    fail = reject;
  });
  transport.listen({
    reply(value) {
      received.push(value);
      if (expectedReplies !== 0 && received.length >= expectedReplies) receive();
    },
    failure(error) { fail(error); },
  });
  try {
    const first = transport.send(JSON.stringify({ version: 1, sequence: 1, operations: [] }));
    const second = transport.send(JSON.stringify({ version: 1, sequence: 2, operations: [] }));
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes[0]!.status).toBe('fulfilled');
    const next = outcomes[1]!;
    // Bun may finish a small write synchronously. If it has, the second frame
    // is safe to send; otherwise the adapter refuses another outstanding write.
    if (next.status === 'rejected') {
      expect(next.reason).toMatchObject({ code: 'writeInProgress' });
      expectedReplies = 1;
    } else {
      expectedReplies = 2;
    }
    if (received.length >= expectedReplies) receive();
    await accepted;
    expect(received).toEqual(Array.from({ length: expectedReplies }, (_value, index) => ({
      version: 1, status: 'accepted', sequence: index + 1,
    })));
  } finally {
    transport.dispose();
  }
});
