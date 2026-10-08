import { expect, it } from 'bun:test';
import { parseEstreeOrThrow, printEstree, childNode, identifierName } from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import { createAnalysisCtx, refreshAstAnalysis } from '../packages/compiler/src/context';
import { scanComponents } from '../packages/compiler/src/analysis/module-scan';
import { planPrivateRowProps } from '../packages/compiler/src/planning/private-row-props';
import { createCtx } from '../packages/compiler/src/dom/context';
import { initializeGeneratedIdentifiers } from '../packages/compiler/src/dom/identifiers';
import { lowerPrivateRowProps } from '../packages/compiler/src/dom/private-row-props';

const row = `function Row(props) {
  const label = props => props.other;
  return <li onClick={() => {props.item.label += '!';}}>{props.item.label}</li>;
}`;
function fixture(declaration = row, extra = '') {
  const program = parseEstreeOrThrow(`${declaration}
    export function App({items}) {return <ul>{items.map(item => <Row key={item.id} item={item}/>)}</ul>;}
    ${extra}`).program;
  const context = createAnalysisCtx();
  const path = {node:program as unknown as t.Program, buildCodeFrameError:(message:string) => new Error(message)};
  refreshAstAnalysis(context, path.node);
  scanComponents(context, path);
  return {program, context, path};
}

it('captures the private envelope proof without allocation, mutation or shadow confusion', () => {
  const value = fixture();
  const before = JSON.stringify(value.program);
  const props = value.context.componentProps.get('Row');
  const [plan] = planPrivateRowProps(value.context, value.path);
  expect(plan).toMatchObject({component:'Row', field:'item'});
  expect(plan?.members).toHaveLength(2);
  expect(plan?.members.every(member => identifierName(childNode(member,'property')) === 'item')).toBe(true);
  expect(Object.isFrozen(plan)).toBe(true);
  expect(Object.isFrozen(plan?.members)).toBe(true);
  expect(value.context.componentProps.get('Row')).toBe(props);
  expect(value.context).not.toHaveProperty('emission');
  expect(value.context).not.toHaveProperty('privateRowPropComponents');
  expect(JSON.stringify(value.program)).toBe(before);
});

it.each([
  ['escaped envelope', row.replace("props.item.label += '!'", 'globalThis.save(props)')],
  ['property receiver', row.replace("props.item.label += '!'", 'props.item()')],
  ['computed read', row.replaceAll('props.item', 'props["item"]')],
  ['envelope mutation', row.replace("props.item.label += '!'", 'props.item = {}')],
])('does not prove an unobserved envelope for %s', (_name, declaration) => {
  const value = fixture(declaration);
  const before = JSON.stringify(value.program);
  expect(planPrivateRowProps(value.context,value.path)).toEqual([]);
  expect(JSON.stringify(value.program)).toBe(before);
});

it('rejects escaping factories and dynamic lexical scope before lowering', () => {
  for (const extra of ['export const factory=Row;', 'function inspect(){return eval("Row");}']) {
    const value = fixture(row,extra);
    expect(planPrivateRowProps(value.context,value.path)).toEqual([]);
  }
});

it('returns normalized parameters explicitly and keeps backend ABI eligibility outside the proof', () => {
  const value = fixture(row.replace('const label', '$cleanup(() => {}); const label'));
  const plans = planPrivateRowProps(value.context,value.path);
  expect(plans).toHaveLength(1);
  const backend = Object.assign(createCtx(),value.context);
  initializeGeneratedIdentifiers(backend,value.program);
  const before = JSON.stringify(value.program);
  expect(lowerPrivateRowProps(backend,value.path,plans).size).toBe(0);
  expect(JSON.stringify(value.program)).toBe(before);
});

it('lowers a captured proof with one publication and collision-free lexical parameters', () => {
  const value = fixture(row, 'const _rowProp=1;');
  const plans = planPrivateRowProps(value.context,value.path);
  const sourceProps = value.context.componentProps.get('Row');
  const backend = Object.assign(createCtx(),value.context);
  initializeGeneratedIdentifiers(backend,value.program);
  const result = lowerPrivateRowProps(backend,value.path,plans);
  expect([...result.keys()]).toEqual(['Row']);
  expect(result.get('Row')?.[0]?.type).toBe('ObjectPattern');
  expect(backend.privateRowPropComponents).toEqual(new Set(['Row']));
  expect(value.context.componentProps.get('Row')).toBe(sourceProps);
  const code = printEstree(value.program).code;
  expect(code).not.toContain('props.item');
  expect(code).toContain('props.other');
  expect(code).toContain('item: _rowProp2');
});
