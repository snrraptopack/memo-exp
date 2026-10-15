import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import type { DomContext as Ctx } from './context';
import { generatedIdentifier } from './identifiers';

export { freshWriteConst, freshReasonConst } from '../emission/publication-constants';

/** Hoist and dedupe a static-markup string const. */
export function freshMarkupConst(
  ctx: Ctx,
  markup: string,
): t.Identifier {
  const existing = ctx.emission.markupConsts.get(markup);
  if (existing !== undefined) return astFactory.identifier(existing);
  const id = generatedIdentifier(
    ctx,
    `HTML_${ctx.emission.markupConstCounter++}`,
  );
  ctx.emission.markupConsts.set(markup, id.name);
  ctx.emission.header.push(
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(id, astFactory.stringLiteral(markup)),
    ]),
  );
  return id;
}
