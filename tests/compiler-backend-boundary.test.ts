import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join,resolve,relative,dirname} from 'node:path';
import {expect,it} from 'vitest';
import {parseEstreeOrThrow,walkAst,childNode,stringValue} from '../packages/compiler/src/ast';
import {createAnalysisCtx} from '../packages/compiler/src/context/model';
import {createCtx} from '../packages/compiler/src/dom/context';
import {allocateInstanceReasons} from '../packages/compiler/src/dom/instance-reasons';
import {scanExternalReactiveImports} from '../packages/compiler/src/analysis/external-reactivity';
import {requirePresentationOwner} from '../packages/compiler/src/planning/presentation-ownership';
import {allocatePresentationParameter} from '../packages/compiler/src/dom/presentation-parameters';
import {initializeGeneratedIdentifiers} from '../packages/compiler/src/dom/identifiers';
import type * as t from '../packages/compiler/src/ast/compiler-types';

const sourceRoot=resolve(import.meta.dirname,'../packages/compiler/src');
function sourceFiles(directory:string):string[] {
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>
    entry.isDirectory()?sourceFiles(join(directory,entry.name)):
      entry.name.endsWith('.ts')?[join(directory,entry.name)]:[]);
}

it('shared analysis, planning and context cannot import DOM lowering or runtime types',()=>{
  const files=['analysis','planning','context'].flatMap(folder=>sourceFiles(join(sourceRoot,folder)));
  files.push(join(sourceRoot,'context.ts'));
  files.push(join(sourceRoot,'components/manifest.ts'));
  const violations:string[]=[];
  const visited=new Set<string>();
  const pending=files.map(file=>({file,path:[relative(sourceRoot,file)]}));
  while(pending.length) {
    const {file,path}=pending.pop()!;
    if(visited.has(file))continue;
    visited.add(file);
    const program=parseEstreeOrThrow(readFileSync(file,'utf8'),{filename:file}).program;
    walkAst(program,{enter(node){
      if(!['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type))return;
      const source=stringValue(childNode(node,'source'));
      if(source===null)return;
      const target=source.startsWith('.')?relative(sourceRoot,resolve(file,'..',source)).replaceAll('\\','/'):source;
      if(/^(dom|emission)(\/|$)/.test(target)||/^@memoized-dom\/runtime(?:\/|$)/.test(target))
        violations.push([...path,source].join(' -> '));
      else if(source.startsWith('.')) {
        const absolute=resolve(dirname(file),source);
        const dependency=[`${absolute}.ts`,join(absolute,'index.ts')].find(existsSync);
        if(dependency)pending.push({file:dependency,path:[...path,relative(sourceRoot,dependency)]});
      }
    }});
  }
  expect(violations).toEqual([]);
});

it('source analysis can be constructed without a DOM allocator or host plans',()=>{
  const context=createAnalysisCtx({moduleId:'./source-only.tsx'});
  expect(context.stateKeys.size).toBe(0);
  expect(Object.keys(context).filter(key=>/^(emission|initialDom|initialServer|initialBrowser|domOnly|instanceReasonIds|analyzedFunctions|callbackPublications|handlerHasRootCommit|routeCallsiteIds|routeContextParams|externalReactiveImports|presentationParameters)/.test(key))).toEqual([]);
  expect(context).not.toHaveProperty('transparentPolicyParams');
  expect(context).not.toHaveProperty('transparentInheritedOnlyPolicyParams');
  expect(context).not.toHaveProperty('privateRowPropComponents');
});

it('records presentation ownership without parameters and keeps local policy ahead of inheritance',()=>{
  const context=createAnalysisCtx();
  requirePresentationOwner(context,'Bridge','inherited');
  const local=requirePresentationOwner(context,'Bridge');
  expect(requirePresentationOwner(context,'Bridge','inherited')).toBe(local);
  expect([...context.presentationOwners]).toEqual([
    ['Bridge',{component:'Bridge',mode:'local'}],
  ]);
  expect(context).not.toHaveProperty('presentationParameters');
});

it('allocates a presentation ABI without changing source ownership or shadowing authored bindings',()=>{
  const context=createCtx();
  const program=parseEstreeOrThrow('const _dataPolicies=1;', {filename:'./policies.ts'}).program;
  initializeGeneratedIdentifiers(context,program);
  const owner=requirePresentationOwner(context,'View');
  const before=JSON.stringify([...context.presentationOwners]);
  const parameter=allocatePresentationParameter(context,owner);
  expect(parameter.name).not.toBe('_dataPolicies');
  expect(allocatePresentationParameter(context,owner)).toBe(parameter);
  expect(JSON.stringify([...context.presentationOwners])).toBe(before);
  expect(()=>allocatePresentationParameter(context,{component:'Missing',mode:'local'})).toThrow('missing analyzed presentation owner');
});

it('allocates deterministic runtime reasons from complete source facts in the backend',()=>{
  const context=createCtx();
  context.instanceReasonSources.set('View',new Set(['z','items\0memo-dom:owner-list-structure','items']));
  context.instanceReasonSources.set('Other',new Set());
  const sources=[...context.instanceReasonSources.get('View')!];
  allocateInstanceReasons(context);
  expect([...context.instanceReasonIds.get('View')!]).toEqual([
    ['items',0],['items\0memo-dom:owner-list-structure',1],['z',2],
  ]);
  expect([...context.instanceReasonSources.get('View')!]).toEqual(sources);
  expect(context.instanceReasonIds.get('Other')!.size).toBe(0);
  context.instanceReasonSources.delete('Other');
  allocateInstanceReasons(context);
  expect(context.instanceReasonIds.has('Other')).toBe(false);
});

it('captures external subscription metadata in source-only analysis without generating bindings',()=>{
  const context=createAnalysisCtx({externalReactiveSources:[{
    module:'external-store',source:'value',subscribe:{module:'external-store/adapter',export:'observe'},
  }]});
  const program=parseEstreeOrThrow("import {value as first,value as second} from 'external-store';",{filename:'./external.ts'}).program;
  const before=JSON.stringify(program);
  scanExternalReactiveImports(context,{node:program as unknown as t.Program});
  expect([...context.externalReactiveBindings]).toEqual([
    ['first',{module:'external-store/adapter',export:'observe'}],
    ['second',{module:'external-store/adapter',export:'observe'}],
  ]);
  expect(context.importedState.has('first')).toBe(true);
  expect(context.state.get('first')).toBe('computed');
  expect(JSON.stringify(program)).toBe(before);
  expect(context).not.toHaveProperty('externalReactiveImports');
});
