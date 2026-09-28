import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModules } from '../packages/compiler/src/linker';
import {
  _internals, resetAccessTable, resetScheduler, setScheduler, unregister,
} from '@memoized-dom/runtime/testing';
import { compileFixture, fixtureRoot } from './harness';

const appFile = join(fixtureRoot, 'interop-app.tsx');
const packageFile = 'interop-kit/index.tsx';
const compiled = compileFixture({ entries: [appFile], packages: ['interop-kit'],
  outDir: 'out/interop' });

describe('mixed MMD and React source interop', () => {
  it('compiles native let-state beside React hooks in one component', async () => {
    const code = compiled.output[packageFile]!;
    expect(code).not.toMatch(/from ['"]react['"]/);
    document.body.replaceChildren();
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((run) => run());
    const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
    document.body.appendChild(app.App('App', null));
    const native = document.querySelector<HTMLButtonElement>('#native')!;
    const react = document.querySelector<HTMLButtonElement>('#react')!;
    expect(native.textContent).toBe('0');
    expect(react.textContent).toBe('10');
    expect(document.querySelector('#pending')!.textContent).toBe('false');
    native.click();
    react.click();
    expect(native.textContent).toBe('1');
    expect(react.textContent).toBe('15');
    // useId emitted a stable per-instance id for the section.
    expect(document.querySelector('section')!.id).toMatch(/^r\d+$/);
    resetScheduler();
  });

  it('translates namespace-member JSX tags and calls', () => {
    const output = compileModules({ 'x.tsx': `
import React from 'react';
function App() {
  const id = React.useId();
  return <React.StrictMode><React.Fragment><React.Suspense fallback={<i>…</i>}>
    <p id={id}>x</p>
  </React.Suspense></React.Fragment></React.StrictMode>;
}
` });
    expect(output['x.tsx']).toBeTruthy();
    expect(output['x.tsx']).not.toMatch(/from ['"]react['"]/);
    expect(output['x.tsx']).not.toMatch(/\bReact\b/);
  });

  it('keeps a string form action as a native attribute', () => {
    const output = compileModules({ 'x.tsx': `
import { useState } from 'react';
function App() {
  const [n] = useState(0);
  return <form action="/api/endpoint"><p>{n}</p></form>;
}
` });
    expect(output['x.tsx']).toContain('action');
  });

  it('folds a function formAction on a submit button into a click handler', () => {
    const output = compileModules({ 'x.tsx': `
import { useActionState } from 'react';
function App() {
  const [, dispatch] = useActionState(async (p, f) => p, 0);
  return <form><input name="x" /><button formAction={dispatch}>go</button></form>;
}
` });
    expect(output['x.tsx']).not.toMatch(/from ['"]react['"]/);
    expect(output['x.tsx']).toContain('FormData');
  });
});
