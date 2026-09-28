import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compile } from '../packages/compiler/src/compile';
import {
  _internals, resetAccessTable, resetScheduler, setScheduler, unregister,
} from '@memoized-dom/runtime/testing';
import { compileFixture, fixtureRoot } from './harness';

const appFile = join(fixtureRoot, 'phase-app.tsx');
const packageFile = 'phase-kit/index.tsx';
const compiled = compileFixture({ entries: [appFile], packages: ['phase-kit'],
  outDir: 'out/phases' });

describe('React effect-phase lowering', () => {
  it('emits no React imports or hook names for the lowered APIs', () => {
    const code = compiled.output[packageFile]!;
    expect(code).not.toMatch(/from ['"]react['"]/);
    expect(code).not.toMatch(
      /\buse(DebugValue|DeferredValue|Id|ImperativeHandle|InsertionEffect|LayoutEffect|Transition)\b/);
    expect(code).toContain('.registerEffect(');
  });

  it('lowers the package source in direct compilation', () => {
    const source = compiled.graph.modules[packageFile]!;
    const output = compile(source, {
      moduleId: packageFile, react: { packages: ['phase-kit'] },
    });
    expect(output).not.toMatch(/from ['"]react['"]/);
    expect(output).toContain('.registerEffect(');
  });
});

describe('assimilated phase hook DOM behavior', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    document.title = '';
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((run) => run());
  });
  afterEach(() => resetScheduler());

  it('runs insertion, layout, then passive effects regardless of source order', async () => {
    const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
    document.body.appendChild(app.App('App', null));
    // Fixture declares insertion, passive, layout — emission must reorder.
    expect(document.title).toBe('ILP');
  });

  it('writes an imperative handle through a forwarded ref prop', async () => {
    const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
    document.body.appendChild(app.App('App', null));
    const input = document.querySelectorAll<HTMLInputElement>('input')[2]!;
    input.value = 'typed';
    document.querySelector<HTMLButtonElement>('#read')!.click();
    expect(document.querySelector('#seen')!.textContent).toBe('typed');
    document.querySelector<HTMLButtonElement>('#clear')!.click();
    expect(input.value).toBe('');
    expect(document.querySelector('#seen')!.textContent).toBe('cleared');
  });

  it('gives every mounted instance a distinct, attribute-paired useId', async () => {
    const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
    document.body.appendChild(app.App('App', null));
    const labels = [...document.querySelectorAll('label')];
    const inputs = [...document.querySelectorAll('input')];
    const ids = inputs.map((input) => input.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    labels.forEach((label, i) => {
      expect(label.getAttribute('for')).toBe(ids[i]);
    });
  });

  it('erases useDebugValue even inside locally defined hooks', async () => {
    const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
    document.body.appendChild(app.App('App', null));
    expect(document.querySelector('main')!.getAttribute('title')).toBe('TITLE');
  });

  it('unwraps StrictMode to a transparent fragment', async () => {
    const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
    const node = app.App('App', null);
    document.body.appendChild(node);
    expect(document.querySelector('main > p')!.textContent).toBe('trace');
  });

  it('runs transitions synchronously with isPending pinned false', async () => {
    const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
    document.body.appendChild(app.App('App', null));
    expect(document.querySelector('#pending')!.textContent).toBe('false');
    expect(document.querySelector('#value')!.textContent).toBe('a');
    document.querySelector<HTMLButtonElement>('#set')!.click();
    expect(document.querySelector('#pending')!.textContent).toBe('false');
    expect(document.querySelector('#value')!.textContent).toBe('b');
  });

  it('clears the imperative handle when the child unmounts', async () => {
    const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
    document.body.appendChild(app.App('App', null));
    document.querySelector<HTMLButtonElement>('#gone')!.click();
    expect(document.querySelectorAll('label').length).toBe(2);
  });

  it('delivers the handle to callable refs and runs ref cleanup on unmount', async () => {
    const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
    document.body.appendChild(app.App('App', null));
    const cbInput = document.querySelectorAll<HTMLInputElement>('input')[3]!;
    cbInput.value = 'via-callback';
    document.querySelector<HTMLButtonElement>('#cbread')!.click();
    expect(document.querySelector('#cbstate')!.textContent).toBe('via-callback');
    document.querySelector<HTMLButtonElement>('#cbgone')!.click();
    expect(document.querySelector('#cbstate')!.textContent).toBe('detached');
  });
});

describe('React phase hook diagnostics', () => {
  it.each([
    ["import { useId } from 'react'; function App() { const [a] = useId(); return <p />; }", 'const id = useId()'],
    ["import { useTransition } from 'react'; function App() { const t = useTransition(); return <p />; }", 'useTransition()'],
    ["import { useDebugValue } from 'react'; function App() { const x = useDebugValue(1); return <p />; }", 'standalone useDebugValue'],
    ["import { useDeferredValue } from 'react'; function App() { const x = useDeferredValue(); return <p />; }", 'useDeferredValue(value)'],
    ["import { useImperativeHandle } from 'react'; function App() { useImperativeHandle(null); return <p />; }", 'createHandle'],
    ["import { startTransition } from 'react'; function App() { const f = () => startTransition(); return <p />; }", 'exactly one callback'],
    ["import { useInsertionEffect } from 'react'; function App() { const e = useInsertionEffect(() => {}); return <p />; }", 'statement'],
    ["import { use } from 'react'; function App() { const v = 1 && use(x); return <p />; }", 'direct component binding'],
  ])('diagnoses unsupported hook shapes', (source, message) => {
    expect(() => compile(source, {
      moduleId: 'phase-kit/invalid.tsx', react: { packages: ['phase-kit'] },
    })).toThrow(message);
  });
});
