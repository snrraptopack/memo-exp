/** Optional end/anchor-relative addresses for compiler-proven region extents. */
import {getActiveEnvironment} from './kernel';
import {bindInitialNodes} from './initial-bindings';

export type InitialBindingStep=number|readonly [anchor:string,offset:number,end?:true];

export function bindInitialListNodes(
  target:string|Node,
  bindings:readonly (readonly [readonly InitialBindingStep[],string])[],
  resolveAnchor?:(parent:Node,marker:string,end:boolean)=>number,
):Node[] {
  const host=typeof target==='string'?getActiveEnvironment().document.getElementById(target):target;
  if(!host)throw new Error(`memo-dom: initial HTML target '${target}' was not found`);
  const resolved=bindings.map(([path,kind]):[number[],string]=>{
    let node:Node=host;
    const address=path.map(step=>{
      const index=typeof step==='number'?step:resolveAnchor?resolveAnchor(node,step[0],step[2]===true)+step[1]:NaN;
      const absolute=typeof step==='number'&&index<0?node.childNodes.length+index:index;
      const child=node.childNodes[absolute];
      if(!Number.isInteger(index)||typeof step!=='number'&&!Number.isInteger(step[1])||absolute<0||!child)throw new Error('memo-dom: initial DOM binding path is missing');
      node=child;return absolute;
    });
    return [address,kind];
  });
  // The shared binder validates every shape before changing empty text markers.
  return bindInitialNodes(host,resolved);
}
