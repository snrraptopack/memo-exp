import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join,resolve,relative,dirname} from 'node:path';
import {expect,it} from 'vitest';
import {parseEstreeOrThrow,walkAst,childNode,stringValue} from '../packages/compiler/src/ast';
import {createAnalysisCtx} from '../packages/compiler/src/context/model';
import {createCtx} from '../packages/compiler/src/dom/context';
import {allocateInstanceReasons} from '../packages/compiler/src/dom/instance-reasons';

const sourceRoot=resolve(import.meta.dirname,'../packages/compiler/src');
function sourceFiles(directory:string):string[] {
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>
    entry.isDirectory()?sourceFiles(join(directory,entry.name)):
      entry.name.endsWith('.ts')?[join(directory,entry.name)]:[]);
}

it('shared analysis, planning and context cannot import DOM lowering or runtime types',()=>{
  const files=['analysis','planning','context'].flatMap(folder=>sourceFiles(join(sourceRoot,folder)));
  files.push(join(sourceRoot,'context.ts'));
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
  expect(Object.keys(context).filter(key=>/^(emission|initialDom|initialServer|initialBrowser|domOnly|instanceReasonIds|analyzedFunctions|callbackPublications|handlerHasRootCommit)/.test(key))).toEqual([]);
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
