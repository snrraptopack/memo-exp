/** DOM binding addresses derived from parser-safe initial content. */
import type { InitialRenderNode, InitialRenderPlan } from '../planning/initial-render';
import type { EmitScope } from './scope';
import { renderDocument } from './scope';
import type { Ctx } from '../context';
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
  readonly retainCreation?: true;
  readonly elements: Readonly<Record<string,InitialDomElement>>;
  readonly components: Readonly<Record<string,{readonly path:readonly number[];readonly tag:string;readonly moduleId:string;readonly component:string;readonly static?:boolean}>>;
  readonly factories?: Readonly<Record<string,InitialDomRoot>>;
  readonly conditions: Readonly<Record<string, {readonly branch: number | null; readonly open: readonly number[];
    readonly end: readonly number[]; readonly returnSite: string | null; readonly branches?: readonly InitialDomRoot[]}>>;
  readonly lists: Readonly<Record<string, {readonly open: readonly number[]; readonly end: readonly number[] | 'last-child';
    readonly count: number | null; readonly row: InitialDomRoot | null}>>;
}

export function planInitialDom(plan: Extract<InitialRenderPlan,{kind:'bindings'}>, factories: Record<string,InitialDomRoot>={}, top=true): InitialDomRoot | null {
  const elements: Record<string,InitialDomElement>={};
  const components: Record<string,InitialDomRoot['components'][string]>={};
  const conditions: Record<string,InitialDomRoot['conditions'][string]>={};
  const lists: Record<string,InitialDomRoot['lists'][string]>={};
  let valid=true;
  function visit(nodes: readonly InitialRenderNode[],parent: readonly number[], start=0): void {
    let index=start;
    nodes.forEach(node=>{
      const current=index++;
      if (node.kind==='component') {
        const host=node.children[0];
        if (components[node.site] || node.children.length!==1 || host?.kind!=='element' || !host.site) {valid=false;return;}
        if (node.static) {
          components[node.site]={path:[...parent,current],tag:host.tag,moduleId:node.moduleId,component:node.component,static:true};
          return;
        }
        const nested=planInitialDom({...plan,nodes:node.children,rootLocal:node.component,returnSite:host.site},factories,false);
        if (!nested) {valid=false;return;}
        const key=`${node.moduleId}#${node.component}`;
        const child={...relativeInitialDom(nested),
          ...(plan.creationComponents?.includes(key)?{retainCreation:true as const}:{})};
        const merged=factories[key]?mergeInitialDom(factories[key]!,child):child;
        if (!merged) {valid=false;return;}
        factories[key]=merged;
        components[node.site]={path:[...parent,current],tag:host.tag,moduleId:node.moduleId,component:node.component};
        return;
      }
      if (node.kind === 'list') {
        if (lists[node.site]) {valid=false;return;}
        if (node.requestRow && (nodes.length!==1 || parent.length===0)) {valid=false;return;}
        if (!node.requestRow && !node.rows.length) {
          lists[node.site]={open:[...parent,current],end:[...parent,current+1],count:0,row:null};
          index++;
          return;
        }
        const first=node.requestRow ?? node.rows[0];
        if (!first || first.length!==1 || first[0]?.kind!=='element' || !first[0].site) {valid=false;return;}
        const containerRow=planInitialDom({...plan,nodes:first,returnSite:first[0].site},factories,false);
        if (!containerRow) {valid=false;return;}
        const row=relativeInitialDom(containerRow);
        lists[node.site]={open:[...parent,current],end:node.requestRow?'last-child':[...parent,current+node.rows.length+1],
          count:node.requestRow?null:node.rows.length,row};
        index += node.rows.length+1;
        return;
      }
      if (node.kind === 'conditional') {
        if (conditions[node.site]) {valid=false;return;}
        const children=node.children;
        if (children.length > 1 || children.length === 1 && !['element','component'].includes(children[0]!.kind)) {valid=false;return;}
        if (node.branch === null) {
          const branches = node.alternatives?.map(nodes => {
            const host=nodes[0];
            if (nodes.length!==1 || host?.kind!=='element' || !host.site) return null;
            const nested=planInitialDom({...plan,nodes,returnSite:host.site},factories,false);
            return nested ? relativeInitialDom(nested) : null;
          });
          if (!branches?.length || branches.some(branch=>branch===null)) {valid=false;return;}
          conditions[node.site]={branch:null,open:[...parent,current],end:[...parent,current+2],
            returnSite:null,branches:branches as InitialDomRoot[]};
          index+=2;
          return;
        }
        conditions[node.site]={branch:node.branch,open:[...parent,current],end:[...parent,current+children.length+1],
          returnSite:children[0] && 'site' in children[0] ? children[0].site ?? null : null};
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
  return valid ? {target:plan.target,component:plan.rootLocal,returnSite:plan.returnSite,elements,components,conditions,lists,
    ...(top?{factories}: {})} : null;
}

function relativeInitialDom(root:InitialDomRoot):InitialDomRoot {
  return {...root,elements:Object.fromEntries(Object.entries(root.elements).map(([site,element])=>
    [site,{...element,path:element.path.slice(1),texts:element.texts.map(text=>({...text,path:text.path.slice(1)}))}])),
    components:Object.fromEntries(Object.entries(root.components).map(([site,component])=>[site,{...component,path:component.path.slice(1)}])),
    conditions:Object.fromEntries(Object.entries(root.conditions).map(([site,condition])=>[site,{...condition,open:condition.open.slice(1),end:condition.end.slice(1)}])),
    lists:Object.fromEntries(Object.entries(root.lists).map(([site,list])=>[site,{...list,open:list.open.slice(1),
      end:list.end==='last-child'?list.end:list.end.slice(1)}]))};
}

/** Repeated factories share shape, but every potentially live slot stays live. */
function mergeInitialDom(left:InitialDomRoot,right:InitialDomRoot):InitialDomRoot|null {
  const shape=(root:InitialDomRoot)=>JSON.stringify(root,(key,value)=>['live','empty','staticAttributes','factories'].includes(key)?undefined:value);
  if (shape(left)!==shape(right))return null;
  return {...left,elements:Object.fromEntries(Object.entries(left.elements).map(([site,element])=>{
    const other=right.elements[site]!;
    return [site,{...element,staticAttributes:element.staticAttributes.filter(site=>other.staticAttributes.includes(site)),
      texts:element.texts.map((text,index)=>({...text,live:text.live||other.texts[index]!.live,empty:text.empty||other.texts[index]!.empty}))}];
  })),conditions:Object.fromEntries(Object.entries(left.conditions).map(([site,condition])=>[site,{
    ...condition,...(condition.branches ? {branches:condition.branches.map((branch,index)=>
      mergeInitialDom(branch,right.conditions[site]!.branches![index]!)!)} : {}),
  }])),lists:Object.fromEntries(Object.entries(left.lists).map(([site,list])=>[site,{...list,row:list.row?mergeInitialDom(list.row,right.lists[site]!.row!)!:null}]))};
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

/** Server placement emits the same source anchors that the browser validates. */
export function initialServerAnchor(ctx:Ctx,scope:EmitScope,parent:string,kind:'when'|'list',site:string,closing:boolean):t.Statement {
  return astFactory.expressionStatement(astFactory.callExpression(
    astFactory.memberExpression(astFactory.identifier(parent),astFactory.identifier('appendChild')),
    [astFactory.callExpression(astFactory.memberExpression(renderDocument(ctx,scope),astFactory.identifier('createComment')),
      [astFactory.stringLiteral(closing?`/mmd:initial:${kind}`:`mmd:initial:${kind}:${site}`)])],
  ));
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
