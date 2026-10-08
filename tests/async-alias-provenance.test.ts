import {expect,it} from 'vitest';
import {analyzeScope,cloneNode,collectNodes,findNode,parseEstreeOrThrow,type BaseNode} from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import * as factory from '../packages/compiler/src/ast/factory';
import {AliasTracker,bindingScopeIsProgram,moduleOrigin} from '../packages/compiler/src/mutation-analysis';
import {annotateAsyncRead} from '../packages/compiler/src/planning/async-reads';
import { createCtx } from '../packages/compiler/src/dom/context';
import { refreshAstAnalysis } from '../packages/compiler/src/context';
import { initializeGeneratedIdentifiers, mdd } from '../packages/compiler/src/dom/identifiers';
import {isGeneratedDataCall} from '../packages/compiler/src/dom/data-read-recognition';

function fixture(expression:string,parameter='') {
  const program=parseEstreeOrThrow(`let resource=[];function App(${parameter}){const alias=${expression};return alias.length;}`).program;
  const analysis=analyzeScope(program);
  const declaration=findNode(program,node=>node.type==='VariableDeclarator' && (node as unknown as t.VariableDeclarator).id.type==='Identifier' && ((node as unknown as t.VariableDeclarator).id as t.Identifier).name==='alias')!;
  const aliases=new AliasTracker((name,binding)=>name==='resource' && binding!==undefined && bindingScopeIsProgram(binding)?moduleOrigin(name,'store'):null);
  return {program,analysis,declaration:declaration as unknown as t.VariableDeclarator,scope:analysis.nodeToScope.get(declaration)!,aliases};
}

it.each(['readResolvedValue','readResolvedValueForRender','readModuleSourceList'])('does not grant alias provenance to authored %s lookalikes',helper=>{
  const value=fixture(`other.${helper}(resource,'resource')`);
  expect(value.aliases.resolveExpression(value.scope,value.declaration.init!)).toBeNull();
});

it('resolves a cloned direct read through lexical identity after changing its backend',()=>{
  const value=fixture('transport(resource)');
  annotateAsyncRead(value.declaration.init as t.Expression,['./data.ts#resource'],'throw','resource');
  const declaration=cloneNode(value.declaration as unknown as BaseNode) as unknown as t.VariableDeclarator;
  (declaration.init as t.CallExpression).callee=factory.identifier('anotherBackend');
  value.aliases.trackDeclarator(value.scope,declaration);
  const member=findNode(value.program,node=>node.type==='MemberExpression')!;
  expect(value.aliases.resolveExpression(value.scope,member as t.Node)).toMatchObject({locality:'module',root:'resource',key:'resource.length'});
});

it('does not turn projected dependencies or multiple sources into a direct alias',()=>{
  const value=fixture('project(resource)');
  annotateAsyncRead(value.declaration.init as t.Expression,['./data.ts#resource'],'undefined');
  expect(value.aliases.resolveExpression(value.scope,value.declaration.init!)).toBeNull();
  annotateAsyncRead(value.declaration.init as t.Expression,['./data.ts#resource','./data.ts#other'],'undefined','resource');
  expect(value.aliases.resolveExpression(value.scope,value.declaration.init!)).toBeNull();
});

it('does not escape a shadowing parameter through a direct read fact',()=>{
  const value=fixture('transport(resource)','resource');
  annotateAsyncRead(value.declaration.init as t.Expression,['./data.ts#resource'],'throw','resource');
  expect(value.aliases.resolveExpression(value.scope,value.declaration.init!)).toBeNull();
});

it('recognizes compiler call ownership across cloning without guessing a namespace',()=>{
  const ctx=createCtx();const program=parseEstreeOrThrow('const resource=[];').program;
  initializeGeneratedIdentifiers(ctx,program);
  const callee=cloneNode(mdd(ctx,'createSource') as unknown as BaseNode) as unknown as t.MemberExpression;
  callee.object=factory.identifier('differentBackend');
  const argument=factory.identifier('resource');
  program.body.push(factory.expressionStatement(factory.callExpression(callee,[argument])) as unknown as BaseNode);
  const authored=parseEstreeOrThrow('_MDD.createSource(resource);').program.body[0]!;
  program.body.push(authored);
  refreshAstAnalysis(ctx,program);
  expect(isGeneratedDataCall(ctx,argument as unknown as BaseNode)).toBe(true);
  const authoredArgument=collectNodes(authored,node=>node.type==='Identifier' && (node as unknown as t.Identifier).name==='resource')[0]!;
  expect(isGeneratedDataCall(ctx,authoredArgument)).toBe(false);
});
