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

  it('diagnoses a local hook call before deleting its definition', () => {
    const entry = join(fixtureRoot, 'hook-local-app.tsx');
    expect(() => compileFixture({ entries: [entry], packages: ['hook-local-kit'] }))
      .toThrow('local specialization is not implemented');
  });
});
