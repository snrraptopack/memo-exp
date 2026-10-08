/** Lower authored stable-source replay facts into this backend's data ABI. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {cloneNode} from '../ast';
import type {LocalDerivation} from '../components/props';
import {assignmentTarget} from './props';
import type {DomContext} from './context';
import {mdd} from './identifiers';

export function buildDerivationReplay(ctx:DomContext,derivation:LocalDerivation):t.Statement {
  const replay=derivation.replay;
  if(replay!==undefined) {
    if(!astFactory.isIdentifier(derivation.target))
      throw new Error('memo-dom: stable source replay requires an identifier target');
    const target=cloneNode(derivation.target);
    return astFactory.expressionStatement(replay.kind==='provider'
      ? astFactory.callExpression(mdd(ctx,'rebindResolvedValue'),
          [target,...replay.call.arguments.map(argument=>cloneNode(argument))])
      : astFactory.callExpression(mdd(ctx,'rebindResolvedValueFromFactory'),
          [target,astFactory.arrowFunctionExpression([],cloneNode(replay.call))]));
  }
  return astFactory.expressionStatement(astFactory.assignmentExpression('=',
    assignmentTarget(derivation.target),cloneNode(derivation.source)));
}
