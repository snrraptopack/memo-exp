/**
 * Production-runtime benchmark for receiver-bounded false-positive effects.
 *
 * A pure method call leaves the observed value unchanged. The benchmark
 * compares access-table routing to the unbounded root-subtree fallback and
 * verifies render counts plus zero guarded writes before timing either path.
 */

import { installAccessTable, resetAccessTable } from '@memoized-dom/runtime';
import { commitWrites } from '@memoized-dom/runtime';
import {
  commit,
  markDirtySubtree,
  register,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime';

interface Counters {
  renders: number;
  writes: number;
}

interface Operation {
  run: () => number;
  counters: Counters;
  dispose: () => void;
}

interface Row {
  readers: number;
  boundedNs: number;
  rootNs: number;
  relative: number;
}

const STATE_KEY = './state.ts#items';
const TOTAL_ENTITIES = 1_024;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function makeOperation(readers: number, bounded: boolean): Operation {
  resetAccessTable();
  let pending: (() => void) | null = null;
  setScheduler((flush) => {
    pending = flush;
  });

  const counters: Counters = { renders: 0, writes: 0 };
  let observed = 1;
  const items = [1];
  const readerIds = Array.from(
    { length: readers },
    (_, index) => `App/reader-${index}`,
  );

  register({
    id: 'App',
    parent: null,
    render: () => {
      counters.renders++;
    },
  });
  for (let index = 0; index < TOTAL_ENTITIES; index++) {
    const readsReceiver = index < readers;
    let cached = observed;
    register({
      id: readsReceiver ? readerIds[index]! : `App/unrelated-${index}`,
      parent: 'App',
      render: () => {
        counters.renders++;
        if (readsReceiver && cached !== observed) {
          cached = observed;
          counters.writes++;
        }
      },
    });
  }
  installAccessTable({ readers: { [STATE_KEY]: readerIds } }, 'App');

  const run = (): number => {
    const result = items.filter(Boolean);
    if (bounded) commitWrites([STATE_KEY]);
    else markDirtySubtree('App');
    const flush = pending;
    pending = null;
    if (flush !== null) flush();
    return result.length + observed;
  };

  return {
    run,
    counters,
    dispose: () => {
      unregister('App');
      resetAccessTable();
      resetScheduler();
      // Ensure no deferred benchmark commit survives teardown.
      commit();
    },
  };
}

function verify(readers: number, bounded: boolean): void {
  const operation = makeOperation(readers, bounded);
  try {
    let sink = 0;
    const operations = 17;
    for (let index = 0; index < operations; index++) sink += operation.run();
    const expectedPerOperation = bounded ? readers : TOTAL_ENTITIES + 1;
    if (operation.counters.renders !== operations * expectedPerOperation) {
      throw new Error(
        `render mismatch: ${operation.counters.renders} !== ` +
          `${operations * expectedPerOperation}`,
      );
    }
    if (operation.counters.writes !== 0 || sink === 0) {
      throw new Error('pure receiver scenario performed a guarded write');
    }
  } finally {
    operation.dispose();
  }
}

function calibrate(run: () => number): number {
  let iterations = 1;
  let elapsed = 0;
  while (iterations < 10_000_000) {
    const start = performance.now();
    let sink = 0;
    for (let index = 0; index < iterations; index++) sink += run();
    elapsed = performance.now() - start;
    if (sink === 0) throw new Error('benchmark result became unobservable');
    if (elapsed >= 25) break;
    iterations *= 2;
  }
  return Math.max(
    1,
    Math.min(
      10_000_000,
      Math.round(iterations * (75 / Math.max(elapsed, 0.01))),
    ),
  );
}

function measure(readers: number, bounded: boolean): number {
  verify(readers, bounded);
  const operation = makeOperation(readers, bounded);
  try {
    for (let index = 0; index < 1_000; index++) operation.run();
    const iterations = calibrate(operation.run);
    const samples: number[] = [];
    for (let sample = 0; sample < 9; sample++) {
      const start = performance.now();
      let sink = 0;
      for (let index = 0; index < iterations; index++) {
        sink += operation.run();
      }
      const elapsed = performance.now() - start;
      if (sink === 0) throw new Error('benchmark result became unobservable');
      samples.push((elapsed * 1_000_000) / iterations);
    }
    return median(samples);
  } finally {
    operation.dispose();
  }
}

const rows: Row[] = [1, 32, 256].map((readers) => {
  const boundedNs = measure(readers, true);
  const rootNs = measure(readers, false);
  return {
    readers,
    boundedNs,
    rootNs,
    relative: rootNs / boundedNs,
  };
});

console.log('\nRECEIVER-BOUNDED EFFECTS (Bun, median of 9)\n');
console.log(
  'readers'.padStart(8),
  'bounded'.padStart(14),
  'root fallback'.padStart(16),
  'relative'.padStart(11),
);
console.log('-'.repeat(54));
for (const row of rows) {
  console.log(
    String(row.readers).padStart(8),
    `${row.boundedNs.toFixed(1)}ns`.padStart(14),
    `${row.rootNs.toFixed(1)}ns`.padStart(16),
    `${row.relative.toFixed(2)}x`.padStart(11),
  );
}
console.log(
  '\n1,024 child entities; pure filter; production routing and commit drain.',
);
