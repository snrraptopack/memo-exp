/** Retain the authored promise creation operation behind `$read` sources. */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import { cloneNode, walkAst, type BaseNode } from '../../ast';
import {
  astBindingAt,
  refreshAstAnalysis,
  unwrapTypeExpression,
  variableDeclaratorFor,
  type Ctx,
} from '../../context';

function creationExpression(
  ctx: Ctx,
  expression: t.Expression,
  seen = new Set<object>(),
): t.Expression {
  const unwrapped = unwrapTypeExpression(expression as unknown as BaseNode);
  if (!astFactory.isIdentifier(unwrapped)) return cloneNode(expression, true);
  const binding = astBindingAt(ctx, unwrapped, unwrapped.name);
  const declaration = binding === undefined ? null : variableDeclaratorFor(ctx, binding);
  if (
    binding === undefined ||
    binding.kind !== 'const' ||
    binding.constantViolations.length > 0 ||
    seen.has(binding) ||
    declaration?.init === null ||
    declaration?.init === undefined ||
    !astFactory.isExpression(declaration.init)
  ) {
    return cloneNode(expression, true);
  }
  seen.add(binding);
  return creationExpression(ctx, declaration.init, seen);
}

export function addReadReplayFactories(ctx: Ctx, program: t.Program): void {
  if (ctx.transparentReadFactories.size === 0) return;
  refreshAstAnalysis(ctx, program);
  walkAst(program as unknown as BaseNode, {
    enter(node) {
      if (!astFactory.isCallExpression(node) ||
        !astFactory.isIdentifier(node.callee) ||
        !ctx.transparentReadFactories.has(node.callee.name) ||
        astBindingAt(ctx, node, node.callee.name)?.kind !== 'import' ||
        node.arguments.length !== 1 ||
        !astFactory.isExpression(node.arguments[0])) return;
      const expression = creationExpression(ctx, node.arguments[0]);
      node.arguments.push(astFactory.arrowFunctionExpression([], expression));
    },
  });
}
