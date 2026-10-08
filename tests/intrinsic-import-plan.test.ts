import { expect, it } from 'bun:test';
import {analyzeScope,parseEstreeOrThrow} from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import {createAnalysisCtx} from '../packages/compiler/src/context/model';
import {planCompilerIntrinsics} from '../packages/compiler/src/intrinsics';

function fixture(source:string){
  const node=parseEstreeOrThrow(source,{filename:'./intrinsics.tsx'}).program as unknown as t.Program;
  const ctx=createAnalysisCtx();ctx.astAnalysis=analyzeScope(node);
  return {ctx,path:{node,buildCodeFrameError:(message:string)=>new Error(message)}};
}

it('plans deterministic intrinsic imports without generating declarations or publishing backend state',()=>{
  const {ctx,path}=fixture(`function App(){const result=$fetch('/api');const tracked=$track(result);
    const form=$forms(()=>result);const page=$routed(()=>result);return <p>{tracked.pending}</p>;}`);
  const before=JSON.stringify(path.node);
  expect(planCompilerIntrinsics(ctx,path)).toEqual([
    {module:'@memoized-dom/data',names:['$fetch','$forms','$track']},
    {module:'@memoized-dom/router',names:['$routed']},
  ]);
  expect(JSON.stringify(path.node)).toBe(before);
  expect(ctx.importedValues.has('$routed')).toBe(false);
});

it('preserves shadows and validates lifecycle syntax in shared planning',()=>{
  const {ctx,path}=fixture(`function App($fetch){$effect(()=>{});$cleanup(()=>{});return <p>{$fetch('/api')}</p>;}`);
  expect(planCompilerIntrinsics(ctx,path)).toEqual([]);
  for(const source of ['function App(){effect(()=>{});return <p/>;}','const escaped=$effect;']){
    const fixtureValue=fixture(source);
    expect(()=>planCompilerIntrinsics(fixtureValue.ctx,fixtureValue.path)).toThrow('compiler');
  }
});
