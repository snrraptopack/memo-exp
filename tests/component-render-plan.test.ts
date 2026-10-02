import { expect, it } from 'vitest';
import { parseEstreeOrThrow, type BaseNode } from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import type { ComponentPath } from '../packages/compiler/src/context';
import { planComponentRendering } from '../packages/compiler/src/planning/component-render';
import { transformEstreeProgram } from '../packages/compiler/src/plugin';

function parse(source: string) {
  return parseEstreeOrThrow(source, {filename:'./plan.tsx'}).program as unknown as t.Program;
}
function componentPaths(program: t.Program) {
  const paths = new Map<string,ComponentPath>();
  for (const statement of program.body) if (statement.type === 'FunctionDeclaration') paths.set(statement.id!.name, {
    node:statement,buildCodeFrameError:message=>new Error(message),
  });
  return paths;
}

it.each([
  ['direct','return <main/>;',1,0],
  ['tail','if (phase===0) return null; if(phase===1) return <i/>; return <b/>;',3,1],
  ['if','if(phase) return <i/>; else return false;',2,1],
  ['switch','switch(phase){case 0: return null; case 1: return <i/>; default: return <b/>;}',3,1],
] as const)('plans %s returns without emitting or mutating source factories', (_name,body,count,empty) => {
  const program=parse(`function View(phase){${body}}`), before=JSON.stringify(program);
  const paths=componentPaths(program); const plan=planComponentRendering(paths);
  expect(JSON.stringify(program)).toBe(before);
  expect(plan.components).toHaveLength(1); expect(plan.components[0]!.source).toBe(paths.get('View'));
  const returns=plan.components[0]!.returns;
  const branches='jsx' in returns ? [returns.jsx] : returns.branches;
  expect(branches).toHaveLength(count); expect(branches.filter(branch=>branch===null)).toHaveLength(empty);
  expect(JSON.stringify(returns)).not.toContain('createCondRegion');
  expect(JSON.stringify(returns)).not.toContain('createElement');
  expect(JSON.stringify(returns)).not.toContain('_MD');
  expect(planComponentRendering(paths).components[0]!.returns).toEqual(returns);
});

it('validates all return shapes before the backend replaces any component', () => {
  const program=parse('function Good(){return <main/>;} function Bad(){while(true){return <p/>;}}');
  const first=JSON.stringify(program.body[0]);
  expect(()=>transformEstreeProgram({node:program,buildCodeFrameError:message=>new Error(message)}))
    .toThrow(/Bad.*unsupported JSX return control flow/);
  expect(JSON.stringify(program.body[0])).toBe(first);
  expect((program.body[0] as t.FunctionDeclaration).params).toHaveLength(0);
});

it('keeps planning inputs limited to normalized component paths, independent of emission state', () => {
  const program=parse('function One(){return <i/>;} function Two(){return <b/>;}');
  const paths=componentPaths(program), before=JSON.stringify(program);
  const plan=planComponentRendering(paths);
  expect(plan.components.map(component=>component.name)).toEqual(['One','Two']);
  expect(Object.keys(plan)).toEqual(['components']);
  expect(Object.keys(plan.components[0]!)).toEqual(['name','source','returns']);
  expect(JSON.stringify(program as unknown as BaseNode)).toBe(before);
});
