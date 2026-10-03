import {expect, it} from 'vitest';
import {cloneNode, parseEstreeOrThrow, printEstree, walkAst} from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import {createCtx, type MapCallExpression, type StateKind} from '../packages/compiler/src/context';
import {matchMapCall, allocateMapSite} from '../packages/compiler/src/lists/map-site';
import {planListCallback} from '../packages/compiler/src/lists/callback-plan';
import {planListSite, type ListSiteInputs} from '../packages/compiler/src/lists/site-plan';
import {captureListSiteInputs, planComponentListSites} from '../packages/compiler/src/planning/list-sites';
import {captureRenderCallbackProps} from '../packages/compiler/src/components/render-callbacks';
import {analyzeComponentProps} from '../packages/compiler/src/components/props';
import {prepareProgramAnalysis} from '../packages/compiler/src/analysis/prepare';

function parse(source: string): t.Program {
  return parseEstreeOrThrow(source,{filename:'./list-plan.tsx'}).program as unknown as t.Program;
}
function expression(source: string): t.Expression {
  return (parse(`const value=(${source});`).body[0] as t.VariableDeclaration).declarations[0]!.init!;
}
function call(source: string): MapCallExpression {return matchMapCall(expression(source))!;}
const fail=(message:string):never=>{throw new Error(message);};
function inputs(): ListSiteInputs {
  return {localRoots:new Set(['owned','props']), state:new Map<string,StateKind>([['items','let'],['store','store']]),
    staticDerived:new Map(), components:new Set(['Row']),
    callbackProps:{objectBinding:null,bindingProps:new Map()},dataRuntimeId:'_Data'};
}
function component(source: string) {
  const program=parse(source), ctx=createCtx();
  prepareProgramAnalysis(ctx,{node:program,buildCodeFrameError:message=>new Error(message)});
  return {program,ctx};
}
function firstMap(node:t.Node):MapCallExpression {
  let result:MapCallExpression|undefined;
  walkAst(node,{enter(current){const map=matchMapCall(current);if(map!==null&&result===undefined)result=map;}});
  return result!;
}

it('plans source, target and keys without mutating callbacks or allocating occurrence identities',()=>{
  const map=call('owned.map((item,index)=>{const label=item.text+index;return <Row key={item.id} text={label}/>;})');
  const before=JSON.stringify(map), plan=planListSite(inputs(),map,fail);
  expect(JSON.stringify(map)).toBe(before);
  expect(plan).toMatchObject({sourceKey:'owned',sourceLocal:true,form:'component',rowComp:'Row',indexParam:'index'});
  expect(plan.normalizedBody).not.toBeNull(); expect(printEstree(plan.jsx!).code).toContain('item.text + index');
  expect(plan).not.toHaveProperty('prefix'); expect(plan).not.toHaveProperty('owner');
  expect(plan).not.toHaveProperty('suffix');
  const used=new Map<string,number>();
  const first=allocateMapSite(map,plan,'View',used), second=allocateMapSite(map,plan,'View',used);
  expect(first.prefix).toBe('View/owned');expect(second.prefix).toBe('View/owned1');
  expect((map.arguments[0] as t.ArrowFunctionExpression).body).toBe(plan.normalizedBody);
});

it.each([
  ['items.map(item=><li/>)','items',false,false],
  ['owned.map(item=><li/>)','owned',true,false],
  ['store.items?.map(item=><li/>)','store.items',false,true],
  ['props.items?.map(item=><li/>)','props.items',true,true],
  ['[1,2].map(item=><li/>)','$static-list',true,false],
] as const)('preserves source ownership and optionality: %s',(source,key,local,optional)=>{
  expect(planListSite(inputs(),call(source),fail)).toMatchObject({sourceKey:key,sourceLocal:local,optional});
});

it('requires explicit enclosing-row ownership for nested member lists',()=>{
  const map=call('item.children.map(child=><li key={child.id}/>)');
  expect(()=>planListSite(inputs(),map,fail)).toThrow(/list member views/);
  for(const local of [false,true]) {
    const plan=planListSite(inputs(),cloneNode(map),fail,{itemParam:'item',sourceKey:'parent.items',sourceLocal:local});
    expect(plan).toMatchObject({sourceKey:'parent.items',sourceLocal:local,suffixBase:'children'});
  }
  expect(()=>planListSite(inputs(),map,fail,{itemParam:'other',sourceKey:'items',sourceLocal:true})).toThrow(/list member views/);
});

it('keeps spread key getter evaluation deferred, ordered and last-wins',()=>{
  const map=call('items.map(item=><li {...first} key={item.id} {...last}/>)');
  const before=JSON.stringify(map), plan=planListSite(inputs(),map,fail), reads:string[]=[];
  expect(JSON.stringify(map)).toBe(before);expect(plan.keyFromSpread).toBe(true);
  const evaluate=new Function('item','first','last',`return ${printEstree(plan.keyExpr!).code};`);
  const first={get key(){reads.push('first');return 1;}}, last={get key(){reads.push('last');return 3;}};
  const item={get id(){reads.push('explicit');return 2;}};
  expect(reads).toEqual([]);expect(evaluate(item,first,last)).toBe(3);
  expect(reads).toEqual(['first','explicit','last']);
  expect(evaluate(item,first,{key:null})).toBeNull();
  const direct=planListSite(inputs(),call('items.map(item=><li key={item.id}/>)'),fail);
  expect(direct.keyFromSpread).toBe(false);expect(printEstree(direct.keyExpr!).code).toBe('item.id');
});

it('captures aliased and generic callback props while preserving direct item/index validation',()=>{
  for(const [parameter,target] of [['{renderItem: draw}','draw'],['props','props.renderItem']] as const) {
    const declaration=parse(`function View(${parameter}){}`).body[0] as t.FunctionDeclaration;
    const env={...inputs(),callbackProps:captureRenderCallbackProps(analyzeComponentProps(declaration.params))};
    const map=call(`items.map((item,index)=>${target}(item,index))`);
    const plan=planListSite(env,map,fail);
    expect(plan.form).toBe('callback');expect(printEstree(plan.renderCallback!).code).toBe(target);
    expect(()=>planListSite(env,call(`items.map((item,index)=>${target}(item.text,index))`),fail)).toThrow(/bindings directly/);
  }
  expect(()=>planListSite(inputs(),call('items.map(item=><Unknown/>)'),fail)).toThrow(/not a linked component/);
});

it('preserves unresolved async source gating and uses current lowered expressions',()=>{
  const map=call('_Data.readResolvedValueForRender(resource).map(item=><li/>)');
  const plan=planListSite(inputs(),map,fail);
  expect(plan.sourceKey).toBe('resource');expect(printEstree(plan.sourceExpr).code).toContain('|| []');
  const imperative=planListSite(inputs(),call('_Data.readResolvedValue(resource).map(item=><li/>)'),fail);
  expect(printEstree(imperative.sourceExpr).code).not.toContain('|| []');
});

it('copies analyzed identities and semantic facts without granting a clone the original source proof',()=>{
  const {ctx,program}=component(`let items=[];function Row({item}){return <li>{item.text}</li>;}
    function View(){let owned=[];return <ul>{owned.map(item=><Row item={item} key={item.id}/>)}</ul>;}`);
  const map=firstMap(ctx.compPaths.get('View')!.node), plans=planComponentListSites(ctx).get('View')!;
  const callback=planListCallback(map,fail), before=JSON.stringify(program), header=[...ctx.header];
  expect(plans.listFor(map,callback)).toMatchObject({sourceKey:'owned',sourceLocal:true,form:'component'});
  expect(JSON.stringify(program)).toBe(before);expect(ctx.header).toEqual(header);
  ctx.instanceState.clear();ctx.instanceDerivedBindings.clear();ctx.componentProps.clear();ctx.opaqueBindings.clear();
  ctx.state.clear();ctx.comps.clear();ctx.importedComponents.clear();ctx.analyzedListSources=new WeakMap();
  (map.callee as t.MemberExpression).object=expression('available ? resolved : []');
  const plan=plans.listFor(map,callback);
  expect(plan).toMatchObject({sourceKey:'owned',sourceLocal:true,form:'component',rowComp:'Row'});
  expect(printEstree(plan.sourceExpr).code).toContain('available ? resolved : []');
  const cloned=cloneNode(map);
  expect(()=>plans.listFor(cloned,planListCallback(cloned,fail))).toThrow(/assign an ordered collection view/);
});

it('snapshots static-derived initializers independently of later factory mutation',()=>{
  const {ctx}=component('function View(){const frozen=[1,2].filter(value=>value>0);return <ul>{frozen.map(value=><li>{value}</li>)}</ul>;}');
  const env=captureListSiteInputs(ctx,'View'), map=call('frozen.map(value=><li>{value}</li>)');
  const init=env.staticDerived.get('frozen')!;
  expect(printEstree(init).code).toContain('.filter');
  ctx.compPaths.clear();ctx.astAnalysis=null;
  expect(planListSite(env,map,fail)).toMatchObject({sourceKey:'$static-list',sourceLocal:true});
});
