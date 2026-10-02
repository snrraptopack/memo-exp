import { childNode, identifierName, jsxIdentifierName, walkAst, type BaseNode } from '../ast';
import type { Ctx } from '../context';
import { isListLightweightCandidate } from './component-graph';

/** Capture ownership facts before component emission replaces authored JSX. */
export function analyzeDomOnlyRows(ctx: Ctx): void {
  if (ctx.hot) return;
  let dynamicScope = false;
  const program = ctx.astAnalysis?.rootScope.block;
  if (program === undefined) return;
  walkAst(program, { enter(node) {
    if (node.type === 'WithStatement' || node.type === 'CallExpression' &&
        identifierName(childNode(node, 'callee')) === 'eval') dynamicScope = true;
  } });
  if (dynamicScope) return;
  for (const [name, path] of ctx.compPaths) {
    const props = ctx.componentProps.get(name);
    if (!isListLightweightCandidate(ctx, name) || ctx.transparentSources.has(name) ||
        props === undefined || props.refProps.length > 0 || props.renderProps.length > 0 ||
        props.renderCallbacks.length > 0) continue;
    let safe = true;
    walkAst<BaseNode>(path.node, { enter(node) {
      if (!safe) return false;
      if (node.type === 'JSXAttribute') {
        const attribute = jsxIdentifierName(childNode(node, 'name'));
        if (attribute !== null && /^on[A-Z]/.test(attribute)) return false;
        if (['ref', 'route', 'route-to', 'if', 'else-if', 'else'].includes(attribute ?? '')) safe = false;
      } else if (node.type === 'JSXOpeningElement') {
        const tag = childNode(node, 'name');
        const tagName = jsxIdentifierName(tag);
        if (tagName === null || /^[A-Z]/.test(tagName)) safe = false;
      } else if (node.type === 'JSXSpreadAttribute' || node.type === 'CallExpression' ||
          node.type === 'OptionalCallExpression' || node.type === 'NewExpression' ||
          node.type === 'TaggedTemplateExpression' || node.type === 'SpreadElement' ||
          node.type === 'WithStatement') {
        safe = false;
      }
    } });
    if (safe) ctx.domOnlyRowComponents.add(name);
  }
}
