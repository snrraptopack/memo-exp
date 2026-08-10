import { describe, expect, it } from 'vitest';
import { compileModulesDetailed } from '@memoized-dom/compiler';

const graph = {
  './state.ts': `
    export const model = { value: 0 };
    export function write(target: { value: number }) { target.value++; }
    export function increment() { write(model); }
  `,
  './derived.ts': `
    import { model } from './state';
    export const doubled = model.value * 2;
  `,
  './view.tsx': `
    import { increment } from './state';
    import { doubled } from './derived';
    export function View() {
      return <button onClick={() => increment()}>{doubled}</button>;
    }
  `,
};

describe('evaluation metadata', () => {
  it('exposes canonical state, function-summary, and reader facts', () => {
    const result = compileModulesDetailed(graph);
    expect(result.metadata['./state.ts']!.stateExports).toContainEqual({
      exported: 'model',
      kind: 'store',
      key: './state.ts#model',
    });
    expect(result.metadata['./state.ts']!.functionExports).toContainEqual(
      expect.objectContaining({
        exported: 'write',
        parameterWrites: [{ index: 0, path: ['value'] }],
        unbounded: false,
      }),
    );
    expect(result.metadata['./derived.ts']!.readers['./state.ts#model.value'])
      .toContain('App/$computed/.%2Fderived.ts#doubled');
  });

  it('ablates imported function summaries without erasing state identity', () => {
    const result = compileModulesDetailed(graph, {
      linkFunctionSummaries: false,
    });
    expect(result.metadata['./derived.ts']!.readers)
      .toHaveProperty('./state.ts#model.value');
    expect(result.output['./view.tsx']).toContain('markDirtySubtree("App")');
  });
});
