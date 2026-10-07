import {expect,it} from 'vitest';
import {parseEstreeOrThrow} from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import * as astFactory from '../packages/compiler/src/ast/factory';
import {createCtx} from '../packages/compiler/src/dom/context';
import {prepareProgramAnalysis} from '../packages/compiler/src/dom/prepare';
import {planModuleCallbacks} from '../packages/compiler/src/planning/module-callbacks';

function prepared(source:string){
  const program=parseEstreeOrThrow(source,{filename:'./module-callbacks.tsx'}).program as unknown as t.Program;
  const path={node:program,buildCodeFrameError:(message:string)=>new Error(message)};
  const ctx=createCtx();prepareProgramAnalysis(ctx,path);
  return {ctx,program,path};
}

it('captures module setup, retained helper work and asynchronous completion without lowering',()=>{
  const {ctx,program,path}=prepared(`let n=0;
    function native(){return n++;}
    function deferred(){globalThis.schedule({run:()=>{n++;}});}
    async function later(){await Promise.resolve();n++;}
    globalThis.schedule([()=>{n++;}]);
    export function App(){return <button onClick={native}>{n}</button>;}`);
  const before=JSON.stringify(program),header=[...ctx.emission.header];
  const plan=planModuleCallbacks(ctx,path);
  expect(JSON.stringify(program)).toBe(before);expect(ctx.emission.header).toEqual(header);
  expect(plan.retained).toHaveLength(3);
  expect(plan.retained.filter(site=>site.target.async)).toHaveLength(1);
  const native=ctx.helpers.get('native')!.node;
  native.body=astFactory.blockStatement([]);
  const writes=plan.writesFor(native);
  expect([...writes.scopes.values()].some(scope=>scope.writes.has('n'))).toBe(true);
  expect(writes.owner).toBeNull();expect(writes.eventBoundary).toBe(false);
  expect(JSON.stringify(writes.copy)).not.toMatch(/markDirty|commitWrites|createElement/);
});

it('respects parameter shadows when identifying escaped module functions',()=>{
  const {ctx,path}=prepared(`let n=0;function callback(){n++;}
    function withShadow(callback){globalThis.schedule(callback);}
    export function App(){return <p>{n}</p>;}`);
  const plan=planModuleCallbacks(ctx,path);
  expect(plan.retained).toEqual([]);
  expect(plan.writesFor(ctx.helpers.get('callback')!.node).owner).toBeNull();
});

it('excludes compiler-owned callbacks and rejects unplanned backend-created functions',()=>{
  const {ctx,path}=prepared('let n=0;globalThis.schedule(()=>n++);export function App(){return <p>{n}</p>;}');
  const call=path.node.body[1] as t.ExpressionStatement;
  const callback=(call.expression as t.CallExpression).arguments[0] as t.ArrowFunctionExpression;
  ctx.compilerOwnedCallbacks.add(callback);
  const plan=planModuleCallbacks(ctx,path);
  expect(plan.retained).toEqual([]);
  expect(()=>plan.writesFor(astFactory.arrowFunctionExpression([],astFactory.numericLiteral(1))))
    .toThrow('authored source contract');
});
