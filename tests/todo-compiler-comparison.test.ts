import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@memoized-dom/compiler';
import {
  _internals,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, 'fixtures', 'todo-compiler-comparison.tsx');
const outDir = join(here, 'fixtures', 'out');
const output = join(outDir, 'todo-compiler-comparison.compiled.ts');
const compiledSpecifier = './fixtures/out/todo-compiler-comparison.compiled.ts';
let code = '';
let scheduled: Array<() => void> = [];

function flush(): void {
  while (scheduled.length > 0) scheduled.shift()!();
}

beforeAll(() => {
  mkdirSync(outDir, { recursive: true });
  code = compile(readFileSync(fixture, 'utf8'), {
    runtimePath: '@memoized-dom/runtime',
  });
  writeFileSync(output, code);
});

describe('real TODO compiler regression', () => {
  beforeEach(() => {
    _internals().registry.forEach((_, id) => unregister(id));
    scheduled = [];
    setScheduler((run) => scheduled.push(run));
    document.body.innerHTML = '';
  });

  afterEach(() => {
    resetScheduler();
  });

  it('emits scoped, path-sensitive updates for the authored handlers', () => {
    expect(code).not.toContain('markDirtySubtree("App")');
    expect(code.match(/\.canReuseTemplate\(/g)).toHaveLength(1);
    expect(code).toMatch(/_when\d*\.update\(_reasons\d*\)/);
    expect(code).toMatch(/if \(_didWrite\d*\) _MD\.markDirty/);
  });

  it('accepts unknown future array methods and invalidates conservatively', () => {
    const future = compile(`
      function App() {
        const values = [];
        function inspect() { values.futureRead(); }
        return <button onClick={inspect}>{values.length}</button>;
      }
    `);

    expect(future).toContain('values.futureRead()');
    expect(future).toContain('_MD.markDirty(');
  });

  it('does not schedule an update for an empty submit', async () => {
    const { App } = await import(compiledSpecifier);
    document.body.appendChild(App('TodoComparison', null, []));
    const form = document.querySelector('form')!;
    const event = new Event('submit', { bubbles: true, cancelable: true });

    form.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(scheduled).toHaveLength(0);
    expect(document.querySelector('p')?.textContent).toContain('No tasks yet');
  });

  it('adds, refreshes one keyed row, and structurally removes it', async () => {
    const { App } = await import(compiledSpecifier);
    document.body.appendChild(App('TodoComparison', null, []));
    const input = document.querySelector('input[type="text"]') as HTMLInputElement;
    const form = document.querySelector('form')!;

    input.value = 'ship compiler';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flush();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flush();

    const row = document.querySelector('li')!;
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(row.textContent).toContain('ship compiler');

    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    flush();

    expect(document.querySelector('li')).toBe(row);
    expect(checkbox.checked).toBe(true);
    expect(row.querySelector('span')?.style.textDecoration).toBe('line-through');

    (row.querySelector('button') as HTMLButtonElement).click();
    flush();
    expect(document.querySelector('li')).toBeNull();
    expect(document.querySelector('p')?.textContent).toContain('No tasks yet');
  });
});
