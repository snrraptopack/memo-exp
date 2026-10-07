import { expect, it } from 'vitest';
import { compileModulesDetailed } from '@memoized-dom/compiler';
import { analyzeScope, parseEstreeOrThrow } from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import { planBodylessFetchImports } from '../packages/compiler/src/planning/fetch-encoding';

function plan(body: string) {
  const program = parseEstreeOrThrow(`import {$fetch as request} from '@memoized-dom/data';${body}`).program;
  const before = JSON.stringify(program);
  const plans = planBodylessFetchImports(program as unknown as t.Program, analyzeScope(program), new Set(['request']));
  expect(JSON.stringify(program)).toBe(before);
  return plans;
}

it.each([
  "request('/user')",
  "request('/user',undefined)",
  "request('/user',{})",
  "request('/user',{query:{name},headers:{accept:'application/json'}})",
  "request('/user',{method:'head'})",
  "request('/user',({cache:false} as Options))",
])('proves direct request inputs in %s', call => {
  const plans = plan(`let name='Ada';${call};`);
  expect(plans).toHaveLength(1);
  expect(plans[0]!.specifier.local.name).toBe('request');
  expect(Object.isFrozen(plans)).toBe(true);
});

it.each([
  "request('/user',{method:'POST',body:{name:'Ada'}})",
  "request('/user',{body:undefined})",
  "request('/user',options)",
  "request('/user',{...options})",
  "request('/user',{[key]:value})",
  "request('/user',{get query(){return {};}})",
  "request('/user',{__proto__:options})",
  "request('/user',{method})",
  "request('/user');send(request)",
  "request('/user');export {request}",
  "request(...args)",
  "request('/user',undefined);const undefined={body:'data'}",
])('retains full encoding for uncertain inputs or an escaping provider in %s', call => {
  expect(plan(call)).toHaveLength(0);
});

it('uses lexical references and retains a module with mixed request methods', () => {
  expect(plan("request('/user');function local(request){return request('/local',{body:'local'});}")).toHaveLength(1);
  expect(plan("request('/user');request('/action',{method:'POST',body:'data'});")).toHaveLength(0);
});

it('lowers module and component fetches while preserving their source ownership', () => {
  const compiled = compileModulesDetailed({
    './session.ts': "export const user=$fetch('/user');",
    './App.tsx': "import {user} from './session';export function App(){let name='Ada';const detail=$fetch('/detail',{query:{name}});return <main><button onClick={()=>name='Lin'}>Change</button><p>{user?.name}{detail?.name}</p></main>;}",
  }).output;
  expect(compiled['./session.ts']).toContain('createBodylessSource');
  expect(compiled['./session.ts']).toContain('describeModuleSource');
  expect(compiled['./App.tsx']).toContain('createBodylessSource');
  expect(compiled['./App.tsx']).toContain('rebindResolvedValue');
});

it('preserves the generic provider when runtime data helpers are customized', () => {
  const compiled = compileModulesDetailed({
    './App.tsx': "export function App(){const user=$fetch('/user');return <main>{user?.name}</main>;}",
  }, {dataRuntimePath: './custom-data'}).output;
  expect(compiled['./App.tsx']).not.toContain('createBodylessSource');
});
