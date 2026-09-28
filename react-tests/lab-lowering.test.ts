import { afterEach, beforeEach, expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  _internals, resetAccessTable, resetScheduler, setScheduler, unregister,
} from '@memoized-dom/runtime/testing';
import { compileFixture } from './harness';

const casesRoot = join(__dirname, '..', 'assimilation', 'react', 'src', 'cases');
const paths = {
  memo: join(casesRoot, '05-usememo', 'Case.tsx'),
  callback: join(casesRoot, '06-usecallback', 'Case.tsx'),
  attrs: join(casesRoot, '17-attrs', 'Case.tsx'),
  deferred: join(casesRoot, '14-usedeferredvalue', 'Case.tsx'),
};
const compiled = compileFixture({
  entries: Object.values(paths),
  outDir: 'out/lab-lowering',
});

async function mountCase(file: string, exportName: string) {
  const module = await import(/* @vite-ignore */ pathToFileURL(compiled.emitted.get(file)!).href);
  document.body.appendChild(module[exportName](exportName, null));
}

beforeEach(() => {
  document.body.replaceChildren();
  _internals().registry.forEach((_, id) => unregister(id));
  resetAccessTable();
  setScheduler((run) => run());
});
afterEach(() => resetScheduler());

it('updates both useMemo derivations from the authored React lab case', async () => {
  await mountCase(paths.memo, 'UseMemoDerived');
  const label = document.querySelector('[data-testid="label"]')!;
  const [count, rename] = document.querySelectorAll<HTMLButtonElement>('button');
  expect(label.textContent).toBe('alpha:2');
  count!.click();
  expect(label.textContent).toBe('alpha:4');
  rename!.click();
  expect(label.textContent).toBe('beta:4');
});

it('uses the current step in a lowered useCallback closure', async () => {
  await mountCase(paths.callback, 'UseCallbackStep');
  const count = document.querySelector('[data-testid="count"]')!;
  const [advance, raise, reset] = document.querySelectorAll<HTMLButtonElement>('button');
  advance!.click();
  raise!.click();
  advance!.click();
  expect(count.textContent).toBe('3');
  reset!.click();
  advance!.click();
  expect(count.textContent).toBe('4');
});

it('keeps the deferred value immediate after MMD receives the change event', async () => {
  await mountCase(paths.deferred, 'UseDeferredValueCase');
  const input = document.querySelector<HTMLInputElement>('input')!;
  input.value = 'q';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  expect(document.querySelector('li')!.textContent).toBe(' row 0');
  input.dispatchEvent(new Event('change', { bubbles: true }));
  expect(document.querySelector('li')!.textContent).toBe('q row 0');
  expect(document.querySelector('[data-testid="stale"]')).toBeNull();
});

it('updates React-authored host attributes, properties, and input events', async () => {
  await mountCase(paths.attrs, 'AttrsCase');
  const state = document.querySelector<HTMLParagraphElement>('p[data-state]')!;
  const style = document.querySelector<HTMLElement>('div[style]')!;
  const label = document.querySelector<HTMLLabelElement>('label')!;
  const [field, checkbox, text] = document.querySelectorAll<HTMLInputElement>('input');
  const [disabled, toggle] = document.querySelectorAll<HTMLButtonElement>('button');
  expect(state.className).toBe('state-off');
  expect(state.dataset.state).toBe('off');
  expect(state.getAttribute('aria-live')).toBe('polite');
  expect(label.htmlFor).toBe(field!.id);
  expect(style.style.backgroundColor).toBe('#eee');
  expect(style.style.borderWidth).toBe('2px');
  expect(disabled!.disabled).toBe(true);
  expect(checkbox!.checked).toBe(true);

  toggle!.click();
  expect(state.className).toBe('state-on');
  expect(style.style.backgroundColor).toBe('#cde');
  expect(disabled!.disabled).toBe(false);
  checkbox!.click();
  expect(checkbox!.checked).toBe(false);
  text!.value = 'typed';
  text!.dispatchEvent(new Event('input', { bubbles: true }));
  expect(document.querySelector('[data-testid="echo"]')!.textContent).toBe('');
  text!.dispatchEvent(new Event('change', { bubbles: true }));
  expect(document.querySelector('[data-testid="echo"]')!.textContent).toBe('typed');
});
