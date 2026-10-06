import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { compileModules } from '@memoized-dom/compiler';
import { _internals, resetAccessTable, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const directory = join(import.meta.dirname, 'fixtures/out/effect-cleanup-consumption');
const cleanups = {
  inline: `return () => record('cleanup:'+count);`,
  expression: `return function(){record('cleanup:'+count);};`,
  named: `function release(){record('cleanup:'+count);}return release;`,
  constant: `const release=()=>record('cleanup:'+count);return release;`,
};
const source = (cleanup: string) => `import {record} from './external.mjs';
  export function App(){let count=0;$effect(()=>{record('run:'+count);${cleanup}});
    return <main><button onClick={()=>count++}>Increment</button><output>{count}</output></main>;}`;
const compile = (text: string) => compileModules({ './App.tsx': text })['./App.tsx']!;

beforeEach(() => {
  document.body.replaceChildren(); resetAccessTable(); setScheduler(run => run());
  vi.stubGlobal('__cleanupRecord', vi.fn());
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'external.mjs'), `export function record(value){globalThis.__cleanupRecord(value);}
    export function sink(){return {consume:record};}`);
});
afterEach(() => {
  for (const id of [..._internals().registry.keys()]) unregister(id);
  resetScheduler(); resetAccessTable(); vi.unstubAllGlobals();
});

it.each(Object.entries(cleanups))('does not publish a false write from %s opaque cleanup', async (name, cleanup) => {
  const code = compile(source(cleanup));
  expect(code).not.toContain('.markDirtySubtree(');
  writeFileSync(join(directory, `${name}.ts`), code);
  const specifier = `./fixtures/out/effect-cleanup-consumption/${name}.ts`;
  const { App } = await import(specifier);
  document.body.append(App('App', null));
  document.querySelector<HTMLButtonElement>('button')!.click();
  expect(document.querySelector('output')!.textContent).toBe('1');
  const record = (globalThis as unknown as { __cleanupRecord: ReturnType<typeof vi.fn> }).__cleanupRecord;
  expect(record.mock.calls.map((call: string[]) => call[0])).toEqual(['run:0', 'cleanup:1', 'run:1']);
  for (const id of [..._internals().registry.keys()]) unregister(id);
  expect(record.mock.calls.map((call: string[]) => call[0])).toEqual(['run:0', 'cleanup:1', 'run:1', 'cleanup:1']);
});

it('keeps explicit cleanup writes and deferred callback publication', () => {
  const direct = compile(source(`return()=>{record('cleanup');count=0;};`));
  expect(direct).toMatch(/record\('cleanup'\);\s*count = 0;\s*_MD\.(?:markDirty|invalidateEntity)\(/);
  const deferred = compile(source(`setTimeout(()=>record(count));return()=>record('cleanup');`));
  expect(deferred).toContain('.markDirtySubtree(');
});

it('consumes an opaque call result in the effect without publishing a feedback write', async () => {
  const code = compile(`import {sink} from './external.mjs';export function App(){let count=0;
    $effect(()=>sink().consume(count));return <main><button onClick={()=>count++}>Next</button><output>{count}</output></main>;}`);
  expect(code).not.toContain('.markDirtySubtree(');
  writeFileSync(join(directory, 'result-consumption.ts'), code);
  const specifier = './fixtures/out/effect-cleanup-consumption/result-consumption.ts';
  const {App} = await import(specifier);
  document.body.append(App('App', null));
  document.querySelector<HTMLButtonElement>('button')!.click();
  expect(document.querySelector('output')!.textContent).toBe('1');
  const record = (globalThis as unknown as {__cleanupRecord: ReturnType<typeof vi.fn>}).__cleanupRecord;
  expect(record.mock.calls.map((call: number[]) => call[0])).toEqual([0, 1]);
});

it('publishes a visible cleanup write to another component', async () => {
  const code = compile(`import {record} from './external.mjs';let last=-1;
    function Result(){return <p>{last}</p>;}
    export function App(){let count=0;$effect(()=>{record(count);return()=>{last=count;record('cleanup');};});
      return <main><button onClick={()=>count++}>Increment</button><Result/></main>;}`);
  writeFileSync(join(directory, 'visible-write.ts'), code);
  const specifier = './fixtures/out/effect-cleanup-consumption/visible-write.ts';
  const { App } = await import(specifier);
  document.body.append(App('App', null));
  expect(document.querySelector('p')!.textContent).toBe('-1');
  document.querySelector<HTMLButtonElement>('button')!.click();
  expect(document.querySelector('p')!.textContent).toBe('1');
});
