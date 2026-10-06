/** Optional end-relative addresses for compiler-proven variable list extents. */
import {getActiveEnvironment} from './kernel';
import {bindInitialNodes} from './initial-bindings';

export function bindInitialListNodes(
  target:string|Node,
  bindings:readonly (readonly [readonly number[],string])[],
):Node[] {
  const host=typeof target==='string'?getActiveEnvironment().document.getElementById(target):target;
  if(!host)throw new Error(`memo-dom: initial HTML target '${target}' was not found`);
  const resolved=bindings.map(([path,kind]):[number[],string]=>{
    let node:Node=host;
    const address=path.map(index=>{
      const absolute=index<0?node.childNodes.length+index:index;
      const child=node.childNodes[absolute];
      if(!Number.isInteger(index)||absolute<0||!child)throw new Error('memo-dom: initial DOM binding path is missing');
      node=child;return absolute;
    });
    return [address,kind];
  });
  // The shared binder validates every shape before changing empty text markers.
  return bindInitialNodes(host,resolved);
}
