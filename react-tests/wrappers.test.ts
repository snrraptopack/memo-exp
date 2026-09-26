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

it('lowers memo and forwardRef wrappers into MMD components and ref props', async () => {
  const appFile = join(fixtureRoot, 'wrapper-app.tsx');
  const compiled = compileFixture({ entries: [appFile], packages: ['wrapper-kit'],
    outDir: 'out/wrappers' });
  const code = compiled.output['wrapper-kit/index.tsx']!;
  expect(code).not.toMatch(/from ['"]react['"]/);
  const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
  document.body.appendChild(app.App('App', null));
  const check = () => document.querySelector<HTMLButtonElement>('#check')!.click();
  const toggle = () => document.querySelector<HTMLButtonElement>('#toggle')!.click();
  expect(document.querySelector('strong')!.textContent).toBe('A');
  expect(document.querySelector('label span')!.textContent).toBe('A');
  check();
  expect(document.querySelector('output')!.textContent).toBe('INPUT');
  const retained = document.querySelector('label');
  document.querySelector<HTMLButtonElement>('button.inside')!.click();
  document.querySelector<HTMLButtonElement>('#rename')!.click();
  expect(document.querySelector('strong')!.textContent).toBe('B');
  expect(document.querySelector('label span')!.textContent).toBe('B');
  expect(document.querySelector('label')).toBe(retained);
  expect(document.querySelector('button.inside')!.textContent).toBe('1');
  toggle();
  check();
  expect(document.querySelector('output')!.textContent).toBe('none');
  toggle();
  check();
  expect(document.querySelector('output')!.textContent).toBe('INPUT');
});
