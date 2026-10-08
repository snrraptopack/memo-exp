import { expect, it } from 'vitest';
import { parseEstreeOrThrow, printEstree } from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import { createAnalysisCtx, refreshAstAnalysis } from '../packages/compiler/src/context';
import { scanComponents } from '../packages/compiler/src/analysis/module-scan';
import { planCalculatedListSources } from '../packages/compiler/src/planning/calculated-list-sources';
import { createCtx } from '../packages/compiler/src/dom/context';
import { initializeGeneratedIdentifiers } from '../packages/compiler/src/dom/identifiers';
import { lowerCalculatedListSources } from '../packages/compiler/src/dom/calculated-list-sources';

function fixture(body: string) {
  const program = parseEstreeOrThrow(`export function App({items,records}){${body}}`).program;
  const context = createAnalysisCtx();
  const path = {node:program as unknown as t.Program,buildCodeFrameError:(message:string)=>new Error(message)};
  refreshAstAnalysis(context,path.node);
  scanComponents(context,path);
  return {program,context};
}

it('captures calculated receivers in source order without mutation or generated state', () => {
  const value = fixture(`return <main>
    <ul>{items.futureMethod().map(item=><li key={item.id}>{item.label}</li>)}</ul>
    <ol>{Object.values(records).map(item=><li>{item}</li>)}</ol></main>;`);
  const before = JSON.stringify(value.program);
  const [plan] = planCalculatedListSources(value.context);
  expect(plan?.component).toBe('App');
  expect(plan?.sources).toHaveLength(2);
  expect(plan?.sources.map(source => source.source.type)).toEqual(['CallExpression','CallExpression']);
  expect(plan?.sources[0]?.statement).toBe(plan?.sources[1]?.statement);
  expect(plan?.sources[0]?.source).not.toBe(plan?.sources[0]?.receiver.object);
  expect(Object.isFrozen(plan)).toBe(true);
  expect(Object.isFrozen(plan?.sources)).toBe(true);
  expect(JSON.stringify(value.program)).toBe(before);
  expect(value.context).not.toHaveProperty('emission');
});

it('keeps direct sources and nested callback bodies on their existing contracts', () => {
  const value = fixture(`const callback=()=>items.futureMethod().map(item=><li>{item}</li>);
    return <main>{items.map(item=><li>{item}</li>)}{records.rows.map(item=><li>{item}</li>)}
      {['one','two'].map(item=><li>{item}</li>)}</main>;`);
  expect(planCalculatedListSources(value.context)).toEqual([]);
});

it('captures optional method chains without deciding library behavior by name', () => {
  const value = fixture(`return <ul>{items?.futureMethod()?.map(item=><li>{item}</li>)}</ul>;`);
  expect(planCalculatedListSources(value.context)[0]?.sources).toHaveLength(1);
});

it('lowers captured source plans without rediscovering component candidates', () => {
  const value = fixture(`const _listView=1;return <ul>{items.filter(item=>item.active).map(item=><li>{item.label}</li>)}</ul>;`);
  const plans = planCalculatedListSources(value.context);
  const backend = createCtx();
  initializeGeneratedIdentifiers(backend,value.program);
  lowerCalculatedListSources(backend,plans);
  const code = printEstree(value.program).code;
  expect(code).toContain('const _listView2 = items.filter');
  expect(code).toContain('_listView2.map');
  expect(backend.compPaths.size).toBe(0);
});
