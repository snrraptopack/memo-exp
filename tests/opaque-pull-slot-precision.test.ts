import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileModules } from '@memoized-dom/compiler';
import {
  _internals, markDirty, reasonsHit, resetAccessTable, resetScheduler, setScheduler, unregister,
} from '@memoized-dom/runtime/testing';

const directory = join(import.meta.dirname, 'fixtures/out/opaque-pull-slots');
const source = `import {clock} from './external';
  export function App() {
    let a=0, b=0;
    const label='count:'+a;
    const inc=()=>{a++;};
    function hidden() { return clock.value + ':' + b; }
    return <main>
      <p id="a">{a}</p><p id="b">{b}</p><p id="label">{label}</p>
      <p id="opaque">{clock.value}</p><p id="hidden">{hidden()}</p>
      <button id="inc-a" onClick={inc}>a</button>
      <button id="inc-b" onClick={()=>{b++;}}>b</button>
    </main>;
  }`;
const probe = globalThis as typeof globalThis & {
  __opaquePullClock?: {value:number};
  __opaquePullCallback?: ()=>void;
  __opaquePullFailure?: boolean;
};
const frames: FrameRequestCallback[] = [];

beforeAll(() => {
  mkdirSync(directory, {recursive:true});
  writeFileSync(join(directory,'external.ts'), 'export const clock={get value(){if(globalThis.__opaquePullFailure)throw new Error("opaque read");return globalThis.__opaquePullClock.value;}};');
  const code = compileModules({'./app.tsx':source})['./app.tsx']!;
  expect(code).toContain('volatile: true');
  expect(code).toMatch(/reasonsHit\([^\n]+, false\)/);
  for (const deferred of [false,true]) {
    const compiled=deferred ? compileModules({'./app.tsx':source.replace('const inc=()=>{a++;};','function inc(unused){a++;}')})['./app.tsx']! : code;
    writeFileSync(join(directory,`app-${deferred}.ts`),compiled);
  }
  const recovery=compileModules({'./app.tsx':source.replace('<p id="a">','<p>{clock.value}</p><p id="a">')})['./app.tsx']!;
  for (const deferred of [false,true]) writeFileSync(join(directory,`recovery-${deferred}.ts`),recovery);
  for (const kind of ['assigned','registered','throwing'] as const) {
    const registration=kind==='assigned'
      ? 'globalThis.__opaquePullCallback=()=>{a++;};'
      : `globalThis.__registerOpaquePull(()=>{a++;${kind==='throwing' ? 'throw new Error("after write");' : ''}});`;
    const callbackCode=compileModules({'./app.tsx':`import {clock} from './external';
      export function App(){let a=0,b=0;${registration}
        return <main><p id="a">{a}</p><p id="b">{b}</p><p id="opaque">{clock.value}</p>
          <button onClick={()=>{b++;}}>b</button></main>;}`})['./app.tsx']!;
    writeFileSync(join(directory,`callback-${kind}.ts`),callbackCode);
  }
});
beforeEach(() => {
  document.body.replaceChildren(); resetAccessTable();
  frames.length=0; probe.__opaquePullClock={value:10};probe.__opaquePullFailure=false;
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.push(callback);return frames.length;});
});
afterEach(() => {
  vi.restoreAllMocks();
  _internals().registry.forEach((_,id)=>unregister(id));
  while(frames.length)frames.shift()!(performance.now());
  resetAccessTable();resetScheduler();vi.unstubAllGlobals();delete probe.__opaquePullClock;delete probe.__opaquePullCallback;delete probe.__opaquePullFailure;
});

it.each([false,true])('recovers a failed render before narrowing the next pull (deferred=%s)',async deferred=>{
  const pending:Array<()=>void>=[];
  setScheduler(run=>{if(deferred)pending.push(run);else run();});
  const flush=()=>{while(pending.length)pending.shift()!();};
  const specifier=`./fixtures/out/opaque-pull-slots/recovery-${deferred}.ts`;
  const {App}=await import(specifier);
  document.body.append(App('Recovery',null));
  probe.__opaquePullFailure=true;
  const button=document.querySelector<HTMLButtonElement>('#inc-a')!;
  const click=()=>button.onclick!.call(button,new MouseEvent('click'));
  if(deferred){click();expect(flush).toThrow('opaque read');}
  else expect(click).toThrow('opaque read');
  expect(document.querySelector('#a')!.textContent).toBe('0');
  probe.__opaquePullFailure=false;
  const frame=frames.shift();expect(frame).toBeTypeOf('function');frame!(performance.now());flush();
  expect(document.querySelector('#a')!.textContent).toBe('1');
  expect(document.querySelector('#label')!.textContent).toBe('count:1');
});

it.each(['assigned','registered','throwing'] as const)('keeps external %s callbacks reactive',async kind=>{
  setScheduler(run=>run());
  vi.stubGlobal('__registerOpaquePull',(callback:()=>void)=>{probe.__opaquePullCallback=callback;});
  const specifier=`./fixtures/out/opaque-pull-slots/callback-${kind}.ts`;
  const {App}=await import(specifier);
  document.body.append(App('Callback',null));
  const a=document.querySelector('#a')!.firstChild as Text;
  const b=document.querySelector('#b')!.firstChild as Text;
  const aRead=vi.spyOn(a,'data','get'),bRead=vi.spyOn(b,'data','get');
  if(kind==='throwing')expect(()=>probe.__opaquePullCallback!()).toThrow('after write');
  else probe.__opaquePullCallback!();
  if(kind==='registered') {
    expect(aRead).toHaveBeenCalled();expect(bRead).not.toHaveBeenCalled();
    expect(a.textContent).toBe('1');
  } else {
    expect(aRead).not.toHaveBeenCalled();expect(a.textContent).toBe('0');
  }
  aRead.mockClear();bRead.mockClear();
  probe.__opaquePullClock!.value=40;
  const frame=frames.shift();expect(frame).toBeTypeOf('function');frame!(performance.now());
  if(kind==='registered')expect(aRead).not.toHaveBeenCalled();
  else expect(aRead).toHaveBeenCalled();
  expect(bRead).not.toHaveBeenCalled();
  expect(a.textContent).toBe('1');expect(document.querySelector('#opaque')!.textContent).toBe('40');
});

it.each([false,true])('pulls only unknown output and merges real writes (deferred=%s)',async deferred=>{
  const pending:Array<()=>void>=[];
  setScheduler(run=>{if(deferred)pending.push(run);else run();});
  const flush=()=>{while(pending.length)pending.shift()!();};
  const specifier=`./fixtures/out/opaque-pull-slots/app-${deferred}.ts`;
  const {App}=await import(specifier);
  document.body.append(App('First',null),App('Second',null));
  const roots=[...document.querySelectorAll('main')];
  const a=roots[0]!.querySelector('#a')!.firstChild as Text;
  const b=roots[0]!.querySelector('#b')!.firstChild as Text;
  const label=roots[0]!.querySelector('#label')!.firstChild as Text;
  const reads=[a,b,label].map(node=>vi.spyOn(node,'data','get'));
  const pull=()=>{const frame=frames.shift();expect(frame).toBeTypeOf('function');frame!(performance.now());};
  probe.__opaquePullClock!.value=20;pull();flush();
  reads.forEach(read=>expect(read).not.toHaveBeenCalled());
  for(const root of roots){expect(root.querySelector('#opaque')!.textContent).toBe('20');expect(root.querySelector('#hidden')!.textContent).toBe('20:0');}
  probe.__opaquePullClock!.value=30;pull();
  roots[0]!.querySelector<HTMLButtonElement>('#inc-a')!.click();flush();
  expect(reads[0]).toHaveBeenCalled();expect(reads[1]).not.toHaveBeenCalled();expect(reads[2]).toHaveBeenCalled();
  expect(roots[0]!.querySelector('#a')!.textContent).toBe('1');
  expect(roots[0]!.querySelector('#label')!.textContent).toBe('count:1');
  expect(roots[1]!.querySelector('#a')!.textContent).toBe('0');
  expect(roots[0]!.querySelector('#opaque')!.textContent).toBe('30');
  reads.forEach(read=>read.mockClear());
  roots[0]!.querySelector<HTMLButtonElement>('#inc-b')!.click();flush();
  expect(roots[0]!.querySelector('#hidden')!.textContent).toBe('30:1');
  expect(reads[0]).not.toHaveBeenCalled();expect(reads[1]).toHaveBeenCalled();expect(reads[2]).not.toHaveBeenCalled();
  reads.forEach(read=>read.mockClear());markDirty('First');flush();
  reads.forEach(read=>expect(read).toHaveBeenCalled());
});

it('preserves wildcard compatibility and handles mixed causes without widening unrelated gates',()=>{
  expect(reasonsHit(-1,0)).toBe(true);expect(reasonsHit(new Set([-1,1]),0)).toBe(true);
  expect(reasonsHit(-1,0,false)).toBe(false);
  expect(reasonsHit(new Set([-1,1]),0,false)).toBe(false);
  expect(reasonsHit(new Set([-1,1]),1,false)).toBe(true);
  expect(reasonsHit(new Set([-1,1]),[0,1],false)).toBe(true);
  expect(reasonsHit(null,0,false)).toBe(true);
  expect(reasonsHit('structure',['structure'],false)).toBe(true);
});

it.each([
  'let a=clock.value, b=0;',
  'let a={value:0}, b=0;',
  'let a=0, b=0; const change=()=>{a=clock.read();};',
  'let a=0, b=0; const change=()=>{a={value:1};};',
  'let a=0, b=0; const change=()=>{[a]=clock.values;};',
  'let a=0, b=0; const change=()=>{eval("a={value:1}");};',
  'let a=0, b=0; globalThis.callback=()=>{a++;};',
  'let a=0, b=0; globalThis.capture(()=>{a++;throw new Error("after write");});',
  'let a=0, b=0; globalThis.capture(()=>{a++;clock.read();});',
  'let a=0, b=0; globalThis.capture(()=>{a++;return clock.value;});',
  'let a=0, b=0; globalThis.capture(()=>{a++;return missing;});',
  'let a=0, b=0; const nested=(a)=>a; globalThis.capture(()=>{a++;});',
])('keeps the pull wildcard for unproven local values: %s',declarations=>{
  const code=compileModules({'./app.tsx':`import {clock} from './external'; export function App(){
    ${declarations} return <main><p>{a}</p><p>{clock.value}</p><button onClick={()=>b++}>{b}</button></main>;
  }`})['./app.tsx']!;
  const gate=code.match(/reasonsHit\([^\n]+\)[^\n]*\{\s*_MD\.setTextData\([^\n]*, a\)/);
  expect(code).toMatch(/_MD\.setTextData\([^\n]*, a\)/);
  expect(gate?.[0] ?? '').not.toContain(', false)');
});
