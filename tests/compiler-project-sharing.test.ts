import { expect, it } from 'bun:test';
import { compileModules } from '../packages/compiler/src/linker';
import { compileDesktopGraph } from '../packages/compiler/src/desktop/module-graph';
import { memoizedEstreeFrontend } from '../packages/compiler/src/ast';
import {
  collectProject,
  discoverProject,
  seedAllReexports,
  seedComponentReexports,
} from '../packages/compiler/src/linking/project';

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

it('preserves each target bootstrap policy while sharing identity seeding', () => {
  const project = collectProject(
    modules['./App.tsx']!,
    './App.tsx',
    memoizedEstreeFrontend,
    readModule,
  );
  const options = { resolveImport: project.resolveImport };
  const browser = discoverProject(project.entries, options, seedComponentReexports);
  const desktop = discoverProject(project.entries, options, seedAllReexports);
  expect(browser.get('./barrel.ts')!.exports.total).toBeUndefined();
  expect(desktop.get('./barrel.ts')!.exports.total).toMatchObject({
    type: 'state',
    key: './state.ts#count',
  });
  expect(desktop.get('./barrel.ts')!.exports.advance).toMatchObject({ type: 'function' });
});
