/** Allocate derivation bindings from ordered shared list-source contracts. */
import * as astFactory from '../ast/factory';
import { cloneNode } from '../ast';
import { refreshAstAnalysis } from '../context';
import type { CalculatedListSourcePlan } from '../planning/calculated-list-sources';
import type { DomContext } from './context';
import { generatedIdentifier } from './identifiers';

export function lowerCalculatedListSources(ctx: DomContext, plans: readonly CalculatedListSourcePlan[]): void {
  for (const plan of plans) {
    const insertionIndex = plan.body.body.indexOf(plan.sources[0]!.statement);
    if (insertionIndex < 0) throw new Error('memo-dom: calculated list placement changed before lowering');
    const declarations = plan.sources.map(source => {
      const binding = generatedIdentifier(ctx,'listView');
      const declaration = astFactory.variableDeclarator(cloneNode(binding),cloneNode(source.source,true));
      source.receiver.object = cloneNode(binding);
      return declaration;
    });
    plan.body.body.splice(insertionIndex,0,astFactory.variableDeclaration('const',declarations));
    const program = ctx.astAnalysis?.rootScope.block;
    if (program !== undefined) refreshAstAnalysis(ctx,program);
  }
}
