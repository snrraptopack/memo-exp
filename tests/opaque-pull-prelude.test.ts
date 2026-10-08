import { stubGlobal, unstubAllGlobals } from '../test-support/helpers';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'bun:test';
import { compileModules } from '@memoized-dom/compiler';
import {
  _internals, markDirty, resetAccessTable, resetScheduler, setScheduler, unregister,
} from '@memoized-dom/runtime/testing';

const directory = join(import.meta.dirname, 'fixtures/out/opaque-pull-prelude');
const source = `import {clock} from './external';
  export function App() {
    let a=0,b=0;
    const resource=clock;
    const derived='count:'+a;
    const label=derived+':'+b;
    const unknown=resource.value+':'+a;
    const inc=()=>{a++;};
    return <main><p class="safe">{label}</p><p class="unknown">{unknown}</p>
      <p class="clock">{clock.value}</p>
      <button class="a" onClick={inc}>a</button>
      <button class="b" onClick={()=>{b++;}}>b</button></main>;
  }`;
function compile(text: string) {
  return compileModules({'./app.tsx':text})['./app.tsx']!;
}
function hasNarrowPrelude(code: string) {
  return /reasonsHit\([^\n]+, false\)\)\s*\{\s*derived =/.test(code);
}

it('excludes pull-only reasons from proven primitive derivation replay',()=>{
  const code=compile(source);
  expect(code).toContain('volatile: true');
  expect(hasNarrowPrelude(code)).toBe(true);
  // An adjacent calculation with the same sources must retain its own policy.
  expect(code).not.toMatch(/reasonsHit\([^\n]+, false\)\)\s*\{[^}]*unknown =/);
});

it.each([
  "'count:'+a", 'a*2', 'a>2 ? a : b', 'a || b', '`count:${a}`',
])('narrows primitive calculation %s',expression=>{
  expect(hasNarrowPrelude(compile(source.replace("'count:'+a",expression)))).toBe(true);
});

it('does not merge adjacent calculations with equal sources and different pull policies',()=>{
  const code=compile(source.replace("resource.value+':'+a",'String(a)')
    .replace("const label=derived+':'+b;",'').replace('{label}','{derived}'));
  expect(hasNarrowPrelude(code)).toBe(true);
  expect(code).toMatch(/reasonsHit\([^\n]+, 0\)\)\s*\{\s*unknown = String\(a\)/);
});

it.each(['if','switch'])('retains opaque %s dependencies through a primitive intermediate',kind=>{
  const code=compile(source.replace("const derived='count:'+a;",`
    let intermediate=0;
    ${kind==='if' ? 'if(resource.value>15)intermediate=a+1;'
      : 'switch(resource.value>15){case true:intermediate=a+1;break;default:intermediate=0;}'}
    const derived='count:'+intermediate;`));
  expect(hasNarrowPrelude(code)).toBe(false);
});

it.each([
  'clock.value+a', 'clock.format(a)', '({value:a})', '[a]', 'String(a)',
])('keeps unknown calculation %s live on pulls',expression=>{
  expect(hasNarrowPrelude(compile(source.replace("'count:'+a",expression)))).toBe(false);
});

it.each([
  'const inc=()=>{a++;throw new Error("after write");};',
  'const inc=()=>{a++;clock.format(a);};',
  'globalThis.callback=()=>{a++;}; const inc=()=>{b++;};',
  'const inc=()=>{eval("a++");};',
])('preserves conservative replay for unproven publication: %s',boundary=>{
  expect(hasNarrowPrelude(compile(source.replace('const inc=()=>{a++;};',boundary)))).toBe(false);
});

const frames: FrameRequestCallback[]=[];
const clock={current:10, calls:0, get value(){this.calls++;return this.current;}, set value(value:number){this.current=value;}, format(a:number){return `${this.value}:${a}`;}};
beforeEach(()=>{
  document.body.replaceChildren();resetAccessTable();frames.length=0;clock.value=10;clock.calls=0;
  stubGlobal('__preludeClock',clock);
  stubGlobal('__preludeCallback',undefined);
  stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.push(callback);return frames.length;});
});

it.each(['control','switch','assigned','throwing'] as const)('refreshes derived values behind %s boundaries on pulls',async kind=>{
  mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,'external.ts'),'export const clock=globalThis.__preludeClock;');
  const controlled=kind==='control'||kind==='switch';
  const text=controlled ? source.replace("const derived='count:'+a;",`
    let intermediate=0;
    ${kind==='control' ? 'if(resource.value>15)intermediate=a+1;'
      : 'switch(resource.value>15){case true:intermediate=a+1;break;default:intermediate=0;}'}
    const derived='count:'+intermediate;`).replace('<p class="safe">',
      '<output class="controlled">{intermediate}</output><p class="safe">') : source.replace('const inc=()=>{a++;};',
      kind==='assigned' ? 'globalThis.__preludeCallback=()=>{a++;}; const inc=()=>{b++;};'
        : 'const inc=()=>{a++;throw new Error("after write");};');
  writeFileSync(join(directory,`${kind}.ts`),compile(text));
  setScheduler(run=>run());
  const specifier=`./fixtures/out/opaque-pull-prelude/${kind}.ts`;
  const {App}=await import(specifier);
  document.body.append(App('Boundary',null));
  const safe=document.querySelector('.safe')!, retained=safe.firstChild;
  if(kind==='assigned')(globalThis as typeof globalThis & {__preludeCallback?:()=>void}).__preludeCallback!();
  if(kind==='throwing'){
    const button=document.querySelector<HTMLButtonElement>('.a')!;
    expect(()=>button.onclick!.call(button,new MouseEvent('click'))).toThrow('after write');
  }
  expect(safe.textContent).toBe('count:0:0');
  clock.value=20;frames.shift()!(performance.now());
  expect(safe.textContent).toBe('count:1:0');expect(safe.firstChild).toBe(retained);
  expect(document.querySelector('.unknown')!.textContent).toBe(`20:${controlled?0:1}`);
  if(controlled){
    expect(document.querySelector('.controlled')!.textContent).toBe('1');
    clock.value=10;frames.shift()!(performance.now());
    expect(safe.textContent).toBe('count:0:0');
    expect(document.querySelector('.controlled')!.textContent).toBe('0');
  }
});
afterEach(()=>{
  _internals().registry.forEach((_,id)=>unregister(id));
  while(frames.length)frames.shift()!(performance.now());
  resetAccessTable();resetScheduler();unstubAllGlobals();
});

it.each([false,true])('preserves chained replay, hidden reads, mixed causes and instance isolation (deferred=%s)',async deferred=>{
  mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,'external.ts'),'export const clock=globalThis.__preludeClock;');
  writeFileSync(join(directory,`app-${deferred}.ts`),compile(source));
  const pending:Array<()=>void>=[];
  setScheduler(run=>{if(deferred)pending.push(run);else run();});
  const flush=()=>{while(pending.length)pending.shift()!();};
  const specifier=`./fixtures/out/opaque-pull-prelude/app-${deferred}.ts`;
  const {App}=await import(specifier);
  document.body.append(App('First',null),App('Second',null));
  const roots=[...document.querySelectorAll('main')];
  const retained=roots.map(root=>root.querySelector('.safe')!.firstChild);
  const check=(a:number,b:number)=>{
    expect(roots[0]!.querySelector('.safe')!.textContent).toBe(`count:${a}:${b}`);
    expect(roots[0]!.querySelector('.unknown')!.textContent).toBe(`${clock.value}:${a}`);
    expect(roots[1]!.querySelector('.safe')!.textContent).toBe('count:0:0');
    roots.forEach((root,index)=>{
      expect(root.querySelector('.safe')!.firstChild).toBe(retained[index]);
      expect(root.querySelector('.clock')!.textContent).toBe(String(clock.value));
    });
  };
  const pull=()=>{const frame=frames.shift();expect(frame).toBeTypeOf('function');frame!(performance.now());};
  clock.calls=0;clock.value=20;pull();flush();check(0,0);expect(clock.calls).toBeGreaterThan(0);
  clock.value=30;pull();roots[0]!.querySelector<HTMLButtonElement>('.a')!.click();flush();check(1,0);
  roots[0]!.querySelector<HTMLButtonElement>('.b')!.click();flush();check(1,1);
  clock.value=40;markDirty('First');markDirty('Second');flush();check(1,1);
});
