/** JavaScript lowering of semantic route selectors chosen during planning. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import type { RouteReadSelector } from '../analysis/route-selectors';

export function routeSelectorExpression(
  selector: RouteReadSelector,
  route: t.Identifier,
): t.Expression {
  if (selector.kind === 'member') {
    return selector.path.reduce<t.Expression>(
      (object, key) => astFactory.memberExpression(
        object, astFactory.stringLiteral(key), true,
      ),
      route,
    );
  }
  return astFactory.callExpression(
    astFactory.memberExpression(
      astFactory.memberExpression(route, astFactory.identifier('query')),
      astFactory.identifier(selector.method),
    ),
    selector.args.map(astFactory.stringLiteral),
  );
}
