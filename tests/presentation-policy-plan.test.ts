import {expect,it} from 'vitest';
import {analyzeScope,findNode,parseEstreeOrThrow,printEstree,type BaseNode} from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import {planGroupPresentations,planPresentationCaptures,planPresentationComponent} from '../packages/compiler/src/planning/presentation-policy';
import {createCtx} from '../packages/compiler/src/context';
import {initializeGeneratedIdentifiers} from '../packages/compiler/src/identifiers';
import {emitPresentationComponent} from '../packages/compiler/src/features/data-sources/group-policy-components';
import {lowerTransparentGroups} from '../packages/compiler/src/features/data-sources/group-lowering';

const errorAt={buildCodeFrameError:(message:string)=>new Error(message)};
function fixture(callback:string,kind:'pending'|'error'='pending') {
  const program=parseEstreeOrThrow(`const external='module';function App(){let title='owner';const label='waiting';return <Group ${kind}={${callback}}/>;}`).program;
  const boundary=findNode(program,node=>node.type==='JSXElement')!;
  const expression=((boundary as unknown as t.JSXElement).openingElement.attributes[0] as t.JSXAttribute).value as t.JSXExpressionContainer;
  const analysis=analyzeScope(program);
  return {program,boundary,expression:expression.expression,analysis,plan:()=>planPresentationComponent(analysis,boundary,expression.expression,kind,errorAt)};
}

it('captures owner bindings once without target state or modifying authored code',()=>{
  const value=fixture('()=> <p>{title}{label}{title}{external}</p>');
  const before=JSON.stringify(value.program);const plan=value.plan();
  expect(plan.kind).toBe('inline');if(plan.kind!=='inline')throw new Error('Expected callback');
  expect(plan.captures.map(capture=>capture.name)).toEqual(['title','label']);
  expect(plan.captures[0]!.binding).toBe(value.analysis.nodeToScope.get(value.boundary)!.getBinding('title'));
  expect(JSON.stringify(value.program)).toBe(before);
  expect(Object.isFrozen(plan)).toBe(true);expect(Object.isFrozen(plan.captures)).toBe(true);
});

it('keeps callback-local bindings out of owner captures',()=>{
  const plan=fixture("()=>{const title='inside';return <p>{title}{label}</p>;}").plan();
  expect(plan.kind==='inline' && plan.captures.map(capture=>capture.name)).toEqual(['label']);
});

it('preserves error/retry aliases and their source locations separately from captures',()=>{
  const plan=fixture('({error:reason,retry:again})=> <button onClick={again}>{reason.message}{title}</button>','error').plan();
  if(plan.kind!=='inline')throw new Error('Expected callback');
  expect(plan.errorLocal).toMatchObject({name:'reason'});expect(plan.retryLocal).toMatchObject({name:'again'});
  expect(plan.errorLocal?.loc).toBeDefined();
  expect(plan.captures.map(capture=>capture.name)).toEqual(['title']);
});

it.each([
  ['pending','async()=> <p/>','synchronous'],
  ['pending','function*(){return <p/>;}','synchronous'],
  ['pending','(props)=> <p/>','do not receive props'],
  ['error','error=> <p/>','destructured'],
  ['error','(props,other)=> <p/>','at most one'],
  ['error','choose()','component identifier'],
] as const)('validates %s callback %s before any backend allocation', (kind,expression,error)=>{
  expect(()=>fixture(expression,kind).plan()).toThrow(error);
});

it('keeps a named policy as a semantic component reference',()=>{
  expect(fixture('Pending').plan()).toEqual({kind:'named',name:'Pending'});
});

it('shares lexical capture facts with TSRX while excluding handler parameters',()=>{
  const value=fixture('()=> <p>{title}{label}</p>');
  const output=findNode(value.program,node=>node.type==='JSXElement' && (node as unknown as t.JSXElement).openingElement.name.type==='JSXIdentifier' && ((node as unknown as t.JSXElement).openingElement.name as t.JSXIdentifier).name==='p')!;
  const captures=planPresentationCaptures(value.analysis,value.boundary,output,new Set(['label']));
  expect(captures.map(capture=>capture.name)).toEqual(['title']);
});

it('lowers the captured body and aliases without reconsulting mutated source or scope',()=>{
  const value=fixture('({error:reason,retry:again})=> <button onClick={again}>{title}</button>','error');
  const plan=value.plan();if(plan.kind!=='inline')throw new Error('Expected callback');
  const ctx=createCtx();initializeGeneratedIdentifiers(ctx,value.program);
  // The backend consumes an owned callback body and captured names, not this tree.
  (value.expression as t.ArrowFunctionExpression).body=({type:'StringLiteral',value:'changed'} as unknown as t.Expression);
  ctx.astAnalysis=analyzeScope(parseEstreeOrThrow('const unrelated=0;').program);
  const declarations:t.FunctionDeclaration[]=[];
  const renderer=emitPresentationComponent(ctx,plan,'error',declarations);
  expect(renderer).toMatchObject({props:[{name:'capture0',value:{name:'title'}}]});
  const output=printEstree(declarations[0] as unknown as BaseNode).code;
  expect(output).toContain('reason');expect(output).toContain('again');expect(output).toContain('title');
  expect(output).not.toContain('changed');
});

it('rejects a later invalid Group before earlier policies allocate or mutate source',()=>{
  const program=parseEstreeOrThrow('function App(){return <><Group pending={()=> <p>Waiting</p>}/><Group error={async()=> <p>Failed</p>}/></>;}').program;
  const ctx=createCtx();ctx.transparentGroups.add('Group');
  const identifiers=initializeGeneratedIdentifiers(ctx,program);
  const before=JSON.stringify(program);
  expect(()=>lowerTransparentGroups(ctx,{node:program as unknown as t.Program,...errorAt},
    planGroupPresentations(program as unknown as t.Program,analyzeScope(program),ctx.transparentGroups,errorAt))).toThrow('synchronous');
  expect(JSON.stringify(program)).toBe(before);expect(ctx.transparentPolicyParams.size).toBe(0);
  expect(ctx.emission.header).toEqual([]);
  expect(identifiers.generateComponent('GroupPending').name).toBe('GroupPending');
});

it.each([
  ['data={value}','remove the data prop'],['other={value}','accepts pending'],
  ['pending={Pending} pending={Pending}','duplicate Group pending'],
  ['suspend={true}','shorthand'],['pending="Loading"','component identifier'],
] as const)('plans Group attribute diagnostics independently of a backend: %s',(attributes,message)=>{
  const program=parseEstreeOrThrow(`function App(){return <Group ${attributes}/>;}`).program;
  expect(()=>planGroupPresentations(program as unknown as t.Program,analyzeScope(program),new Set(['Group']),errorAt)).toThrow(message);
});

it('plans nested own policies without baking generated inheritance into source facts',()=>{
  const program=parseEstreeOrThrow('function App(){let title="owner";return <Group pending={()=> <p>{title}</p>} error={Failure}><Group suspend pending={Pending}/></Group>;}').program;
  const plans=planGroupPresentations(program as unknown as t.Program,analyzeScope(program),new Set(['Group']),errorAt);
  const [outer,inner]=[...plans.values()];
  expect(outer).toMatchObject({pending:{kind:'inline'},error:{kind:'named',name:'Failure'},suspend:false});
  expect(inner).toEqual({pending:{kind:'named',name:'Pending'},error:undefined,suspend:true});
});
