import { expect, it } from 'vitest';
import { parseEstreeOrThrow, printEstree } from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import { planDirectChildren } from '../packages/compiler/src/jsx/children';

const fail = (message: string): never => { throw new Error(message); };
function children(source: string) {
  const program = parseEstreeOrThrow(`const node=(${source});`, {filename:'./children.tsx'}).program;
  return ((program.body[0] as unknown as t.VariableDeclaration).declarations[0]!.init as t.JSXElement).children;
}

it('plans mixed child semantics without changing authored nodes or allocating DOM names', () => {
  const source = children('<section>Hello {name}{false}{null}{undefined}<i/>{items.map(item=><b key={item.id}>{item.text}</b>)}{show&&<em/>}{slot} tail {count}</section>');
  const before = JSON.stringify(source);
  const plan = planDirectChildren(source, {
    isForwarded: expression => expression.type === 'Identifier' && expression.name === 'slot', fail,
  });
  expect(JSON.stringify(source)).toBe(before);
  expect(plan.map(child => child.type)).toEqual(['text','node','list','condition','slot','text']);
  expect(plan.some(child => 'variable' in child)).toBe(false);
  expect(printEstree(plan[0]!.type === 'text' ? plan[0].expression : null!).code).toContain('name');
  expect(plan[1]!.type === 'node' && plan[1].node).toBe(source[5]);
});

it('keeps scalar logical expressions in text and ignores empty expression containers', () => {
  const plan = planDirectChildren(children('<p>{/* empty */}{count||0}{count?"yes":"no"}</p>'), {isForwarded:()=>false,fail});
  expect(plan).toHaveLength(1);
  expect(plan[0]!.type).toBe('text');
});

it('rejects spread children during planning', () => {
  expect(()=>planDirectChildren(children('<p>{...items}</p>'), {isForwarded:()=>false,fail}))
    .toThrow('spread children are not supported');
});
