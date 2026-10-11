/** Adapt core setup replay to retained scene preparation. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { cloneNode, walkAst } from '../ast';
import type { Ctx } from '../context';
import { planPreludeReplay } from '../emission/prelude';
import { valueExpression } from './lower-scene';

export function desktopPrelude(
  ctx: Ctx,
  component: string,
  body: readonly t.Statement[],
  sources: t.Identifier,
  affected: t.Identifier,
): t.ArrowFunctionExpression | undefined {
  const locals = ctx.instanceDerivations.get(component) ?? [];
  for (const local of locals) local.declaration.kind = 'let';
  const steps = planPreludeReplay(
    body,
    locals,
    ctx.instanceControlFlow.get(component) ?? [],
    (local) => {
      const target = cloneNode(local.target);
      walkAst(target, {
        enter(node) {
          const typed = node as t.Node & { typeAnnotation?: unknown; optional?: boolean };
          if ('typeAnnotation' in typed) delete typed.typeAnnotation;
          if ('optional' in typed) delete typed.optional;
        },
      });
      return b.expressionStatement(b.assignmentExpression('=', target, cloneNode(local.source)));
    },
  );
  if (!steps.length) return undefined;
  return b.arrowFunctionExpression(
    [sources],
    b.blockStatement(
      steps.map((step) =>
        b.ifStatement(
          b.callExpression(affected, [valueExpression(step.sources), sources]),
          b.blockStatement([step.statement]),
        ),
      ),
    ),
  );
}
