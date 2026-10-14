import { expect, test } from 'bun:test';
import { compileDesktop } from '@memoized-dom/compiler/desktop';

import {
  parseWithEstreeFrontendOrThrow,
  memoizedEstreeFrontend,
  printEstree
} from '../../compiler/src/ast';

import type * as t from '../../compiler/src/ast/compiler-types';
import * as core from '@memoized-dom/runtime/core';
import * as presentation from '../src/runtime/view';
import { NativeApplication } from '../src/runtime/application';
import { PublicationClient } from '../src/host/client';
import { ManualTransport } from './fixtures/manual-transport';
import { createMountAdapter } from '../src/runtime/mount';

const source = `
  let count = 0;
  export function increment(){ count++; }
  export function App(){
    return <main className={['counter', {odd: count % 2}]} {...(count === 1 ? {title:'One'} : {})}>
      <button onClick={increment}>Increment</button><p>{count}</p>
    </main>;
  }
`;

function moduleFactory(text = source, rootName = 'App', rootId?: string) {
  const compiled = compileDesktop(text, {
    moduleId: './compiled-test.tsx',
    rootId,
    runtimePath: 'core',
    presentationPath: 'presentation'
  });

  const parsed = parseWithEstreeFrontendOrThrow(memoizedEstreeFrontend, compiled.code, { filename: './compiled.js' });
  const program = parsed.program as t.Program;
  const parameters: string[] = [];

  program.body = program.body.flatMap((statement) => {
    if (statement.type === 'ImportDeclaration') {
      parameters.push((statement.specifiers[0]!).local.name);

      return [];
    }

    if (statement.type === 'ExportNamedDeclaration') {
      return statement.declaration ? [statement.declaration as t.Statement] : [];
    }

    return [statement];
  });

  return new Function(...parameters, printEstree(program).code + '\nreturn {App:' + rootName + ',increment};')(core, presentation) as {
    App(frame: presentation.NativeFrame): presentation.NativeView;
    increment(): void
   };
}

function createCompiledApplication(module = moduleFactory()) {
  const transport = new ManualTransport();
  const errors: unknown[] = [];

  const application = new NativeApplication(new PublicationClient(transport), {
    scheduleFrame: null,
    visible: () => true,
    reportError: (error) => errors.push(error)
  });

  application.run(() => core.setScheduler(() => {}));

  let view!: presentation.NativeView;

  const candidate = application.prepare(
    () => {
      view = module.App({
        application,
        owner: { id: 'App', generation: 1 },
        parent: null,
        reportError: (error) => errors.push(error)
      });

      return view;
    },
    {
      accepted() {
        view.acceptInitial();
      },

      activated() {
        view.activateUpdates();
      }
    }
  );

  return { application, candidate, view, transport, errors, module };
}

test('compiled metadata mounts a root without an authored native frame', async () => {
  const { application, transport, errors, module, candidate } = createCompiledApplication();
  candidate.discard();
  const adapter = createMountAdapter(application, 'app', error => errors.push(error));

  expect(() => adapter.mount('missing', module.App)).toThrow('was not found');
  expect(() => adapter.mount('app', () => {})).toThrow('not a compiled native root');

  const mounted = adapter.mount('app', module.App);
  expect(mounted.mounted).toBe(true);
  expect(mounted.host.isConnected).toBe(false);
  expect(() => adapter.mount('app', module.App)).toThrow('already owns');
  transport.accept(1);
  await adapter.settled();
  expect(mounted.host.isConnected).toBe(true);

  adapter.view()!.dispatch(1, 'onClick', new Event('click'));
  application.run(core.commit);
  expect(JSON.parse(transport.sent[1]!).operations).toContainEqual({
    op: 'text', target: { owner: { id: 'App', generation: 1 }, source: 4 }, value: '1'
  });
  transport.accept(2);
  await adapter.view()!.publication();
  mounted.unmount();
  await Bun.sleep(0);
  transport.accept(3);
  await adapter.settled();
  expect(mounted.mounted).toBe(false);
  expect(mounted.host.isConnected).toBe(false);
  expect(errors).toEqual([]);

  const remounted = adapter.mount('app', module.App);
  expect(JSON.parse(transport.sent[3]!).templates).toBeUndefined();
  expect(JSON.parse(transport.sent[3]!).operations[0].owner.generation).toBe(2);
  transport.accept(4);
  await adapter.settled();
  expect(remounted.mounted).toBe(true);
  application.close();
});

test('root registration uses the shared reader identity rather than the authored function name', async () => {
  const module = moduleFactory(source.replace('function App()', 'function Counter()'), 'Counter', 'WindowRoot');
  const { application, transport, errors, candidate } = createCompiledApplication(module);
  candidate.discard();
  const adapter = createMountAdapter(application, 'app', error => errors.push(error));
  const mounted = adapter.mount('app', module.App);
  expect(mounted.rootId).toBe('WindowRoot');
  transport.accept(1);
  await adapter.settled();
  adapter.view()!.dispatch(1, 'onClick', new Event('click'));
  application.run(core.commit);
  expect(JSON.parse(transport.sent[1]!).operations).toContainEqual({
    op: 'text', target: { owner: { id: 'WindowRoot', generation: 1 }, source: 4 }, value: '1'
  });
  transport.accept(2);
  await adapter.view()!.publication();
  expect(errors).toEqual([]);
  application.close();
});

test('synchronous unmount waits for creation acceptance and refused retirement retains ownership', async () => {
  const { application, transport, errors, module, candidate } = createCompiledApplication();
  candidate.discard();
  const adapter = createMountAdapter(application, 'app', error => errors.push(error));
  const mounted = adapter.mount('app', module.App);
  mounted.unmount();
  mounted.unmount();
  expect(transport.sent).toHaveLength(1);
  transport.accept(1);
  await Bun.sleep(0);
  expect(transport.sent).toHaveLength(2);
  transport.refuse(2);
  await expect(adapter.settled()).rejects.toThrow('Source does not exist');
  await Bun.sleep(0);
  expect(mounted.mounted).toBe(true);
  expect(mounted.host.isConnected).toBe(true);
  expect(() => adapter.mount('app', module.App)).toThrow('already owns');
  mounted.unmount();
  await Bun.sleep(0);
  transport.accept(2);
  await adapter.settled();
  expect(mounted.mounted).toBe(false);
  expect(errors).toHaveLength(1);
  application.close();
});

test('ordinary TSX emits real cell/access closures and accepted event dispatch updates text', async () => {
  const { application, candidate, view, transport, errors } = createCompiledApplication();
  const mounted = candidate.publish(view.initialPublication);

  expect(() => view.dispatch(1, 'onClick', new Event('click'))).toThrow('not active');
  transport.accept(1);
  await mounted;
  view.dispatch(1, 'onClick', new Event('click'));
  application.run(core.commit);

  const packet = JSON.parse(transport.sent[1]!);

  expect(packet.operations).toContainEqual({
    op: 'text',
    target: { owner: { id: 'App', generation: 1 }, source: 4 },
    value: '1'
  });

  expect(packet.operations.some((operation: { op: string }) => operation.op === 'mount')).toBe(false);
  transport.accept(2);
  expect((await view.publication())?.sequence).toBe(2);
  expect(errors).toEqual([]);
  application.close();
  expect(() => view.dispatch(1, 'onClick', new Event('click'))).toThrow('not active');
});

test('compiled child components join one accepted owner subtree and retain their events', async () => {
  const module = moduleFactory(`
    let count = 0;

    export function increment() {
      count++;
    }

    function Card({ title, onClick }) {
      return <section>
        <h2>{title}</h2>
        <button onClick={onClick}>Increment</button>
        <p>{count}</p>
      </section>;
    }

    export function App() {
      return <main>
        <Card title="Summary" onClick={increment} />
        <footer>End</footer>
      </main>;
    }
  `);
  const { application, candidate, view, transport, errors } = createCompiledApplication(module);
  const publication = view.initialPublication;

  expect(publication.templates?.map(template => template.key)).toHaveLength(2);
  expect(publication.operations).toContainEqual({
    op: 'mount',
    owner: { id: 'App/Card', generation: 1 },
    template: expect.stringContaining('#Card:'),
    target: {
      kind: 'region',
      source: { owner: { id: 'App', generation: 1 }, source: 1 },
    },
  });
  expect(publication.operations).toContainEqual({
    op: 'text',
    target: { owner: { id: 'App/Card', generation: 1 }, source: 2 },
    value: 'Summary',
  });

  const mounted = candidate.publish(publication);
  transport.accept(1);
  await mounted;

  view.dispatch(
    { owner: { id: 'App/Card', generation: 1 }, source: 3 },
    'onClick',
    new Event('click'),
  );
  application.run(core.commit);

  const update = JSON.parse(transport.sent[1]!);

  expect(update.operations).toContainEqual({
    op: 'text',
    target: { owner: { id: 'App/Card', generation: 1 }, source: 6 },
    value: '1',
  });

  transport.accept(2);
  await Bun.sleep(0);
  expect(errors).toEqual([]);
  application.close();
});

test('reactive component props replay through the shared core prop box', async () => {
  const module = moduleFactory(`
    let count = 0;

    export function increment() {
      count++;
    }

    function Value({ label, value }) {
      return <p>{label}: {value}</p>;
    }

    function Summary({ label = 'Count', value }) {
      return <section><Value label={label} value={value} /></section>;
    }

    export function App() {
      return <main>
        <button onClick={increment}>Increment</button>
        <Summary {...(count % 2 === 0
          ? { label: 'Even', value: count }
          : { label: 'Odd', value: count })} />
      </main>;
    }
  `);
  const { application, candidate, view, transport, errors } = createCompiledApplication(module);
  const initial = view.initialPublication;

  expect(initial.operations).toContainEqual({
    op: 'text',
    target: {
      owner: { id: 'App/Summary/Value', generation: 1 },
      source: expect.any(Number),
    },
    value: 'Even: 0',
  });

  const mounted = candidate.publish(initial);

  transport.accept(1);
  await mounted;
  view.dispatch(1, 'onClick', new Event('click'));
  application.run(core.commit);

  const update = JSON.parse(transport.sent[1]!);

  expect(update.operations).toContainEqual({
    op: 'text',
    target: {
      owner: { id: 'App/Summary/Value', generation: 1 },
      source: expect.any(Number),
    },
    value: 'Odd: 1',
  });

  transport.accept(2);
  await view.publication();
  expect(errors).toEqual([]);
  application.close();
});

test('inline conditions replace host and component branches after acceptance', async () => {
  const module = moduleFactory(`
    let shown = true;
    let count = 0;

    export function increment() {
      shown = !shown;
      count++;
    }

    function Label({ value }) {
      return <strong>{value} {count}</strong>;
    }

    export function App() {
      return <main>
        {shown
          ? <section><Label value="Visible" /></section>
          : <aside onClick={increment}>Hidden</aside>}
      </main>;
    }
  `);
  const { application, candidate, view, transport, errors } =
    createCompiledApplication(module);
  const initial = view.initialPublication;

  expect(initial.operations).toContainEqual({
    op: 'mount',
    owner: { id: 'App/when0/$content', generation: 1 },
    template: expect.stringContaining('#App/when0[0]:'),
    target: {
      kind: 'region',
      source: { owner: { id: 'App', generation: 1 }, source: 1 },
    },
  });
  expect(initial.operations).toContainEqual({
    op: 'mount',
    owner: { id: 'App/when0/$content/Label', generation: 1 },
    template: expect.stringContaining('#Label:'),
    target: expect.any(Object),
  });

  const mounted = candidate.publish(initial);
  transport.accept(1);
  await mounted;

  const conditionEntity = application.runtime.state.registry.get('App/when0');
  const labelEntity = application.runtime.state.registry.get('App/when0/Label');

  expect(conditionEntity).toBeDefined();
  expect(labelEntity).toBeDefined();

  application.run(() => {
    module.increment();
    core.commit();
  });

  const replacement = JSON.parse(transport.sent[1]!);

  expect(replacement.operations[0]).toEqual({
    op: 'retire',
    owner: { id: 'App/when0/$content', generation: 1 },
  });
  expect(replacement.operations).toContainEqual({
    op: 'mount',
    owner: { id: 'App/when0/$content', generation: 2 },
    template: expect.stringContaining('#App/when0[1]:'),
    target: {
      kind: 'region',
      source: { owner: { id: 'App', generation: 1 }, source: 1 },
    },
  });

  expect(application.runtime.state.registry.get('App/when0')).toBe(conditionEntity);
  expect(application.runtime.state.registry.get('App/when0/Label')).toBe(labelEntity);

  application.run(() => {
    module.increment();
    core.commit();
  });

  // The old component stays callable while the structural publication is
  // pending, but it must not enqueue a stale update behind its own retirement.
  expect(transport.sent).toHaveLength(2);

  transport.accept(2);
  await view.publication();

  expect(application.runtime.state.registry.get('App/when0')).toBe(conditionEntity);
  expect(application.runtime.state.registry.has('App/when0/Label')).toBe(false);

  application.run(core.commit);

  const correction = JSON.parse(transport.sent[2]!);

  expect(correction.operations[0]).toEqual({
    op: 'retire',
    owner: { id: 'App/when0/$content', generation: 2 },
  });
  expect(correction.operations).toContainEqual({
    op: 'text',
    target: {
      owner: { id: 'App/when0/$content/Label', generation: 3 },
      source: expect.any(Number),
    },
    value: 'Visible 2',
  });

  transport.accept(3);
  await view.publication();

  expect(application.runtime.state.registry.get('App/when0/Label')).toBeDefined();

  application.run(() => {
    module.increment();
    core.commit();
  });
  transport.accept(4);
  await view.publication();

  const hiddenSource = {
    owner: { id: 'App/when0/$content', generation: 4 },
    source: 0,
  };

  view.dispatch(hiddenSource, 'onClick', new Event('click'));
  application.run(core.commit);

  expect(JSON.parse(transport.sent[4]!).operations[0]).toEqual({
    op: 'retire',
    owner: { id: 'App/when0/$content', generation: 4 },
  });

  const refused = view.publication().then(
    value => value,
    error => error,
  );

  transport.refuse(5);
  expect(await refused).toMatchObject({ name: 'PublicationRefusedError' });
  expect(view.matchesSource(hiddenSource)).toBe(true);
  expect(application.runtime.state.registry.get('App/when0')).toBe(conditionEntity);
  expect(application.runtime.state.registry.has('App/when0/Label')).toBe(false);
  expect(errors).toHaveLength(1);
  application.close();
});

test('component return plans preserve props and empty branches through acceptance', async () => {
  const module = moduleFactory(`
    let mode = 0;

    export function increment() {
      mode = (mode + 1) % 3;
    }

    function Badge({ label }) {
      return <strong>{label}</strong>;
    }

    function ModeView({ prefix = 'Mode', mode }) {
      if (mode === 0) {
        return <section><Badge label={prefix + ' first'} /></section>;
      }

      if (mode === 1) {
        return null;
      }

      return <aside onClick={increment}>{prefix} third</aside>;
    }

    export function App() {
      return <main><ModeView prefix="Panel" mode={mode} /></main>;
    }
  `);
  const { application, candidate, view, transport, errors } =
    createCompiledApplication(module);
  const initial = view.initialPublication;

  expect(initial.operations).toContainEqual({
    op: 'mount',
    owner: { id: 'App/ModeView/$content', generation: 1 },
    template: expect.stringContaining('#ModeView/$return[0]:'),
    target: expect.any(Object),
  });
  expect(initial.operations).toContainEqual({
    op: 'text',
    target: {
      owner: { id: 'App/ModeView/$content/Badge', generation: 1 },
      source: expect.any(Number),
    },
    value: 'Panel first',
  });

  const mounted = candidate.publish(initial);
  transport.accept(1);
  await mounted;

  const componentEntity = application.runtime.state.registry.get('App/ModeView');
  const badgeEntity = application.runtime.state.registry.get('App/ModeView/Badge');

  application.run(() => {
    module.increment();
    core.commit();
  });

  expect(JSON.parse(transport.sent[1]!).operations).toEqual([{
    op: 'retire',
    owner: { id: 'App/ModeView/$content', generation: 1 },
  }]);
  expect(application.runtime.state.registry.get('App/ModeView/Badge')).toBe(badgeEntity);

  transport.accept(2);
  await view.publication();

  expect(application.runtime.state.registry.get('App/ModeView')).toBe(componentEntity);
  expect(application.runtime.state.registry.has('App/ModeView/Badge')).toBe(false);

  application.run(() => {
    module.increment();
    core.commit();
  });

  expect(JSON.parse(transport.sent[2]!).operations).toContainEqual({
    op: 'mount',
    owner: { id: 'App/ModeView/$content', generation: 3 },
    template: expect.stringContaining('#ModeView/$return[2]:'),
    target: expect.any(Object),
  });

  transport.accept(3);
  await view.publication();

  const thirdSource = {
    owner: { id: 'App/ModeView/$content', generation: 3 },
    source: 0,
  };

  view.dispatch(thirdSource, 'onClick', new Event('click'));
  application.run(core.commit);

  expect(JSON.parse(transport.sent[3]!).operations[0]).toEqual({
    op: 'retire',
    owner: { id: 'App/ModeView/$content', generation: 3 },
  });

  const refused = view.publication().then(
    value => value,
    error => error,
  );

  transport.refuse(4);
  expect(await refused).toMatchObject({ name: 'PublicationRefusedError' });
  expect(view.matchesSource(thirdSource)).toBe(true);
  expect(application.runtime.state.registry.get('App/ModeView')).toBe(componentEntity);
  expect(application.runtime.state.registry.has('App/ModeView/Badge')).toBe(false);
  expect(errors).toHaveLength(1);
  application.close();
});

test('a root return plan retires its live native branch through ordinary unmount', async () => {
  const module = moduleFactory(`
    export function increment() {}

    export function App() {
      if (true) {
        return <main>Root branch</main>;
      }

      return null;
    }
  `);
  const { application, candidate, transport, errors } = createCompiledApplication(module);

  candidate.discard();

  const adapter = createMountAdapter(application, 'app', error => errors.push(error));
  const mounted = adapter.mount('app', module.App);
  const initial = JSON.parse(transport.sent[0]!);

  expect(initial.operations[0]).toMatchObject({
    op: 'mount',
    owner: { id: 'App/$content', generation: 1 },
  });

  transport.accept(1);
  await adapter.settled();
  mounted.unmount();
  await Bun.sleep(0);

  expect(JSON.parse(transport.sent[1]!).operations).toEqual([{
    op: 'retire',
    owner: { id: 'App/$content', generation: 1 },
  }]);

  transport.accept(2);
  await adapter.settled();
  expect(mounted.mounted).toBe(false);
  expect(application.runtime.state.registry.size).toBe(0);
  expect(errors).toEqual([]);
  application.close();
});

test('component children remain caller-reactive through forwarded native slots', async () => {
  const module = moduleFactory(`
    let count = 0;

    export function increment() {
      count++;
    }

    function Inner({ children }) {
      return <article>{children}</article>;
    }

    function Frame({ children }) {
      return <section>
        <Inner>{children}</Inner>
        <aside>{children}</aside>
      </section>;
    }

    export function App() {
      return <main>
        <Frame>
          <button onClick={increment}>Value {count}</button>
        </Frame>
      </main>;
    }
  `);
  const { application, candidate, view, transport, errors } =
    createCompiledApplication(module);
  const publication = view.initialPublication;
  const mounts = publication.operations.filter(operation => operation.op === 'mount');

  expect(mounts.map(operation => operation.owner.id)).toEqual([
    'App',
    'App/Frame',
    'App/Frame/Inner',
    'App/Frame/Inner/slot/$content',
    'App/Frame/Inner/slot/$content/slot/$content',
    'App/Frame/slot/$content',
  ]);
  expect(publication.operations.filter(operation =>
    operation.op === 'text' && operation.value === 'Value 0')).toHaveLength(2);

  const mounted = candidate.publish(publication);
  transport.accept(1);
  await mounted;

  const authoredButton = {
    owner: { id: 'App/Frame/slot/$content', generation: 1 },
    source: 0,
  };

  view.dispatch(authoredButton, 'onClick', new Event('click'));
  application.run(core.commit);

  // Each retained content range publishes independently. The transport admits
  // one packet at a time, so inspect both accepted updates rather than assuming
  // two ranges share a transport packet.
  transport.accept(2);
  await Bun.sleep(0);
  expect(transport.sent).toHaveLength(3);
  transport.accept(3);
  await view.publication();

  const operations = transport.sent.slice(1).flatMap(packet =>
    JSON.parse(packet).operations);

  expect(operations.filter((operation: { op: string; value?: string }) =>
    operation.op === 'text' && operation.value === 'Value 1')).toHaveLength(2);
  expect(errors).toEqual([]);
  application.close();
});

test('unused component children remain lazy and competing children are diagnosed', async () => {
  const module = moduleFactory(`
    export function increment() {}

    function Never() {
      throw new Error('Unused content must not be created');
      return <p>Hidden</p>;
    }

    function Frame({ children }) {
      return <section>Visible</section>;
    }

    export function App() {
      return <Frame><Never /></Frame>;
    }
  `);
  const { application, candidate, view, transport } = createCompiledApplication(module);
  const publication = view.initialPublication;
  expect(publication.operations.filter(operation => operation.op === 'mount')
    .map(operation => operation.owner.id)).toEqual(['App', 'App/Frame']);

  const mounted = candidate.publish(publication);
  transport.accept(1);
  await mounted;
  expect(application.runtime.state.registry.has('App/Frame/Never')).toBe(false);
  application.close();

  expect(() => compileDesktop(`
    function Frame({ children }) { return <section>{children}</section>; }
    export function App() {
      return <Frame children={<b>First</b>}><i>Second</i></Frame>;
    }
  `)).toThrow('cannot use both a children prop and nested JSX children');
});

test('JSX-valued props forward stable content factories and retain reactive events', async () => {
  const module = moduleFactory(`
    let count = 0;
    export function increment() { count++; }

    function Frame({ header, body }) {
      return <section><header>{header}</header><article>{body}</article></section>;
    }

    function Wrapper({ header, body }) {
      return <Frame header={header} body={body} />;
    }

    export function App() {
      return <Wrapper
        header={<h2>Heading {count}</h2>}
        body={<button onClick={increment}>Button {count}</button>}
      />;
    }
  `);
  const { application, candidate, view, transport, errors } = createCompiledApplication(module);
  const initial = view.initialPublication;

  expect(initial.operations).toContainEqual({
    op: 'text',
    target: { owner: { id: 'App/Wrapper/Frame/slot/$content', generation: 1 }, source: 1 },
    value: 'Heading 0',
  });

  const mounted = candidate.publish(initial);
  transport.accept(1);
  await mounted;

  view.dispatch({
    owner: { id: 'App/Wrapper/Frame/slot[1]/$content', generation: 1 }, source: 0,
  }, 'onClick', new Event('click'));
  application.run(core.commit);
  transport.accept(2);
  await Bun.sleep(0);
  transport.accept(3);
  await view.publication();

  const operations = transport.sent.slice(1).flatMap(packet => JSON.parse(packet).operations);
  expect(operations.filter((operation: { op: string }) => operation.op === 'retire')).toEqual([]);
  expect(operations.filter((operation: { op: string; value?: string }) =>
    operation.op === 'text').map((operation: { value: string }) => operation.value)
    .sort()).toEqual(['Button 1', 'Heading 1']);
  expect(errors).toEqual([]);
  application.close();
});

test.each([false, true])('conditional content shares replay for nested children=%s and dormant JSX props', async nested => {
  const module = moduleFactory(`
    let shown = true;
    export function increment() { shown = !shown; }

    function Frame({ children }) { return <section>{children}</section>; }
    function AppHeader() { return <h2>Ready</h2>; }
    function Unused({ header }) {
      return <aside>{false && <header>{header}</header>}</aside>;
    }
    function Never() {
      throw new Error('Unused prop must remain lazy');
      return <p>Hidden</p>;
    }

    export function App() {
      return <main>
        ${nested
          ? '<Frame>{shown ? <AppHeader /> : null}</Frame>'
          : '<Frame children={shown ? <AppHeader /> : null} />'}
        <Unused header={<Never />} />
      </main>;
    }
  `);
  const { application, candidate, view, transport, errors } = createCompiledApplication(module);
  const mounted = candidate.publish(view.initialPublication);
  transport.accept(1);
  await mounted;

  application.run(() => { module.increment(); core.commit(); });
  const packet = JSON.parse(transport.sent[1]!);
  expect(packet.operations).toEqual([{
    op: 'retire',
    owner: { id: 'App/Frame/slot/$content/when0/$content', generation: 1 },
  }]);
  expect(application.runtime.state.registry.has('App/Frame/slot/when0/AppHeader')).toBe(true);
  transport.accept(2);
  await view.publication();
  expect(application.runtime.state.registry.has('App/Frame/slot/when0/AppHeader')).toBe(false);
  expect(errors).toEqual([]);

  // A refused show must preserve the accepted empty range and avoid attaching
  // the staged component to the shared registry.
  application.run(() => { module.increment(); core.commit(); });
  const refused = view.publication().then(value => value, error => error);
  transport.refuse(3);
  expect(await refused).toMatchObject({ name: 'PublicationRefusedError' });
  expect(application.runtime.state.registry.has('App/Frame/slot/when0/AppHeader')).toBe(false);
  expect(errors).toHaveLength(1);
  application.close();
});

test('JSX props require the existing callee render-slot contract', () => {
  expect(() => compileDesktop(`
    function Scalar({ title }) { return <div title={title} />; }
    export function App() { return <Scalar title={<h2>Heading</h2>} />; }
  `)).toThrow("JSX prop 'title' on <Scalar> is not rendered by the callee");
});

test('ordered prop spreads can override a lazy JSX factory without creating its content', async () => {
  const module = moduleFactory(`
    export function increment() {}
    function Never() {
      throw new Error('Overridden JSX content must not be created');
      return <p>Hidden</p>;
    }
    function Frame({ header, title }) {
      return <section title={title}>{header}</section>;
    }
    export function App() {
      return <Frame header={<Never />} {...{ title: 'First', header: undefined }}
        title="Last" header={<h2>Chosen</h2>} />;
    }
  `);
  const { application, candidate, view, transport, errors } = createCompiledApplication(module);
  const initial = view.initialPublication;
  expect(initial.operations).toContainEqual({
    op: 'setAttribute',
    target: { owner: { id: 'App/Frame', generation: 1 }, source: 0 },
    name: { namespace: '', local: 'title' }, value: 'Last',
  });
  expect(initial.templates?.flatMap(template => template.nodes).some(source =>
    source.node.kind === 'text' && source.node.value === 'Chosen')).toBe(true);

  const mounted = candidate.publish(initial);
  transport.accept(1);
  await mounted;
  expect(errors).toEqual([]);
  application.close();
});

test('a component inside forwarded content retains its own shared state readers', async () => {
  const module = moduleFactory(`
    let count = 0;
    export function increment() { count++; }

    function Label() {
      return <button onClick={increment}>{count}</button>;
    }

    function Frame({ children }) {
      return <section>{children}</section>;
    }

    export function App() {
      return <Frame><Label /></Frame>;
    }
  `);
  const { application, candidate, view, transport, errors } = createCompiledApplication(module);
  const mounted = candidate.publish(view.initialPublication);
  transport.accept(1);
  await mounted;

  view.dispatch({
    owner: { id: 'App/Frame/slot/$content/Label', generation: 1 },
    source: 0,
  }, 'onClick', new Event('click'));
  application.run(core.commit);

  expect(transport.sent).toHaveLength(2);
  expect(JSON.parse(transport.sent[1]!).operations).toContainEqual({
    op: 'text',
    target: { owner: { id: 'App/Frame/slot/$content/Label', generation: 1 }, source: 1 },
    value: '1',
  });
  transport.accept(2);
  await view.publication();
  expect(errors).toEqual([]);
  application.close();
});

test('forwarded content coalesces writes when its synthetic range reaches native pressure', async () => {
  const module = moduleFactory(`
    let count = 0;
    export function increment() { count++; }
    function Frame({ children }) { return <section>{children}</section>; }
    export function App() { return <Frame><p>{count}</p></Frame>; }
  `);
  const { application, candidate, view, transport, errors } = createCompiledApplication(module);
  const mounted = candidate.publish(view.initialPublication);
  transport.accept(1);
  await mounted;

  for (let index = 0; index < 12; index++) {
    application.run(() => {
      module.increment();
      core.commit();
    });
  }

  // Drain the admitted updates. Freed credit replays the retained synthetic
  // range even though its native owner is absent from the semantic registry.
  for (let sequence = 2; sequence <= 10; sequence++) {
    transport.accept(sequence);
    await Bun.sleep(0);
    application.run(core.commit);
  }

  await view.publication();
  expect(JSON.parse(transport.sent.at(-1)!).operations).toContainEqual({
    op: 'text',
    target: { owner: { id: 'App/Frame/slot/$content', generation: 1 }, source: 1 },
    value: '12',
  });
  expect(errors).toEqual([]);
  application.close();
});

test('repeated and nested components keep shared owner paths and deduplicate templates', async () => {
  const module = moduleFactory(`
    export function increment() {}

    function Leaf({ label }) {
      return <span>{label}</span>;
    }

    function Panel() {
      return <section><Leaf label="Nested" /></section>;
    }

    export function App() {
      return <main>
        <Panel />
        <Panel />
      </main>;
    }
  `);
  const { application, candidate, view, transport } = createCompiledApplication(module);
  const publication = view.initialPublication;
  const mounts = publication.operations.filter(operation => operation.op === 'mount');

  expect(publication.templates).toHaveLength(3);
  expect(mounts.map(operation => operation.owner.id)).toEqual([
    'App',
    'App/Panel',
    'App/Panel/Leaf',
    'App/Panel[1]',
    'App/Panel[1]/Leaf',
  ]);

  const mounted = candidate.publish(publication);
  transport.accept(1);
  await mounted;
  expect([...application.runtime.state.registry.keys()]).toEqual([
    'App',
    'App/Panel',
    'App/Panel/Leaf',
    'App/Panel[1]',
    'App/Panel[1]/Leaf',
  ]);

  application.close();
  expect(application.runtime.state.registry.size).toBe(0);
});

test('queued snapshots remove attributes introduced by a not-yet-accepted update', async () => {
  const { application, candidate, view, transport } = createCompiledApplication();
  const mounted = candidate.publish(view.initialPublication);

  transport.accept(1);
  await mounted;
  view.dispatch(1, 'onClick', new Event('click'));
  application.run(core.commit);
  view.dispatch(1, 'onClick', new Event('click'));
  application.run(core.commit);
  transport.accept(2);
  await Bun.sleep(0);

  const packet = JSON.parse(transport.sent[2]!);

  expect(packet.operations).toContainEqual({
    op: 'removeAttribute',
    target: { owner: { id: 'App', generation: 1 }, source: 0 },
    name: { namespace: '', local: 'title' }
  });

  transport.accept(3);
  await view.publication();
  application.close();
});

test('writes before and during initial publication are recomputed through the core after acceptance', async () => {
  const { application, candidate, view, transport, module } = createCompiledApplication();

  application.run(() => {
    module.increment();
    core.commit();
  });

  const mounted = candidate.publish(view.initialPublication);

  expect(JSON.parse(transport.sent[0]!).operations.at(-1).value).toBe('1');

  application.run(() => {
    module.increment();
    core.commit();
  });

  expect(transport.sent).toHaveLength(1);
  transport.accept(1);
  await mounted;
  application.run(core.commit);
  expect(JSON.parse(transport.sent[1]!).operations.at(-1).value).toBe('2');
  transport.accept(2);
  await view.publication();
  application.close();
});

test('one compiled module keeps its cells isolated between native applications', async () => {
  const module = moduleFactory();
  const first = createCompiledApplication(module);
  const second = createCompiledApplication(module);

  for (const fixture of [first, second]) {
    const mounted = fixture.candidate.publish(fixture.view.initialPublication);

    fixture.transport.accept(1);
    await mounted;
  }

  first.view.dispatch(1, 'onClick', new Event('click'));
  first.application.run(core.commit);
  expect(second.transport.sent).toHaveLength(1);
  first.transport.accept(2);
  await first.view.publication();
  first.application.close();
  second.application.close();
});

test('native pressure coalesces the latest source state without unbounded publication jobs', async () => {
  const { application, candidate, view, transport, errors } = createCompiledApplication();
  const mounted = candidate.publish(view.initialPublication);

  transport.accept(1);
  await mounted;

  for (let index = 0; index < 12; index++) {
    view.dispatch(1, 'onClick', new Event('click'));
    application.run(core.commit);
  }

  expect(transport.sent).toHaveLength(2);
  transport.accept(2);

  // Yield one event-loop turn: acceptance, application publication and credit
  // release have separate promise continuations; their count is not an API.
  await Bun.sleep(0);

  application.run(core.commit);

  for (let sequence = 3; sequence <= 9; sequence++) {
    transport.accept(sequence);
    await Bun.sleep(0);
  }

  const latest = JSON.parse(transport.sent.at(-1)!);

  expect(latest.sequence).toBe(10);
  expect(latest.operations.at(-1).value).toBe('12');
  transport.accept(10);
  await view.publication();
  expect(errors).toEqual([]);
  application.close();
});

test('shared cell lowering respects shadowed bindings and executed writes', () => {
  const code = compileDesktop(`let count=0;export function increment(flag){if(flag)count++;}
    export function App(){const shadow=(count)=>count+1;return <p onClick={()=>increment(true)}>{count}{shadow(3)}</p>}`).code;

  expect(code).toContain('defineStateCell');
  expect(code).toContain('updateCell');
  expect(code).toContain('installAccessTable');
  expect(code).toContain('shadow = (count) => count + 1');
});

test('unsupported lifetimes/structures/reactivity fail instead of silently losing semantics', () => {
  expect(() => compileDesktop('export function App(){let count=0;return <button onClick={()=>{count++;}}>{count}</button>}')).toThrow('Instance writes');
  expect(() => compileDesktop('export function App(){$cleanup(()=>{});return <div/>}')).toThrow('Cleanup');
  expect(() => compileDesktop('export function App(){return <div ref={node}/>}')).toThrow('Refs');
  expect(() => compileDesktop('let items=[];export function App(){return <button onClick={()=>items.push(1)}>Add</button>}')).toThrow('guarded-publication');
  expect(() => compileDesktop('let count=0;export function App(){setTimeout(()=>{count++;},0);return <p>{count}</p>}')).toThrow('Retained callbacks');
});
