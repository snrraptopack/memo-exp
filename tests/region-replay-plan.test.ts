import { expect, it } from 'vitest';
import { cloneNode, parseEstreeOrThrow, walkAst } from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import { prepareProgramAnalysis } from '../packages/compiler/src/analysis/prepare';
import { createRegionReplayFacts, type ListReplaySource } from '../packages/compiler/src/analysis/region-replay';
import { createCtx } from '../packages/compiler/src/context';
import { planRegionReplays } from '../packages/compiler/src/planning/region-replay';
import { matchMapCall } from '../packages/compiler/src/lists';

function parse(source: string): t.Program {
  return parseEstreeOrThrow(source, { filename:'./region-replay.tsx' }).program as unknown as t.Program;
}
function expression(source: string): t.Expression {
  return (parse(`const value=(${source});`).body[0] as t.VariableDeclaration).declarations[0]!.init!;
}
function list(sourceExpr = expression('items')): ListReplaySource {
  return {sourceExpr, sourceKey:'items', sourceLocal:false, hasPrelude:false};
}
function environment() {
  return { ownerRoots:new Set(['count','label','props']), volatile:false,
    moduleIndexSources:new Set(['items']), stateKeys:new Map([['items','./data.ts#items']]),
    fixedSourceFor:()=>undefined as string | undefined };
}

it('snapshots owner roots, volatility and module routing inputs independently of later mutations', () => {
  const inputs = environment(), facts = createRegionReplayFacts(inputs);
  inputs.ownerRoots.clear(); inputs.moduleIndexSources.clear(); inputs.stateKeys.clear(); inputs.volatile = true;
  expect(facts.conditionFromOwner(expression('count>1'))).toBe(true);
  expect(facts.conditionFromOwner(expression('shared>1'))).toBe(false);
  expect(facts.listFor(expression('0'), list())).toEqual({
    fixedPositions:false, moduleIndices:true, structuralSource:'./data.ts#items',
  });
});

it('keeps local, member and prelude list replays off the module index path', () => {
  const facts = createRegionReplayFacts(environment());
  for (const source of [ {...list(), sourceLocal:true}, {...list(), hasPrelude:true},
    {...list(expression('store.items')), sourceKey:'store.items'} ]) {
    expect(facts.listFor(expression('0'), source).moduleIndices).toBe(false);
  }
  expect(facts.listFor(expression('0'), {...list(),sourceLocal:true}).structuralSource).toBe('');
});

it('preserves dotted canonical source identity without rewriting an already linked key', () => {
  const inputs = environment(); inputs.stateKeys.set('store','./store.ts#state');
  const facts = createRegionReplayFacts(inputs), call = expression('0');
  expect(facts.listFor(call,{...list(),sourceKey:'store.items'}).structuralSource).toBe('./store.ts#state.items');
  expect(facts.listFor(call,{...list(),sourceKey:'./linked.ts#items'}).structuralSource).toBe('./linked.ts#items');
  expect(facts.listFor(call,{...list(),sourceKey:'unknown.items'}).structuralSource).toBe('unknown.items');
});

it('forwards volatile conditionals even without an owner root but leaves unrelated ordinary expressions alone', () => {
  const inputs = environment(); inputs.volatile = true;
  expect(createRegionReplayFacts(inputs).conditionFromOwner(expression('shared>1'))).toBe(true);
  const facts = createRegionReplayFacts(environment());
  expect(facts.conditionFromOwner(expression('props.visible ? label : count'))).toBe(true);
  expect(facts.conditionFromOwner(expression('shared.visible'))).toBe(false);
});

it('captures lexical closed-list proofs before context and factory mutation without granting them to clones', () => {
  const program = parse(`let items=[{id:1,text:'one'}];
    function View(){return <ul>{items.map(item=><li key={item.id}>{item.text}</li>)}</ul>;}
    function rename(){items[0].text='two';}`);
  const ctx = createCtx();
  prepareProgramAnalysis(ctx,{node:program,buildCodeFrameError:message=>new Error(message)});
  const calls: t.Node[] = [];
  walkAst(program,{enter(node){const call=matchMapCall(node); if(call!==null) calls.push(call);}});
  const call = calls[0]!, before = JSON.stringify(program), header = [...ctx.header];
  const facts = planRegionReplays(ctx).get('View')!;
  expect(JSON.stringify(program)).toBe(before); expect(ctx.header).toEqual(header);
  expect(facts.listFor(call,list()).fixedPositions).toBe(true);
  expect(facts.listFor(cloneNode(call),list()).fixedPositions).toBe(false);
  ctx.astAnalysis=null; ctx.plainListItemTargets=new WeakMap(); ctx.moduleListTargets.clear();
  ctx.stateKeys.clear(); ctx.compPaths.get('View')!.node.body.body=[];
  expect(facts.listFor(call,list())).toMatchObject({fixedPositions:true,moduleIndices:true});
  expect(facts.listFor(call,{...list(),hasPrelude:true}).fixedPositions).toBe(false);
  expect(facts.listFor(call,list(expression('other'))).fixedPositions).toBe(false);
});

it('does not transfer a closed module binding proof to a same-named component parameter', () => {
  const program = parse(`let items=[{id:1,text:'one'}];
    function ModuleView(){return <ul>{items.map(item=><li key={item.id}>{item.text}</li>)}</ul>;}
    function PropView({items}){return <ul>{items.map(item=><li key={item.id}>{item.text}</li>)}</ul>;}`);
  const ctx=createCtx();
  prepareProgramAnalysis(ctx,{node:program,buildCodeFrameError:message=>new Error(message)});
  const plans=planRegionReplays(ctx);
  for (const name of ['ModuleView','PropView']) {
    let call: t.Node | undefined;
    walkAst(ctx.compPaths.get(name)!.node,{enter(node){const found=matchMapCall(node); if(found!==null) call=found;}});
    expect(plans.get(name)!.listFor(call!,{...list(),sourceLocal:name==='PropView'}).fixedPositions)
      .toBe(name==='ModuleView');
  }
});
