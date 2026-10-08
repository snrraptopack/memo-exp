import type * as t from '../ast/compiler-types';
import {
  childNode, childNodes, identifierName, jsxIdentifierName,
  nodeField, walkAst, type BaseNode,
} from '../ast';
import { astBindingAt, type Ctx, type ProgramPath } from '../context';

/** The authored envelope cannot escape or be observed beyond this own field. */
export interface PrivateRowPropPlan {
  readonly component: string;
  readonly declaration: t.FunctionDeclaration;
  readonly field: string;
  readonly members: readonly BaseNode[];
}

/**
 * A private row that only reads one supplied own props field cannot observe
 * the envelope. Capture that proof before a backend selects its row ABI.
 * Every call must be a direct keyed JSX map row with precisely that prop.
 */
export function planPrivateRowProps(ctx: Ctx, programPath: ProgramPath): readonly PrivateRowPropPlan[] {
  const program = programPath.node as unknown as BaseNode;
  let dynamicScope = false;
  walkAst(program, { enter(node) {
    if (node.type === 'WithStatement' || node.type === 'CallExpression' &&
        identifierName(childNode(node, 'callee')) === 'eval') dynamicScope = true;
  } });
  if (dynamicScope) return [];

  const plans: PrivateRowPropPlan[] = [];
  for (const [name, path] of ctx.compPaths) {
    const analysis = ctx.astAnalysis!;
    const fn = path.node;
    const parameter = fn.params.length === 1 ? fn.params[0] : null;
    if (!parameter || parameter.type !== 'Identifier') continue;
    const component = analysis.rootScope.getBinding(name);
    const props = astBindingAt(ctx, parameter as unknown as BaseNode, parameter.name);
    // Ordinary references include exports, aliases and direct factory calls.
    // JSX tag names are indexed for scope but do not enter references.
    if (!component || component.declarationNode !== fn || component.references.length !== 0 || component.constantViolations.length !== 0 ||
        analysis.parentByNode.get(fn)?.type !== 'Program' || !props ||
        props.constantViolations.length !== 0 || props.references.length === 0) continue;
    const members: BaseNode[] = [];
    let field: string | null = null, valid = true;
    for (const reference of props.references) {
      const member = analysis.parentByNode.get(reference);
      const key = member ? identifierName(childNode(member, 'property')) : null;
      if (member?.type !== 'MemberExpression' || childNode(member, 'object') !== reference ||
          nodeField(member, 'computed') === true || nodeField(member, 'optional') === true ||
          key === null || key === '__proto__' || field !== null && field !== key) { valid = false; break; }
      if (key === 'key' || key === 'ref') { valid = false; break; }
      field = key;
      let target = member, use = analysis.parentByNode.get(target);
      while (use && ['Property', 'ObjectProperty', 'ObjectPattern', 'ArrayPattern', 'RestElement',
        'AssignmentPattern', 'ParenthesizedExpression', 'TSNonNullExpression', 'TSAsExpression', 'ChainExpression'].includes(use.type)) {
        target = use; use = analysis.parentByNode.get(target);
      }
      if (use && (
        ['AssignmentExpression', 'ForOfStatement', 'ForInStatement'].includes(use.type) && childNode(use, 'left') === target ||
        use.type === 'UpdateExpression' ||
        use.type === 'UnaryExpression' && nodeField(use, 'operator') === 'delete' ||
        ['CallExpression', 'OptionalCallExpression'].includes(use.type) && childNode(use, 'callee') === target ||
        use.type === 'TaggedTemplateExpression' && childNode(use, 'tag') === target
      )) { valid = false; break; }
      members.push(member);
    }
    if (!valid || field === null) continue;
    let calls = 0;
    walkAst(program, { enter(node) {
      if (node.type === 'JSXMemberExpression') {
        let root = childNode(node, 'object');
        while (root?.type === 'JSXMemberExpression') root = childNode(root, 'object');
        if (jsxIdentifierName(root) === name && astBindingAt(ctx, node, name) === component) valid = false;
      }
      if (!valid || node.type !== 'JSXOpeningElement' || jsxIdentifierName(childNode(node, 'name')) !== name) return;
      if (astBindingAt(ctx, node, name) !== component) { valid = false; return; }
      const element = analysis.parentByNode.get(node);
      let callback = element && analysis.parentByNode.get(element);
      if (callback?.type === 'ReturnStatement') {
        const block = analysis.parentByNode.get(callback);
        callback = block && childNodes(block, 'body').length === 1 ? analysis.parentByNode.get(block) : undefined;
      }
      const call = callback && analysis.parentByNode.get(callback);
      const callee = call && childNode(call, 'callee');
      if (callback?.type !== 'ArrowFunctionExpression' || call?.type !== 'CallExpression' ||
          childNodes(call, 'arguments')[0] !== callback || callee?.type !== 'MemberExpression' ||
          nodeField(callee, 'computed') === true || identifierName(childNode(callee, 'property')) !== 'map') {
        valid = false; return;
      }
      const attributes = childNodes(node, 'attributes');
      if (attributes.length !== 2 || attributes.some(attribute => attribute.type !== 'JSXAttribute') ||
          attributes.filter(attribute => jsxIdentifierName(childNode(attribute, 'name')) === field).length !== 1 ||
          attributes.filter(attribute => jsxIdentifierName(childNode(attribute, 'name')) === 'key').length !== 1) {
        valid = false; return;
      }
      calls++;
    } });
    let argumentsRead = false;
    walkAst(fn as unknown as BaseNode, { enter(node) {
      if (node.type === 'Identifier' && identifierName(node) === 'arguments') argumentsRead = true;
      // JSX tag identifiers are outside ordinary binding references. Keep
      // namespace/dynamic member tags on their existing contract.
      if (node.type === 'JSXMemberExpression') valid = false;
    } });
    if (!valid || calls === 0 || argumentsRead) continue;
    plans.push(Object.freeze({component:name, declaration:fn, field, members:Object.freeze(members)}));
  }
  return Object.freeze(plans);
}
