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

it('lowers React useRef to an MMD instance box and DOM ref sink', async () => {
  const appFile = join(fixtureRoot, 'ref-app.tsx');
  const compiled = compileFixture({ entries: [appFile], packages: ['ref-kit'],
    outDir: 'out/ref' });
  const code = compiled.output['ref-kit/index.tsx']!;
  expect(code).not.toMatch(/from ['"]react['"]/);
  const app = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(appFile)!).href);
  document.body.appendChild(app.App('App', null));
  const check = () => document.querySelector<HTMLButtonElement>('#check')!.click();
  const toggle = () => document.querySelector<HTMLButtonElement>('#toggle')!.click();
  const seen = () => document.querySelector('output')!.textContent;
  check();
  expect(seen()).toBe('field,forwarded');
  toggle();
  expect(document.querySelector('#field')).toBeNull();
  check();
  expect(seen()).toBe('none,none');
  toggle();
  check();
  expect(seen()).toBe('field,forwarded');
});
