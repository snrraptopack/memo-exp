/**
 * Calculated list-source normalization.
 *
 * A direct expression such as `items.filter(predicate).map(renderRow)` is
 * hoisted to one component-local derivation before ordinary instance analysis.
 * Existing derivation replay and R7 reconciliation then provide update
 * scheduling and keyed retention without adding a runtime list-expression
 * interpreter.
 */
import * as t from '@babel/types';
import { walkAst, type BaseNode } from '../ast';
import {
  refreshAstAnalysis,
  type Ctx,
  type MapCallExpression,
} from '../context';
import { generatedIdentifier } from '../identifiers';
import { matchMapCall } from '../lists';
import {
  isStaticPrimitiveList,
  transparentListExpression,
} from './source-shapes';

function directSourceShape(expression: t.Expression): boolean {
  const current = transparentListExpression(expression);
  return (
    t.isIdentifier(current) ||
    t.isMemberExpression(current) ||
    t.isOptionalMemberExpression(current) ||
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
 * Hoist calculated roots of structural `.map()` calls into generated const
 * derivations consumed by the existing R14/R7 pipeline. Method behavior and
 * return values remain ordinary author-owned JavaScript contracts.
 */
export function normalizeCalculatedListSources(ctx: Ctx): void {
  for (const [, componentPath] of ctx.compPaths) {
    const candidates: Array<{
      call: MapCallExpression;
      source: t.Expression;
      statement: t.Statement;
    }> = [];
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
        const call = node as unknown as MapCallExpression;
        const callee = call.callee;
        if (
          matchMapCall(call) === null ||
          (!t.isMemberExpression(callee) &&
            !t.isOptionalMemberExpression(callee)) ||
          !t.isExpression(callee.object) ||
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
        candidates.push({
          call,
          source: t.cloneNode(callee.object, true),
          statement,
        });
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

    const declarations: t.VariableDeclarator[] = [];
    for (const candidate of candidates) {
      const binding = generatedIdentifier(ctx, 'listView');
      declarations.push(
        t.variableDeclarator(t.cloneNode(binding), candidate.source),
      );
      const callee = candidate.call.callee;
      if (
        (!t.isMemberExpression(callee) && !t.isOptionalMemberExpression(callee)) ||
        !t.isExpression(callee.object)
      ) {
        continue;
      }
      callee.object = t.cloneNode(binding);
    }

    const insertionIndex = body.indexOf(candidates[0]!.statement);
    if (insertionIndex < 0) continue;
    body.splice(
      insertionIndex,
      0,
      t.variableDeclaration('const', declarations),
    );
    const program = ctx.astAnalysis?.rootScope.block;
    if (program !== undefined) refreshAstAnalysis(ctx, program);
  }
}
