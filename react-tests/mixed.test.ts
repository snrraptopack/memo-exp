import { afterEach, beforeEach, expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  _internals, resetAccessTable, resetScheduler, setScheduler, unregister,
} from '@memoized-dom/runtime/testing';
import { compileFixture, fixtureRoot } from './harness';

beforeEach(() => {
  document.body.replaceChildren();
  _internals().registry.forEach((_, id) => unregister(id));
  resetAccessTable();
  setScheduler((run) => run());
});
afterEach(() => resetScheduler());

it('compiles React state with ordinary MMD state and keyed lists in one module', async () => {
  const appFile = join(fixtureRoot, 'mixed-app.tsx');
  const compiled = compileFixture({ entries: [appFile], packages: ['mixed-kit'],
    outDir: 'out/mixed' });
  const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
  document.body.appendChild(app.App('App', null));
  const rows = () => [...document.querySelectorAll('li')].map(node => node.textContent);
  expect(rows()).toEqual(['A:one!']);
  document.querySelector<HTMLButtonElement>('#react-state')!.click();
  expect(rows()).toEqual(['B:one!']);
  document.querySelector<HTMLButtonElement>('#mmd-list')!.click();
  expect(rows()).toEqual(['B:one!', 'B:two!']);
  const retained = document.querySelector('li');
  document.querySelector<HTMLButtonElement>('#mmd-state')!.click();
  expect(rows()).toEqual(['B:one?', 'B:two?']);
  expect(document.querySelector('li')).toBe(retained);
});

it('allows the same mixed authoring directly in an MMD application module', async () => {
  const appFile = join(fixtureRoot, 'mixed-direct-app.tsx');
  const compiled = compileFixture({ entries: [appFile], outDir: 'out/mixed-direct' });
  const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
  document.body.appendChild(app.App('App', null));
  const rows = () => [...document.querySelectorAll('li')].map(node => node.textContent);
  expect(rows()).toEqual(['A:one!']);
  document.querySelector<HTMLButtonElement>('#react-state')!.click();
  expect(rows()).toEqual(['B:one!']);
  document.querySelector<HTMLButtonElement>('#mmd-list')!.click();
  expect(rows()).toEqual(['B:one!', 'B:two!']);
  document.querySelector<HTMLButtonElement>('#mmd-state')!.click();
  expect(rows()).toEqual(['B:one?', 'B:two?']);
});

it('specializes local React hooks and Children.map inside an MMD application', async () => {
  const appFile = join(fixtureRoot, 'mixed-local-app.tsx');
  const compiled = compileFixture({ entries: [appFile], outDir: 'out/mixed-local' });
  const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
  document.body.appendChild(app.App('App', null));
  const rows = () => [...document.querySelectorAll('li')].map(node => node.textContent);
  expect(rows()).toEqual(['A:0']);
  const retained = document.querySelector('li');
  document.querySelector<HTMLButtonElement>('#increment')!.click();
  expect(rows()).toEqual(['A:1']);
  document.querySelector<HTMLButtonElement>('#add')!.click();
  expect(rows()).toEqual(['A:1', 'B:1']);
  expect(document.querySelector('li')).toBe(retained);
});
