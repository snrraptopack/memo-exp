import { expect, it } from 'vitest';
import { cloneNode, parseEstreeOrThrow, walkAst } from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import { createExpressionSourceFacts } from '../packages/compiler/src/analysis/expression-sources';
import { prepareProgramAnalysis } from '../packages/compiler/src/analysis/prepare';
import { createCtx } from '../packages/compiler/src/context';
import { planExpressionSources } from '../packages/compiler/src/planning/expression-sources';
import {planComponentListSites} from '../packages/compiler/src/planning/list-sites';
import {planComponentCallbacks} from '../packages/compiler/src/planning/component-callbacks';
import { planComponentRendering } from '../packages/compiler/src/planning/component-render';
import { planComponentPlacements } from '../packages/compiler/src/planning/component-placement';
import { planRegionReplays } from '../packages/compiler/src/planning/region-replay';

function parse(source: string): t.Program {
  return parseEstreeOrThrow(source, {filename:'./facts.tsx'}).program as unknown as t.Program;
}
function expression(source: string): t.Expression {
  return (parse(`const value=(${source});`).body[0] as t.VariableDeclaration).declarations[0]!.init!;
}
function inputs() {
  return {
    ownerSources: new Set(['a','b','reader']),
    unknownSources: new Set(['moduleState','opaque','form']),
    derivedSources: new Map<string,string[] | null>([['sum',['a','b']],['stable',null]]),
    pureCallee: () => false,
  };
}

it('captures exact roots once, independently of subsequent analysis mutations', () => {
  const environment=inputs(), facts=createExpressionSourceFacts(environment);
  environment.ownerSources.clear(); environment.unknownSources.clear();
  environment.derivedSources.get('sum')!.push('late'); environment.derivedSources.clear();
  expect(facts.sourcesFor(expression('sum+a'))).toEqual(['a','b']);
  expect(facts.sourcesFor(expression('moduleState+a'))).toBeNull();
  expect(facts.sourcesFor(expression('stable'))).toBeNull();
  expect(facts.sourcesFor(expression('"constant"'))).toEqual([]);
});

it.each(['reader.read()','opaque.value+a','form.result','a++','a=2','new Image()',
  'String(a)','tag`value ${a}`'])('preserves unknown provenance for %s', source => {
  expect(createExpressionSourceFacts(inputs()).sourcesFor(expression(source))).toBeNull();
});

it('distinguishes computed reads from property names and merges derived roots', () => {
  const facts=createExpressionSourceFacts(inputs());
  expect(facts.sourcesFor(expression('({b:a})'))).toEqual(['a']);
  expect(facts.sourcesFor(expression('({[b]:a})'))).toEqual(['a','b']);
  expect(facts.sourcesFor(expression('reader.a+sum'))).toEqual(['a','b','reader']);
});

it('plans lexical call facts before emission and consumes them without the mutable context', () => {
  const program=parse(`
    let shared=0;
    function fmt(n){return 'n='+n;}
    function View({reader}) {
      let a=0,b=0;
      const sum=a+b;
      return <main title={String(a)}><i>{fmt(sum)}</i><b>{reader.read()}</b><u>{shared}</u>
        <button onClick={()=>{a++;}}/><button onClick={()=>{b++;shared++;}}/></main>;
    }
    function Shadow({String}) {let a=0,b=0;
      return <main title={String(a)}><button onClick={()=>{a++;b++;}}/></main>;}
  `);
  const ctx=createCtx();
  prepareProgramAnalysis(ctx,{node:program,buildCodeFrameError:message=>new Error(message)});
  const before=JSON.stringify(program), header=[...ctx.emission.header];
  const sources=planExpressionSources(ctx);
  const plan=planComponentRendering(ctx.compPaths, {
    callbacks:new Map([...ctx.compPaths].map(([name,path])=>[name,planComponentCallbacks(ctx,name,path)])),
    expressionSources:sources, pullPlans:new Map(), placements:planComponentPlacements(ctx),
    regionReplays:planRegionReplays(ctx), listSites:planComponentListSites(ctx),
    renderCallbackProps:new Map([...ctx.componentProps].map(([name,props])=>[name,[...props.renderCallbacks]])),
  });
  expect(JSON.stringify(program)).toBe(before); expect(ctx.emission.header).toEqual(header);
  const calls=new Map<string,t.CallExpression>();
  for (const component of plan.components) walkAst(component.source.node,{enter(node){
    if(node.type==='CallExpression') {
      const call=node as t.CallExpression;
      if(call.callee.type==='Identifier') calls.set(`${component.name}:${call.callee.name}`,call);
      if(call.callee.type==='MemberExpression') calls.set(`${component.name}:method`,call);
    }
  }});
  ctx.instanceState.clear(); ctx.instanceDerivations.clear(); ctx.componentProps.clear();
  ctx.state.clear(); ctx.helpers.clear(); ctx.importedFunctions.clear(); ctx.astAnalysis=null;
  const facts=plan.components.find(component=>component.name==='View')!.expressionSources;
  expect(facts.sourcesFor(calls.get('View:String')!)).toEqual(['a']);
  expect(facts.sourcesFor(calls.get('View:fmt')!)).toEqual(['a','b']);
  expect(facts.sourcesFor(cloneNode(calls.get('View:fmt')!))).toEqual(['a','b']);
  expect(facts.sourcesFor(cloneNode(calls.get('View:String')!))).toBeNull();
  expect(facts.sourcesFor(calls.get('View:method')!)).toBeNull();
  expect(facts.sourcesFor(expression('shared'))).toBeNull();
  expect(sources.get('Shadow')!.sourcesFor(calls.get('Shadow:String')!)).toBeNull();
});
