import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileModules } from '@memoized-dom/compiler';
import { build } from 'esbuild';
import { rowStyles, statePlacements, updateStyles } from './state-placement-matrix';
import { updateStyleSource } from './update-style-source';

const directory = import.meta.dirname;
const output = resolve(directory, 'dist/update-style');
mkdirSync(output, {recursive:true});
const data = readFileSync(resolve(directory,'data.ts'),'utf8');
const imports: string[] = [], entries: string[] = [];
for (const placement of statePlacements) for (const rows of rowStyles) for (const style of updateStyles) {
  const name = `${placement.id}-${rows}-${style}`, rootId = 'UpdateStyle_' + name.replaceAll('-','_');
  const moduleId = `./bench/dom/dist/update-style/${name}.tsx`;
  const compiled = compileModules({
    [moduleId]: updateStyleSource(placement,rows,style,rootId),
    './bench/dom/data.ts': data,
    './bench/dom/dist/update-style/entry.ts': `import {mount} from '@memoized-dom/runtime'; import {${rootId}} from './${name}'; mount('root',${rootId});`,
  })[moduleId]!;
  writeFileSync(resolve(output,name+'.ts'),compiled);
  const binding = 'App' + imports.length;
  imports.push(`import {${rootId} as ${binding}} from './${name}';`);
  entries.push(`{id:'${name}', placement:'${placement.id}', rows:'${rows}', style:'${style}', rootId:'${rootId}', create:() => ${binding}('${rootId}',null) as HTMLElement}`);
}
writeFileSync(resolve(output,'apps.ts'),imports.join('\n') + '\nexport const variants = [' + entries.join(',\n') + '];\n');
await build({entryPoints:[resolve(directory,'update-style-browser.ts')],outfile:resolve(output,'browser.js'),
  bundle:true,format:'iife',minify:true,define:{'process.env.NODE_ENV':'"production"'}});
console.log('Compiled and bundled 16 mutable/immutable DOM variants.');
