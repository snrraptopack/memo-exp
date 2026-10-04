import { expect, it } from 'vitest';
import { parseEstreeOrThrow, walkAst } from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import { createCtx } from '../packages/compiler/src/context';
import { prepareProgramAnalysis } from '../packages/compiler/src/analysis/prepare';
import { planHandlerWrites } from '../packages/compiler/src/handlers/analyze';
import { emitHandlerWrites } from '../packages/compiler/src/emission/handler';

it('captures a native-operation write without mutating authored code or emitting runtime calls', () => {
  const program = parseEstreeOrThrow(`export function App(){
    let items=[{id:1,label:'one'},{id:2,label:'two'}];
    return <main><button onClick={()=>{items=items.toReversed();}}>reverse</button>
      <ul>{items.map(item=><li key={item.id}>{item.label}</li>)}</ul></main>;
  }`, { filename: './plan.tsx' }).program as unknown as t.Program;
  const ctx = createCtx();
  prepareProgramAnalysis(ctx, { node: program, buildCodeFrameError: message => new Error(message) });
  ctx.identifiers!.registerComponentId('App', '_factoryId');
  let handler: t.ArrowFunctionExpression | undefined;
  walkAst(program, { enter(node) {
    if (node.type === 'JSXAttribute' && node.name.type === 'JSXIdentifier' && node.name.name === 'onClick') {
      handler = (node.value as t.JSXExpressionContainer).expression as t.ArrowFunctionExpression;
    }
  } });
  const original = JSON.stringify(program), header = [...ctx.header];
  const plan = planHandlerWrites(ctx, handler!, 'App');
  expect(JSON.stringify(program)).toBe(original);
  expect(ctx.header).toEqual(header);
  expect(plan.listWrites.operations).toHaveLength(1);
  expect(JSON.stringify(plan.copy)).not.toContain('evaluateListOperation');
  expect(JSON.stringify(plan.copy)).not.toContain('markDirty');
  // Lowering consumes the captured operation; it need not rediscover that
  // operation in the original analysis maps after another pass clears them.
  ctx.ownerListOperations = new WeakMap();
  emitHandlerWrites(ctx, plan);
  expect(JSON.stringify(handler)).toContain('evaluateListOperation');
  expect(JSON.stringify(handler)).toContain('markDirty');
  expect(ctx.header.length).toBeGreaterThan(header.length);
});
