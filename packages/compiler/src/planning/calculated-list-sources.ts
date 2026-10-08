/**
 * Shared calculated list-source planning.
 *
 * A direct expression such as `items.filter(predicate).map(renderRow)` is
 * planned as one component-local derivation before ordinary instance analysis.
 * A backend lowers the plan; existing derivation replay and R7 reconciliation
 * provide scheduling and keyed retention without a list-expression interpreter.
 */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode, walkAst, type BaseNode } from '../ast';
import type { Ctx } from '../context';
import {
  isStaticPrimitiveList,
  transparentListExpression,
  matchMapCall,
} from '../lists/source-shapes';

export interface CalculatedListSource {
  readonly receiver: t.MemberExpression | t.OptionalMemberExpression;
  readonly source: t.Expression;
  readonly statement: t.Statement;
}

export interface CalculatedListSourcePlan {
  readonly component: string;
  readonly body: t.BlockStatement;
  readonly sources: readonly CalculatedListSource[];
}

function directSourceShape(expression: t.Expression): boolean {
  const current = transparentListExpression(expression);
  return (
    astFactory.isIdentifier(current) ||
    astFactory.isMemberExpression(current) ||
    astFactory.isOptionalMemberExpression(current) ||
    isStaticPrimitiveList(current)
  );
}

function containingTopLevelStatement(
  ctx: Ctx,
  node: BaseNode,
  componentBody: BaseNode,
): t.Statement | null {
  let current: BaseNode | null = node;
  while (
    current !== null &&
    ctx.astAnalysis?.parentByNode.get(current) !== componentBody
  ) {
    current = ctx.astAnalysis?.parentByNode.get(current) ?? null;
  }
  return current as unknown as t.Statement | null;
}

/**
 * Capture calculated roots in authored traversal/statement order. This pass
 * neither allocates derivation bindings nor changes any receiver or declaration.
 * Method behavior and return values remain ordinary authored JavaScript.
 */
export function planCalculatedListSources(ctx: Ctx): readonly CalculatedListSourcePlan[] {
  const plans: CalculatedListSourcePlan[] = [];
  for (const [component, componentPath] of ctx.compPaths) {
    const candidates: CalculatedListSource[] = [];
    const componentBody = componentPath.node.body as unknown as BaseNode;

    walkAst(componentBody, {
      enter(node) {
        if (
          node !== componentBody &&
          (node.type === 'FunctionDeclaration' ||
            node.type === 'FunctionExpression' ||
            node.type === 'ArrowFunctionExpression')
        ) {
          return false;
        }
        if (
          node.type !== 'CallExpression' &&
          node.type !== 'OptionalCallExpression'
        ) {
          return;
        }
        const call = matchMapCall(node as unknown as t.Node);
        if (call === null) return;
        const callee = call.callee;
        if (
          (!astFactory.isMemberExpression(callee) &&
            !astFactory.isOptionalMemberExpression(callee)) ||
          !astFactory.isExpression(callee.object) ||
          directSourceShape(callee.object)
        ) {
          return;
        }
        const statement = containingTopLevelStatement(
          ctx,
          node,
          componentBody,
        );
        if (statement === null) return;
        candidates.push(Object.freeze({
          receiver: callee,
          source: cloneNode(callee.object, true),
          statement,
        }));
      },
    });

    if (candidates.length === 0) continue;
    const body = componentPath.node.body.body;
    const statementOrder = new Map(
      body.map((statement, index) => [statement, index]),
    );
    candidates.sort(
      (left, right) =>
        (statementOrder.get(left.statement) ?? 0) -
        (statementOrder.get(right.statement) ?? 0),
    );

    plans.push(Object.freeze({component,body:componentPath.node.body,sources:Object.freeze(candidates)}));
  }
  return Object.freeze(plans);
}
