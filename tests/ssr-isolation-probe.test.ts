/**
 * SSR Phase 1.3 — module-state isolation probe.
 *
 * Answers the proposal's highest-risk question: can two concurrent server
 * requests render the same application graph with different module-level
 * state and provably zero cross-request reads?
 *
 * Part A (Option A oracle): per-request graph evaluation. The same compiled
 * fixture is instantiated twice as separate module records. Proves ordinary
 * ESM evaluation isolates perfectly — and documents its cost (N requests =
 * N module evaluations).
 *
 * Part B (Option B prototype): state cells. ONE shared "compiled" module
 * (the cell descriptors are static, exactly as the compiler would emit them)
 * with storage owned by each application runtime. Proves divergent state,
 * functional updates, and that invalidation still routes through the
 * existing access table under the canonical identity.
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
  defineStateCell,
  installAccessTable,
  readCell,
  register,
  resetScheduler,
  runWithApplicationRuntime,
  setCell,
  setScheduler,
  unregister,
  updateCell,
} from '@memoized-dom/runtime';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

// Authored module-state fixture: exactly the pattern applications write.
const source = `
  export let count = 0;
  export let items: string[] = [];

  export function increment(): number {
    count += 1;
    return count;
  }
  export function readCount(): number {
    return count;
  }
  export function addItem(item: string): number {
    items.push(item);
    return items.length;
  }
  export function readItems(): string[] {
    return items;
  }
`;

describe('module-state isolation probe', () => {
  beforeEach(() => {
    setScheduler((run) => run());
  });

  afterEach(() => {
    resetScheduler();
    getActiveApplicationRuntime();
    // Ambient default has nothing registered by these probes; per-runtime
    // entities are drained via dispose() within each test.
  });

  // -------------------------------------------------------------------------
  // Part A — Option A: per-request graph evaluation (correctness oracle)
  // -------------------------------------------------------------------------
  describe('option A: per-request module evaluation', () => {
    it('isolates module state completely across request instances', async () => {
      mkdirSync(outDir, { recursive: true });
      const output = compileModules(
        { './probe-state.ts': source },
        { runtimePath: '@memoized-dom/runtime' },
      );
      const compiled = output['./probe-state.ts']!;
      // Two module records from one compilation: what a per-request
      // evaluator does for every request.
      const fileA = join(outDir, 'probe-a.mjs');
      const fileB = join(outDir, 'probe-b.mjs');
      writeFileSync(fileA, compiled);
      writeFileSync(fileB, compiled);

      const requestA = await import(pathToFileURL(fileA).href);
      const requestB = await import(pathToFileURL(fileB).href);

      // Interleaved mutations: each request mutates its own bindings.
      expect(requestA.increment()).toBe(1);
      expect(requestA.increment()).toBe(2);
      expect(requestB.increment()).toBe(1);
      requestA.addItem('from-A');
      requestB.addItem('from-B');

      // Zero cross-request reads.
      expect(requestA.readCount()).toBe(2);
      expect(requestB.readCount()).toBe(1);
      expect(requestA.readItems()).toEqual(['from-A']);
      expect(requestB.readItems()).toEqual(['from-B']);
    });
  });

  // -------------------------------------------------------------------------
  // Part B — Option B prototype: state cells on the application runtime
  // -------------------------------------------------------------------------
  describe('option B prototype: state cells', () => {
    // Static cell descriptors — exactly what the compiler emits at module
    // scope. ONE shared instance here; only the runtime differs per request.
    const cellCount = defineStateCell('./probe/state.ts#count', 0);
    const cellItems = defineStateCell<string[]>('./probe/state.ts#items', []);

    it('gives each runtime independent storage with lazy authored defaults', () => {
      const a = createApplicationRuntime('request-a');
      const b = createApplicationRuntime('request-b');

      runWithApplicationRuntime(a, () => {
        expect(readCell(cellCount)).toBe(0); // authored initial
      });
      runWithApplicationRuntime(b, () => {
        expect(readCell(cellCount)).toBe(0);
      });

      // Divergent writes.
      runWithApplicationRuntime(a, () => {
        setCell(cellCount, 100);
      });
      runWithApplicationRuntime(b, () => {
        setCell(cellCount, 200);
        updateCell(cellItems, (items) => [...items, 'from-B']);
      });
      runWithApplicationRuntime(a, () => {
        updateCell(cellCount, (c) => c + 1);
      });

      runWithApplicationRuntime(a, () => {
        expect(readCell(cellCount)).toBe(101);
        expect(readCell(cellItems)).toEqual([]);
      });
      runWithApplicationRuntime(b, () => {
        expect(readCell(cellCount)).toBe(200);
        expect(readCell(cellItems)).toEqual(['from-B']);
      });

      a.dispose();
      b.dispose();
    });

    it('routes invalidation through the access table by canonical identity', () => {
      const a = createApplicationRuntime('request-a');
      const renders: number[] = [];

      runWithApplicationRuntime(a, () => {
        installAccessTable(
          { readers: { './probe/state.ts#count': ['Probe/Counter'] } },
          'Probe',
        );
        register({
          id: 'Probe/Counter',
          parent: null,
          render: () => {
            renders.push(readCell(cellCount));
          },
        });
      });

      runWithApplicationRuntime(a, () => {
        setCell(cellCount, 7);
        commit();
      });

      // The write invalidated the reader via the canonical key — the same
      // routing an authored `count = 7` uses today.
      expect(renders).toEqual([7]);

      a.dispose();
    });

    it('dispose() resets cells so a reused runtime starts from authored defaults', () => {
      const a = createApplicationRuntime('request-reuse');
      runWithApplicationRuntime(a, () => {
        setCell(cellCount, 42);
        expect(readCell(cellCount)).toBe(42);
      });

      a.dispose();
      runWithApplicationRuntime(a, () => {
        expect(readCell(cellCount)).toBe(0);
      });
    });
  });
});
