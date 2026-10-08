/** Allocate the DOM factory's private presentation ABI from shared ownership. */
import type * as t from '../ast/compiler-types';
import type { PresentationOwner } from '../planning/presentation-ownership';
import type { DomContext } from './context';
import { generatedIdentifier } from './identifiers';

export function allocatePresentationParameter(ctx: DomContext, owner: PresentationOwner): t.Identifier {
  if (ctx.presentationOwners.get(owner.component) !== owner) {
    throw new Error('memo-dom: missing analyzed presentation owner');
  }
  let parameter = ctx.presentationParameters.get(owner.component);
  if (parameter === undefined) {
    parameter = generatedIdentifier(ctx, 'dataPolicies');
    ctx.presentationParameters.set(owner.component, parameter);
  }
  return parameter;
}
