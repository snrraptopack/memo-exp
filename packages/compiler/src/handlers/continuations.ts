/** Host-neutral routing around async suspension and final completion. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { cloneNode, walkAst } from '../ast';
import type { HandlerWritePlan } from './plan';

export function instrumentContinuations(
  callback: HandlerWritePlan['copy'],
  publish: t.Statement,
  resume: t.Expression,
): void {
  walkAst(callback.body, {
    enter(node) {
      if (b.isFunction(node)) return false;
    },
    leave(node) {
      if (node.type !== 'AwaitExpression') return;
      const awaitNode = node as t.AwaitExpression;
      awaitNode.argument = b.callExpression(resume, [
        awaitNode.argument,
        b.arrowFunctionExpression([], b.blockStatement([cloneNode(publish)])),
      ]);
    },
  });
  const body = b.isBlockStatement(callback.body)
    ? callback.body.body
    : [b.returnStatement(callback.body)];
  let directives = 0;
  while (
    b.isExpressionStatement(body[directives]) &&
    b.isStringLiteral((body[directives] as t.ExpressionStatement).expression)
  )
    directives++;
  callback.body = b.blockStatement([
    ...body.slice(0, directives),
    {
      type: 'TryStatement',
      block: b.blockStatement(body.slice(directives)),
      handler: null,
      finalizer: b.blockStatement([publish]),
    } as t.Statement,
  ]);
}
