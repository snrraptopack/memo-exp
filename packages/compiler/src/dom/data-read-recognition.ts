/** Recognition of already-lowered operations belongs to the backend. */
import type * as t from '../ast/compiler-types';
import type { BaseNode } from '../ast';
import type { DomContext } from './context';
import { isGeneratedDataMember } from './identifiers';

export function isGeneratedDataCall(ctx: DomContext, node: BaseNode): boolean {
  let call = ctx.astAnalysis?.parentByNode.get(node) ?? null;
  while (call !== null && call.type !== 'CallExpression') call = ctx.astAnalysis?.parentByNode.get(call) ?? null;
  return call !== null && isGeneratedDataMember((call as unknown as t.CallExpression).callee);
}
