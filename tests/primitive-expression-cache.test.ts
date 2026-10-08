import {beforeAll,beforeEach,afterEach,expect,it,vi} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {compile} from '@memoized-dom/compiler';
import {parseEstreeOrThrow,findNode} from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import {expressionProducesPrimitive} from '../packages/compiler/src/analysis/expression-values';
import {_internals,resetScheduler,setScheduler,unregister} from '@memoized-dom/runtime/testing';

it.each([
  ['value * 2',true], ['value + other',true], ['value instanceof Other',true], ['typeof value',true],
  ['void value()',true], ['`value:${value}`',true], ['flag ? 1 : "one"',true],
  ['(sideEffect(), value * 2)',true], ['null ?? 3n',true], ['(value * 2 as unknown)',true],
  ['value',false], ['value.name',false], ['Number(value)',false], ['value || 1',false],
  ['flag ? 1 : value',false], ['({} as number)',false], ['/pattern/',false], ['({})',false],
] as const)('proves completed primitive results without trusting types: %s',(source,expected)=>{
  const program=parseEstreeOrThrow(`const result=${source};`).program;
  const declaration=findNode(program,node=>node.type==='VariableDeclarator')! as unknown as t.VariableDeclarator;
  const snapshot=()=>JSON.stringify(program,(_key,value)=>typeof value==='bigint'?`${value}n`:value);
  const before=snapshot();
  expect(expressionProducesPrimitive(declaration.init as t.Expression)).toBe(expected);
  expect(snapshot()).toBe(before);
});

beforeAll(()=>{
  const directory=join(import.meta.dirname,'fixtures/out');mkdirSync(directory,{recursive:true});
  for(const kind of ['inline','component']) {
    const code=compile(`function Row({item}){return <li>{item.value*2}</li>;}
      export function App({items}){return <ul>{items.map(item=>${kind==='inline'
        ? '<li key={item.id}>{item.value*2}</li>' : '<Row key={item.id} item={item}/>'})}</ul>;}`);
    expect(code).not.toMatch(/typeof\s+_textValue/);
    writeFileSync(join(directory,`primitive-expression-${kind}.compiled.ts`),code);
  }
});
beforeEach(()=>{
  _internals().registry.forEach((_,id)=>unregister(id));
  setScheduler(run=>run());document.body.replaceChildren();
});
afterEach(()=>{vi.restoreAllMocks();resetScheduler();});

async function mount(kind:string,value:unknown) {
  const specifier=`./fixtures/out/primitive-expression-${kind}.compiled.ts`;
  const {App}=await import(specifier);
  const items=[{id:1,value}];document.body.append(App('App',null,[{items}]));
  const node=document.querySelector('li')!,text=node.firstChild as Text;
  return {items,node,text,render:()=>_internals().registry.get('App')!.render()};
}
for(const kind of ['inline','component']) {
  it(`${kind}: preserves operand reads and repeated opaque numeric coercion`,async()=>{
    let value=1,reads=0,conversions=0;
    const app=await mount(kind,0);
    const opaque={valueOf(){conversions++;return value;}};
    Object.defineProperty(app.items[0],'value',{configurable:true,get(){reads++;return opaque;}});
    const observer=new MutationObserver(()=>{});observer.observe(app.text,{characterData:true});
    app.render();app.render();expect(reads).toBe(2);expect(conversions).toBe(2);
    expect(app.text.data).toBe('2');expect(observer.takeRecords()).toHaveLength(1);
    value=3;app.render();expect(app.text.data).toBe('6');expect(document.querySelector('li')).toBe(app.node);
    observer.disconnect();
  });
  it.each([false,true])(`${kind}: recovers from reentrant coercion (throws=%s)`,async throws=>{
    const app=await mount(kind,1),failure=new Error('coercion');
    app.items[0]!.value={valueOf(){app.items[0]!.value=3;app.render();if(throws)throw failure;return 2;}};
    if(throws)expect(app.render).toThrow(failure);else {app.render();expect(app.text.data).toBe('4');}
    app.render();expect(app.text.data).toBe('6');expect(document.querySelector('li')).toBe(app.node);
  });
  it(`${kind}: invalidates after a text setter throws following a nested update`,async()=>{
    const app=await mount(kind,1),failure=new Error('setter');
    vi.spyOn(app.text,'data','set').mockImplementationOnce(()=>{
      app.items[0]!.value=3;app.render();throw failure;
    });
    app.items[0]!.value=2;expect(app.render).toThrow(failure);
    app.items[0]!.value=2;app.render();expect(app.text.data).toBe('4');
  });
}
