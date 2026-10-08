/** Allocate source aliases from captured prop projections; publish names explicitly. */
import * as astFactory from '../../ast/factory';
import { cloneNode, isValidIdentifier, overwriteNode, type BaseNode } from '../../ast';
import type { SourcePropProjection } from '../../planning/source-props';
import type { IdentifierOwner } from '../identifiers';
import { generatedIdentifier } from '../identifiers';

export function lowerSourcePropProjections(
  owner: IdentifierOwner,
  projections: readonly SourcePropProjection[],
): ReadonlyMap<string,string> {
  const sourceProps = new Map<string,string>();
  for (const projection of projections) {
    if (projection.kind === 'binding') {
      sourceProps.set(projection.binding,projection.prop);
      continue;
    }
    const alias = generatedIdentifier(owner,`${projection.prop}Source`);
    if (projection.reads.length === 0) continue;
    for (const read of projection.reads) overwriteNode(read,cloneNode(alias) as unknown as BaseNode);
    projection.declaration.body.body.unshift(astFactory.variableDeclaration('const',[
      astFactory.variableDeclarator(cloneNode(alias),astFactory.memberExpression(
        astFactory.identifier(projection.objectBinding),
        isValidIdentifier(projection.prop) ? astFactory.identifier(projection.prop) : astFactory.stringLiteral(projection.prop),
        !isValidIdentifier(projection.prop),
      )),
    ]));
    sourceProps.set(alias.name,projection.prop);
  }
  return sourceProps;
}
