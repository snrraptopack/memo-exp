import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import type {Ctx} from '../context/model';
import {canonicalStateKey} from '../context/ast';
import {generatedIdentifier} from '../identifiers';

/** Hoist and dedupe a canonical write-set constant. */
export function freshWriteConst(
  ctx: Ctx,
  writes: readonly string[],
): t.Identifier {
  const canonicalWrites = [
    ...new Set(writes.map((write) => canonicalStateKey(ctx, write))),
  ].sort();
  const key = canonicalWrites.join(' ');
  const existing = ctx.emission.writeConsts.get(key);
  if (existing !== undefined) return astFactory.identifier(existing);
  const id = generatedIdentifier(ctx, `WRITES_${ctx.emission.writeConstCounter++}`);
  ctx.emission.writeConsts.set(key, id.name);
  ctx.emission.header.push(
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        id,
        astFactory.arrayExpression(
          canonicalWrites.map((write) => astFactory.stringLiteral(write)),
        ),
      ),
    ]),
  );
  return id;
}

/** Hoist and dedupe a sorted array used to batch local dirty reasons. */
export function freshReasonConst(
  ctx: Ctx,
  reasons: readonly (number | string)[],
): t.Identifier {
  const unique = [...new Set(reasons)].sort((left, right) =>
    typeof left === 'number' && typeof right === 'number'
      ? left - right
      : typeof left === 'number'
        ? -1
        : typeof right === 'number'
          ? 1
          : left < right
            ? -1
            : 1,
  );
  const key = unique.join(' ');
  const existing = ctx.emission.reasonConsts.get(key);
  if (existing !== undefined) return astFactory.identifier(existing);
  const id = generatedIdentifier(
    ctx,
    `REASONS_${ctx.emission.reasonConstCounter++}`,
  );
  ctx.emission.reasonConsts.set(key, id.name);
  ctx.emission.header.push(
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        id,
        astFactory.arrayExpression(
          unique.map((reason) =>
            typeof reason === 'number'
              ? astFactory.numericLiteral(reason)
              : astFactory.stringLiteral(reason),
          ),
        ),
      ),
    ]),
  );
  return id;
}

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
