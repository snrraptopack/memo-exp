import { expect, it } from 'vitest';
import { parseEstreeOrThrow } from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import { createCtx, canonicalStateKey } from '../packages/compiler/src/context';
import { prepareProgramAnalysis } from '../packages/compiler/src/analysis/prepare';
import { planAccessReaders } from '../packages/compiler/src/analysis/access-table';
import { emitAccessTable } from '../packages/compiler/src/emission/access-table';

function prepared(source: string) {
  const program=parseEstreeOrThrow(source,{filename:'./reader-plan.tsx'}).program as unknown as t.Program;
  const ctx=createCtx({moduleId:'./reader-plan.tsx'});
  prepareProgramAnalysis(ctx,{node:program,buildCodeFrameError:message=>new Error(message)});
  return {ctx,program};
}

it('plans canonical routes without a runtime allocator or backend statements',()=>{
  const {ctx,program}=prepared(`let count=0;
    export function App(){return <button onClick={()=>{count++}}>{count}</button>}`);
  const original=JSON.stringify(program),headers=[...ctx.header],identifiers=ctx.identifiers;
  ctx.identifiers=null;
  const plan=planAccessReaders(ctx);
  expect(plan.get(canonicalStateKey(ctx,'count'))).toEqual(new Set(['App']));
  expect(JSON.stringify(program)).toBe(original);expect(ctx.header).toEqual(headers);
  // Manifest discovery can use these routes without allocating a runtime name.
  ctx.identifiers=identifiers;
  ctx.compReads.clear();ctx.stateKeys.clear();
  const emitted=emitAccessTable(ctx,plan);
  expect(JSON.stringify(emitted)).toContain('./reader-plan.tsx#count');
  expect(JSON.stringify(emitted)).toContain('installAccessTable');
  expect(JSON.stringify(emitted)).toContain('App');
});

it('keeps captured list readers and structural routes independent of later context changes',()=>{
  const {ctx}=prepared(`let items=[{id:1,label:'one'}];
    function Row({item}){return <li>{item.label}</li>}
    export function App(){return <ul>{items.map(item=><Row key={item.id} item={item}/>)}</ul>}`);
  const key=canonicalStateKey(ctx,'items'),structural=`${key}\0memo-dom:list-structure-reader`;
  const plan=planAccessReaders(ctx);
  expect(plan.get(key)?.size).toBeGreaterThan(0);
  expect(plan.get(structural)).toEqual(new Set(['App']));
  const snapshot=[...plan].map(([key,readers])=>[key,[...readers]]);
  ctx.compReads.clear();ctx.componentListSources.clear();ctx.listSources.clear();ctx.rowReads.clear();
  expect([...plan].map(([key,readers])=>[key,[...readers]])).toEqual(snapshot);
  expect(planAccessReaders(ctx).size).toBe(0);
});

it('does not emit or allocate an access-table helper for an empty reader plan',()=>{
  const {ctx,program}=prepared(`export function App(){return <p>Hello</p>}`);
  const original=JSON.stringify(program),headers=[...ctx.header];
  ctx.identifiers=null;
  const plan=planAccessReaders(ctx);
  expect(plan.size).toBe(0);expect(emitAccessTable(ctx,plan)).toBeNull();
  expect(ctx.header).toEqual(headers);expect(JSON.stringify(program)).toBe(original);
});
