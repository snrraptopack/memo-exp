/** Serialize the captured module-reader routes for the DOM runtime. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import type { Ctx } from '../context';
import type { AccessReaderPlan } from '../analysis/access-table';
import { md } from '../identifiers';

export function emitAccessTable(ctx: Ctx, plan: AccessReaderPlan): t.Statement | null {
  if (plan.size === 0) return null;
  const readerProperties = [...plan.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([variable, readers]) => astFactory.objectProperty(
      astFactory.stringLiteral(variable),
      astFactory.arrayExpression([...readers].sort().map(reader => astFactory.stringLiteral(reader))),
    ));
  return astFactory.expressionStatement(
    astFactory.callExpression(md(ctx, 'installAccessTable'), [
      astFactory.objectExpression([astFactory.objectProperty(
        astFactory.identifier('readers'), astFactory.objectExpression(readerProperties),
      )]),
      astFactory.stringLiteral(ctx.rootId),
      astFactory.stringLiteral(ctx.moduleId),
    ]),
  );
}
