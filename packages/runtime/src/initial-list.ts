/** Optional initial-HTML validation; ordinary lists share reconciliation only. */
import type { InitialListDOM } from './list-dom';

export function bindInitialList(parent: Node, open: Node, end: Node | null, count?: number): InitialListDOM {
  if (end===null || open===end || open.parentNode!==parent || end.parentNode!==parent ||
      (count===undefined ? end.nodeType!==8 || (end as Comment).data!=='/mmd:initial:list' : !Number.isInteger(count) || count<0)) {
    throw new Error('memo-dom: initial list anchors do not match the browser program');
  }
  const rows: Node[]=[];
  let cursor=open.nextSibling;
  while (cursor!==end && cursor!==null && (count===undefined || rows.length<=count)) {
    if (cursor.nodeType!==1) throw new Error('memo-dom: initial list needs one host root per row');
    rows.push(cursor);cursor=cursor.nextSibling;
  }
  if (cursor!==end || count!==undefined && rows.length!==count) throw new Error('memo-dom: initial list row count does not match the browser program');
  return {open,end,rows,dispose(){
    let errors:unknown[]|null=null;
    for(const row of rows) {
      try {row.parentNode?.removeChild(row);} catch(error) {(errors??=[]).push(error);}
    }
    if(errors?.length===1)throw errors[0];
    if(errors)throw new AggregateError(errors,'memo-dom: initial list disposal failed');
  }};
}
