import { expect, it } from 'bun:test';
import { parseEstreeOrThrow, walkAst } from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import { createCtx } from '../packages/compiler/src/dom/context';
import { prepareProgramAnalysis } from '../packages/compiler/src/dom/prepare';
import { planHandlerWrites } from '../packages/compiler/src/handlers/analyze';
import { emitHandlerWrites } from '../packages/compiler/src/dom/handler';
import { listProvenanceVariable, mutationJournalVariable } from '../packages/compiler/src/dom/list-bindings';

function preparedHandler(source:string) {
  const program=parseEstreeOrThrow(source,{filename:'./plan.tsx'}).program as unknown as t.Program;
  const ctx=createCtx();
  prepareProgramAnalysis(ctx,{node:program,buildCodeFrameError:message=>new Error(message)});
  ctx.emission.identifiers!.registerComponentId('App','_factoryId');
  let handler:t.ArrowFunctionExpression|undefined;
  walkAst(program,{enter(node){
    if(node.type==='JSXAttribute'&&node.name.type==='JSXIdentifier'&&node.name.name==='onClick')
      handler=(node.value as t.JSXExpressionContainer).expression as t.ArrowFunctionExpression;
  }});
  return {program,ctx,handler:handler!};
}

it('captures targeted item mutation without inserting a journal during analysis',()=>{
  const {program,ctx,handler}=preparedHandler(`export function App(){
    let items=[{id:1,label:'one'}];return <main>
      <ul>{items.map(item=><li key={item.id}>{item.label}</li>)}</ul>
      <button onClick={()=>{items[0].label='new';}}/></main>;}`);
  const authored=JSON.stringify(program), headers=[...ctx.emission.header];
  const journal=ctx.keyedListMutationSources.get('App')!.get('items')!;
  expect(journal).not.toHaveProperty('keysVariable');
  const plan=planHandlerWrites(ctx,handler,'App');
  expect(JSON.stringify(program)).toBe(authored);
  expect(ctx.emission.header).toEqual(headers);
  expect(plan.mutationSites).toHaveLength(1);
  expect(plan.mutationSites[0]!.source).toBe('items');
  expect(plan.mutationSites[0]!.path.node.type).toBe('AssignmentExpression');
  const variable=mutationJournalVariable(ctx,'App',journal.source);
  expect(JSON.stringify(plan.copy)).not.toContain(variable);
  ctx.keyedListMutationSources.clear();
  emitHandlerWrites(ctx,plan,{journals:new Map([['items',variable]])});
  expect(JSON.stringify(handler)).toContain(variable);
  expect(JSON.stringify(handler)).toContain('markDirty');
});

it('keeps authored row facts separate from its backend refresh and owner bindings',()=>{
  const {ctx,handler}=preparedHandler(`export function App(){const items=[{id:1,label:'one'}];
    return <ul>{items.map(item=><li key={item.id}><button onClick={()=>{item.label='new';}}/></li>)}</ul>;}`);
  const facts={itemParam:'item',itemPath:[],keyPath:['id'],sourceKey:'items',localRefresh:true};
  const plan=planHandlerWrites(ctx,handler,'App',facts);
  expect(plan.row).toEqual(facts);
  expect(JSON.stringify(plan)).not.toContain('_rowRefresh');
  emitHandlerWrites(ctx,plan,{row:{...facts,rowIdVar:'_rowId',refreshVar:'_rowRefresh',ownerIdVar:'_ownerId'}});
  expect(JSON.stringify(handler)).toContain('_rowRefresh');
});

it('allocates a journal from its captured source contract after analysis storage is discarded',()=>{
  const {ctx,handler}=preparedHandler(`export function App(){let items=[{id:1,label:'one'}];
    return <main><ul>{items.map(item=><li key={item.id}>{item.label}</li>)}</ul>
      <button onClick={()=>{items[0].label='new';}}/></main>;}`);
  const plan=planHandlerWrites(ctx,handler,'App');
  expect(plan.mutationSites).toHaveLength(1);
  ctx.keyedListMutationSources.clear();
  emitHandlerWrites(ctx,plan);
  const variable=mutationJournalVariable(ctx,'App','items');
  expect(JSON.stringify(handler)).toContain(variable);
});

it('captures a native-operation write without mutating authored code or emitting runtime calls', () => {
  const program = parseEstreeOrThrow(`export function App(){
    let items=[{id:1,label:'one'},{id:2,label:'two'}];
    return <main><button onClick={()=>{items=items.toReversed();}}>reverse</button>
      <ul>{items.map(item=><li key={item.id}>{item.label}</li>)}</ul></main>;
  }`, { filename: './plan.tsx' }).program as unknown as t.Program;
  const ctx = createCtx();
  prepareProgramAnalysis(ctx, { node: program, buildCodeFrameError: message => new Error(message) });
  ctx.emission.identifiers!.registerComponentId('App', '_factoryId');
  let handler: t.ArrowFunctionExpression | undefined;
  walkAst(program, { enter(node) {
    if (node.type === 'JSXAttribute' && node.name.type === 'JSXIdentifier' && node.name.name === 'onClick') {
      handler = (node.value as t.JSXExpressionContainer).expression as t.ArrowFunctionExpression;
    }
  } });
  const original = JSON.stringify(program), header = [...ctx.emission.header];
  const plan = planHandlerWrites(ctx, handler!, 'App');
  expect(JSON.stringify(program)).toBe(original);
  expect(ctx.emission.header).toEqual(header);
  expect(plan.listWrites.operations).toHaveLength(1);
  const operation = plan.listWrites.operations[0]!.plan;
  expect(operation.source).toBe('items');
  expect(operation).not.toHaveProperty('token');
  expect(ctx.ownerListGuards.get('App')).toEqual(new Set(['items']));
  const token = listProvenanceVariable(ctx, 'App', operation.source);
  expect(JSON.stringify(plan)).not.toContain(token);
  expect(JSON.stringify(plan.copy)).not.toContain('evaluateListOperation');
  expect(JSON.stringify(plan.copy)).not.toContain('markDirty');
  // Lowering consumes the captured operation; it need not rediscover that
  // operation in the original analysis maps after another pass clears them.
  ctx.ownerListOperations = new WeakMap();
  ctx.ownerListGuards.clear();
  emitHandlerWrites(ctx, plan);
  expect(JSON.stringify(handler)).toContain(token);
  expect(JSON.stringify(handler)).toContain('evaluateListOperation');
  expect(JSON.stringify(handler)).toContain('markDirty');
  expect(ctx.emission.header.length).toBeGreaterThan(header.length);
});
