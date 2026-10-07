/** Anchor lookup is retained only by programs with variable sibling regions. */
import {bindInitialListNodes,type InitialBindingStep} from './initial-list-bindings';

export function bindInitialRegionNodes(target:string|Node,bindings:readonly (readonly [readonly InitialBindingStep[],string])[]):Node[] {
  const ranges=new Map<Node,Map<string,readonly [number,number]>>();
  return bindInitialListNodes(target,bindings,(parent,marker,end)=>{
    let sites=ranges.get(parent);
    if(!sites) {
      sites=new Map();ranges.set(parent,sites);
      const stack:{marker:string;index:number}[]=[];
      for(let index=0;index<parent.childNodes.length;index++) {
        const node=parent.childNodes[index]!;
        if(node.nodeType!==8)continue;
        const data=(node as Comment).data;
        if(/^mmd:initial:(list|when):/.test(data))stack.push({marker:data,index});
        else if(data==='/mmd:initial:list'||data==='/mmd:initial:when') {
          const open=stack.pop();
          if(!open||!open.marker.startsWith(data.slice(1)+':')||sites.has(open.marker))throw new Error('memo-dom: initial region anchors do not match');
          sites.set(open.marker,[open.index,index]);
        }
      }
      if(stack.length)throw new Error('memo-dom: initial region anchors do not match');
    }
    const range=sites.get(marker);
    if(!range)throw new Error('memo-dom: initial region anchor is missing');
    return range[end?1:0];
  });
}
