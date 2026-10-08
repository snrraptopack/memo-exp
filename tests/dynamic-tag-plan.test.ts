import { expect, it } from 'bun:test';
import {parseEstreeOrThrow,printEstree,findNode,type BaseNode} from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import {createAnalysisCtx,refreshAstAnalysis,type LinkedDynamicComponentCandidate} from '../packages/compiler/src/context';
import {scanComponents} from '../packages/compiler/src/analysis/module-scan';
import {recordLinkedDynamicComponentBindings} from '../packages/compiler/src/analysis/dynamic-imports';
import {planDynamicTags,recordDynamicTagPropModes} from '../packages/compiler/src/planning/dynamic-tags';
import {createCtx} from '../packages/compiler/src/dom/context';
import {initializeGeneratedIdentifiers} from '../packages/compiler/src/dom/identifiers';
import {lowerDynamicTags,lowerLinkedDynamicComponentImports} from '../packages/compiler/src/dom/dynamic-tags';

function fixture(source:string) {
  const program=parseEstreeOrThrow(source).program;
  const context=createAnalysisCtx();
  const path={node:program as unknown as t.Program,buildCodeFrameError:(message:string)=>new Error(message)};
  refreshAstAnalysis(context,path.node);scanComponents(context,path);
  return {program,context,path};
}
const nested=`function Summary(){return <p>summary</p>;}function Details(){return <p>details</p>;}
  export function App(){let compact=true,detailed=false;const Host=compact?'section':'article';
    const View=detailed?Details:Summary;return <Host><View/></Host>;}`;

it('captures child-before-parent sites and finite candidates without backend state or mutation',()=>{
  const value=fixture(nested),before=JSON.stringify(value.program);
  const plan=planDynamicTags(value.context);
  const sites=plan.components.find(component=>component.path===value.context.compPaths.get('App'))!.sites;
  expect(sites.map(site=>site.kind==='selection' && printEstree(site.selector as unknown as BaseNode).code)).toEqual(['View','Host']);
  expect(sites.map(site=>site.kind==='selection' && site.candidates.map(candidate=>[candidate.kind,candidate.name])))
    .toEqual([[['component','Details'],['component','Summary']],[['intrinsic','section'],['intrinsic','article']]]);
  expect(Object.isFrozen(plan)).toBe(true);expect(Object.isFrozen(sites)).toBe(true);
  expect(JSON.stringify(value.program)).toBe(before);expect(value.context).not.toHaveProperty('emission');
});

it('lowers captured candidates after discovery inputs change and preserves nested alternatives',()=>{
  const value=fixture(nested),plan=planDynamicTags(value.context);
  const backend=Object.assign(createCtx(),value.context);
  initializeGeneratedIdentifiers(backend,value.program);
  // Lowering consumes the proof; it must not try to infer the candidates again.
  for(const component of plan.components)for(const site of component.sites) {
    if(site.kind!=='selection')continue;
    const declaration=findNode(component.path.node as unknown as BaseNode,node=>node.type==='VariableDeclarator' &&
      (node as unknown as t.VariableDeclarator).id.type==='Identifier' &&
      ((node as unknown as t.VariableDeclarator).id as t.Identifier).name===(site.selector as t.Identifier).name)!;
    (declaration as unknown as t.VariableDeclarator).init=null;
  }
  lowerDynamicTags(backend,plan);
  const output=printEstree(value.program).code;
  expect(output).toContain('<section>');expect(output).toContain('<article>');
  expect(output).toContain('<Details />');expect(output).toContain('<Summary />');
  expect(output).not.toContain('<Host');expect(output).not.toContain('<View');
  expect(backend.emission.header).toHaveLength(1);
});

it('keeps scalar/render prop classification explicit and detects conflicting authored usage',()=>{
  const value=fixture(`function Panel({content}){return <article>{content}</article>;}
    export function App(){const View=Panel;return <View content="text"/>;}`);
  value.context.componentProps.get('Panel')!.renderProps=['content'];
  const before=JSON.stringify(value.program),plan=planDynamicTags(value.context);
  expect(plan.propModes).toEqual([{component:'Panel',renderProps:[]}]);
  expect(value.context.componentProps.get('Panel')!.renderProps).toEqual(['content']);
  expect(JSON.stringify(value.program)).toBe(before);
  recordDynamicTagPropModes(value.context,plan.propModes);
  expect(value.context.componentProps.get('Panel')!.renderProps).toEqual([]);
  const conflict=fixture(`function Panel({content}){return <article>{content}</article>;}
    export function App(){const View=Panel;return <main><View content="text"/><View content={<b>jsx</b>}/></main>;}`);
  conflict.context.componentProps.get('Panel')!.renderProps=['content'];
  expect(()=>planDynamicTags(conflict.context)).toThrow('both scalar data and JSX content');
});

it('leaves native tag validation to DOM lowering',()=>{
  const value=fixture('export function App(){const Host="bad tag";return <Host/>;}');
  const plan=planDynamicTags(value.context),backend=Object.assign(createCtx(),value.context);
  initializeGeneratedIdentifiers(backend,value.program);
  expect(()=>lowerDynamicTags(backend,plan)).toThrow('not a valid dynamic intrinsic tag name');
  expect(backend.emission.header).toEqual([]);
});

it('publishes collision-safe linked imports through an explicit source contract',()=>{
  const program=parseEstreeOrThrow('const MDDynamic_Panel=1;').program;
  const context=createAnalysisCtx();context.state.set('View','let');
  const candidate:LinkedDynamicComponentCandidate={key:'./Panel.tsx#Panel',source:'./Panel',imported:'Panel',
    props:['content'],objectProps:true,acceptsUnknownProps:false,hasWholeDefault:false,listLightweight:false,renderProps:['content']};
  context.linkedDynamicComponentCandidates.set('View',[candidate,candidate]);
  context.linkedDynamicComponentCandidates.set('choose',[candidate]);
  const result=lowerLinkedDynamicComponentImports(context,{node:program as unknown as t.Program});
  expect(result.imports).toHaveLength(1);
  expect([...result.components.keys()]).toEqual(['MDDynamic_Panel1']);
  expect([...result.owners]).toEqual([['View',['MDDynamic_Panel1']],['choose',['MDDynamic_Panel1']]]);
  expect(context.importedComponents.size).toBe(0);expect(context.stateComponentCandidates.size).toBe(0);
  recordLinkedDynamicComponentBindings(context,result);
  expect(context.importedComponents.get('MDDynamic_Panel1')?.key).toBe(candidate.key);
  expect(context.componentProps.get('MDDynamic_Panel1')?.renderProps).toEqual(['content']);
  expect(context.stateComponentCandidates.get('View')).toEqual(['MDDynamic_Panel1']);
  expect(context.functionComponentCandidates.get('choose')).toEqual(['MDDynamic_Panel1']);
});
