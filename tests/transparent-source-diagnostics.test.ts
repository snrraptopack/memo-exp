import { describe, expect, it } from 'vitest';
import { compile, diagnose, diagnoseModules } from '@memoized-dom/compiler';

describe('colorless source diagnostics', () => {
  it.each([
    [
      'assignment',
      'let name; ({ name } = $fetch("/user"));',
    ],
    [
      'parameter default',
      'function read({ name } = $fetch("/user")) { return name; } read();',
    ],
    ['object rest', 'const { name, ...rest } = $fetch("/user");'],
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
    expect(diagnostic?.message).toMatch(
      /cannot be destructured|cannot be kept reactive/,
    );
  });

  it('lowers function-local source destructuring to live member derivations', () => {
    const code = compile(`
      import { $fetch } from '@memoized-dom/data';
      function App() {
        const source = $fetch('/user');
        const alias = source;
        const {
          name: displayName,
          address: { city },
          tags: [firstTag, ...otherTags],
          missing = 'fallback',
        } = alias;
        return <main>{displayName}:{city}:{firstTag}:{otherTags.length}:{missing}</main>;
      }
    `);

    expect(code).not.toContain('const {');
    expect(code).toMatch(/_sourceValue\d*\.name/);
    expect(code).toMatch(/_sourceValue\d*\.address\.city/);
    expect(code).toMatch(/_sourceValue\d*\.tags\[0\]/);
    expect(code).toMatch(/_sourceValue\d*\.tags\.slice\(1\)/);
  });

  it('supports a linked imported colorless module source', () => {
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

    expect(diagnostics).toEqual([]);
  });

  it('rejects direct source destructuring in a non-component helper', () => {
    const diagnostics = diagnose(`
      import { $fetch } from '@memoized-dom/data';
      function readUser() {
        const source = $fetch('/user');
        const { name } = source;
        return name;
      }
      function App() {
        return <button onClick={readUser}>Read</button>;
      }
    `);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('[MMD-S004]');
    expect(diagnostics[0]?.message).toContain('cannot be destructured');
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
