import {expect, it} from 'vitest';
import {analyzeScope, cloneNode, findNode, parseEstreeOrThrow, printEstree, type BaseNode} from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import { createCtx } from '../packages/compiler/src/dom/context';
import { initializeGeneratedIdentifiers } from '../packages/compiler/src/dom/identifiers';
import {planModuleSources} from '../packages/compiler/src/planning/module-sources';
import {lowerModuleSourceDeclarations} from '../packages/compiler/src/features/data-sources/module-sources';
import {sourceEffectInputs} from '../packages/compiler/src/effects/source-inputs';

const catalog = {sources: new Set(['$fetch', '$read', '$forms']), forms: new Set(['$forms']), reads: new Set(['$read'])};
const errorAt = {buildCodeFrameError: (message: string) => new Error(message)};
function fixture(source: string) {
  const program = parseEstreeOrThrow(`import {$fetch,$read,$forms} from '@memoized-dom/data';${source}`).program;
  const analysis = analyzeScope(program);
  const before = JSON.stringify(program);
  const plans = planModuleSources(program as unknown as t.Program, analysis, './source.ts', catalog, errorAt);
  return {program, analysis, before, plans};
}

it('plans declaration identity, canonical keys and owned request inputs without target state', () => {
  const value = fixture(`let search='Ada';export const users=$fetch('/users',{query:{search}}), detail=$fetch('/detail');`);
  expect(JSON.stringify(value.program)).toBe(value.before);
  expect(value.plans).toHaveLength(1);
  const [users, detail] = value.plans[0]!.sources;
  expect(users).toMatchObject({kind: 'fetch', name: 'users', key: './source.ts#users'});
  expect(users!.inputs.map(input => input.name)).toEqual(['search']);
  expect(users!.inputs[0]!.binding).toBe(value.analysis.rootScope.getBinding('search'));
  expect(detail!.inputs).toEqual([]);
  const initializer = users!.declarator.init as t.CallExpression;
  expect(users!.kind === 'fetch' && users.target).not.toBe(initializer.arguments[0]);
  expect(Object.isFrozen(value.plans)).toBe(true);
  expect(Object.isFrozen(users)).toBe(true);expect(Object.isFrozen(users!.inputs)).toBe(true);
});

it.each([
  ["{query:{search:'fixed'}}", []],
  ['{query:{search}}', ['search']],
  ["{query:{[search]:'fixed'}}", ['search']],
  ['{query:{term:search}}', ['search']],
  ["{query:headers.search}", ['headers']],
  ["{parse:(search)=>search}", []],
  ["{parse:()=>search}", ['search']],
  ["{parse:function search(value){return value;}}", []],
  ["{parse:function(){const search='local';return search;}}", []],
  ['{parse:(value=search)=>value}', ['search']],
  ['({query:{search:"fixed"}} as Options)', []],
] as const)('uses lexical references in %s', (options, names) => {
  const value = fixture(`import type {Options} from './types';let search='Ada';const headers={search:'fixed'};const users=$fetch('/users',${options});`);
  expect(value.plans[0]!.sources[0]!.inputs.map(input => input.name)).toEqual(names);
});

it('retains module helper and captured references while deduplicating their identity', () => {
  const value = fixture(`let search='Ada';function target(){return '/'+search;}
    const user=$fetch(target(),{query:{search,other:search},parse:()=>search});`);
  expect(value.plans[0]!.sources[0]!.inputs.map(input => input.name)).toEqual(['target', 'search']);
});

it('does not register forms, nested sources or an authored factory lookalike', () => {
  const value = fixture(`const form=$forms(fields=>fields.get('name'));
    function local($fetch){const user=$fetch('/local');return user;}
    function owner(){const user=$fetch('/owned');return user;}`);
  expect(value.plans).toEqual([]);
  const program = parseEstreeOrThrow('function $fetch(input){return input;}const user=$fetch("/users");').program;
  expect(planModuleSources(program as unknown as t.Program, analyzeScope(program), './source.ts', catalog, errorAt)).toEqual([]);
});

it('recognizes a provider import alias without guessing backend names', () => {
  const program = parseEstreeOrThrow('import {$fetch as fetchUser} from "@memoized-dom/data";export const user=fetchUser("/user");').program;
  const plans = planModuleSources(program as unknown as t.Program, analyzeScope(program), './source.ts',
    {sources: new Set(['fetchUser']), forms: new Set(), reads: new Set()}, errorAt);
  expect(plans[0]!.sources[0]).toMatchObject({kind: 'fetch', key: './source.ts#user'});
});

it('lowers owned inputs and recorded references after the source and scope are changed', () => {
  const value = fixture("let search='Ada';export const users=$fetch('/users',{query:{search}});");
  const ctx = createCtx();initializeGeneratedIdentifiers(ctx, value.program);
  ctx.astAnalysis = analyzeScope(parseEstreeOrThrow('const unrelated=0;').program);
  value.plans[0]!.sources[0]!.declarator.init = ({type: 'Literal', value: 'changed'} as unknown as t.Expression);
  lowerModuleSourceDeclarations(ctx, value.program as unknown as t.Program, value.plans);
  const output = printEstree(value.program).code;
  expect(output).toContain("createSource('/users'");
  expect(output).toContain('rebindModuleSource');expect(output).not.toContain('changed');
  expect(ctx.transparentModuleSources.get('users')).toBe('./source.ts#users');
  const effect = findNode(value.program, node => node.type === 'CallExpression' &&
    (node as unknown as t.CallExpression).callee.type === 'Identifier' &&
    ((node as unknown as t.CallExpression).callee as t.Identifier).name === '$effect');
  expect(effect).not.toBeNull();expect(ctx.compilerLifecycleCalls.get(effect!)).toBe('effect');
});

it('preserves description/declaration/effect order for multiple sources in a statement', () => {
  const value = fixture('let target="/users";const first=$fetch(target),second=$fetch(target);');
  const ctx = createCtx();initializeGeneratedIdentifiers(ctx, value.program);
  lowerModuleSourceDeclarations(ctx, value.program as unknown as t.Program, value.plans);
  const output = printEstree(value.program).code;
  const declarations = output.indexOf('const first');
  expect(output.indexOf('describeModuleSource("./source.ts#first"')).toBeLessThan(declarations);
  expect(output.indexOf('describeModuleSource("./source.ts#second"')).toBeLessThan(declarations);
  expect(output.indexOf('rebindModuleSource')).toBeGreaterThan(declarations);
});

it('carries the replay operation of a lazy module read', () => {
  const value = fixture('let id=1;const user=$read(Promise.resolve({id}),()=>Promise.resolve({id}));');
  const source = value.plans[0]!.sources[0]!;
  expect(source).toMatchObject({kind: 'read'});
  expect(source.inputs.map(input => input.name)).toEqual(['id']);
  if (source.kind !== 'read') throw Error('Expected read');
  expect(printEstree(source.replay as unknown as BaseNode).code).toContain('Promise.resolve');
  const ctx = createCtx();initializeGeneratedIdentifiers(ctx, value.program);
  lowerModuleSourceDeclarations(ctx, value.program as unknown as t.Program, value.plans);
  const output = printEstree(value.program).code;
  expect(output).toContain('createReadSource');expect(output).toContain('rebindReadModuleSource');
  const effect = findNode(value.program, node => node.type === 'CallExpression' &&
    (node as unknown as t.CallExpression).callee.type === 'Identifier' &&
    ((node as unknown as t.CallExpression).callee as t.Identifier).name === '$effect')!;
  expect(sourceEffectInputs(cloneNode(effect, true))).toEqual(['id']);
  expect(output).not.toContain('__memoDomSourceEffectInputs');
});

it('captures deferred reads through a closed replay alias before lowering', () => {
  const value = fixture('let id=1;function load(){return Promise.resolve().then(()=>({id}));}const replay=load;const user=$read(Promise.resolve({id:1}),replay);');
  expect(value.plans[0]!.sources[0]!.inputs.map(input => input.name)).toEqual(['replay', 'id']);
});

it('keeps helper-local shadows out of source inputs and terminates recursive helper discovery', () => {
  const value = fixture('let id=1;function load(id){if(id)return load(0);return Promise.resolve({id});}const user=$read(load(1),()=>load(1));');
  expect(value.plans[0]!.sources[0]!.inputs.map(input => input.name)).toEqual(['load']);
});

it('retains read inputs and excludes plain/destructured write targets in replay callbacks', () => {
  const value = fixture('let id=1,observed=0,other=0;const user=$read(Promise.resolve(),()=>Promise.resolve().then(()=>{observed=id;({other}= {other:id});return {id};}));');
  expect(value.plans[0]!.sources[0]!.inputs.map(input => input.name)).toEqual(['id']);
});

it('reports a missing read replay before earlier sources allocate or mutate target state', () => {
  const program = parseEstreeOrThrow('import {$fetch,$read} from "@memoized-dom/data";const first=$fetch("/user"),second=$read(...args);').program;
  const before = JSON.stringify(program);
  const ctx = createCtx();initializeGeneratedIdentifiers(ctx, program);
  expect(() => planModuleSources(program as unknown as t.Program, analyzeScope(program), './source.ts', catalog, errorAt)).toThrow('promise expression and a replay expression');
  expect(JSON.stringify(program)).toBe(before);expect(ctx.transparentModuleSources.size).toBe(0);
  expect(ctx.usesTransparentData).toBe(false);
});
