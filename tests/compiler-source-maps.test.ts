import {
  originalPositionFor,
  TraceMap,
} from '@jridgewell/trace-mapping';
import { describe, expect, it } from 'vitest';
import {
  compile,
  compileDetailed,
  compileModulesDetailed,
} from '@memoized-dom/compiler';

const source = `export function App() {
  const label: string = 'Ready';
  return <button>{label}</button>;
}`;

describe('compiler source maps', () => {
  it('preserves the string-returning compile API', () => {
    expect(typeof compile(source, { moduleId: './src/App.tsx' })).toBe('string');
  });

  it('maps generated DOM code to the authored TSX location', () => {
    const compiled = compileDetailed(source, {
      moduleId: './src/App.tsx',
    });
    const lines = compiled.code.split('\n');
    const generatedLine =
      lines.findIndex((line) => line.includes('createElement("button")')) + 1;
    const generatedColumn = lines[generatedLine - 1]!.indexOf('document');
    const original = originalPositionFor(new TraceMap(compiled.map), {
      line: generatedLine,
      column: generatedColumn,
    });

    expect(compiled.map.sources).toEqual(['./src/App.tsx']);
    expect(compiled.map.sourcesContent).toEqual([source]);
    expect(original).toMatchObject({
      source: './src/App.tsx',
      line: 3,
    });
  });

  it('returns one source map for every linked module', () => {
    const modules = {
      './src/state.ts': `export const state = { label: 'Ready' };`,
      './src/App.tsx': `
        import { state } from './state';
        export function App() {
          return <output>{state.label}</output>;
        }
      `,
    };
    const compiled = compileModulesDetailed(modules);

    expect(Object.keys(compiled.maps).sort()).toEqual(Object.keys(modules).sort());
    for (const id of Object.keys(modules)) {
      expect(compiled.maps[id]!.sources).toEqual([id]);
      expect(compiled.maps[id]!.sourcesContent).toEqual([modules[id as keyof typeof modules]]);
    }
  });
});
