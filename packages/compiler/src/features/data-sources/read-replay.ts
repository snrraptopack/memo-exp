/** Lower planned read operations; never rediscover their source or lexical scope. */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import {cloneNode} from '../../ast';
import { generatedIdentifier, type IdentifierOwner } from '../../dom/identifiers';
import type {ReadReplayPlan} from '../../planning/read-replay';

export function lowerReadReplays(owner: IdentifierOwner, plans: readonly ReadReplayPlan[]): void {
  const factories = new Map<t.VariableDeclarator, t.Identifier>();
  for (const plan of plans) {
    const replay = astFactory.arrowFunctionExpression([], cloneNode(plan.expression, true));
    if (plan.placement === undefined || plan.origin === undefined) {
      plan.call.arguments.push(replay);
      continue;
    }
    let factory = factories.get(plan.origin);
    if (factory === undefined) {
      factory = generatedIdentifier(owner, 'readReplay');
      factories.set(plan.origin, factory);
      const declaration = astFactory.variableDeclarator(cloneNode(factory), replay);
      const placement = plan.placement;
      if (placement.kind === 'declarators') {
        placement.entries.splice(placement.entries.indexOf(placement.before), 0, declaration);
      } else {
        placement.entries.splice(placement.entries.indexOf(placement.before), 0,
          astFactory.variableDeclaration('const', [declaration]));
      }
    }
    plan.call.arguments.push(cloneNode(factory));
  }
}
