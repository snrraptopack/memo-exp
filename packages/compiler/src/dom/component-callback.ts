/** Bind shared callback write plans to this renderer's owner and row ABI. */
import type { DomContext as Ctx } from './context';
import type { RowCtx } from '../context';
import type { CallbackSourcePlan } from '../planning/component-callbacks';
import { emitHandlerWrites } from './handler';
import { mutationJournalVariable } from './list-bindings';

export function emitComponentCallback(ctx:Ctx,plan:CallbackSourcePlan|null,row?:RowCtx):void {
  if(!plan||ctx.analyzedFunctions.has(plan.target))return;
  // Named helpers live at factory scope; row identifiers cannot be captured
  // by their declaration. Preserve completion commits and cycle ownership.
  ctx.analyzedFunctions.add(plan.target);
  for(const helper of plan.helpers)emitComponentCallback(ctx,helper);
  const facts=row?{itemParam:row.itemParam,itemPath:[...row.itemPath],keyPath:row.keyPath===null?null:[...row.keyPath],
    sourceKey:row.sourceKey,sourceLocal:row.sourceLocal,localRefresh:row.refreshVar!==undefined}:undefined;
  const writes=plan.writesFor(facts);
  const journals=new Map([...ctx.keyedListMutationSources.get(writes.owner!)?.keys()??[]]
    .map(source=>[source,mutationJournalVariable(ctx,writes.owner!,source)]));
  emitHandlerWrites(ctx,writes,{row,journals});
}
