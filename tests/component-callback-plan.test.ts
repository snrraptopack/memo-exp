import {expect,it} from 'vitest';
import {analyzeScope,parseEstreeOrThrow,walkAst,type BaseNode} from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import { createCtx } from '../packages/compiler/src/dom/context';
import { type ComponentPath } from '../packages/compiler/src/context';
import {planComponentCallbacks} from '../packages/compiler/src/planning/component-callbacks';
import * as astFactory from '../packages/compiler/src/ast/factory';

function fixture(source:string){
  const program=parseEstreeOrThrow(source,{filename:'./callbacks.tsx'}).program;
  const ctx=createCtx();ctx.astAnalysis=analyzeScope(program);
  const node=program.body[0] as unknown as t.FunctionDeclaration;
  const path:ComponentPath={node,buildCodeFrameError:message=>new Error(message)};
  ctx.compPaths.set('App',path);ctx.instanceState.set('App',new Set(['n']));
  const arrows:t.ArrowFunctionExpression[]=[];
  walkAst<BaseNode>(program,{enter(node){if(node.type==='ArrowFunctionExpression')arrows.push(node as unknown as t.ArrowFunctionExpression);}});
  const before=JSON.stringify(program),callbacks=planComponentCallbacks(ctx,'App',path);
  expect(JSON.stringify(program)).toBe(before);
  return {ctx,path,arrows,callbacks};
}

it('preserves authored bodies and owner lookup after factory replacement',()=>{
  const {callbacks,path,arrows}=fixture('function App(){let n=0;return <Child run={()=>{n++;return n;}}/>;}');
  const callback=callbacks.forValue(arrows[0]!)!;
  arrows[0]!.body=astFactory.numericLiteral(99);
  path.node=astFactory.functionDeclaration(astFactory.identifier('Replaced'),[],astFactory.blockStatement([]));
  const writes=callback.writesFor();
  expect(writes.original).toBe(arrows[0]);expect(writes.copy.body.type).toBe('BlockStatement');
  expect(JSON.stringify(writes.copy)).not.toContain('markDirty');
  expect([...writes.scopes.values()].some(scope=>scope.instanceWrites.has('n'))).toBe(true);
});

it('captures helper cycles once, keeps declaration identity and excludes JSX factories',()=>{
  const {callbacks}=fixture('function App(){let n=0;function first(){n++;second();}function second(){first();}function View(){return <p/>;}return <Child run={()=>first()}/>;}');
  const plan=callbacks.forValue(astFactory.identifier('first'))!;
  expect(plan.target.type).toBe('FunctionDeclaration');expect(plan.helpers).toHaveLength(1);
  expect(plan.helpers[0]!.helpers).toEqual([]);
  expect(callbacks.forValue(astFactory.identifier('View'))).toBeNull();
  expect(callbacks.forValue(astFactory.identifier('unknown'))).toBeNull();
});

it('accepts semantic row facts without retaining renderer identifiers',()=>{
  const {callbacks,arrows}=fixture('function App(){let n=0;return <Child run={()=>item.label="changed"}/>;}');
  const facts={itemParam:'item',itemPath:[],keyPath:['id'],sourceKey:'items',sourceLocal:true,localRefresh:false};
  const plan=callbacks.forValue(arrows[0]!)!.writesFor(facts);
  expect(plan.row).toEqual(facts);expect(plan.owner).toBe('App');
  expect(JSON.stringify(plan.copy)).not.toMatch(/markDirty|refreshRow|commitWrites|createElement/);
});

it('captures native event completion and deferred helpers before backend mutation',()=>{
  const {callbacks,arrows,path}=fixture(`function App(){let n=0;
    function later(){queueMicrotask(()=>{n++;});}
    return <button onClick={event=>{if(event.altKey)return n;later();return n++;}}/>;}`);
  const event=arrows.at(-1)!;
  const source=callbacks.forEvent(event,true)!;
  expect(source.helpers).toHaveLength(1);
  event.body=astFactory.blockStatement([]);
  path.node=astFactory.functionDeclaration(astFactory.identifier('Replaced'),[],astFactory.blockStatement([]));
  const native=source.writesFor(undefined,true);
  const ordinary=source.writesFor(undefined,false);
  expect(native.eventBoundary).toBe(true);
  expect(native.executionAwareRoot).toBe(true);
  expect(ordinary.eventBoundary).toBe(false);
  expect(JSON.stringify(native.copy)).toContain('altKey');
  expect([...native.scopes.values()].some(scope=>scope.instanceWrites.has('n'))).toBe(true);
  const helper=source.helpers[0]!.writesFor();
  expect([...helper.scopes.values()].some(scope=>scope.instanceWrites.has('n'))).toBe(true);
  expect(JSON.stringify(native.copy)).not.toMatch(/markDirty|commitWrites|createElement/);
});

it('keeps authored concise native returns and separates render callback eligibility',()=>{
  const {callbacks,arrows}=fixture('function App(){let n=0;return <button onClick={()=>n++}/>;}');
  const source=callbacks.forEvent(arrows[0]!)!;
  const writes=source.writesFor(undefined,true);
  expect(writes.copy.body.type).toBe('UpdateExpression');
  expect(writes.executionAwareRoot).toBe(false);
  expect(writes.eventBoundary).toBe(true);
  const jsx=fixture('function App(){let n=0;return <button onClick={()=>{n++;return <p/>;}}/>;}');
  expect(jsx.callbacks.forValue(jsx.arrows[0]!)).toBeNull();
  expect(jsx.callbacks.forEvent(jsx.arrows[0]!)).not.toBeNull();
});
