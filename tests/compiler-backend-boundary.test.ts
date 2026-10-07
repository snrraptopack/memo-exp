import {readFileSync,readdirSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {expect,it} from 'vitest';
import {parseEstreeOrThrow,walkAst,childNode,stringValue} from '../packages/compiler/src/ast';
import {createAnalysisCtx} from '../packages/compiler/src/context/model';

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
  for(const file of files) {
    const program=parseEstreeOrThrow(readFileSync(file,'utf8'),{filename:file}).program;
    walkAst(program,{enter(node){
      if(!['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type))return;
      const source=stringValue(childNode(node,'source'));
      if(source===null)return;
      const target=source.startsWith('.')?relative(sourceRoot,resolve(file,'..',source)).replaceAll('\\','/'):source;
      if(/^(dom|emission)(\/|$)/.test(target)||/^@memoized-dom\/runtime(?:\/|$)/.test(target))
        violations.push(`${relative(sourceRoot,file)} -> ${source}`);
    }});
  }
  expect(violations).toEqual([]);
});

it('source analysis can be constructed without a DOM allocator or host plans',()=>{
  const context=createAnalysisCtx({moduleId:'./source-only.tsx'});
  expect(context.stateKeys.size).toBe(0);
  expect(Object.keys(context).filter(key=>/^(emission|initialDom|initialServer|initialBrowser|domOnly)/.test(key))).toEqual([]);
});
