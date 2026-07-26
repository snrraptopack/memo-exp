/**
 * R18 protects the event-boundary contract: handlers without a recognized
 * write still invalidate their nearest component, row, or region entity.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { compile } from '@memoized-dom/compiler';
import {
  _internals,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const source = `
  const values = [1];
  values.filter = () => {
    values.push(values.length + 1);
    return [];
  };

  export function resetState() {
    values.length = 1;
  }

  export function App() {
    return <button id="filter" onClick={() => values.filter(Boolean)}>
      {values.length}
    </button>;
  }
`;

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

function importCompiled(): Promise<any> {
  return import('./fixtures/out/r18-event.compiled.ts');
}

describe('R18 - scoped event-boundary invalidation', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r18-event.compiled.ts'),
      compile(source, { runtimePath: '@memoized-dom/runtime' }),
    );
  });

  beforeEach(async () => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    setScheduler((fn) => fn());
    const mod = await importCompiled();
    mod.resetState();
  });

  afterEach(() => {
    resetScheduler();
  });

  it('rerenders the handler origin when no write is recognized', async () => {
    const mod = await importCompiled();
    document.body.appendChild(mod.App('App', null));
    const button = document.querySelector<HTMLButtonElement>('#filter')!;

    expect(button.textContent?.trim()).toBe('1');
    button.click();
    expect(button.textContent?.trim()).toBe('2');
  });

  it('emits receiver-bounded rather than root-subtree invalidation', () => {
    const code = compile(source);
    expect(code).toMatch(
      /values\.filter\(Boolean\);\s+_MD\d*\.commitWrites\(_WRITES_\d*\)/,
    );
    expect(code).not.toContain('markDirtySubtree');
  });

  it('starts row events from the row entity', () => {
    const code = compile(`
      const values = [{ id: 1 }];
      function App() {
        return <ul>{values.map(value =>
          <li key={value.id} onClick={() => value.id}>{value.id}</li>
        )}</ul>;
      }
    `);
    expect(code).toMatch(/value\.id;\s+_MD\d*\.markDirty\(_rowId\d*\)/);
  });

  it('starts conditional-branch events from the region entity', () => {
    const code = compile(`
      let visible = true;
      function App() {
        return <div>{visible
          ? <button onClick={() => Math.random()}>check</button>
          : null}</div>;
      }
    `);
    expect(code).toMatch(
      /Math\.random\(\);\s+_MD\d*\.markDirty\(_id\d* \+ "\/when0"\)/,
    );
  });

  it('wraps a shared write-free handler with each call site origin', () => {
    const code = compile(`
      let visible = true;
      function App() {
        const inspect = () => Math.random();
        return <main>
          <button onClick={inspect}>owner</button>
          {visible ? <button onClick={inspect}>region</button> : null}
        </main>;
      }
    `);
    expect(code).toMatch(
      /inspect\(_event\d*\);\s+_MD\d*\.markDirty\(_id\d*\)/,
    );
    expect(code).toMatch(
      /inspect\(_event\d*\);\s+_MD\d*\.markDirty\(_id\d* \+ "\/when0"\)/,
    );
  });
});
