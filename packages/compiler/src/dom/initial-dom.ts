/** DOM binding addresses derived from parser-safe initial content. */
import type { InitialRenderNode, InitialRenderPlan } from '../planning/initial-content';
import type { EmitScope } from './scope';
import { renderDocument } from './scope';
import type { DomContext as Ctx } from './context';
import * as astFactory from '../ast/factory';
import type * as t from '../ast/compiler-types';
import { nodeHasJsx } from '../context/ast';
import { initialSite, initialSlotMountKey } from '../planning/initial-content';
import { initialNodeExtent } from './render-plan';
import type { BaseNode } from '../ast';
import { md } from './identifiers';

/** Resolve a structural site through lexical slots and nested region plans. */
export function initialStructuralPlacement(plan:InitialDomRoot|null|undefined,site:string):InitialDomRoot|undefined {
  if (!plan) return undefined;
  if (plan.conditions[site]!==undefined || plan.lists[site]!==undefined) return plan;
  const nested=[...Object.values(plan.slots??{}).map(slot=>slot.plan),
    ...Object.values(plan.lists).flatMap(list=>list.row?[list.row]:[]),
    ...Object.values(plan.conditions).flatMap(condition=>condition.branches??[])];
  for (const child of nested) {
    const placement=initialStructuralPlacement(child,site);
    if (placement) return placement;
  }
  return undefined;
}

/** DOM read lowering preserves every region with a proved source placement. */
export function initialReadPlacement(ctx:Ctx,component:string,expression:BaseNode):{scalar:boolean;structural:boolean} {
  const plan=ctx.initialDomRoot?.component===component ? ctx.initialDomRoot :
    ctx.initialDomComponents[component] ?? ctx.initialServerComponents[component];
  const site=initialSite(expression);
  return {scalar:plan!=null&&!nodeHasJsx(expression as unknown as t.Node),
    structural:initialStructuralPlacement(plan,site)!==undefined};
}

/** Anchor offsets address siblings independently of a region's rendered width. */
export type InitialDomStep = number | readonly [anchor:string, offset:number, end?:true];
export type InitialDomPath = readonly InitialDomStep[];
function advance(step:InitialDomStep,offset:number):InitialDomStep {
  return typeof step==='number' ? step+offset : step[2] ? [step[0],step[1]+offset,true] : [step[0],step[1]+offset];
}
export interface InitialDomElement {
  readonly path: InitialDomPath;
  readonly texts: readonly {readonly path: InitialDomPath; readonly live: boolean; readonly empty: boolean}[];
  readonly staticAttributes: readonly string[];
  readonly inputValueSite?: string;
}
export interface InitialDomRoot {
  readonly target: string;
  readonly component: string;
  readonly returnSite: string;
  readonly retainCreation?: true;
  /** End-relative or anchor-relative binding addresses are present. */
  readonly pathMode?: 'end'|'anchor';
  readonly elements: Readonly<Record<string,InitialDomElement>>;
  readonly texts?: InitialDomElement['texts'];
  readonly slots?: Readonly<Record<string, InitialDomSlot>>;
  readonly components: Readonly<Record<string,{readonly path:InitialDomPath;readonly tag:string;readonly moduleId:string;readonly component:string;readonly static?:boolean}>>;
  readonly factories?: Readonly<Record<string,InitialDomRoot>>;
  readonly conditions: Readonly<Record<string, {readonly branch: number | null; readonly open: InitialDomPath;
    readonly end: InitialDomPath; readonly returnSite: string | null; readonly branches?: readonly (InitialDomRoot|null)[]}>>;
  readonly lists: Readonly<Record<string, {readonly open: InitialDomPath; readonly end: InitialDomPath | 'last-child';
    readonly count: number | null; readonly row: InitialDomRoot | null}>>;
}

/** A lexical slot reuses the same binding program at each authored mount site. */
export interface InitialDomSlot {
  readonly plan: InitialDomRoot;
  readonly static?: true;
  readonly offset: number;
  readonly mounts: Readonly<Record<string, number>>;
}
type SlotOwners = Record<string, Record<string, InitialDomSlot>>;

export function planInitialDom(plan: Extract<InitialRenderPlan,{kind:'bindings'}>, factories: Record<string,InitialDomRoot>={}, top=true,
  slotOwners: SlotOwners = {}, start = 0): InitialDomRoot | null {
  const elements: Record<string,InitialDomElement>={};
  const components: Record<string,InitialDomRoot['components'][string]>={};
  const conditions: Record<string,InitialDomRoot['conditions'][string]>={};
  const lists: Record<string,InitialDomRoot['lists'][string]>={};
  let valid=true;
  let pathMode:InitialDomRoot['pathMode']=start<0?'end':undefined;
  const width = initialNodeExtent;
  const variableExtent=(node:InitialRenderNode)=>node.kind==='list' && node.requestRow!==undefined ||
    node.kind==='conditional' && node.branch===null && new Set(node.alternatives?.map(branch=>branch.length)).size>1;
  function positions(nodes:readonly InitialRenderNode[],start:number):InitialDomStep[] {
    if(nodes.some(node=>node.kind==='slot' && node.children.some(variableExtent))){valid=false;return [];}
    const variable=nodes.flatMap((node,index)=>variableExtent(node)?[index]:[]);
    const anchored=variable.length>1 || variable.some(index=>nodes[index]!.kind==='conditional');
    if(anchored)pathMode='anchor';
    let index:InitialDomStep=start;
    return nodes.map((node,offset)=>{
      const marker=node.kind==='list'||node.kind==='conditional' ? `mmd:initial:${node.kind==='list'?'list':'when'}:${node.site}` : '';
      const current=anchored && variableExtent(node) ? [marker,0] as const : index;
      if(anchored && variableExtent(node)) {
        index=[marker,1,true];
      } else if(offset===variable[0]) {
        const suffix=nodes.slice(offset+1).reduce((size,node)=>size+width(node),0);
        index=-suffix;
        if(suffix>0 && !pathMode)pathMode='end';
      } else index=advance(index,width(node));
      return current;
    });
  }
  function visit(nodes: readonly InitialRenderNode[],parent: InitialDomPath, start=0): void {
    const addresses=positions(nodes,start);
    if(!valid)return;
    nodes.forEach((node,offset)=>{
      const current=addresses[offset]!;
      if (node.kind === 'slot') {
        if (!node.mount?.site || typeof current!=='number') {valid=false;return;}
        const slotPlan=planInitialDom({...plan, nodes:node.children, rootLocal:node.component,
          rootModuleId:node.moduleId, returnSite:''}, factories, false, slotOwners, current);
        const nested=slotPlan && {...slotPlan,...(node.creation?{retainCreation:true as const}:{})};
        if (!nested) {valid=false;return;}
        const owner=`${node.moduleId}#${node.component}`;
        const slots=slotOwners[owner] ??= {};
        const mount=initialSlotMountKey(node.mount.moduleId,node.mount.component,node.mount.site);
        const previous=slots[node.site];
        const merged=previous ? mergeInitialDom(previous.plan,shiftInitialDom(nested,previous.offset-current)) : nested;
        if (!merged || previous?.mounts[mount] !== undefined && previous.mounts[mount] !== current) {valid=false;return;}
        slots[node.site]={plan:merged,offset:previous?.offset??current,mounts:{...previous?.mounts,[mount]:current},
          ...(node.static && (!previous || previous.static) ? {static:true as const} : {})};
        return;
      }
      if (node.kind==='component') {
        const host=node.children[0];
        if (components[node.site] || node.children.length!==1 || host?.kind!=='element' || !host.site) {valid=false;return;}
        if (node.static) {
          components[node.site]={path:[...parent,current],tag:host.tag,moduleId:node.moduleId,component:node.component,static:true};
          return;
        }
        const nested=planInitialDom({...plan,nodes:node.children,rootLocal:node.component,rootModuleId:node.moduleId,returnSite:host.site},factories,false,slotOwners);
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
        if (node.requestRow && parent.length===0) {valid=false;return;}
        if (!node.requestRow && !node.rows.length) {
          lists[node.site]={open:[...parent,current],end:[...parent,advance(current,1)],count:0,row:null};
          return;
        }
        const first=node.requestRow ?? node.rows[0];
        if (!first || first.length!==1 || !['element','component'].includes(first[0]!.kind) || !('site' in first[0]!) || !first[0].site) {valid=false;return;}
        const containerRow=planInitialDom({...plan,nodes:first,returnSite:first[0].site},factories,false,slotOwners);
        if (!containerRow) {valid=false;return;}
        let row=relativeInitialDom(containerRow);
        // Every closed initial row must agree on binding shape. Live/empty
        // scalar bindings merge, but incompatible extents never use row zero.
        if(!node.requestRow) for(const other of node.rows.slice(1)) {
          const next=planInitialDom({...plan,nodes:other,returnSite:other[0] && 'site' in other[0] ? other[0].site! : ''},factories,false,slotOwners);
          const merged=next && mergeInitialDom(row,relativeInitialDom(next));
          if(!merged){valid=false;return;}
          row=merged;
        }
        const suffix=nodes.slice(offset+1).reduce((size,node)=>size+width(node),0);
        lists[node.site]={open:[...parent,current],end:typeof current!=='number' ? [...parent,[`mmd:initial:list:${node.site}`,0,true]] :
          node.requestRow?(suffix===0?'last-child':[...parent,-suffix-1]):[...parent,advance(current,node.rows.length+1)],
          count:node.requestRow?null:node.rows.length,row};
        return;
      }
      if (node.kind === 'conditional') {
        if (conditions[node.site]) {valid=false;return;}
        const children=node.children;
        if (children.length > 1 || children.length === 1 && !['element','component'].includes(children[0]!.kind)) {valid=false;return;}
        if (node.branch === null) {
          const branches = node.alternatives?.map(nodes => {
            if(!nodes.length)return null;
            const host=nodes[0];
            if (nodes.length!==1 || !host || !['element','component'].includes(host.kind) || !('site' in host) || !host.site) {valid=false;return null;}
            const nested=planInitialDom({...plan,nodes,returnSite:host.site},factories,false,slotOwners);
            return nested ? relativeInitialDom(nested) : null;
          });
          if (!branches?.length || branches.some((branch,index)=>branch===null && node.alternatives![index]!.length>0)) {valid=false;return;}
          conditions[node.site]={branch:null,open:[...parent,current],end:variableExtent(node)
            ? [...parent,[`mmd:initial:when:${node.site}`,0,true]] : [...parent,advance(current,2)],
            returnSite:null,branches};
          return;
        }
        conditions[node.site]={branch:node.branch,open:[...parent,current],end:[...parent,advance(current,children.length+1)],
          returnSite:children[0] && 'site' in children[0] ? children[0].site ?? null : null};
        // Closed branches retain absolute placement only before a variable
        // sibling; otherwise give their factory its own host-relative plan.
        if(typeof current!=='number'){
          const host=children[0];
          if(!host){return;}
          const nested=planInitialDom({...plan,nodes:children,returnSite:'site' in host?host.site!:''},factories,false,slotOwners);
          if(!nested){valid=false;return;}
          const branches:Array<InitialDomRoot|null>=Array.from({length:node.branch+1},()=>null);
          branches[node.branch]=relativeInitialDom(nested);
          conditions[node.site]={...conditions[node.site]!,returnSite:null,branches};
          return;
        }
        visit(children,parent,current+1);
        return;
      }
      if (node.kind !== 'element') return;
      if (!node.site || elements[node.site]) {valid=false;return;}
      const path=[...parent,current];
      const childAddresses=positions(node.children,0);
      elements[node.site]={path,
        ...(node.tag==='input' ? {inputValueSite:node.attributes.find(attribute=>attribute.name==='value')?.site} : {}),
        texts:node.children.flatMap((child,offset)=>{
          const current=childAddresses[offset]!;
          return child.kind === 'text' ? [{path:[...path,current],live:child.live!==false,empty:child.value===''}] : [];
        }),
        staticAttributes:node.attributes.flatMap(attribute=>attribute.live===false&&attribute.site ? [attribute.site] : []),
      };
      visit(node.children,path);
    });
  }
  visit(plan.nodes,[],start);
  const rootAddresses=positions(plan.nodes,start);
  const texts=plan.nodes.flatMap((node,index)=>node.kind==='text'
    ? [{path:[rootAddresses[index]!],live:node.live!==false,empty:node.value===''}] : []);
  if (top) for (const [key, factory] of Object.entries(factories)) {
    if (slotOwners[key]) factories[key]={...factory,slots:slotOwners[key]};
  }
  // Row factories need their lexical caller's slot plans too. Slot paths are
  // relative to the callee's mount host, not the row container address.
  const slots=slotOwners[`${plan.rootModuleId}#${plan.rootLocal}`];
  return valid ? {target:plan.target,component:plan.rootLocal,returnSite:plan.returnSite,elements,components,conditions,lists,
    ...(texts.length?{texts}:{}), ...(slots?{slots}:{}),
    ...(pathMode?{pathMode}:{}),
    ...(top?{factories}: {})} : null;
}

/** Relocate a fixed slot extent within its callee-provided host. */
function shiftInitialDom(root:InitialDomRoot, offset:number):InitialDomRoot {
  const shift=(path:InitialDomPath)=>[typeof path[0]==='number'?path[0]+offset:path[0]!,...path.slice(1)];
  return {...root,
    elements:Object.fromEntries(Object.entries(root.elements).map(([site,element])=>[site,{...element,path:shift(element.path),
      texts:element.texts.map(text=>({...text,path:shift(text.path)}))}])),
    components:Object.fromEntries(Object.entries(root.components).map(([site,component])=>[site,{...component,path:shift(component.path)}])),
    conditions:Object.fromEntries(Object.entries(root.conditions).map(([site,condition])=>[site,{...condition,
      open:shift(condition.open),end:shift(condition.end)}])),
    lists:Object.fromEntries(Object.entries(root.lists).map(([site,list])=>[site,{...list,
      open:shift(list.open),end:list.end==='last-child'?list.end:shift(list.end)}])),
    ...(root.texts?{texts:root.texts.map(text=>({...text,path:shift(text.path)}))}:{}),
  };
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
  const shape=(root:InitialDomRoot)=>JSON.stringify(root,(key,value)=>['live','empty','staticAttributes','factories','slots','pathMode'].includes(key)?undefined:value);
  if (shape(left)!==shape(right))return null;
  const pathMode=left.pathMode==='anchor'||right.pathMode==='anchor'?'anchor':left.pathMode??right.pathMode;
  return {...left,...(pathMode?{pathMode}:{}),
    elements:Object.fromEntries(Object.entries(left.elements).map(([site,element])=>{
    const other=right.elements[site]!;
    return [site,{...element,staticAttributes:element.staticAttributes.filter(site=>other.staticAttributes.includes(site)),
      texts:element.texts.map((text,index)=>({...text,live:text.live||other.texts[index]!.live,empty:text.empty||other.texts[index]!.empty}))}];
  })),...(left.texts?{texts:left.texts.map((text,index)=>({...text,live:text.live||right.texts![index]!.live,
    empty:text.empty||right.texts![index]!.empty}))}:{}),conditions:Object.fromEntries(Object.entries(left.conditions).map(([site,condition])=>[site,{
    ...condition,...(condition.branches ? {branches:condition.branches.map((branch,index)=>
      branch ? mergeInitialDom(branch,right.conditions[site]!.branches![index]!)! : null)} : {}),
  }])),lists:Object.fromEntries(Object.entries(left.lists).map(([site,list])=>[site,{...list,row:list.row?mergeInitialDom(list.row,right.lists[site]!.row!)!:null}]))};
}

/** Only nodes used by future browser work get a binding descriptor. */
export function initialNode(scope: EmitScope,path: InitialDomPath,kind: string) {
  const initial=scope.initialDom!;
  const index=initial.descriptors.length;
  initial.descriptors.push(astFactory.arrayExpression([
    astFactory.arrayExpression(path.map((index,depth)=>typeof index!=='number'
      ? astFactory.arrayExpression([astFactory.stringLiteral(index[0]),astFactory.numericLiteral(index[1]),...(index[2]?[astFactory.booleanLiteral(true)]:[])])
      : depth===0 && initial.offset ? astFactory.binaryExpression('+',initial.offset,astFactory.numericLiteral(index)) : astFactory.numericLiteral(index))),astFactory.stringLiteral(kind),
  ]));
  return astFactory.memberExpression(astFactory.identifier(initial.variable),astFactory.numericLiteral(index),true);
}

/** One binding declaration shared by component and lexical slot emission. */
export function initialBindingHelper(plan:InitialDomRoot):string {
  return plan.pathMode==='anchor'?'bindInitialRegionNodes':plan.pathMode==='end'?'bindInitialListNodes':'bindInitialNodes';
}
export function initialBindingsDeclaration(ctx:Ctx,scope:EmitScope,target:t.Expression):t.VariableDeclaration {
  const initial=scope.initialDom!;
  const call=astFactory.callExpression(md(ctx,initialBindingHelper(initial.plan)),
    [target,astFactory.arrayExpression(initial.descriptors)]);
  return astFactory.variableDeclaration('const',[astFactory.variableDeclarator(astFactory.identifier(initial.variable),
    initial.adopting?astFactory.conditionalExpression(initial.adopting,call,astFactory.arrayExpression([])):call)]);
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
