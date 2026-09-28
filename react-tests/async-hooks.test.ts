import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModules } from '../packages/compiler/src/linker';
import {
  _internals, resetAccessTable, resetScheduler, setScheduler, unregister,
} from '@memoized-dom/runtime/testing';
import { compileFixture, fixtureRoot } from './harness';

const appFile = join(fixtureRoot, 'async-app.tsx');
const packageFile = 'async-kit/index.tsx';
const compiled = compileFixture({ entries: [appFile], packages: ['async-kit'],
  outDir: 'out/async' });

describe('React async hook lowering', () => {
  it('lowers use() through the data package read source and erases React', () => {
    const code = compiled.output[packageFile]!;
    expect(code).toContain("from \"@memoized-dom/data\"");
    expect(code).not.toMatch(/from ['"]react['"]/);
    expect(code).not.toMatch(/\bSuspense\b|\buseActionState\b/);
  });

  it('rejects use() in non-declarator positions and Suspense props', () => {
    expect(() => compileModules({ 'x.tsx': `
import { use } from 'react';
function App() { const v = true ? use(p) : 0; return <p/>; }
` })).toThrow('direct component binding');
    expect(() => compileModules({ 'x.tsx': `
import { Suspense } from 'react';
function App() { return <Suspense fallback={<p/>} name="x"><p/></Suspense>; }
` })).toThrow('only \'fallback\'');
  });
});

describe('assimilated async hook DOM behavior', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((run) => run());
  });
  afterEach(() => resetScheduler());

  it('renders Suspense fallback then reveals resolved content per boundary', async () => {
    const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
    document.body.appendChild(app.App('App', null));
    expect(document.querySelectorAll('.ph').length + document.querySelectorAll('.ph2').length).toBe(2);
    expect(document.querySelectorAll('.panel').length).toBe(0);
    await vi.waitFor(() => {
      expect([...document.querySelectorAll('.panel')].map((p) => p.textContent))
        .toEqual(['msg-a', 'msg-b']);
    });
    expect(document.querySelector('.ph')).toBeNull();
    expect(document.querySelector('.ph2')).toBeNull();
  });

  it('drives a form through useActionState: pending then result', async () => {
    const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
    document.body.appendChild(app.App('App', null));
    expect(document.querySelector('#state')!.textContent).toBe('0');
    const form = document.querySelector('form')!;
    form.dispatchEvent(new SubmitEvent('submit', {
      bubbles: true, cancelable: true,
      submitter: form.querySelector('button')!,
    }));
    await vi.waitFor(() => {
      expect(document.querySelector('#state')!.textContent).toBe('5');
    });
    expect(document.querySelector('#pending')!.textContent).toBe('idle');
  });

  it('accepts imperative dispatch calls with FormData', async () => {
    const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
    document.body.appendChild(app.App('App', null));
    document.querySelector<HTMLButtonElement>('#manual')!.click();
    await vi.waitFor(() => {
      expect(document.querySelector('#state')!.textContent).toBe('2');
    });
  });
});
