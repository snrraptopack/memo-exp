/** DOM row ABI lowering consumes a captured, binding-aware envelope proof. */
import * as astFactory from '../ast/factory';
import type * as t from '../ast/compiler-types';
import { childNode, cloneNode, replaceNode } from '../ast';
import { refreshAstAnalysis, type ProgramPath } from '../context';
import { isListLightweightCandidate } from '../analysis/component-graph';
import type { PrivateRowPropPlan } from '../planning/private-row-props';
import type { DomContext } from './context';
import { generatedIdentifier } from './identifiers';

export function lowerPrivateRowProps(
  ctx: DomContext,
  programPath: ProgramPath,
  plans: readonly PrivateRowPropPlan[],
): ReadonlyMap<string, t.FunctionDeclaration['params']> {
  const parameters = new Map<string, t.FunctionDeclaration['params']>();
  if (ctx.hot) return parameters;
  for (const plan of plans) {
    if (!isListLightweightCandidate(ctx, plan.component)) continue;
    const local = generatedIdentifier(ctx, 'rowProp');
    for (const member of plan.members) {
      const replacement = cloneNode(childNode(member, 'object')!) as unknown as typeof local;
      replacement.name = local.name;
      replaceNode(ctx.astAnalysis!, member, replacement);
    }
    plan.declaration.params = [{ type: 'ObjectPattern', properties: [
      astFactory.objectProperty(astFactory.identifier(plan.field), cloneNode(local)),
    ] }];
    parameters.set(plan.component, plan.declaration.params);
    ctx.privateRowPropComponents.add(plan.component);
    refreshAstAnalysis(ctx, programPath.node);
  }
  return parameters;
}
