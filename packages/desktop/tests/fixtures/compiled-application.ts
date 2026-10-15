
import { compileDesktop } from '@memoized-dom/compiler/desktop';

import {
  parseWithEstreeFrontendOrThrow,
  memoizedEstreeFrontend,
  printEstree
} from '../../../compiler/src/ast';

import type * as t from '../../../compiler/src/ast/compiler-types';
import * as core from '@memoized-dom/runtime/core';
import * as presentation from '../../src/runtime/view';
import { NativeApplication } from '../../src/runtime/application';
import { PublicationClient } from '../../src/host/client';
import { ManualTransport } from './manual-transport';
import type { Operation, Publication } from '../../src/host/protocol';

export const source = `
  let count = 0;
  export function increment(){ count++; }
  export function App(){
    return <main className={['counter', {odd: count % 2}]} {...(count === 1 ? {title:'One'} : {})}>
      <button onClick={increment}>Increment</button><p>{count}</p>
    </main>;
  }
`;

export function moduleFactory(text = source, rootName = 'App', rootId?: string) {
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
    App(frame: presentation.NativeFrame, props?: unknown[]): presentation.NativeView;
    increment(): unknown
   };
}

export function createCompiledApplication(module = moduleFactory(), props?: unknown[]) {
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
      }, props);

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

/** Drain serialized row publications, including new frames admitted by a reply. */
export async function drainCompiled(fixture: ReturnType<typeof createCompiledApplication>, from: number) {
  for (let index = from; index < fixture.transport.sent.length; index++) {
    const frame = JSON.parse(fixture.transport.sent[index]!) as { sequence: number };
    fixture.transport.accept(frame.sequence);
    await Bun.sleep(0);
    fixture.application.run(core.commit);
  }

  await fixture.view.publication();
}

export function compiledOperations(fixture: ReturnType<typeof createCompiledApplication>, from = 0): Operation[] {
  return fixture.transport.sent.slice(from).flatMap(text => (JSON.parse(text) as Publication).operations);
}
