/** Tests consume the real source-analysis pipeline before native lowering. */
import {
  parseWithEstreeFrontendOrThrow,
  memoizedEstreeFrontend,
} from '../../../compiler/src/ast';
import type * as t from '../../../compiler/src/ast/compiler-types';
import { createAnalysisCtx, type ProgramPath } from '../../../compiler/src/context/model';
import { prepareSemanticAnalysis } from '../../../compiler/src/analysis/pipeline';
import { planExpressionSources } from '../../../compiler/src/planning/expression-sources';
import { analyzeComponentReturns } from '../../../compiler/src/components/return-plan';
import { compilerError } from '../../../compiler/src/errors';
import { lowerNativeTemplate } from '@memoized-dom/compiler/desktop';

export function sourceTemplate(source: string, key: string, forwarded: readonly string[] = []) {
  const moduleId = './template-fixture.tsx';
  const parsed = parseWithEstreeFrontendOrThrow(memoizedEstreeFrontend, source, { filename: moduleId });
  const program = parsed.program as t.Program;
  const path: ProgramPath = {
    node: program,
    buildCodeFrameError: (message, at = program) => compilerError(message, moduleId, at),
  };
  const context = createAnalysisCtx({ moduleId, rootId: 'App' });
  prepareSemanticAnalysis(context, path, { install() {} });

  const component = context.compPaths.get('App');
  if (component === undefined) throw new Error('Fixture must declare App');
  const returns = analyzeComponentReturns(component, 'App');
  if (!('jsx' in returns)) throw new Error('Fixture must use one direct JSX return');
  const before = JSON.stringify(program);
  const expressions = planExpressionSources(context).get('App')!;
  const plan = lowerNativeTemplate({
    key,
    jsx: returns.jsx,
    expressionSources: expressions,
    isForwarded: expression => expression.type === 'Identifier' && forwarded.includes(expression.name),
    fail(message, at) { throw compilerError(message, moduleId, at); },
  });

  return { plan, program, before, context };
}
