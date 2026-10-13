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

const source = `
  let count = 0;
  export function increment(){ count++; }
  export function App(){
    return <main className={['counter', {odd: count % 2}]} {...(count === 1 ? {title:'One'} : {})}>
      <button onClick={increment}>Increment</button><p>{count}</p>
    </main>;
  }
`;

function moduleFactory(text = source) {
  const compiled = compileDesktop(text, {
    moduleId: './compiled-test.tsx',
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

  return new Function(...parameters, printEstree(program).code + '\nreturn {App,increment};')(core, presentation) as {
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
  await Promise.resolve();

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
