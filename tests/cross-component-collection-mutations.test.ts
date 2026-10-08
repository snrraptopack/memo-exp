import {afterEach,expect,it} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileModules} from '@memoized-dom/compiler';
import {registeredIds,unregisterSubtree,setScheduler,resetScheduler} from '@memoized-dom/runtime/testing';

afterEach(()=>{
  for(const id of registeredIds())unregisterSubtree(id);
  resetScheduler();document.body.replaceChildren();
});

it.each(['module','component'].flatMap(location=>['named','object'].map(props=>({location,props}))))(
  'updates parent and sibling readers after a child mutates a forwarded array ($location, $props)',async({location,props})=>{
    const items="const items=[{id:1,label:'one'}];";
    const output=compileModules({
      './main.ts':"import {mount} from '@memoized-dom/runtime/testing';import {App} from './App';mount('root',App);",
      './App.tsx':`import {Editor} from './Editor';${location==='module'?items:''}
        export function App(){${location==='component'?items:''}return <main>
          <Editor items={items}/><output>{items.length}</output>
          <ul>{items.map(item=><li key={item.id}>{item.label}</li>)}</ul></main>;}`,
      './Editor.tsx':"import {Action} from './Action';export function Editor({items}){return <Action list={items}/>;}",
      './Action.tsx':`export function Action(${props==='named'?'{list}':'props'}){
        return <button onClick={()=>{const target=${props==='named'?'list':'props.list'};
          target.push({id:target.length+1,label:'new'});target[0].label='changed';}}>Add</button>;}`,
    },{runtimePath:'@memoized-dom/runtime/testing'});
    const directory=join(import.meta.dirname,'fixtures/out/cross-component-collection',`${location}-${props}`);
    mkdirSync(directory,{recursive:true});
    for(const [file,code]of Object.entries(output))writeFileSync(join(directory,file),code);
    const {App}=await import(/* @vite-ignore */pathToFileURL(join(directory,'App.tsx')).href);
    setScheduler(run=>run());document.body.append(App('App',null));
    const retained=document.querySelector('li');
    for(const count of [2,3]){
      document.querySelector<HTMLButtonElement>('button')!.click();
      expect(document.querySelector('output')!.textContent).toBe(String(count));
      expect([...document.querySelectorAll('li')].map(node=>node.textContent)).toEqual(['changed',...Array(count-1).fill('new')]);
      expect(document.querySelector('li')).toBe(retained);
    }
  },
);
