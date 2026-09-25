import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _internals, resetAccessTable, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';
import { compileFixture, fixtureRoot } from './harness';

const app = join(fixtureRoot, 'hook-app.tsx');
const result = compileFixture({ entries: [app], packages: ['hook-kit'], outDir: 'out/hooks' });

beforeEach(() => {
  document.body.replaceChildren();
  _internals().registry.forEach((_, id) => unregister(id));
  resetAccessTable();
  setScheduler(run => run());
});
afterEach(() => {
  resetScheduler();
  vi.restoreAllMocks();
});

describe('linked custom hooks', () => {
  it('specializes a package hook into independent component state', async () => {
    const emitted = result.output['hook-kit/index.tsx']!;
    const source = result.output['hook-kit/useCounter.ts']!;
    expect(emitted).not.toMatch(/\buseCounter\s*\(|from ['"]react['"]/);
    expect(emitted).toMatch(/import ['"]\.\/useCounter['"]/);
    expect(source).not.toMatch(/useCounter|from ['"]react['"]/);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { App } = await import(/* @vite-ignore */ pathToFileURL(result.emitted.get(app)!).href);
    expect(log).toHaveBeenCalledWith('hook-kit module evaluated');
    document.body.appendChild(App('HookApp', null));
    const [first, second] = [...document.querySelectorAll('button')];
    expect([first?.textContent, second?.textContent]).toEqual(['2:20', '2:20']);
    first!.click();
    expect([first?.textContent, second?.textContent]).toEqual(['4:22', '2:20']);
    second!.click();
    expect([first?.textContent, second?.textContent]).toEqual(['4:22', '4:22']);
  });

  it('diagnoses a source-module capture before deleting the hook export', () => {
    const entry = join(fixtureRoot, 'hook-capture-app.tsx');
    expect(() => compileFixture({ entries: [entry], packages: ['hook-capture-kit'] }))
      .toThrow("captures module binding 'moduleInitial'");
  });

  it('specializes a local hook through the same owner plan', async () => {
    const entry = join(fixtureRoot, 'hook-local-app.tsx');
    const local = compileFixture({ entries: [entry], packages: ['hook-local-kit'],
      outDir: 'out/local-hooks' });
    expect(local.output['hook-local-kit/index.tsx']).not.toMatch(/\buseCounter\s*\(/);
    const { App } = await import(/* @vite-ignore */ pathToFileURL(local.emitted.get(entry)!).href);
    document.body.appendChild(App('LocalHookApp', null));
    const button = document.querySelector('button')!;
    expect(button.textContent).toBe('1');
    button.click();
    expect(button.textContent).toBe('2');
  });

  it('resolves a named hook reexport and removes its runtime export', async () => {
    const entry = join(fixtureRoot, 'hook-barrel-app.tsx');
    const barrel = compileFixture({ entries: [entry], packages: ['hook-barrel-kit'],
      outDir: 'out/barrel-hooks' });
    expect(barrel.output['hook-barrel-kit/hooks.ts']).not.toMatch(/export.*useCounter/);
    expect(barrel.output['hook-barrel-kit/hook-public.ts']).not.toMatch(/export.*useCounter/);
    expect(barrel.output['hook-barrel-kit/index.tsx']).not.toMatch(/\buseCounter\s*\(/);
    const { App } = await import(/* @vite-ignore */ pathToFileURL(barrel.emitted.get(entry)!).href);
    document.body.appendChild(App('BarrelHookApp', null));
    const button = document.querySelector('button')!;
    expect(button.textContent).toBe('3');
    button.click();
    expect(button.textContent).toBe('4');
  });

  it('lets an MMD application component own a linked package hook', async () => {
    const entry = join(fixtureRoot, 'hook-direct-app.tsx');
    const direct = compileFixture({ entries: [entry], packages: ['hook-kit'],
      outDir: 'out/direct-hooks' });
    expect(direct.output[entry]).not.toMatch(/\buseCounter\s*\(|from ['"]react['"]/);
    const { App } = await import(/* @vite-ignore */ pathToFileURL(direct.emitted.get(entry)!).href);
    document.body.appendChild(App('DirectHookApp', null));
    const button = document.querySelector('button')!;
    expect(button.textContent).toBe('10');
    button.click();
    expect(button.textContent).toBe('12');
  });
});
