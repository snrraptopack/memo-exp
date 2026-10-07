/** Resolve authored render-prop identities without content-slot lowering. */
import {isIdentifier as isAstIdentifier,isMemberExpression as isAstMemberExpression,type BaseNode} from '../ast';
import type {Ctx as AnalysisContext} from '../context/model';
import {objectBindingName,propNameForBinding} from '../components/props';

/** Declared render-prop name referenced by one interpolation/forwarding site. */
export function renderPropReferenceName(
  ctx: AnalysisContext,
  compName: string,
  expression: BaseNode,
): string | null {
  const plan = ctx.componentProps.get(compName);
  if (plan === undefined) return null;
  const objectBinding = objectBindingName(plan);
  if (
    objectBinding !== null &&
    isAstMemberExpression(expression) &&
    !expression.computed &&
    isAstIdentifier(expression.object) &&
    expression.object.name === objectBinding &&
    isAstIdentifier(expression.property)
  ) {
    return expression.property.name;
  }
  if (isAstIdentifier(expression)) {
    const declared = propNameForBinding(plan, expression.name);
    if (declared !== null) return declared;
    if (
      expression.name === 'children' &&
      ctx.instanceDerivedBindings.get(compName)?.has('children') === true
    ) {
      return 'children';
    }
  }
  return null;
}
