import { expect, it } from 'vitest';
import { childNode, parseEstreeOrThrow, walkAst, type BaseNode } from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import { createCtx, refreshAstAnalysis } from '../packages/compiler/src/context';
import { planComponentPull } from '../packages/compiler/src/planning/primitive-pull';

function parse(source: string): t.Program {
  return parseEstreeOrThrow(source,{filename:'./pull-plan.tsx'}).program as unknown as t.Program;
}
function expression(source: string): BaseNode {
  return (parse(`const value=(${source});`).body[0] as t.VariableDeclaration).declarations[0]!.init!;
}
function prepare(body: string) {
  const program=parse(`let shared=0; function View(input){${body} return <p/>;}`);
  const owner=program.body[1] as t.FunctionDeclaration;
  const ctx=createCtx();
  refreshAstAnalysis(ctx,program);
  ctx.compPaths.set('View',{node:owner,buildCodeFrameError:message=>new Error(message)});
  const declarations=new Map<string,t.VariableDeclarator>();
  walkAst<BaseNode>(owner,{enter(node){
    if(node.type==='VariableDeclarator') {
      const declaration=node as t.VariableDeclarator;
      if(declaration.id.type==='Identifier') declarations.set(declaration.id.name,declaration);
    }
  }});
  return {ctx,program,owner,declarations};
}

it('requires callback publication and snapshots that decision separately for each finalization', () => {
  const {ctx,declarations}=prepare('let a=0,b=0; const inc=()=>{a++;};');
  const plan=planComponentPull(ctx,'View'), inc=declarations.get('inc')!.init!;
  expect(plan.finalize(()=>false).independentFor(expression('a'))).toBe(false);
  const published=new Set<BaseNode>([inc]);
  const facts=plan.finalize(execution=>published.has(execution));
  published.clear();
  expect(facts.independentFor(expression('a+b'))).toBe(true);
  expect(plan.finalize(()=>false).independentFor(expression('a'))).toBe(false);
});

it('captures initializer, write and completion facts before backend AST mutation', () => {
  const {ctx,program,owner,declarations}=prepare('let a=0,b=0; const inc=()=>{a++;};');
  const before=JSON.stringify(program), header=[...ctx.header];
  const plan=planComponentPull(ctx,'View');
  expect(JSON.stringify(program)).toBe(before); expect(ctx.header).toEqual(header);
  const inc=declarations.get('inc')!.init!;
  declarations.get('a')!.init=expression('({value:0})') as t.Expression;
  const body=childNode(inc,'body') as unknown as t.BlockStatement;
  body.body=(parse('throw new Error("generated");').body as t.Statement[]);
  owner.body.body=[]; ctx.astAnalysis=null; ctx.compPaths.clear(); ctx.opaqueBindings.set('View',new Set(['a']));
  const facts=plan.finalize(execution=>execution===inc);
  expect(facts.independentFor(expression('a'))).toBe(true);
  expect(facts.independentFor(expression('input'))).toBe(false);
  expect(facts.independentFor(expression('shared'))).toBe(false);
});

it('keeps writes followed by throwing or hidden reads on the pull path even when instrumented', () => {
  const {ctx}=prepare(`let a=0,b=0,c=0;
    const throwing=()=>{a++;throw new Error('after write');};
    const hidden=()=>{b++;return input.value;};
    const missing=()=>{c++;return missingGlobal;};`);
  const facts=planComponentPull(ctx,'View').finalize(()=>true);
  for(const name of ['a','b','c']) expect(facts.independentFor(expression(name))).toBe(false);
});

it('proves primitive synchronous writes and transitive labels without callback publication', () => {
  const {ctx}=prepare('let a=0; a=2; const label="n="+a;');
  const facts=planComponentPull(ctx,'View').finalize(()=>false);
  expect(facts.independentFor(expression('label'))).toBe(true);
  expect(facts.independentFor(expression('a>1 ? `${label}` : "empty"'))).toBe(true);
  expect(facts.independentFor(expression('input.value'))).toBe(false);
});

it.each([
  'let a=0; const nested=(a)=>a;',
  'let a=0; eval("a=1");',
  'let a={value:0};',
  'let a=input.value;',
  'let a=0; const change=()=>{a=input.read();};',
  'let a=0; const change=()=>{[a]=input.values;};',
])('preserves conservative primitive eligibility: %s', body => {
  const {ctx}=prepare(body);
  expect(planComponentPull(ctx,'View').finalize(()=>true).independentFor(expression('a'))).toBe(false);
});
