import {expect, it} from 'vitest';
import {
  analyzeScope, findNode, parseEstreeOrThrow, printEstree, type BaseNode,
} from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import { createCtx } from '../packages/compiler/src/dom/context';
import { initializeGeneratedIdentifiers } from '../packages/compiler/src/dom/identifiers';
import {planReadReplays} from '../packages/compiler/src/planning/read-replay';
import {lowerReadReplays} from '../packages/compiler/src/dom/read-replay';

function fixture(source: string) {
  const program = parseEstreeOrThrow(`import {$read} from '@memoized-dom/data';${source}`).program;
  const analysis = analyzeScope(program);
  const plans = planReadReplays(program as unknown as t.Program, analysis, new Set(['$read']));
  return {program, analysis, plans};
}

function lower(value: ReturnType<typeof fixture>) {
  const ctx = createCtx();
  initializeGeneratedIdentifiers(ctx, value.program);
  lowerReadReplays(ctx, value.plans);
  return printEstree(value.program).code;
}

it('owns replay expressions without modifying source or allocating target identifiers', () => {
  const value = fixture('function App(){const promise=load(id);const alias=promise;return $read(alias);}');
  const before = JSON.stringify(value.program);
  expect(printEstree(value.plans[0]!.expression as unknown as BaseNode).code).toBe('load(id)');
  expect(value.plans[0]!.placement).toBeUndefined();
  const call = findNode(value.program, node => node.type === 'CallExpression' &&
    (node as unknown as t.CallExpression).callee.type === 'Identifier' &&
    ((node as unknown as t.CallExpression).callee as t.Identifier).name === 'load')!;
  (call as unknown as t.CallExpression).arguments = [{type: 'Literal', value: 'changed'} as unknown as t.Expression];
  expect(lower(value)).toContain('$read(alias, () => load(id))');
  expect(before).not.toBe(JSON.stringify(value.program));
  expect(Object.isFrozen(value.plans)).toBe(true);
  expect(Object.isFrozen(value.plans[0])).toBe(true);
});

it('source planning leaves the authored tree and its analysis untouched', () => {
  const value = fixture('const promise=load(id);function App(){return $read(promise);}');
  const before = JSON.stringify(value.program);
  planReadReplays(value.program as unknown as t.Program, value.analysis, new Set(['$read']));
  expect(JSON.stringify(value.program)).toBe(before);
  expect(value.plans[0]!.origin).toBeDefined();
  expect(value.plans[0]!.placement?.kind).toBe('declarators');
});

it.each([
  ['const {promise}=box;return $read(promise);', 'promise'],
  ['const [promise]=box;return $read(promise);', 'promise'],
  ['let promise=load(id);return $read(promise);', 'promise'],
  ['const promise=load(id);promise=other;return $read(promise);', 'promise'],
  ['return $read(input);', 'input'],
  ['return $read(load(id));', 'load(id)'],
  ['const promise=load(id);const alias=(promise as Promise<unknown>)!;return $read(alias);', 'load(id)'],
  ['const a=b;const b=a;return $read(a);', 'a'],
] as const)('plans conservative source %s', (source, expression) => {
  const value = fixture(`function App(input){${source}}`);
  expect(printEstree(value.plans[0]!.expression as unknown as BaseNode).code).toBe(expression);
});

it('recognizes imported aliases and leaves shadowed or explicitly replayed reads alone', () => {
  const program = parseEstreeOrThrow(`import {$read as read} from '@memoized-dom/data';
    function local(read){return read(load());}const first=read(load());const second=read(load(),()=>other());`).program;
  const plans = planReadReplays(program as unknown as t.Program, analyzeScope(program), new Set(['read']));
  expect(plans).toHaveLength(1);
  expect((plans[0]!.call.callee as t.Identifier).name).toBe('read');
});

it('shares one original-scope factory across crossing reads and reserves descendant names', () => {
  const value = fixture(`const endpoint='outer';const promise=load(endpoint);const alias=promise;
    function first(){const _readReplay=0;const endpoint='shadow';return $read(alias);}
    function second(){return $read(promise);}`);
  const output = lower(value);
  expect(output.match(/=> load\(endpoint\)/g)).toHaveLength(1);
  const first = value.plans[0]!.call.arguments[1] as t.Identifier;
  const second = value.plans[1]!.call.arguments[1] as t.Identifier;
  expect(first.name).toBe(second.name);
  expect(first.name).not.toBe('_readReplay');
});

it('does not export the generated replay factory of an exported promise', () => {
  const value = fixture('export const promise=load();function App(){return $read(promise);}');
  const output = lower(value);
  expect(output).toMatch(/const _readReplay = \(\) => load\(\);\s*export const promise = load\(\);/);
  expect(output).not.toContain('export const _readReplay');
});

it('retains lexical this and arguments from the original function on retry', async () => {
  const value = fixture(`function owner(input){const promise=Promise.resolve(this.prefix+arguments[0]);
    return function child(){return $read(promise);};}`);
  const output = lower(value);
  const body = output.replace(/import[^;]+;/, '');
  const owner = new Function('$read', `${body};return owner;`)((promise: Promise<string>, replay: () => Promise<string>) => ({promise, replay}));
  const read = owner.call({prefix: 'outer:'}, 'value').call({prefix: 'shadow:'}, 'wrong');
  expect(await read.promise).toBe('outer:value');
  expect(await read.replay()).toBe('outer:value');
});

it('retains a block-scoped initializer next to its declarator without changing initial evaluation order', async () => {
  const value = fixture(`function owner(){let calls=0;const first=++calls,promise=Promise.resolve(++calls),last=++calls;
    {const calls=100;return [$read(promise),first,last,()=>calls];}}`);
  const output = lower(value).replace(/import[^;]+;/, '');
  const owner = new Function('$read', `${output};return owner;`)((promise: Promise<number>, replay: () => Promise<number>) => ({promise, replay}));
  const [read, first, last, calls] = owner();
  expect(first).toBe(1);expect(last).toBe(3);expect(calls()).toBe(100);
  expect(await read.promise).toBe(2);expect(await read.replay()).toBe(4);
});
