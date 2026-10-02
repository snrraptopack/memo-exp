import { expect, it } from 'vitest';
import { parseEstreeOrThrow, walkAst, type BaseNode } from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import { prepareProgramAnalysis } from '../packages/compiler/src/analysis/prepare';
import { analyzeComponentRouteSelectors } from '../packages/compiler/src/analysis/route-selectors';
import { createCtx } from '../packages/compiler/src/context';
import { planComponentPlacements } from '../packages/compiler/src/planning/component-placement';

function prepare(source: string) {
  const program = parseEstreeOrThrow(source, { filename: './placement.tsx' }).program as unknown as t.Program;
  const ctx = createCtx();
  prepareProgramAnalysis(ctx, { node: program, buildCodeFrameError: message => new Error(message) });
  return { ctx, program };
}

it('captures authored row aliases and local collection ownership without changing source or headers', () => {
  const { ctx, program } = prepare(`
    function Row({item: record}) { return <li>{record.text}</li>; }
    function App() { let items=[{id:1,text:'one'}];
      return <ul>{items.map(item=><Row key={item.id} item={item}/>)}</ul>; }
  `);
  const before = JSON.stringify(program), header = [...ctx.header];
  const placements = planComponentPlacements(ctx);
  expect(JSON.stringify(program)).toBe(before);
  expect(ctx.header).toEqual(header);
  expect(placements.get('Row')).toMatchObject({
    listed: true, hasLinkedRows: false, sourceLocal: true,
    row: { itemParam: 'record', itemPath: [], keyPath: ['id'], sourceLocal: true },
  });
  expect(placements.get('App')!.row).toBeNull();
});

it('captures linked row key paths and props envelopes independently of mutable linker metadata', () => {
  const { ctx } = prepare('function Row(props) {return <li>{props.item.text}</li>;}');
  const keyPath = ['nested', 'id'];
  const linked = { keyPath, sourceKey: 'caller#items', sourceLocal: true };
  ctx.linkedComponentRows.set('Row', [linked]);
  const placement = planComponentPlacements(ctx).get('Row')!;
  keyPath.push('late'); linked.sourceLocal = false; linked.sourceKey = 'changed';
  ctx.linkedComponentRows.clear(); ctx.componentProps.clear();
  expect(placement).toMatchObject({ listed: true, hasLinkedRows: true, sourceLocal: true,
    row: { itemParam: 'props', itemPath: ['item'], keyPath: ['nested', 'id'],
      sourceKey: 'caller#items', sourceLocal: true } });
});

it.each([{keyPath:['other']}, {keyPath:null}])('keeps incompatible or unknown linked keys conservative: %j', ({keyPath}) => {
  const { ctx } = prepare(`let items=[{id:1,text:'one'}];
    function Row({item}) {return <li>{item.text}</li>;}
    function App() {return <ul>{items.map(item=><Row key={item.id} item={item}/>)}</ul>;}`);
  ctx.linkedComponentRows.set('Row', [{ keyPath, sourceKey: 'linked#items', sourceLocal: true }]);
  const placement = planComponentPlacements(ctx).get('Row')!;
  expect(placement.row!.keyPath).toBeNull();
  expect(placement.row!.sourceKey).toBe(ctx.listedSites.get('Row')![0]!.sourceKey);
  expect(placement.sourceLocal).toBe(true);
});

it('records a listed component with no row parameter without inventing an item binding', () => {
  const { ctx } = prepare('function Row() {return <li>static</li>;}');
  ctx.linkedComponentRows.set('Row', [{ keyPath: ['id'], sourceKey: 'caller#items', sourceLocal: false }]);
  expect(planComponentPlacements(ctx).get('Row')).toMatchObject({
    listed: true, hasLinkedRows: true, sourceLocal: false, row: null,
  });
});

it('batches imported route aliases with deduplication and source-specific dynamic fallback', () => {
  const { ctx } = prepare(`import {route as exact, route as dynamic} from '@memoized-dom/router';
    function View({field}) {return <p>{exact.pathname}:{exact.pathname}:{exact.params.id}:
      {exact.query.has('tab','board')}:{exact.query.toString()}:{dynamic.params[field]}</p>;}`);
  const node = ctx.compPaths.get('View')!.node;
  const facts = analyzeComponentRouteSelectors(ctx, node, ['exact', 'dynamic', 'missing']);
  expect(facts.get('exact')).toEqual([
    {kind:'member',path:['pathname']}, {kind:'member',path:['params','id']},
    {kind:'query',method:'has',args:['tab','board']}, {kind:'query',method:'toString',args:[]},
  ]);
  expect(facts.get('dynamic')).toBeNull(); expect(facts.get('missing')).toBeNull();
  const placement = planComponentPlacements(ctx).get('View')!;
  walkAst<BaseNode>(node, {enter(current) {
    if (current.type === 'Literal') (current as t.Literal).value = 'changed';
  }});
  ctx.compReads.clear(); ctx.routeReactiveBindings.clear(); ctx.externalReactiveBindings.clear();
  expect(placement.externalSources).toEqual(['dynamic', 'exact']);
  expect(placement.routeSelectors.get('exact')).toEqual(facts.get('exact'));
  expect(placement.routeSelectors.get('dynamic')).toBeNull();
});

it('ignores a shadowed route alias while retaining imported selectors', () => {
  const { ctx } = prepare(`import {route} from '@memoized-dom/router';
    function View() {const format=(route)=>route.unknown;
      return <p>{route.pathname}</p>;}`);
  expect(analyzeComponentRouteSelectors(ctx, ctx.compPaths.get('View')!.node, ['route']).get('route'))
    .toEqual([{kind:'member',path:['pathname']}]);
});

it('captures route ownership and external/local effect inputs before backend lowering', () => {
  const { ctx } = prepare(`import {route} from '@memoized-dom/router';
    function View() {let count=0; const path=route.pathname;
      $effect(()=>{document.title=path+count;});
      return <main route="/projects/:id"><p>{count}</p><button onClick={()=>{count++;}}/></main>;}`);
  const placement = planComponentPlacements(ctx).get('View')!;
  expect(placement.externalSources).toEqual(['route']);
  expect(placement.hasLocalEffects).toBe(true); expect(placement.ownsRoutes).toBe(true);
  ctx.effects.clear(); ctx.localRoutes.length = 0; ctx.instanceDerivations.clear();
  expect(placement.hasLocalEffects).toBe(true); expect(placement.ownsRoutes).toBe(true);
  expect(placement.externalSources).toEqual(['route']);
});
