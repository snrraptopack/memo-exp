/**
 * Calculated list-source normalization.
 *
 * A direct expression such as `items.filter(predicate).map(renderRow)` is
 * hoisted to one component-local derivation before ordinary instance analysis.
 * Existing derivation replay and R7 reconciliation then provide update
 * scheduling and keyed retention without adding a runtime list-expression
 * interpreter.
 */
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { Ctx } from '../context';
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
    isStaticPrimitiveList(current)
  );
}

function containingTopLevelStatement(
  path: NodePath,
  componentPath: NodePath<t.FunctionDeclaration>,
): NodePath<t.Statement> | null {
  let current: NodePath | null = path;
  const body = componentPath.get('body');
  while (current !== null && current.parentPath !== body) {
    current = current.parentPath;
  }
  return current?.isStatement() === true ? current : null;
}

function belongsDirectlyToComponent(
  path: NodePath,
  componentPath: NodePath<t.FunctionDeclaration>,
): boolean {
  return (
    path.findParent(
      (parent) =>
        parent.isFunctionDeclaration() ||
        parent.isFunctionExpression() ||
        parent.isArrowFunctionExpression(),
    ) === componentPath
  );
}

/**
 * Hoist calculated roots of structural `.map()` calls into generated const
 * derivations consumed by the existing R14/R7 pipeline. Method behavior and
 * return values remain ordinary author-owned JavaScript contracts.
 */
export function normalizeCalculatedListSources(ctx: Ctx): void {
  for (const [, componentPath] of ctx.compPaths) {
    const candidates: Array<{
      path: NodePath<t.CallExpression>;
      source: t.Expression;
      statement: NodePath<t.Statement>;
    }> = [];

    componentPath.traverse({
      CallExpression(path) {
        if (
          matchMapCall(path.node) === null ||
          !t.isMemberExpression(path.node.callee) ||
          !t.isExpression(path.node.callee.object) ||
          directSourceShape(path.node.callee.object) ||
          !belongsDirectlyToComponent(path, componentPath)
        ) {
          return;
        }
        const statement = containingTopLevelStatement(path, componentPath);
        if (statement === null) return;
        candidates.push({
          path,
          source: t.cloneNode(path.node.callee.object, true),
          statement,
        });
      },
    });

    if (candidates.length === 0) continue;
    const bodyPaths = componentPath.get('body').get('body');
    const statementOrder = new Map(
      bodyPaths.map((path, index) => [path.node, index]),
    );
    candidates.sort(
      (left, right) =>
        (statementOrder.get(left.statement.node) ?? 0) -
        (statementOrder.get(right.statement.node) ?? 0),
    );

    const declarations: t.VariableDeclarator[] = [];
    for (const candidate of candidates) {
      const binding = generatedIdentifier(ctx, 'listView');
      declarations.push(
        t.variableDeclarator(t.cloneNode(binding), candidate.source),
      );
      const callee = candidate.path.get('callee');
      if (Array.isArray(callee) || !callee.isMemberExpression()) continue;
      const object = callee.get('object');
      if (Array.isArray(object)) continue;
      object.replaceWith(t.cloneNode(binding));
    }

    candidates[0]!.statement.insertBefore(
      t.variableDeclaration('const', declarations),
    );
    componentPath.scope.crawl();

  }
}
