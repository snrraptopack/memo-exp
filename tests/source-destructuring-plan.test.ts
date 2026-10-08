import { expect, it } from 'vitest';
import { analyzeScope, parseEstreeOrThrow, printEstree } from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import { createAnalysisCtx } from '../packages/compiler/src/context/model';
import { scanComponents } from '../packages/compiler/src/analysis/module-scan';
import { scanTransparentSourceImports } from '../packages/compiler/src/analysis/transparent-imports';
import { planSourceDestructuring } from '../packages/compiler/src/planning/source-destructuring';
import { createCtx } from '../packages/compiler/src/dom/context';
import { initializeGeneratedIdentifiers } from '../packages/compiler/src/dom/identifiers';
import { lowerSourceDestructuring } from '../packages/compiler/src/dom/source-destructuring';
import { analyzedComponentExport } from '../packages/compiler/src/components/manifest';

function fixture(body: string, parameters = '') {
  const program = parseEstreeOrThrow(`import {$fetch} from '@memoized-dom/data';
    function App(${parameters}){${body} return <p/>;}`).program;
  const context = createAnalysisCtx();
  const path = {node: program as unknown as t.Program, buildCodeFrameError: (message: string) => new Error(message)};
  scanTransparentSourceImports(context, path);
  scanComponents(context, path);
  const analysis = analyzeScope(program);
  return { program, context, plan: () => planSourceDestructuring(context, path.node, analysis, path) };
}

it('captures alias projections, defaults and array positions without changing authored syntax', () => {
  const value = fixture(`const source=$fetch('/user');const alias=source;
    const {name:label, tags:[,second,...rest], missing='fallback'}=alias;`);
  const before = JSON.stringify(value.program);
  const [plan] = value.plan();
  expect(plan?.entries).toMatchObject([{kind:'project',source:{kind:'binding',name:'source'},projection:{kind:'object',entries:[
    {target:{kind:'binding',identifier:{name:'label'}}},
    {target:{kind:'array',entries:[{index:1,rest:false},{index:2,rest:true}]}},
    {target:{kind:'default',fallback:{value:'fallback'}}},
  ]}}]);
  expect(Object.isFrozen(plan)).toBe(true);
  expect(Object.isFrozen(plan?.entries)).toBe(true);
  expect(JSON.stringify(value.program)).toBe(before);
  expect(value.context).not.toHaveProperty('emission');
});

it('validates a later unsupported projection before earlier declarations change', () => {
  const value = fixture(`const source=$fetch('/user');const {name='fallback'}=source;
    const {name:other,...rest}=source;`);
  const before = JSON.stringify(value.program);
  expect(value.plan).toThrow('[MMD-S004]');
  expect(JSON.stringify(value.program)).toBe(before);
});

it('does not classify a shadowed provider parameter as an imported source', () => {
  expect(fixture(`const {name}=$fetch('/ordinary');`, '$fetch').plan()).toEqual([]);
});

it('accepts a direct component source declaration and rejects nested source creation', () => {
  const [plan] = fixture(`const {name}=$fetch('/user');`).plan();
  expect(plan?.entries).toMatchObject([{kind:'project',source:{kind:'creation'}}]);
  expect(fixture(`function read(){const {name}=$fetch('/user');return name;} read();`).plan).toThrow('[MMD-S004]');
});

it('lowers captured projections without needing the source scope or provider registry again', () => {
  const value = fixture(`const source=$fetch('/user');const {name:label,missing='fallback'}=source;`);
  const plans = value.plan();
  const backend = createCtx();
  initializeGeneratedIdentifiers(backend, value.program);
  lowerSourceDestructuring(backend, plans);
  const code = printEstree(value.program).code;
  expect(code).toContain('label = source.name');
  expect(code).toContain('source.missing');
  expect(code).toContain('=== undefined');
  expect(code).not.toContain('const {');
});

it('publishes backend row eligibility explicitly without adding it to source facts', () => {
  const value = fixture('');
  const before = [...value.context.comps];
  expect(analyzedComponentExport(value.context, './App.tsx', 'App', {listResourceFree:true})).toHaveProperty('listResourceFree',true);
  expect(analyzedComponentExport(value.context, './App.tsx', 'App', {listResourceFree:false})).not.toHaveProperty('listResourceFree');
  expect(value.context).not.toHaveProperty('domOnlyRowComponents');
  expect([...value.context.comps]).toEqual(before);
});

it('keeps nested declaration placement inside a retained default callback', () => {
  const value = fixture(`const source=$fetch('/user');
    const {callback=()=>{const {name}=source;return name;}}=source;`);
  const plans = value.plan();
  const backend = createCtx();
  initializeGeneratedIdentifiers(backend, value.program);
  lowerSourceDestructuring(backend, plans);
  const code = printEstree(value.program).code;
  expect(code).not.toContain('const {');
  expect(code).toContain('name = source.name');
});
