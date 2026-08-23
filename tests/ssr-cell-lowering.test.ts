/**
 * SSR Phase 1.3 — compiler cell lowering (production Option B).
 *
 * Proves the `moduleStateCells` emission: authored module-state bindings
 * compile to request-owned state-cell operations while canonical identities
 * — and therefore access-table routing, computed entities, and component
 * updates — stay unchanged.
 *
 * Part A pins the emitted shape (owner records defaults, importers reference
 * the same identity, reads/writes lower to readCell/setCell/updateCell,
 * member mutations keep mutating through a lowered base read).
 *
 * Part B proves the SSR exit criterion end-to-end: ONE shared compiled module
 * record, TWO concurrent application runtimes, divergent mutations through
 * exported mutators — zero cross-request state and correct per-request
 * reactive updates through the replayed access table.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compileModules } from '@memoized-dom/compiler';
import {
  commit,
  createApplicationRuntime,
  getActiveApplicationRuntime,
  resetScheduler,
  runWithApplicationRuntime,
  setScheduler,
} from '@memoized-dom/runtime';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

const ownerSource = `
  export let count = 0;
  export const store = { selectedId: null, items: [] as string[] };

  export function inc(): void {
    count += 1;
    store.items.push('item-' + count);
  }
`;

const importerSource = `
  import { count, store, inc } from './cell-state';

  export function App() {
    return (
      <ul>
        <li>{count}</li>
        <li>{store.items.length}</li>
      </ul>
    );
  }
`;

function compileWithCells() {
  return compileModules(
    {
      './cell-state.ts': ownerSource,
      './cell-app.tsx': importerSource,
    },
    { runtimePath: '@memoized-dom/runtime', moduleStateCells: true },
  );
}

describe('module-state cell lowering', () => {
  beforeEach(() => {
    setScheduler((run) => run());
  });

  afterEach(() => {
    resetScheduler();
    getActiveApplicationRuntime();
  });

  it('emits owner defaults, importer refs, and lowered reads/writes', () => {
    const output = compileWithCells();

    const owner = output['./cell-state.ts']!;
    // Owner records the authored default; object stores become factories so
    // every request instantiates fresh objects.
    expect(owner).toContain(
      '_MD.defineStateCell("./cell-state.ts#count", 0)',
    );
    expect(owner).toMatch(
      /_MD\.defineStateCell\("\.\/cell-state\.ts#store", \(\) => \{\s*return \{/,
    );
    // Writes lower onto the request's own cells.
    expect(owner).toContain('_MD.updateCell(_cell');
    expect(owner).toContain("_MD.readCell(_cell");
    expect(owner).toContain('.items.push(');

    const importer = output['./cell-app.tsx']!;
    // Importer references the same identity with NO default of its own.
    expect(importer).toContain(
      '_MD.defineStateCell("./cell-state.ts#count")',
    );
    expect(importer).toContain(
      '_MD.defineStateCell("./cell-state.ts#store")',
    );
    // Authored value imports of lifted bindings collapse to a side-effect
    // import (owner evaluation order preserved); reads are cell reads.
    expect(importer).toContain("import './cell-state'");
    expect(importer).not.toMatch(/import \{[^}]*\} from '\.\/cell-state'/);
    expect(importer).toContain('_MD.readCell(_cell');
    // Canonical access-table routing is untouched.
    expect(importer).toContain('"./cell-state.ts#count"');
  });

  it('rejects non-literal module-state initializers instead of sharing them', () => {
    expect(() =>
      compileModules(
        {
          './bad-store.ts': `
            export const store = { items: externalSeed() };
            function externalSeed() { return []; }
          `,
        },
        { runtimePath: '@memoized-dom/runtime', moduleStateCells: true },
      ),
    ).toThrow(/plain object\/array literal/);

    expect(() =>
      compileModules(
        {
          './bad-let.ts': `
            let derived = base + 1;
          `,
        },
        { runtimePath: '@memoized-dom/runtime', moduleStateCells: true },
      ),
    ).toThrow(/initialized from a literal/);
  });

  it('isolates two concurrent requests over ONE compiled module record', async () => {
    mkdirSync(outDir, { recursive: true });
    const output = compileWithCells();
    const ownerPath = join(outDir, 'cell-state.ts');
    const appPath = join(outDir, 'cell-app.ts');
    writeFileSync(ownerPath, output['./cell-state.ts']!);
    writeFileSync(appPath, output['./cell-app.tsx']!);
    // ONE shared set of module records for both "requests" - the production
    // cell architecture reuses compiled code across requests.
    const state = await import(pathToFileURL(ownerPath).href);
    const mod = await import(pathToFileURL(appPath).href);

    const requestA = createApplicationRuntime('cell-req-a');
    const requestB = createApplicationRuntime('cell-req-b');

    let rootA: Element;
    let rootB: Element;
    runWithApplicationRuntime(requestA, () => {
      rootA = mod.App('App', null) as Element;
    });
    runWithApplicationRuntime(requestB, () => {
      rootB = mod.App('App', null) as Element;
    });

    // Both start from authored defaults.
    expect(rootA!.textContent).toBe('00');
    expect(rootB!.textContent).toBe('00');

    // Divergent mutations through the SAME exported mutator functions of the
    // SAME module record: each write lands in the active request's cells and
    // invalidates only that request's readers via the replayed access table.
    // (Request runtimes schedule commits asynchronously by default; commit()
    // drains the active request deterministically.)
    runWithApplicationRuntime(requestA, () => {
      state.inc();
      commit();
    });
    runWithApplicationRuntime(requestB, () => {
      state.inc();
      commit();
    });
    runWithApplicationRuntime(requestB, () => {
      state.inc();
      commit();
    });

    expect(rootA!.textContent).toBe('11');
    expect(rootB!.textContent).toBe('22');

    requestA.dispose();
    requestB.dispose();

    // Disposal resets cells: a reused runtime starts from authored defaults.
    runWithApplicationRuntime(requestA, () => {
      const root = mod.App('App', null) as Element;
      expect(root.textContent).toBe('00');
    });
    requestA.dispose();
  });
});
