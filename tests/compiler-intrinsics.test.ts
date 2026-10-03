import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compile,
  compileModules,
  compileModulesDetailed,
} from '@memoized-dom/compiler';
import {
  _internals,
  resetAccessTable,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

afterEach(() => {
  for (const id of _internals().registry.keys()) unregister(id);
  document.body.replaceChildren();
  resetAccessTable();
  resetScheduler();
  vi.unstubAllGlobals();
});

describe('implicit compiler intrinsics', () => {
  it.each(['effect', 'cleanup'])('rejects the unprefixed %s lifecycle alias', name => {
    expect(() => compile(`export function App(){${name}(()=>{});return <main/>;}`))
      .toThrow(`use $${name}()`);
  });

  it('keeps ordinary explicitly bound lifecycle names as JavaScript', () => {
    const output=compile(`function effect(fn){fn();}function cleanup(fn){fn();}
      export function App(){effect(()=>{});cleanup(()=>{});return <main/>;}`);
    expect(output).not.toContain('.registerEffect(');
    expect(output).toContain('effect(() => {})');
    expect(output).toContain('cleanup(() => {})');
  });
  it('discovers import-free module/component data and route preparation calls', () => {
    const result = compileModulesDetailed({
      './app.tsx': `
      const initial = $read(Promise.resolve({name: 'Ada'}));
      export function App() {
        const person = $fetch('/person');
        const request = $track(person);
        const form = $forms(fields => fields);
        const page = $routed(({params}) => ({slug: params.id}));
        return <main>{initial.name}{person.name}{request.pending}{form.pending}{page.slug}</main>;
      }`,
    });
    const code = result.output['./app.tsx'];
    expect(code).toContain('@memoized-dom/data');
    expect(code).toContain('readResolvedValue');
    expect(result.metadata['./app.tsx']!.routedPreparations).toHaveLength(1);
  });

  it('respects local, parameter and imported shadows and ignores unknown $ names', () => {
    const code = compileModules({
      './app.tsx': `
      import { $read } from './custom';
      function App() {
        const $fetch = url => url;
        const $effect = callback => callback();
        const $cleanup = callback => callback;
        $effect(() => {}); $cleanup(() => {});
        return <p>{$fetch('custom')}{$read('custom')}{$other()}</p>;
      }`,
    })['./app.tsx']!;
    expect(code).not.toContain('@memoized-dom/data');
    expect(code).not.toContain('.registerEffect(');
    expect(code).not.toContain('.cleanup(');
    expect(code).toContain('$other()');
    expect(
      compile('function App() { return <p>{toString()}</p>; }'),
    ).not.toContain('@memoized-dom/data');
  });

  it('runs $effect after updates and disposes $cleanup with the owner', async () => {
    const directory = join(
      import.meta.dirname,
      'fixtures/out/compiler-intrinsics',
    );
    mkdirSync(directory, { recursive: true });
    const path = join(directory, 'lifecycle.ts');
    const events: Array<string | number> = [];
    vi.stubGlobal('__intrinsicLog', (value: string | number) => {
      events.push(value);
    });
    writeFileSync(
      path,
      compile(`
      export function App() {
        let count = 0;
        $effect(() => { globalThis.__intrinsicLog(count); return () => globalThis.__intrinsicLog('effect cleanup'); });
        $cleanup(() => globalThis.__intrinsicLog('owner cleanup'));
        return <button onClick={() => count++}>{count}</button>;
      }`),
    );
    const fixture = await import(pathToFileURL(path).href);
    setScheduler((run) => run());
    const root = fixture.App('App', null) as HTMLButtonElement;
    document.body.append(root);
    expect(events).toContain(0);
    root.click();
    expect(root.textContent).toBe('1');
    expect(events).toContain(1);
    unregister('App');
    expect(events).toContain('effect cleanup');
    expect(events).toContain('owner cleanup');
  });

  it('keeps cleanup ownership and effect synchronous-callback validation', () => {
    expect(
      compile(
        'function App() { const page = $routed(({params}) => ({id: params.id})); return <p>{page.id}</p>; }',
      ),
    ).toContain('readRoutedPreparation');
    expect(() => compile('const run = $effect;')).toThrow(/direct call/);
    expect(() => compile('$cleanup(() => {});')).toThrow(/component factory/);
    expect(() =>
      compile('function App() { $effect(async () => {}); return <p/>; }'),
    ).toThrow(/synchronous/);
  });
});
