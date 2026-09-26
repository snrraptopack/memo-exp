import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compile } from '../packages/compiler/src/compile';
import {
  _internals, resetAccessTable, resetScheduler, setScheduler, unregister,
} from '@memoized-dom/runtime/testing';
import { compileFixture, fixtureRoot } from './harness';

const appFile = join(fixtureRoot, 'counter-app.tsx');
const packageFile = 'counter-kit/index.tsx';
const compiled = compileFixture({ entries: [appFile], packages: ['counter-kit'] });

describe('authored React package assimilation', () => {
  it('translates package hooks into MMD instance operations', () => {
    const code = compiled.output[packageFile]!;
    expect(code).toBeTruthy();
    expect(code).not.toMatch(/from ['"]react['"]/);
    expect(code).not.toMatch(/\buse(State|Memo|Callback|Effect)\b/);
    expect(code).toContain('.registerEffect(');
    expect(code).toContain('.markDirty(');
    expect(code).toContain('doubled = count * 2');
  });

  it('uses the same translation in direct and linked compilation', () => {
    const source = compiled.graph.modules[packageFile]!;
    expect(compiled.output[packageFile]).toBe(compile(source, {
      moduleId: packageFile, react: { packages: ['counter-kit'] },
    }));
  });

  it.each([
    ["import { useLayoutEffect } from 'react'; function App() { useLayoutEffect(() => {}, []); return <p />; }", 'useLayoutEffect'],
    ["import { useState } from 'react'; function useCounter() { return useState(0); } function App() { useCounter(); return <p />; }", 'custom hook'],
    ["import { useState } from 'react'; function App() { if (true) { const [n, setN] = useState(0); } return <p />; }", 'direct component declaration'],
    ["import React from 'react'; function App() { return <React.Fragment><p /></React.Fragment>; }", 'JSX tag'],
    ["import 'react'; function App() { return <p />; }", 'side-effect import'],
    ["import { jsx } from 'react/jsx-runtime'; const view = jsx('p', {});", 'react/jsx-runtime.jsx'],
  ])('diagnoses source forms without a proven target', (source, message) => {
    expect(() => compile(source, {
      moduleId: 'counter-kit/invalid.tsx', react: { packages: ['counter-kit'] },
    })).toThrow(message);
  });

  it('recognizes React imports in MMD application modules by their source binding', () => {
    const source = "import { useState } from 'react'; function App() { const [n, setN] = useState(0); return <button onClick={() => setN(n + 1)}>{n}</button>; }";
    const output = compile(source);
    expect(output).not.toMatch(/from ['"]react['"]/);
    expect(output).toContain('.markDirty(');
    expect(compile(compiled.graph.modules[packageFile]!, {
      moduleId: 'counter-kit-extra/index.tsx', react: { packages: ['counter-kit'] },
    })).not.toMatch(/from ['"]react['"]/);
  });
});

describe('assimilated package DOM behavior', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    document.title = '';
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((run) => run());
  });
  afterEach(() => resetScheduler());

  it('mounts two independent package component instances and updates derived text', async () => {
    const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
    document.body.appendChild(app.App('App', null));
    const [first, second] = [...document.querySelectorAll('button')];
    expect([first?.textContent, second?.textContent]).toEqual(['A:2', 'B:2']);
    expect(document.title).toBe('B:2');
    first!.click();
    expect([first?.textContent, second?.textContent]).toEqual(['A:4', 'B:2']);
    expect(document.title).toBe('A:4');
    // MMD-owned cleanup reads the live instance derivation at disposal time.
    expect(document.body.dataset.cleaned).toBe('A:4');
    first!.click();
    expect([first?.textContent, second?.textContent]).toEqual(['A:6', 'B:2']);
    expect(document.body.dataset.cleaned).toBe('A:6');
  });
});
