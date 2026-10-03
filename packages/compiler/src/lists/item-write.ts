/** Authored indexed-item write syntax shared by discovery and handler lowering. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { transparentListExpression } from './source-shapes';

export interface DirectItemWrite {
  readonly source: string;
  readonly itemAccess: t.MemberExpression;
  readonly path: string[];
}

/** Syntax only: callers must prove binding identity and plain receiver/key reads. */
export function directItemWrite(member: t.MemberExpression): DirectItemWrite | null {
  const chain: t.MemberExpression[] = [];
  let current: t.Expression = member;
  for (;;) {
    current = transparentListExpression(current);
    if (!astFactory.isMemberExpression(current)) break;
    chain.unshift(current);
    if (astFactory.isSuper(current.object)) return null;
    current = current.object;
  }
  if (!astFactory.isIdentifier(current)) return null;
  const itemAccess = chain[0];
  if (itemAccess === undefined || !itemAccess.computed || chain.length < 2 ||
      !astFactory.isExpression(itemAccess.property) ||
      !(astFactory.isIdentifier(itemAccess.property) ||
        astFactory.isNumericLiteral(itemAccess.property) ||
        astFactory.isStringLiteral(itemAccess.property))) return null;
  const path: string[] = [];
  for (const segment of chain.slice(1)) {
    if (!segment.computed && astFactory.isIdentifier(segment.property)) path.push(segment.property.name);
    else if (segment.computed && astFactory.isStringLiteral(segment.property)) path.push(segment.property.value);
    else return null;
  }
  return { source: current.name, itemAccess, path };
}
