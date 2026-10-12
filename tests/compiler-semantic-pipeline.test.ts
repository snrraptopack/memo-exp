import { expect, it } from 'bun:test';
import { parseEstreeOrThrow } from '../packages/compiler/src/ast';
import * as b from '../packages/compiler/src/ast/factory';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import { refreshAstAnalysis, type Ctx, type ProgramPath } from '../packages/compiler/src/context';
import { createAnalysisCtx } from '../packages/compiler/src/context/model';
import {
  prepareSemanticAnalysis,
  type SemanticPreparationProfile,
} from '../packages/compiler/src/analysis/pipeline';
import { analyzeComponent } from '../packages/compiler/src/analysis/component-validation';
import { planAccessReaders } from '../packages/compiler/src/analysis/access-table';
import { planCompilerIntrinsics } from '../packages/compiler/src/intrinsics';

function program(source: string): ProgramPath {
  const parsed = parseEstreeOrThrow(source, { filename: './pipeline.tsx' });
  return {
    node: parsed.program as unknown as t.Program,
    buildCodeFrameError(message) { return new Error(message); },
  };
}

const sourceProfile: SemanticPreparationProfile<Ctx> = {
  install(context, path) {
    refreshAstAnalysis(context, path.node);
    planCompilerIntrinsics(context, path);
  },
  validateComponents(context) {
    for (const name of context.comps.keys()) {
      analyzeComponent(context, name);
    }
  },
};

it('analyzes component declarations, state, effects and access routes without a DOM allocator', () => {
  const context = createAnalysisCtx({ moduleId: './pipeline.tsx' });
  const path = program(`
    let shared = 0;
    export const App = () => {
      let count = 0;
      const doubled = count * 2;
      $effect(() => { console.log(shared); });
      return <button onClick={() => { shared++; count++; }}>{shared}:{doubled}</button>;
    };
  `);

  prepareSemanticAnalysis(context, path, sourceProfile);

  expect([...context.comps.keys()]).toEqual(['App']);
  expect(context.state.get('shared')).toBe('let');
  expect([...context.instanceState.get('App')!]).toEqual(['count']);
  expect(context.instanceDerivations.get('App')!.map(derivation => derivation.bindings))
    .toEqual([['doubled']]);
  expect(context.effects.get('App')).toHaveLength(1);
  expect(planAccessReaders(context).get('./pipeline.tsx#shared')).toContain('App');
  expect(context).not.toHaveProperty('emission');
  expect(context).not.toHaveProperty('instanceReasonIds');
});

it('refreshes lexical facts after target normalization introduces a derived binding', () => {
  const context = createAnalysisCtx({ moduleId: './pipeline.tsx' });
  const path = program(`
    export function App() {
      let count = 0;
      return <button onClick={() => count++}>{doubled}</button>;
    }
  `);

  prepareSemanticAnalysis(context, path, {
    ...sourceProfile,
    normalizeComponents(context) {
      const component = context.compPaths.get('App')!;
      component.node.body.body.splice(1, 0, b.variableDeclaration('const', [
        b.variableDeclarator(
          b.identifier('doubled'),
          b.binaryExpression('*', b.identifier('count'), b.numericLiteral(2)),
        ),
      ]));
    },
  });

  const derivation = context.instanceDerivations.get('App')![0]!;
  expect(derivation.bindings).toEqual(['doubled']);
  expect(derivation.sources).toEqual(['count']);
  expect([...context.instanceState.get('App')!]).toEqual(['count']);
});

it('discovers external subscription metadata before preparation and read routing', () => {
  const context = createAnalysisCtx({
    moduleId: './pipeline.tsx',
    externalReactiveSources: [{
      module: 'external-store',
      source: 'store',
      subscribe: { module: 'external-store/adapter', export: 'observe' },
    }],
  });
  const path = program(`
    import { store } from 'external-store';
    export function App() { return <p>{store.count}</p>; }
  `);
  const stages: string[] = [];

  prepareSemanticAnalysis(context, path, {
    ...sourceProfile,
    subscriptions(context) {
      expect(context.externalReactiveBindings.get('store')).toEqual({
        module: 'external-store/adapter', export: 'observe',
      });
      stages.push('subscriptions');
    },
    prepareSources(context) {
      expect(context.importedState.has('store')).toBe(true);
      stages.push('prepare');
    },
    finishPreparation(context) {
      expect(planAccessReaders(context).get('./pipeline.tsx#store')).toContain('App');
      stages.push('complete');
    },
  });

  expect(stages).toEqual(['subscriptions', 'prepare', 'complete']);
  expect(context).not.toHaveProperty('externalReactiveImports');
});

it('classifies opaque sources before preparing their constant projections', () => {
  const context = createAnalysisCtx({ moduleId: './pipeline.tsx' });
  // Project resolution establishes value imports before semantic analysis.
  // This library value has no instrumented function summary or subscription.
  context.importedValues.add('createClock');
  const path = program(`
    import { createClock } from 'external-clock';
    export function App() {
      const clock = createClock();
      const doubled = clock.value * 2;
      return <p>{doubled}</p>;
    }
  `);

  prepareSemanticAnalysis(context, path, sourceProfile);

  expect(context.volatileComponents.has('App')).toBe(true);
  expect(context.instanceDerivations.get('App')!.map(derivation => derivation.bindings))
    .toContainEqual(['doubled']);
  expect(context).not.toHaveProperty('emission');
});

it('rejects state-free recursive components without relying on a target finishing hook', () => {
  const context = createAnalysisCtx({ moduleId: './pipeline.tsx' });
  const path = program('export function App() { return <main><App /></main>; }');

  expect(() => prepareSemanticAnalysis(context, path, sourceProfile))
    .toThrow("recursive component 'App'");
});
