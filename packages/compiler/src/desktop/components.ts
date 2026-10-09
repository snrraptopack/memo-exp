/** Desktop ABI for the core compiler's authored prop-shape plans. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { cloneNode, type BaseNode } from '../ast';
import { walkAst } from '../ast/walk';
import { parameterTarget, type ComponentPropsPlan } from '../components/props';

const clone = <T extends t.Node>(node: T): T => cloneNode(node as unknown as BaseNode) as unknown as T;
export function desktopProps(plan: ComponentPropsPlan, fresh: (name: string) => t.Identifier, fail: (message: string, node: t.Node) => never) {
  const envelope = fresh('__desktopProps');
  const next = fresh('__desktopNextProps');
  const setup: t.Statement[] = [];
  const assignments: t.Statement[] = [];
  for (const [index, param] of plan.params.entries()) {
    const target = parameterTarget(param);
    if (!b.isIdentifier(target) && !b.isObjectPattern(target)) fail('desktop props require named parameters or a flat object pattern', target);
    walkAst<t.Node>(target, { enter(node) {
      if (node !== target && (b.isObjectPattern(node) || b.isArrayPattern(node) || b.isRestElement(node))) fail('nested and rest prop patterns are not implemented', node);
    } });
    walkAst<t.Node>(param, { enter(node) {
      if (b.isAssignmentPattern(node)) assertDefault(node.right, fail);
    } });
    const value = (source: t.Identifier): t.Expression => {
      const read = plan.mode === 'object' ? source : b.memberExpression(source, b.stringLiteral(plan.names[index]!), true);
      return b.isAssignmentPattern(param) ? b.conditionalExpression(
        b.binaryExpression('===', b.unaryExpression('typeof', read), b.stringLiteral('undefined')), clone(param.right), read,
      ) : read;
    };
    setup.push(b.variableDeclaration('let', [b.variableDeclarator(clone(target), value(envelope))]));
    assignments.push(b.expressionStatement(b.assignmentExpression('=', clone(target), value(next))));
  }
  return {
    params: [b.assignmentPattern(envelope, b.objectExpression([]))], setup,
    receive: plan.params.length ? b.arrowFunctionExpression([next], b.blockStatement(assignments)) : undefined,
  };
}
function assertDefault(value: t.Expression, fail: (message: string, node: t.Node) => never): void {
  if (b.isStringLiteral(value) || b.isNumericLiteral(value) || b.isBooleanLiteral(value) || b.isNullLiteral(value) ||
      (b.isIdentifier(value) && value.name === 'undefined') || (b.isObjectExpression(value) && !value.properties.length) ||
      (b.isUnaryExpression(value) && ['-', '+'].includes(value.operator) && b.isNumericLiteral(value.argument))) return;
  fail('desktop prop defaults currently require constant primitive values or an empty envelope', value);
}
