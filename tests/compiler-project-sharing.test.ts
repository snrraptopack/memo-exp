import { expect, it } from 'bun:test';
import { compileModules } from '../packages/compiler/src/linker';
import { compileDesktopGraph } from '../packages/compiler/src/desktop/module-graph';
import { memoizedEstreeFrontend } from '../packages/compiler/src/ast';
import { collectProject, discoverProject } from '../packages/compiler/src/linking/project';

const modules: Record<string, string> = {
  './App.tsx': `
    import {total, advance} from './barrel.ts';
    export function App() { return <button onClick={advance}>{total}</button>; }
  `,
  './barrel.ts': `import {count as total, increment as advance} from './state.ts'; export {total, advance};`,
  './state.ts': `export let count = 0; export function increment() { return ++count; }`,
};
const readModule = (specifier: string) =>
  modules[specifier] === undefined
    ? undefined
    : { moduleId: specifier, source: modules[specifier]! };

it('resolves the same defining state key through import-then-export barrels for both targets', () => {
  const browser = compileModules(modules);
  const desktop = compileDesktopGraph(modules['./App.tsx']!, {
    moduleId: './App.tsx',
    readModule,
  });
  expect(browser['./App.tsx']).toContain('./state.ts#count');
  expect(desktop.modules.get('./App.tsx')!.code).toContain('./state.ts#count');
  expect(desktop.modules.get('./state.ts')!.code).toContain('commitWrites');
});

it('seeds state and helper identities before fixed-point analysis', () => {
  const project = collectProject(
    modules['./App.tsx']!,
    './App.tsx',
    memoizedEstreeFrontend,
    readModule,
  );
  const options = { resolveImport: project.resolveImport };
  const discovered = discoverProject(project.entries, options);
  expect(discovered.get('./barrel.ts')!.exports.total).toMatchObject({
    type: 'state',
    key: './state.ts#count',
  });
  expect(discovered.get('./barrel.ts')!.exports.advance).toMatchObject({ type: 'function' });
});

it('seeds canonical state and helper identities through multiple barrels', () => {
  const sources: Record<string, string> = {
    './App.tsx': `
      import {total, advance} from './outer.ts';
      export function App() { return <button onClick={advance}>{total}</button>; }
    `,
    './outer.ts': `import {value as total, write as advance} from './inner.ts'; export {total, advance};`,
    './inner.ts': `import {count as value, increment as write} from './state.ts'; export {value, write};`,
    './state.ts': modules['./state.ts']!,
  };
  const project = collectProject(
    sources['./App.tsx']!,
    './App.tsx',
    memoizedEstreeFrontend,
    (specifier) =>
      sources[specifier] === undefined
        ? undefined
        : { moduleId: specifier, source: sources[specifier]! },
  );
  const discovered = discoverProject(project.entries, { resolveImport: project.resolveImport });
  expect(discovered.get('./outer.ts')!.exports.total).toMatchObject({
    type: 'state',
    key: './state.ts#count',
  });
  expect(discovered.get('./outer.ts')!.exports.advance).toBe(
    discovered.get('./state.ts')!.exports.increment,
  );
  const browser = compileModules(sources);
  const desktop = compileDesktopGraph(sources['./App.tsx']!, {
    moduleId: './App.tsx',
    readModule: (specifier) =>
      sources[specifier] === undefined
        ? undefined
        : { moduleId: specifier, source: sources[specifier]! },
  });
  expect(browser['./App.tsx']).toContain('./state.ts#count');
  expect(desktop.modules.get('./App.tsx')!.code).toContain('./state.ts#count');
});

it('rejects a barrel cycle without inventing a defining identity', () => {
  const sources: Record<string, string> = {
    './first.ts': `import {value} from './second.ts'; export {value};`,
    './second.ts': `import {value} from './first.ts'; export {value};`,
  };
  const project = collectProject(
    sources['./first.ts']!,
    './first.ts',
    memoizedEstreeFrontend,
    (specifier) => ({ moduleId: specifier, source: sources[specifier]! }),
  );
  expect(() => discoverProject(project.entries, { resolveImport: project.resolveImport })).toThrow(
    "cyclic re-export 'value' has no defining binding",
  );
});
