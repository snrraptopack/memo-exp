import { expect, it } from 'vitest';
import { cloneNode, parseEstreeOrThrow, printEstree, walkAst } from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import { matchMapCall } from '../packages/compiler/src/lists';
import { planListCallback } from '../packages/compiler/src/lists/callback-plan';
import { planConditionalBranches } from '../packages/compiler/src/jsx/conditional-plan';
import { planComponentRegionShapes } from '../packages/compiler/src/planning/region-shapes';

function parse(source: string): t.Program {
  return parseEstreeOrThrow(source,{filename:'./shapes.tsx'}).program as unknown as t.Program;
}
function expression(source: string): t.Expression {
  return (parse(`const value=(${source});`).body[0] as t.VariableDeclaration).declarations[0]!.init!;
}
const fail = (message: string): never => {throw new Error(message);};
const errorAt = {buildCodeFrameError:(message:string)=>new Error(message)};
function callback(source: string) { return matchMapCall(expression(`items.map(${source})`))!; }
function condition(source: string) { return expression(source) as t.ConditionalExpression | t.LogicalExpression; }

it('plans const row substitutions and an explicit replacement without mutating the source callback', () => {
  const call=callback('(item,index)=>{const {text}=item; const label=text+index; return <li key={item.id}>{label}</li>;}');
  const before=JSON.stringify(call), plan=planListCallback(call,fail);
  expect(JSON.stringify(call)).toBe(before);
  expect(plan.itemParam).toBe('item'); expect(plan.indexParam).toBe('index');
  expect(plan.prelude).toHaveLength(0); expect(plan.normalizedBody).toBe(plan.jsx);
  const output=printEstree(plan.jsx!).code;
  expect(output).toContain('item.text + index'); expect(output).not.toContain('{label}');
  expect(planListCallback(cloneNode(call),fail).jsx).toEqual(plan.jsx);
});

it('keeps ordered callback expressions exactly once alongside substituted JSX and preserves the authored block', () => {
  const call=callback('item=>{const label=item.text; record(label); audit(item.id); return <li>{label}</li>;}');
  const before=JSON.stringify(call), plan=planListCallback(call,fail);
  expect(JSON.stringify(call)).toBe(before); expect(plan.normalizedBody).toBeNull();
  expect(plan.prelude.map(statement=>printEstree(statement).code.trim())).toEqual(['record(item.text);','audit(item.id);']);
  expect(printEstree(plan.jsx!).code).toContain('{item.text}');
});

it('strips only cloned parameter annotations and leaves delegated callback recognition to composition analysis', () => {
  const call=callback('({text}: {text:string}, index:number)=>renderItem(text,index)');
  const before=JSON.stringify(call), plan=planListCallback(call,fail);
  expect(JSON.stringify(call)).toBe(before);
  expect(plan.jsx).toBeNull(); expect(plan.itemParam).toBe('text'); expect(plan.indexParam).toBe('index');
  expect((plan.itemPattern as unknown as {typeAnnotation:unknown}).typeAnnotation).toBeNull();
});

it.each([
  'item=>{let label=item.text; return <li>{label}</li>;}',
  'item=>{const label=item.text++; return <li>{label}</li>;}',
  'item=>{const label=item.text; return <li onClick={(label)=>label}>{label}</li>;}',
])('preserves callback syntax and shadowing diagnostics: %s', source => {
  expect(()=>planListCallback(callback(source),fail)).toThrow(/R7 L1/);
});

it('flattens branch selection in source order without allocating a conditional suffix', () => {
  const source=condition('first() ? <i/> : second() ? message : null');
  const before=JSON.stringify(source), plan=planConditionalBranches(source,errorAt);
  expect(JSON.stringify(source)).toBe(before); expect(plan.branches).toHaveLength(3);
  expect(plan.branches[2]).toBeNull(); expect(Object.keys(plan)).toEqual(['pickExpr','branches']);
  const pick=new Function('first','second',`return ${printEstree(plan.pickExpr).code};`);
  const reads:string[]=[];
  expect(pick(()=>{reads.push('first');return true;},()=>{reads.push('second');return true;})).toBe(0);
  expect(reads).toEqual(['first']); reads.length=0;
  expect(pick(()=>{reads.push('first');return false;},()=>{reads.push('second');return true;})).toBe(1);
  expect(reads).toEqual(['first','second']);
  expect(pick(()=>false,()=>false)).toBe(2);
  expect(printEstree(plan.branches[1]!).code).toContain('{message}');
});

it.each([['&&',true,0,false,1],['||',true,1,false,0]] as const)
  ('preserves %s branch indices', (operator,yes,yesIndex,no,noIndex) => {
    const plan=planConditionalBranches(condition(`enabled ${operator} <i/>`),errorAt);
    const pick=new Function('enabled',`return ${printEstree(plan.pickExpr).code};`);
    expect(pick(yes)).toBe(yesIndex); expect(pick(no)).toBe(noIndex);
  });

it('rejects keys on conditional branch hosts while leaving nested keyed lists legal', () => {
  expect(()=>planConditionalBranches(condition('show ? <p key="bad"/> : null'),errorAt)).toThrow(/only meaningful on list rows/);
  expect(()=>planConditionalBranches(condition('show && items.map(item=><li key={item.id}/>)'),errorAt)).not.toThrow();
});

it('prepares nested shapes in normalized row content and accepts cloned content through the same normalizers', () => {
  const program=parse(`function View(){return <ul>{items.map(item=>{
    const label=item.text; record(label); return <li>{show ? <b>{label}</b> : null}
      <ol>{item.children.map(child=><li key={child.id}>{child.text}</li>)}</ol></li>;
  })}</ul>;}`);
  const node=program.body[0] as t.FunctionDeclaration, before=JSON.stringify(program);
  const plans=planComponentRegionShapes({node,...errorAt});
  expect(JSON.stringify(program)).toBe(before);
  let outer:t.Expression | undefined;
  walkAst(node,{enter(current){const call=matchMapCall(current); if(call!==null&&outer===undefined) outer=call;}});
  const row=plans.listCallbackFor(matchMapCall(outer!)!);
  let nested:t.Expression | undefined, branch:t.ConditionalExpression | undefined;
  walkAst(row.jsx!,{enter(current){
    const call=matchMapCall(current); if(call!==null) nested=call;
    if(current.type==='ConditionalExpression') branch=current as t.ConditionalExpression;
  }});
  const inner=matchMapCall(nested!)!;
  expect(plans.listCallbackFor(inner).itemParam).toBe('child');
  expect(plans.listCallbackFor(cloneNode(inner)).jsx).toEqual(plans.listCallbackFor(inner).jsx);
  expect(plans.conditionalFor(cloneNode(branch!))).toEqual(plans.conditionalFor(branch!));
  expect(printEstree(plans.conditionalFor(branch!).branches[0]!).code).toContain('{item.text}');
});
