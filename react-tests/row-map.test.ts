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

it('maps finite React children into caller-owned MMD render content', async () => {
  const appFile = join(fixtureRoot, 'row-app.tsx');
  const compiled = compileFixture({ entries: [appFile], packages: ['row-kit'] });
  const packageCode = compiled.output['row-kit/index.tsx']!;
  expect(packageCode).not.toMatch(/from ['"]react['"]/);
  expect(packageCode).not.toContain('Children.map');
  const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
  document.body.appendChild(app.App('App', null));
  expect([...document.querySelectorAll('output')].map(node => node.textContent))
    .toEqual(['2', '1', '0', '2', '1', '1']);
  expect([...document.querySelectorAll('li.row')].map(node => node.textContent))
    .toEqual(['0', 'fixed', 'other', '', 'tail', 'XY', 'MN']);
  expect([...document.querySelectorAll('li.row')].map(node => node.getAttribute('data-index')))
    .toEqual(['0', '1', '0', '0', '1', '0', '0']);
  document.querySelector('button')!.click();
  expect([...document.querySelectorAll('li.row')].map(node => node.textContent))
    .toEqual(['1', 'fixed', 'other', '', 'tail', 'XY', 'MN']);
});

it('maps through a package-owned component with reactive state and props', async () => {
  const appFile = join(fixtureRoot, 'row-capture-app.tsx');
  const compiled = compileFixture({ entries: [appFile], packages: ['row-capture-kit'] });
  const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
  document.body.appendChild(app.App('App', null));
  expect(document.querySelector('li')?.className).toBe('row');
  const [appButton, packageButton] = [...document.querySelectorAll('button')];
  packageButton!.click();
  expect(document.querySelector('li')?.className).toBe('active');
  packageButton!.click();
  expect(document.querySelector('li')?.className).toBe('row');
  appButton!.click();
  expect(document.querySelector('li')?.className).toBe('selected');
});

it('diagnoses a mapped child whose shape is not known at the caller', () => {
  const appFile = join(fixtureRoot, 'row-dynamic-app.tsx');
  expect(() => compileFixture({ entries: [appFile], packages: ['row-kit'] }))
    .toThrow('requires a finite JSX child sequence');
});

it('diagnoses a second raw render of the mapped child slot', () => {
  const appFile = join(fixtureRoot, 'row-dual-app.tsx');
  expect(() => compileFixture({ entries: [appFile], packages: ['row-dual-kit'] }))
    .toThrow('cannot render raw children alongside a mapped child sequence');
});

it('maps a caller-owned list as it grows and shrinks', async () => {
  const appFile = join(fixtureRoot, 'row-dynamic-list-app.tsx');
  const compiled = compileFixture({ entries: [appFile], packages: ['row-kit'], outDir: 'out/row-dynamic' });
  const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
  document.body.appendChild(app.App('App', null));
  const labels = () => [...document.querySelectorAll('li.row')].map(node => node.textContent);
  const counts = () => [...document.querySelectorAll('output')].map(node => node.textContent);
  expect(labels()).toEqual(['A', 'B']);
  expect(counts()).toEqual(['2']);
  const retainedB = document.querySelectorAll('li.row')[1];
  document.querySelector<HTMLButtonElement>('#add')!.click();
  expect(labels()).toEqual(['A', 'B', 'C']);
  expect(counts()).toEqual(['3']);
  document.querySelector<HTMLButtonElement>('#remove')!.click();
  expect(labels()).toEqual(['B', 'C']);
  expect(counts()).toEqual(['2']);
  expect(document.querySelectorAll('li.row')[0]).toBe(retainedB);
});

it('keeps package values live around a growing caller list', async () => {
  const appFile = join(fixtureRoot, 'row-dynamic-capture-app.tsx');
  const compiled = compileFixture({ entries: [appFile], packages: ['row-dynamic-capture-kit'],
    outDir: 'out/row-dynamic-capture' });
  const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
  document.body.appendChild(app.App('App', null));
  const rows = () => [...document.querySelectorAll('li')].map(node => [node.textContent, node.className]);
  expect(rows()).toEqual([['A', 'row'], ['B', 'row']]);
  document.querySelector<HTMLButtonElement>('#package-toggle')!.click();
  expect(rows()).toEqual([['A', 'active'], ['B', 'active']]);
  document.querySelector<HTMLButtonElement>('#add')!.click();
  expect(rows()).toEqual([['A', 'active'], ['B', 'active'], ['C', 'active']]);
  document.querySelector<HTMLButtonElement>('#package-toggle')!.click();
  document.querySelector<HTMLButtonElement>('#app-toggle')!.click();
  expect(rows()).toEqual([['A', 'selected'], ['B', 'selected'], ['C', 'selected']]);
  document.querySelector<HTMLButtonElement>('#remove')!.click();
  expect(rows()).toEqual([['B', 'selected'], ['C', 'selected']]);
});
