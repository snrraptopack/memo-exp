import { expect, it } from 'bun:test';
import { parseEstreeOrThrow, printEstree } from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import { createAnalysisCtx, refreshAstAnalysis } from '../packages/compiler/src/context';
import { scanComponents } from '../packages/compiler/src/analysis/module-scan';
import { scanTransparentSourceImports } from '../packages/compiler/src/analysis/transparent-imports';
import { scanComponentSources, scanEventSourceAssignments, registerTransparentSourceRoots } from '../packages/compiler/src/analysis/transparent-sources';
import { planSourcePropProjections } from '../packages/compiler/src/planning/source-props';
import { createCtx } from '../packages/compiler/src/dom/context';
import { initializeGeneratedIdentifiers } from '../packages/compiler/src/dom/identifiers';
import { lowerSourcePropProjections } from '../packages/compiler/src/dom/components/transparent-props';

function fixture(body:string,parameters='props') {
  const program = parseEstreeOrThrow(`import {$fetch} from '@memoized-dom/data';
    const _userSource=1;export function View(${parameters}){${body}}`).program;
  const context = createAnalysisCtx({linkedComponentPropSources:{View:{user:{keys:[],rootFallback:false,transparent:true}}}});
  const path = {node:program as unknown as t.Program,buildCodeFrameError:(message:string)=>new Error(message)};
  refreshAstAnalysis(context,path.node);
  scanTransparentSourceImports(context,path);
  scanComponents(context,path);
  return {program,context,path};
}

it('captures member reads by lexical identity without changing props or shadowed reads', () => {
  const value = fixture(`const nested=props=>props.user;return <p>{props.user.name}:{props['user'].age}</p>;`);
  const before = JSON.stringify(value.program);
  const [plan] = planSourcePropProjections(value.context,'View');
  expect(plan).toMatchObject({kind:'object',prop:'user',objectBinding:'props'});
  if (plan?.kind !== 'object') throw new Error('Missing object projection');
  expect(plan.reads).toHaveLength(2);
  expect(Object.isFrozen(plan.reads)).toBe(true);
  expect(JSON.stringify(value.program)).toBe(before);
  expect(value.context).not.toHaveProperty('emission');
});

it('uses the authored local binding for destructured and renamed source props', () => {
  const value = fixture('return <p>{profile.name}</p>;','{user:profile}');
  expect(planSourcePropProjections(value.context,'View')).toEqual([{kind:'binding',prop:'user',binding:'profile'}]);
  expect(planSourcePropProjections(value.context,'Missing')).toEqual([]);
});

it('returns normalized names explicitly and consumes them in source-only discovery', () => {
  const value = fixture('return <p>{props.user.name}</p>;');
  const plan = planSourcePropProjections(value.context,'View');
  const backend = createCtx();
  initializeGeneratedIdentifiers(backend,value.program);
  const normalized = lowerSourcePropProjections(backend,plan);
  expect([...normalized]).toEqual([['_userSource2','user']]);
  expect(backend.compPaths.size).toBe(0);
  expect(backend.transparentSourceProps.size).toBe(0);
  refreshAstAnalysis(value.context,value.path.node);
  scanComponentSources(value.context,'View',normalized);
  expect(value.context.transparentSources.get('View')).toEqual(new Set(['_userSource2']));
  expect(value.context.transparentSourceProps.get('View')).toEqual(new Map(normalized));
  expect(printEstree(value.program).code).toContain('const _userSource2 = props.user;');
});

it('discovers event holders and derivation roots without allocating runtime slots', () => {
  const value = fixture(`let user=null;return <button onClick={()=>{user=$fetch('/profile');}}>{user?.name}</button>;`,'');
  value.context.instanceState.set('View',new Set(['user']));
  const before = JSON.stringify(value.program);
  scanEventSourceAssignments(value.context);
  registerTransparentSourceRoots(value.context);
  expect(value.context.eventSourceSlots.get('View')).toEqual(new Set(['user']));
  expect(value.context.transparentSources.get('View')).toEqual(new Set(['user']));
  expect(value.context.opaqueBindings.get('View')).toEqual(new Set(['user']));
  expect(value.context).not.toHaveProperty('presentationParameters');
  expect(JSON.stringify(value.program)).toBe(before);
});
