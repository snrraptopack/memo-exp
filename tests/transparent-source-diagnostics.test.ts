import { describe, expect, it } from 'vitest';
import { diagnose, diagnoseModules } from '@memoized-dom/compiler';

describe('colorless source diagnostics', () => {
  it.each([
    ['object declaration', 'const { name } = $fetch("/user");'],
    ['array declaration', 'const [first] = $fetch("/users");'],
    [
      'assignment',
      'let name; ({ name } = $fetch("/user"));',
    ],
    [
      'parameter default',
      'function read({ name } = $fetch("/user")) { return name; } read();',
    ],
    [
      'source alias',
      'const source = $fetch("/user"); const alias = source; const { name } = alias;',
    ],
  ])('rejects %s at its authored pattern', (_label, declaration) => {
    const source = [
      'import { $fetch } from "@memoized-dom/data";',
      'function App() {',
      `  ${declaration}`,
      '  return <main />;',
      '}',
    ].join('\n');

    const [diagnostic] = diagnose(source, {
      moduleId: './App.tsx',
      rootComponent: 'App',
    });

    expect(diagnostic).toMatchObject({
      moduleId: './App.tsx',
      line: 3,
      source: 'memoized-dom',
      severity: 'error',
    });
    expect(diagnostic?.message).toContain('[MMD-S004]');
    expect(diagnostic?.message).toContain('cannot be destructured');
  });

  it('rejects a linked imported colorless module source', () => {
    const diagnostics = diagnoseModules({
      './data.ts': `
        import { $fetch } from '@memoized-dom/data';
        export const currentUser = $fetch('/user');
      `,
      './App.tsx': `
        import { currentUser } from './data';
        export function App() {
          const { name } = currentUser;
          return <main>{name}</main>;
        }
      `,
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      moduleId: './App.tsx',
      line: 4,
    });
    expect(diagnostics[0]?.message).toContain('[MMD-S004]');
  });

  it('allows destructuring a settled plain item inside a list callback', () => {
    const diagnostics = diagnose(`
      import { $fetch } from '@memoized-dom/data';
      function App() {
        const stories = $fetch('/stories');
        return <main>{stories.map((story) => {
          const { title, votes } = story;
          return <article>{title} — {votes}</article>;
        })}</main>;
      }
    `, { moduleId: './App.tsx', rootComponent: 'App' });

    expect(diagnostics).toEqual([]);
  });
});
