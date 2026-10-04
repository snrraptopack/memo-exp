/** DOM binding addresses derived from parser-safe initial content. */
import type { InitialRenderNode, InitialRenderPlan } from '../planning/initial-render';
import type { EmitScope } from './scope';
import * as astFactory from '../ast/factory';
import type * as t from '../ast/compiler-types';

export interface InitialDomElement {
  readonly path: readonly number[];
  readonly texts: readonly {readonly path: readonly number[]; readonly live: boolean; readonly empty: boolean}[];
  readonly staticAttributes: readonly string[];
  readonly inputValueSite?: string;
}
export interface InitialDomRoot {
  readonly target: string;
  readonly component: string;
  readonly returnSite: string;
  readonly elements: Readonly<Record<string,InitialDomElement>>;
  readonly conditions: Readonly<Record<string, {readonly branch: number; readonly open: readonly number[];
    readonly end: readonly number[]; readonly returnSite: string | null}>>;
  readonly lists: Readonly<Record<string, {readonly open: readonly number[]; readonly end: readonly number[];
    readonly count: number; readonly row: InitialDomRoot | null}>>;
}

export function planInitialDom(plan: Extract<InitialRenderPlan,{kind:'bindings'}>): InitialDomRoot | null {
  const elements: Record<string,InitialDomElement>={};
  const conditions: Record<string,InitialDomRoot['conditions'][string]>={};
  const lists: Record<string,InitialDomRoot['lists'][string]>={};
  let valid=true;
  function visit(nodes: readonly InitialRenderNode[],parent: readonly number[], start=0): void {
    let index=start;
    nodes.forEach(node=>{
      const current=index++;
      if (node.kind === 'list') {
        if (lists[node.site]) {valid=false;return;}
        if (!node.rows.length) {
          lists[node.site]={open:[...parent,current],end:[...parent,current+1],count:0,row:null};
          index++;
          return;
        }
        const first=node.rows[0];
        if (!first || first.length!==1 || first[0]?.kind!=='element' || !first[0].site) {valid=false;return;}
        const containerRow=planInitialDom({...plan,nodes:first,returnSite:first[0].site});
        if (!containerRow) {valid=false;return;}
        const row={...containerRow,elements:Object.fromEntries(Object.entries(containerRow.elements).map(([site,element])=>
          [site,{...element,path:element.path.slice(1),texts:element.texts.map(text=>({...text,path:text.path.slice(1)}))}]))};
        lists[node.site]={open:[...parent,current],end:[...parent,current+node.rows.length+1],count:node.rows.length,row};
        index += node.rows.length+1;
        return;
      }
      if (node.kind === 'conditional') {
        if (conditions[node.site]) {valid=false;return;}
        const children=node.children;
        if (children.length > 1 || children.length === 1 && children[0]!.kind !== 'element') {valid=false;return;}
        conditions[node.site]={branch:node.branch,open:[...parent,current],end:[...parent,current+children.length+1],
          returnSite:children[0]?.kind === 'element' ? children[0].site ?? null : null};
        visit(children,parent,current+1);
        index += children.length+1;
        return;
      }
      if (node.kind !== 'element') return;
      if (!node.site || elements[node.site]) {valid=false;return;}
      const path=[...parent,current];
      let childIndex=0;
      elements[node.site]={path,
        ...(node.tag==='input' ? {inputValueSite:node.attributes.find(attribute=>attribute.name==='value')?.site} : {}),
        texts:node.children.flatMap(child=>{
          const current=childIndex;
          childIndex += child.kind === 'conditional' ? child.children.length+2 : child.kind==='list' ? child.rows.length+2 : 1;
          return child.kind === 'text' ? [{path:[...path,current],live:child.live!==false,empty:child.value===''}] : [];
        }),
        staticAttributes:node.attributes.flatMap(attribute=>attribute.live===false&&attribute.site ? [attribute.site] : []),
      };
      visit(node.children,path);
    });
  }
  visit(plan.nodes,[]);
  return valid ? {target:plan.target,component:plan.rootLocal,returnSite:plan.returnSite,elements,conditions,lists} : null;
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

/** Branches bind once; later activations use the same factory's creation path. */
export function initialOrCreate(scope: EmitScope, bound: t.Expression, create: t.Expression) {
  if (!scope.initialDom) return create;
  return scope.initialDom.adopting
    ? astFactory.conditionalExpression(scope.initialDom.adopting, bound, create) : bound;
}

export function freshInitialStatement(scope: EmitScope, statement: t.Statement) {
  return scope.initialDom?.adopting
    ? astFactory.ifStatement(astFactory.unaryExpression('!', scope.initialDom.adopting), statement) : statement;
}
