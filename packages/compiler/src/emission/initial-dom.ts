/** DOM binding addresses derived from parser-safe initial content. */
import type { InitialRenderNode, InitialRenderPlan } from '../planning/initial-render';
import type { EmitScope } from './scope';
import * as astFactory from '../ast/factory';

export interface InitialDomElement {
  readonly path: readonly number[];
  readonly texts: readonly {readonly path: readonly number[]; readonly live: boolean; readonly empty: boolean}[];
  readonly staticAttributes: readonly string[];
}
export interface InitialDomRoot {
  readonly target: string;
  readonly component: string;
  readonly returnSite: string;
  readonly elements: Readonly<Record<string,InitialDomElement>>;
}

export function planInitialDom(plan: Extract<InitialRenderPlan,{kind:'bindings'}>): InitialDomRoot | null {
  const elements: Record<string,InitialDomElement>={};
  let valid=true;
  function visit(nodes: readonly InitialRenderNode[],parent: readonly number[]): void {
    nodes.forEach((node,index)=>{
      if (node.kind !== 'element') return;
      if (!node.site || elements[node.site]) {valid=false;return;}
      const path=[...parent,index];
      elements[node.site]={path,
        texts:node.children.flatMap((child,index)=>child.kind === 'text' ? [{path:[...path,index],live:child.live!==false,empty:child.value===''}] : []),
        staticAttributes:node.attributes.flatMap(attribute=>attribute.live===false&&attribute.site ? [attribute.site] : []),
      };
      visit(node.children,path);
    });
  }
  visit(plan.nodes,[]);
  return valid ? {target:plan.target,component:plan.rootLocal,returnSite:plan.returnSite,elements} : null;
}

/** Only nodes used by future browser work get a binding descriptor. */
export function initialNode(scope: EmitScope,path: readonly number[],kind: string) {
  const initial=scope.initialDom!;
  const index=initial.descriptors.length;
  initial.descriptors.push(astFactory.arrayExpression([
    astFactory.arrayExpression(path.map(index=>astFactory.numericLiteral(index))),astFactory.stringLiteral(kind),
  ]));
  return astFactory.memberExpression(astFactory.identifier(initial.variable),astFactory.numericLiteral(index),true);
}
