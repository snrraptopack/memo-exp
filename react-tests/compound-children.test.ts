import { afterEach, beforeEach, expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  _internals, resetAccessTable, resetScheduler, setScheduler, unregister,
} from '@memoized-dom/runtime/testing';
import { compileFixture, fixtureRoot } from './harness';

const appFile = join(fixtureRoot, 'compound-app.tsx');

beforeEach(() => {
  document.body.replaceChildren();
  _internals().registry.forEach((_, id) => unregister(id));
  resetAccessTable();
  setScheduler((run) => run());
});
afterEach(() => resetScheduler());

it('specializes a package compound component with its caller-owned child sequence', async () => {
  const compiled = compileFixture({ entries: [appFile], packages: ['compound-kit'] });
  const packageCode = compiled.output['compound-kit/index.tsx']!;
  expect(packageCode).not.toMatch(/from ['"]react['"]/);
  expect(packageCode).not.toContain('Children.count');
  const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
  document.body.appendChild(app.App('App', null));
  expect([...document.querySelectorAll('output')].map(node => node.textContent))
    .toEqual(['2', '0', '1', '0']);
  expect([...document.querySelectorAll('section div span')].map(node => node.textContent))
    .toEqual(['A', 'B', 'C', 'D']);
});

it('diagnoses a child sequence whose value is not statically known', () => {
  const dynamic = join(fixtureRoot, 'compound-dynamic-app.tsx');
  expect(() => compileFixture({ entries: [dynamic], packages: ['compound-kit'] }))
    .toThrow('requires a finite JSX child sequence');
});
